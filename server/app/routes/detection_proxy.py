"""Same-origin proxy for the rice-disease CV+soil fusion service, with persistence.

The kiosk browser is served over self-signed HTTPS and can't call the plain-HTTP CV
microservice (127.0.0.1:5001) directly (mixed content). This route accepts the uploaded
leaf image, reads the CURRENT live soil reading IN-PROCESS from sensor.py, builds the
model's 8-d soil vector, forwards image+soil to the CV service, PERSISTS every result to
`disease_detections`, then returns the CV JSON. Mirrors chatbot_proxy.py (lock, httpx,
clean error JSON).
"""
import asyncio
import base64
import logging
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import ChatMessage, ChatSession, DiseaseDetection, SprayPolygon, TargetDetection
from app.routes.fields import auto_chambers_from_detections
from app.routes.sensor import latest_reading

router = APIRouter()

CV_UPSTREAM_URL = os.getenv("CV_UPSTREAM_URL", "http://127.0.0.1:5001")
CV_PROXY_TIMEOUT = 30.0  # inference ~2s (two YOLO passes); generous for a cold start + queue

# Images are written here and served read-only at /detections/<name> (mounted in main.py).
_STORAGE_DIR = Path(__file__).resolve().parents[2] / "storage" / "detections"
_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}

logger = logging.getLogger("detection_proxy")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# Live sensor key -> the fusion model's 7-channel deployment order
# [Temp,Moisture,Conductivity,pH,N,P,K] (already in the model's raw units). The model imputes
# its 8th feature (Fertility) internally from these seven (see cv_model README / soil_scaler
# `fertility_impute`), so we send exactly 7 — no placeholder needed.
_SOIL_ORDER = ["temp", "moisture", "ec", "ph", "n", "p", "k"]

# The CV model is single-threaded; serialize upstream calls (honest queueing, like chatbot_proxy).
_lock = asyncio.Lock()


def _soil_context() -> tuple[list[float] | None, dict | None]:
    """From the live sensor, return (8-d vector for the model, named snapshot for the DB).
    Both are None when the sensor is disconnected/stale, a value is missing, or the packet
    is all-zero (probe no-contact) — so we never feed OR record garbage soil."""
    snap = latest_reading()
    if not snap.get("connected"):
        return None, None
    by_key = {r["key"]: r["value"] for r in snap.get("readings", [])}
    vals = [by_key.get(k) for k in _SOIL_ORDER]
    if any(v is None for v in vals):
        return None, None
    if all(float(v) == 0.0 for v in vals):
        return None, None
    snapshot = {k: float(by_key[k]) for k in _SOIL_ORDER}
    return [float(v) for v in vals], snapshot  # 7-d; model imputes Fertility internally


def _sensor_gps() -> tuple[float | None, float | None]:
    """The ESP32 field GPS from the live sensor packet, only when it has a satellite fix."""
    g = latest_reading().get("gps") or {}
    if g.get("fix") and (g.get("lat") or g.get("lon")):
        return g.get("lat"), g.get("lon")
    return None, None


def _resolve_location(lat, lng) -> tuple[float | None, float | None, str | None]:
    """Geotag every detection. Prefer the client device's browser GPS (real when
    /detection is opened from a phone via Tailscale); otherwise fall back to the ESP32
    sensor's field GPS — the dependable source on the Pi kiosk, where the browser has no
    GPS hardware. Returns (lat, lng, source)."""
    if lat is not None and lng is not None:
        return lat, lng, "device"
    slat, slng = _sensor_gps()
    if slat is not None:
        return slat, slng, "sensor"
    return None, None, None


def _persist_detection(db, raw, original_name, source, lat, lng, gps_source, data, soil_snapshot) -> str:
    """Save the image to storage/detections and insert one disease_detections row.
    Best-effort — a failure here must never break the user-facing detection result."""
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(original_name or "")[1].lower()
    if ext not in _ALLOWED_EXT:
        ext = ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    (_STORAGE_DIR / fname).write_bytes(raw)

    top = data.get("top") or {}
    row = DiseaseDetection(
        source=source if source in ("camera", "upload") else "upload",
        image_path=fname,
        original_name=original_name or None,
        sample_lat=lat,
        sample_lng=lng,
        gps_source=gps_source,
        top_disease=top.get("name"),
        top_confidence=top.get("p_final"),
        present=data.get("present") or [],
        n_detections=data.get("n_detections"),
        used_soil=bool(data.get("used_soil")),
        soil_snapshot=soil_snapshot,
    )
    db.add(row)
    db.commit()
    return row


# All 7 CV classes are fungal/bacterial leaf/grain diseases → the fungicide/bactericide
# chamber. (The insektisida chamber is for insect pests, which this vision model never
# detects.) Server owns this mapping so the GIS "Deteksi HPT" link is authoritative.
_DISEASE_CHAMBER = {
    "Hawar-Daun": "fungisida", "Blast": "fungisida", "Bercak-Cokelat-Sempit": "fungisida",
    "bercak-Cokelat": "fungisida", "Busuk-Pelepah": "fungisida", "Busuk-Bulir": "fungisida",
    "Gosong-Palsu": "fungisida",
}

# A plain-file breadcrumb for the GIS zone-link flow — the systemd backend's stdout goes to
# journald which is unreadable on this Pi, so we also append here for diagnosis.
_ZONE_DEBUG_LOG = Path(__file__).resolve().parents[2] / "detect-zone-debug.log"


def _zone_debug(msg: str) -> None:
    try:
        with _ZONE_DEBUG_LOG.open("a") as f:
            f.write(f"{datetime.utcnow().isoformat()} {msg}\n")
    except Exception:
        pass


def _insert_targets(db, present, by_name, image_url, lat, lng, polygon=None, soil_snapshot=None) -> int:
    """Record detected diseases into target_detections — one row per present disease.
    If `polygon` is given, attach the rows to that GIS spray zone and recompute its chamber
    (same rule as POST /polygons/{id}/detections). If `polygon` is None, the rows are inserted
    with polygon_id NULL — a plain (non-zone) detection logged in the same table. The live soil
    snapshot at capture time is stored on each row. Atomic own commit; caller wraps in
    try/except so a failure never breaks the diagnosis."""
    for name in present:
        cls = by_name.get(name) or {}
        db.add(TargetDetection(
            polygon_id=polygon.id if polygon is not None else None,
            disease_name=name,
            confidence=cls.get("p_final"),
            sample_lat=lat,
            sample_lng=lng,
            chamber=_DISEASE_CHAMBER.get(name, "fungisida"),
            image_path=image_url,
            soil_snapshot=soil_snapshot,
        ))
    db.flush()
    if polygon is not None and polygon.chamber_mode != "manual":
        polygon.selected_chambers = auto_chambers_from_detections(polygon)
        polygon.chamber_mode = "auto" if polygon.selected_chambers else "none"
    db.commit()
    return len(present)


@router.post("/api/detect")
async def detect(
    image: UploadFile = File(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    source: str = Form("upload"),
    polygon_id: str | None = Form(None),  # set by the GIS "Deteksi HPT" flow → link to spray zone
    zone_code: str | None = Form(None),
    db: Session = Depends(get_db),
):
    raw = await image.read()
    soil, soil_snapshot = _soil_context()
    logger.info("detect: bytes=%d source=%s used_soil=%s", len(raw), source, soil is not None)
    payload = {"image_b64": base64.b64encode(raw).decode("ascii"), "soil": soil}

    async with _lock:
        try:
            async with httpx.AsyncClient(timeout=CV_PROXY_TIMEOUT) as client:
                resp = await client.post(f"{CV_UPSTREAM_URL}/detect", json=payload)
        except httpx.TimeoutException:
            logger.warning("detect: upstream timeout")
            return JSONResponse(
                status_code=504,
                content={"ok": False, "message": "Layanan deteksi tidak merespon (timeout)."},
            )
        except httpx.ConnectError:
            logger.warning("detect: upstream unreachable")
            return JSONResponse(
                status_code=502,
                content={"ok": False, "message": "Layanan deteksi tidak dapat dihubungi."},
            )
        except Exception:
            logger.exception("detect: unexpected proxy error")
            return JSONResponse(
                status_code=502,
                content={"ok": False, "message": "Layanan deteksi mengalami kesalahan."},
            )

    data = resp.json()
    # Persist EVERY successful detection (camera OR upload). Best-effort: a DB hiccup
    # must not break the diagnosis the user sees.
    if resp.status_code == 200 and isinstance(data, dict) and data.get("top"):
        flat, flng, gps_source = _resolve_location(lat, lng)
        try:
            row = _persist_detection(db, raw, image.filename, source, flat, flng, gps_source, data, soil_snapshot)
            data["detection_id"] = str(row.id)  # so the client can attach the AI narrative later
            # Same-origin URL of the saved leaf image. The GIS "Deteksi HPT" flow passes this
            # as the spray-zone detection's thumbnail (target_detections.image_path).
            data["image_url"] = f"/detections/{row.image_path}" if row.image_path else None
            logger.info(
                "detect: saved id=%s image=%s top=%s present=%s gps=%s(%s,%s)",
                row.id, row.image_path, (data.get("top") or {}).get("name"), data.get("present"),
                gps_source, flat, flng,
            )
        except Exception:
            db.rollback()
            logger.exception("detect: failed to persist detection (non-fatal)")

        # Record detected diseases into target_detections. GIS "Deteksi HPT" attaches them to
        # the spray zone; a plain (non-zone) detection is still logged there with polygon_id NULL
        # (per request). Only diseases actually present become spray targets. Best-effort — a
        # failure here never breaks the diagnosis the user sees.
        present = data.get("present") or []
        by_name = {c.get("name"): c for c in (data.get("classes") or [])}
        _zone_debug(
            f"detect source={source} polygon_id={polygon_id!r} zone_code={zone_code!r} "
            f"present={present} image={data.get('image_url')}"
        )
        try:
            if polygon_id:
                polygon = None
                try:
                    polygon = db.get(SprayPolygon, uuid.UUID(str(polygon_id)))
                except (ValueError, TypeError, AttributeError):
                    polygon = None
                if polygon is None:
                    data["zone_linked"] = {"ok": False, "reason": "polygon_not_found"}
                else:
                    count = _insert_targets(db, present, by_name, data.get("image_url"), flat, flng, polygon, soil_snapshot) if present else 0
                    data["zone_linked"] = {"ok": True, "count": count, "zone_code": polygon.zone_code,
                                           "chambers": polygon.selected_chambers or []}
            elif present:
                # Non-zone detection: still recorded in target_detections (polygon_id NULL).
                _insert_targets(db, present, by_name, data.get("image_url"), flat, flng, None, soil_snapshot)
            _zone_debug(f"  -> targets done zone_linked={data.get('zone_linked')}")
        except Exception as exc:
            db.rollback()
            logger.exception("detect: target insert failed (non-fatal)")
            if polygon_id:
                data["zone_linked"] = {"ok": False, "reason": "exception"}
            _zone_debug(f"  -> target insert EXCEPTION {exc!r}")

    return JSONResponse(status_code=resp.status_code, content=data)


def _detection_to_dict(r: DiseaseDetection) -> dict:
    return {
        "id": str(r.id),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "source": r.source,
        "image_url": f"/detections/{r.image_path}" if r.image_path else None,
        "original_name": r.original_name,
        "lat": r.sample_lat,
        "lng": r.sample_lng,
        "gps_source": r.gps_source,
        "top_disease": r.top_disease,
        "top_confidence": r.top_confidence,
        "present": r.present or [],
        "n_detections": r.n_detections,
        "used_soil": r.used_soil,
        "soil_snapshot": r.soil_snapshot,
        "ai_narrative": r.ai_narrative,
    }


@router.get("/api/detections")
def list_detections(limit: int = 50, db: Session = Depends(get_db)) -> dict:
    rows = (
        db.query(DiseaseDetection)
        .order_by(DiseaseDetection.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return {"detections": [_detection_to_dict(r) for r in rows]}


class _NarrativeIn(BaseModel):
    prompt: str
    narrative: str
    # When the deepening came from the Jetson agent: its case id (the chat session continues
    # that case - follow-up questions in /chatbot) and the diagnosis-card payload.
    meta: dict | None = None
    agent_case_id: str | None = None


@router.post("/api/detections/{det_id}/narrative")
def save_narrative(det_id: str, body: _NarrativeIn, db: Session = Depends(get_db)):
    """Persist a 'Perdalam via AI' result: onto the detection row AND as a session in the
    LLM chat history (so it shows up in Riwayat). Called by the frontend after Gemma replies."""
    try:
        det = db.get(DiseaseDetection, uuid.UUID(det_id))
    except (ValueError, TypeError, AttributeError):
        det = None
    if det is None:
        return JSONResponse(status_code=404, content={"ok": False, "message": "Deteksi tidak ditemukan."})

    det.ai_narrative = body.narrative
    disease = (det.top_disease or "Deteksi").replace("-", " ")
    session = ChatSession(title=f"Pendalaman deteksi: {disease}",
                          agent_case_id=(body.agent_case_id or "").strip() or None)
    db.add(session)
    db.flush()
    db.add(ChatMessage(session_id=session.id, sender="user", text=body.prompt))
    db.add(ChatMessage(session_id=session.id, sender="bot", text=body.narrative, meta=body.meta))
    db.commit()
    return {"ok": True, "session_id": str(session.id)}
