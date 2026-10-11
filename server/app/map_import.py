"""Pull a finished soerogis mapping session into the field-imagery store.

The soerogis mapping backend (the gRPC server on the drone / NUC) keeps every
session's orthophoto, NDVI mosaic and spray-zone KML behind its own plain-HTTP file
server. The HTTPS SPA cannot fetch those itself (mixed content), and the spraying and
Maps features only read imagery that lives *here*: `storage/imagery/<lahan>/<capture>/
{rgb,ndvi}.tif` registered as a `FieldImagery` row. So this module does what
`POST /imagery/register` expects someone to have done by hand:

1. download `stitched.tif` and `ndvi.tif` (and `clusters.kml`) server-to-server,
2. shape the orthophoto like the DJI maps already here: a 3-band uint8 `rgb.tif`
   (Red, Green, NIR — our RGN camera has no blue) with nodata 0, so
   `gdal_translate -b 1 -b 2 -b 3 -of PNG` writes a transparent surround instead of an
   opaque black one,
3. register it through the same code path as the register endpoint
   (`fields.upsert_imagery_for_field`), which makes the overlay PNGs, reads the corners
   and computes the NDVI stats.

Importing the same session again REFRESHES its imagery row in place (same id), so
approved spray zones stay attached.

Runs in a background thread (a 22 MP ortho takes tens of seconds on the Pi); the
frontend polls `GET /api/jobs/{id}/import`. The app is a single uvicorn worker, so the
in-memory status registry is enough; after a restart `find_import` rebuilds a `done`
status from the `source.json` marker written next to the imagery.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException

from app.db import database
from app.db.models import Field, FieldImagery
from app.routes import fields as fields_routes

log = logging.getLogger("rikub.map_import")

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SLUG_STRIP = re.compile(r"[^a-z0-9._-]+")
_CHUNK = 1 << 20
_HTTP_TIMEOUT_S = 60
MARKER_NAME = "source.json"

# One conversion at a time: gdal + the NDVI colourmap are memory-hungry on a Pi.
_HEAVY = threading.Lock()

Progress = Callable[[str, int, str], None]


class ImportFailed(Exception):
    """A step failed; the message is shown to the operator."""


@dataclass(frozen=True)
class ImportPlan:
    session_id: str
    field_name: str
    capture_at: datetime | None
    rel_dir: str          # relative to server/, posix: storage/imagery/<lahan>/capture-...
    stitched_url: str
    ndvi_url: str
    kml_url: str | None


def imagery_root() -> Path:
    return fields_routes.SERVER_ROOT / "storage" / "imagery"


def slugify(text: str, fallback: str = "lahan") -> str:
    slug = _SLUG_STRIP.sub("-", text.strip().lower()).strip("-._")
    return slug[:60] or fallback


def _parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def plan_import(session: dict[str, Any], field_name: str | None) -> ImportPlan:
    """Validate a (normalised) GetJob response and decide where its files go."""
    sid = str(session.get("id") or session.get("job_id") or "")
    if not SESSION_ID_RE.match(sid):
        raise HTTPException(status_code=400, detail="ID sesi tidak valid")
    status = session.get("status")
    if status != "ready":
        # Not just "has files": a session whose re-stitch failed keeps the previous
        # run's artifacts, and importing those would register stale imagery.
        raise HTTPException(status_code=409, detail=f"Peta belum siap (status: {status})")
    artifacts = session.get("artifacts") or {}
    if not artifacts.get("stitched_tif"):
        raise HTTPException(status_code=409, detail="Orthophoto (stitched.tif) belum tersedia")
    if not artifacts.get("ndvi_tif"):
        raise HTTPException(
            status_code=409,
            detail="ndvi.tif belum tersedia di backend mapping (jalankan StartNdvi atau perbarui backend)",
        )

    name = (
        (field_name or "").strip()
        or str(session.get("area_name") or "").strip()
        or str(session.get("name") or "").strip()
        or sid
    )
    if len(name) > 120:
        raise HTTPException(status_code=400, detail="Nama lahan terlalu panjang (maks 120 karakter)")

    capture_at = next(
        (dt for dt in (_parse_dt(session.get(k)) for k in ("captured_at", "created_at", "updated_at")) if dt),
        None,
    )
    day = (capture_at or datetime.now()).strftime("%Y-%m-%d")
    # The session's own suffix keeps two same-day surveys of one field apart, and makes
    # a re-import of the same session land on the same directory (=> refresh, not copy).
    short = slugify(sid.rsplit("_", 1)[-1], "sesi")
    return ImportPlan(
        session_id=sid,
        field_name=name,
        capture_at=capture_at,
        rel_dir=f"storage/imagery/{slugify(name)}/capture-{day}-{short}",
        stitched_url=artifacts["stitched_tif"],
        ndvi_url=artifacts["ndvi_tif"],
        kml_url=artifacts.get("clusters_kml") or None,
    )


def download_file(
    url: str,
    dest: Path,
    on_progress: Callable[[int, int], None] | None = None,
    timeout: float = _HTTP_TIMEOUT_S,
) -> int:
    """Stream ``url`` to ``dest`` (via ``.part``), refusing a short read. Returns bytes."""
    part = dest.with_name(dest.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "rikub-map-import"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            total = int(response.headers.get("Content-Length") or 0)
            got = 0
            with open(part, "wb") as out:
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
                    got += len(chunk)
                    if on_progress:
                        on_progress(got, total)
        if total and got != total:
            raise ImportFailed(f"Unduhan terpotong ({got} dari {total} byte): {dest.name}")
        os.replace(part, dest)
        return got
    except urllib.error.HTTPError as exc:
        raise ImportFailed(f"Backend mapping menjawab HTTP {exc.code} untuk {dest.name}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise ImportFailed(f"Tidak bisa mengunduh {dest.name} dari backend mapping: {reason}") from exc
    finally:
        part.unlink(missing_ok=True)


def build_rgb_tif(src: Path, dest: Path) -> None:
    """Orthophoto -> 3-band uint8 ``rgb.tif`` (R, G, NIR) with nodata 0.

    Atomic: written next to ``dest`` and renamed, so a failure never leaves a
    half-written rgb.tif that the register step would convert.
    """
    tmp = dest.with_name(dest.name + ".new")
    try:
        fields_routes.run_gdal_command([
            "gdal_translate", "-q", "-of", "GTiff",
            "-b", "1", "-b", "2", "-b", "3",
            "-a_nodata", "0",
            "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE",
            str(src), str(tmp),
        ])
        os.replace(tmp, dest)
    except HTTPException as exc:      # run_gdal_command speaks HTTP; this runs in a thread
        raise ImportFailed(str(exc.detail)) from exc
    finally:
        tmp.unlink(missing_ok=True)


def check_rasters(stitched: Path, ndvi: Path) -> None:
    """Cheap sanity checks before anything replaces the files in use."""
    try:
        import rasterio
    except ImportError as exc:       # pragma: no cover - rasterio is a hard dependency of /imagery
        raise ImportFailed("rasterio tidak terpasang di server") from exc
    try:
        with rasterio.open(stitched) as ds:
            if ds.count < 3 or ds.dtypes[0] != "uint8":
                raise ImportFailed(
                    f"stitched.tif tidak seperti yang diharapkan ({ds.count} band, {ds.dtypes[0]}; perlu >=3 band uint8)"
                )
        with rasterio.open(ndvi) as ds:
            if ds.count != 1 or not ds.dtypes[0].startswith("float"):
                raise ImportFailed(
                    f"ndvi.tif tidak seperti yang diharapkan ({ds.count} band, {ds.dtypes[0]}; perlu 1 band float)"
                )
    except rasterio.errors.RasterioIOError as exc:
        raise ImportFailed(f"File raster tidak terbaca: {exc}") from exc


def _files_for(rel_dir: str, has_kml: bool) -> dict[str, str | None]:
    base = "/" + "/".join(quote(part) for part in rel_dir.removeprefix("storage/").split("/"))
    return {
        "rgb_tif": f"{base}/rgb.tif",
        "ndvi_tif": f"{base}/ndvi.tif",
        "zones_kml": f"{base}/zones.kml" if has_kml else None,
    }


def import_session(plan: ImportPlan, progress: Progress) -> dict[str, Any]:
    """Download, shape and register one session. Returns the ``done`` payload."""
    root = fields_routes.SERVER_ROOT
    cap_dir = root / plan.rel_dir
    cap_dir.mkdir(parents=True, exist_ok=True)
    tmp_stitched = cap_dir / "stitched.src.tif"
    tmp_ndvi = cap_dir / "ndvi.src.tif"
    tmp_kml = cap_dir / "zones.src.kml"

    def scaled(lo: int, hi: int, label: str, step: str):
        def cb(got: int, total: int) -> None:
            frac = (got / total) if total else 0.0
            mb = got / 1_048_576
            progress(step, int(lo + (hi - lo) * frac), f"{label} ({mb:.0f} MB)")
        return cb

    try:
        progress("download-ortho", 1, "Mengunduh orthophoto…")
        download_file(plan.stitched_url, tmp_stitched, scaled(1, 40, "Mengunduh orthophoto", "download-ortho"))
        progress("download-ndvi", 40, "Mengunduh NDVI…")
        download_file(plan.ndvi_url, tmp_ndvi, scaled(40, 70, "Mengunduh NDVI", "download-ndvi"))

        has_kml = False
        if plan.kml_url:
            try:
                download_file(plan.kml_url, tmp_kml)
                has_kml = True
            except ImportFailed as exc:   # zones are optional for spraying (NDVI zones are made here)
                log.warning("zones KML skipped for %s: %s", plan.session_id, exc)

        progress("prepare", 72, "Menyiapkan RGB (R + G + NIR)…")
        check_rasters(tmp_stitched, tmp_ndvi)
        build_rgb_tif(tmp_stitched, cap_dir / "rgb.tif")
        os.replace(tmp_ndvi, cap_dir / "ndvi.tif")
        if has_kml:
            os.replace(tmp_kml, cap_dir / "zones.kml")

        progress("register", 80, "Membuat PNG overlay, statistik NDVI & mendaftarkan…")
        if database.SessionLocal is None:
            raise ImportFailed("DATABASE_URL belum dikonfigurasi")
        db = database.SessionLocal()
        try:
            field = db.query(Field).filter(Field.name == plan.field_name).first()
            if field is None:
                field = Field(name=plan.field_name)
                db.add(field)
                db.flush()
            payload = fields_routes.ImageryRegister(
                capture_at=plan.capture_at,
                rgb_tif_path=f"{plan.rel_dir}/rgb.tif",
                ndvi_tif_path=f"{plan.rel_dir}/ndvi.tif",
            )
            imagery, created = fields_routes.upsert_imagery_for_field(field, payload, db)
            imagery_dict = fields_routes.imagery_to_dict(imagery)
            field_dict = fields_routes.field_to_dict(field)
        finally:
            db.close()

        (cap_dir / MARKER_NAME).write_text(json.dumps({
            "session_id": plan.session_id,
            "field_id": field_dict["id"],
            "imagery_id": imagery_dict["id"],
            "imported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "created": created,
            "sources": {"stitched_tif": plan.stitched_url, "ndvi_tif": plan.ndvi_url, "clusters_kml": plan.kml_url},
        }, indent=2))
        log.info("imported session=%s -> %s (%s)", plan.session_id, plan.rel_dir, "new" if created else "refreshed")
        return {"imagery": imagery_dict, "field": field_dict, "files": _files_for(plan.rel_dir, has_kml), "refreshed": not created}
    finally:
        for leftover in (tmp_stitched, tmp_ndvi, tmp_kml):
            leftover.unlink(missing_ok=True)


class ImportRegistry:
    """Latest import status per session, plus the worker threads that produce it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def get(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            state = self._jobs.get(session_id)
            return dict(state) if state else None

    def _update(self, session_id: str, **fields: Any) -> None:
        with self._lock:
            self._jobs[session_id].update(fields)

    def start(self, plan: ImportPlan, runner: Callable[[ImportPlan, Progress], dict[str, Any]] | None = None) -> dict[str, Any]:
        """Start an import; a second request for a running one just returns its status."""
        with self._lock:
            current = self._jobs.get(plan.session_id)
            if current is not None and current["state"] == "running":
                return dict(current)
            self._jobs[plan.session_id] = state = {
                "state": "running", "session_id": plan.session_id, "field_name": plan.field_name,
                "step": "queued", "progress": 0, "message": "Mengantre…",
                "started_at": time.time(), "finished_at": None, "error": None,
                "imagery": None, "field": None, "files": None, "refreshed": None,
            }
            snapshot = dict(state)
        threading.Thread(
            target=self._run, args=(plan, runner or import_session),
            name=f"map-import-{plan.session_id}", daemon=True,
        ).start()
        return snapshot

    def _run(self, plan: ImportPlan, runner: Callable[[ImportPlan, Progress], dict[str, Any]]) -> None:
        sid = plan.session_id

        def progress(step: str, pct: int, message: str) -> None:
            self._update(sid, step=step, progress=max(0, min(99, int(pct))), message=message)

        try:
            with _HEAVY:
                result = runner(plan, progress)
            self._update(sid, state="done", step="done", progress=100, message="Selesai",
                         finished_at=time.time(), error=None, **result)
        except Exception as exc:   # noqa: BLE001 - every failure is reported to the operator
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc) or type(exc).__name__
            log.exception("map import failed session=%s", sid)
            self._update(sid, state="failed", step="failed", message="Gagal", error=str(detail),
                         finished_at=time.time())


REGISTRY = ImportRegistry()


def find_import(session_id: str, db) -> dict[str, Any] | None:
    """A ``done`` status for a session imported earlier (e.g. before a restart), else None."""
    for marker in imagery_root().glob(f"*/*/{MARKER_NAME}"):
        try:
            data = json.loads(marker.read_text())
        except (OSError, ValueError):
            continue
        if data.get("session_id") != session_id:
            continue
        try:
            imagery = db.get(FieldImagery, UUID(data["imagery_id"]))
        except (KeyError, ValueError):
            imagery = None
        if imagery is None:           # row deleted since: the marker is stale
            continue
        rel_dir = marker.parent.relative_to(fields_routes.SERVER_ROOT).as_posix()
        return {
            "state": "done", "session_id": session_id, "step": "done", "progress": 100,
            "message": "Sudah diunduh", "error": None, "imported_at": data.get("imported_at"),
            "imagery": fields_routes.imagery_to_dict(imagery),
            "field": fields_routes.field_to_dict(imagery.field),
            "files": _files_for(rel_dir, (marker.parent / "zones.kml").is_file()),
        }
    return None
