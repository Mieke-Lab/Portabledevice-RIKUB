"""Offline base maps: a caching tile proxy plus area downloads.

The map pages load their base layer from /api/tiles/<layer>/<z>/<x>/<y> instead of
the tile providers directly. A tile already in storage/tiles is served from disk, so a
map that was viewed (or downloaded) once keeps working without internet. A missing tile
is fetched from the provider once, stored, then served. POST /api/tiles/download fetches
every tile of an area ahead of time (the field, before going out of signal), and
POST /api/tiles/prefetch quietly caches the area a drone page is showing. A tile that is
neither stored nor fetchable is cut from a stored lower-zoom tile, so the map turns
blurry instead of blank.
"""
import asyncio
import io
import logging
import math
import os
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

TILE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "tiles"

# Same ids and native zooms as BASE_LAYERS in web/src/components/maps/mapConfig.js.
# bulk=False: only cached as viewed, never area-downloaded. "default" was OSM until OSM
# blocked the device for bulk prefetch (2026-10); it is now Esri's street map.
LAYERS = {
    "default": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        "ext": "jpg", "media": "image/jpeg", "max_zoom": 19, "bulk": False,
    },
    "satellite": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "ext": "jpg", "media": "image/jpeg", "max_zoom": 18, "bulk": True,
    },
    "terrain": {
        "url": "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "ext": "png", "media": "image/png", "max_zoom": 17, "bulk": False,
    },
}

USER_AGENT = "JagaPadi/1.0 (RIKUB portable device; offline tile cache)"
FETCH_TIMEOUT = httpx.Timeout(20.0, connect=8.0)  # phone hotspots are slow to connect
OFFLINE_BACKOFF_S = 15   # after a connection failure, serve only from disk for a while
DOWNLOAD_RETRIES = 3
MAX_DOWNLOAD_TILES = 20000  # one area download; keeps it to a field, not a region
DOWNLOAD_WORKERS = 4
EST_BYTES_PER_TILE = 25_000
MAX_PREFETCH_TILES = 3000
PREFETCH_QUEUE = 8
PREFETCH_WORKERS = 2     # leaves fetch slots for the tiles the map is asking for
FALLBACK_LEVELS = 6      # an ancestor 6 zooms up still gives 4x4 px per tile
CACHE_HEADERS = {"Cache-Control": "public, max-age=604800"}
NO_STORE = {"Cache-Control": "no-store"}

_client: httpx.AsyncClient | None = None
_fetch_slots = asyncio.Semaphore(6)
_offline_until = 0.0


class _Offline(Exception):
    """The provider could not be reached (no internet, DNS, connect timeout)."""


def _reset_offline() -> None:
    global _offline_until
    _offline_until = 0.0


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=FETCH_TIMEOUT, headers={"User-Agent": USER_AGENT},
                                    follow_redirects=True)
    return _client


def _spec(layer: str, z: int, x: int, y: int) -> dict:
    spec = LAYERS.get(layer)
    if spec is None:
        raise HTTPException(404, "Layer peta tidak dikenal")
    n = 1 << z if z >= 0 else 0
    if not (0 <= z <= spec["max_zoom"] and 0 <= x < n and 0 <= y < n):
        raise HTTPException(404, "Tile di luar jangkauan")
    return spec


def _tile_path(layer: str, z: int, x: int, y: int) -> Path:
    return TILE_ROOT / layer / str(z) / str(x) / f"{y}.{LAYERS[layer]['ext']}"


async def _fetch(layer: str, z: int, x: int, y: int) -> bytes | None:
    """Download one tile and store it. None = the provider has no such tile."""
    global _offline_until
    if time.monotonic() < _offline_until:
        raise _Offline()
    url = LAYERS[layer]["url"].format(z=z, x=x, y=y)
    async with _fetch_slots:
        try:
            resp = await _http().get(url)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:  # no internet / DNS
            _offline_until = time.monotonic() + OFFLINE_BACKOFF_S
            raise _Offline() from exc
        except httpx.HTTPError:  # slow or broken response: only this tile fails
            return None
    # OSM answers a blocked client with 200 + an "Access blocked" picture; never store that
    if resp.status_code != 200 or not resp.content or "x-blocked" in resp.headers:
        return None
    path = _tile_path(layer, z, x, y)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{id(resp)}.part")
    tmp.write_bytes(resp.content)
    os.replace(tmp, path)  # atomic: a half-written tile is never served
    return resp.content


def _overzoom(layer: str, z: int, x: int, y: int) -> bytes | None:
    """The tile cut out of the nearest stored ancestor and scaled up, or None."""
    for up in range(1, min(FALLBACK_LEVELS, z) + 1):
        src = _tile_path(layer, z - up, x >> up, y >> up)
        if not src.is_file():
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            span = im.width / (1 << up)
            ox = (x - ((x >> up) << up)) * span
            oy = (y - ((y >> up) << up)) * span
            tile = im.resize((im.width, im.height), Image.BILINEAR,
                             box=(ox, oy, ox + span, oy + span))
        buf = io.BytesIO()
        if LAYERS[layer]["ext"] == "jpg":
            tile.save(buf, format="JPEG", quality=80)
        else:
            tile.save(buf, format="PNG")
        return buf.getvalue()
    return None


@router.get("/{layer}/{z}/{x}/{y}")
async def get_tile(layer: str, z: int, x: int, y: int):
    spec = _spec(layer, z, x, y)
    path = _tile_path(layer, z, x, y)
    if path.is_file():
        return FileResponse(path, media_type=spec["media"], headers=CACHE_HEADERS)
    try:
        data = await _fetch(layer, z, x, y)
    except _Offline:
        data = None
    if data is not None:
        return Response(data, media_type=spec["media"], headers=CACHE_HEADERS)
    # no-store: once the real tile can be fetched, the next view replaces the blurry one
    data = await asyncio.to_thread(_overzoom, layer, z, x, y)
    if data is None:
        return Response(status_code=404, headers=NO_STORE)
    return Response(data, media_type=spec["media"], headers=NO_STORE)


# --- area download ------------------------------------------------------------------

class DownloadIn(BaseModel):
    layers: list[str] = ["satellite"]
    south: float
    west: float
    north: float
    east: float
    min_zoom: int = 10
    max_zoom: int = 19
    dry_run: bool = False


def _tile_xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 1 << z
    lat = max(min(lat, 85.0511), -85.0511)
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def _area_tiles(body: DownloadIn):
    """(layer, z, x, y) for every tile covering the area, each layer up to its native zoom."""
    for layer in body.layers:
        top = min(body.max_zoom, LAYERS[layer]["max_zoom"])
        for z in range(max(body.min_zoom, 0), top + 1):
            x0, y0 = _tile_xy(body.north, body.west, z)
            x1, y1 = _tile_xy(body.south, body.east, z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    yield layer, z, x, y


def _area_count(body: DownloadIn) -> int:
    total = 0
    for layer in body.layers:
        top = min(body.max_zoom, LAYERS[layer]["max_zoom"])
        for z in range(max(body.min_zoom, 0), top + 1):
            x0, y0 = _tile_xy(body.north, body.west, z)
            x1, y1 = _tile_xy(body.south, body.east, z)
            total += (x1 - x0 + 1) * (y1 - y0 + 1)
    return total


_job: dict = {"running": False}
_job_task: asyncio.Task | None = None


async def _run_download(body: DownloadIn) -> None:
    tiles = _area_tiles(body)  # shared by the workers; next() never runs concurrently

    async def worker():
        for layer, z, x, y in tiles:
            if _job["cancel"]:
                return
            if _tile_path(layer, z, x, y).is_file():
                _job["cached"] += 1
            else:
                for attempt in range(DOWNLOAD_RETRIES):
                    try:
                        data = await _fetch(layer, z, x, y)
                        break
                    except _Offline:
                        if attempt == DOWNLOAD_RETRIES - 1:
                            _job["error"] = ("Internet terputus, unduhan dihentikan. Tile yang sudah "
                                             "tersimpan tetap bisa dipakai; ulangi saat online.")
                            _job["cancel"] = True
                            return
                        await asyncio.sleep(3 * (attempt + 1))
                        _reset_offline()  # the user asked for this download: try the network again
                _job["saved" if data is not None else "failed"] += 1
            _job["done"] += 1

    try:
        await asyncio.gather(*(worker() for _ in range(DOWNLOAD_WORKERS)))
    finally:
        _job["running"] = False
        _job["finished_at"] = time.time()


def _check_area(body: DownloadIn, limit: int) -> int:
    unknown = [l for l in body.layers if l not in LAYERS]
    if unknown or not body.layers:
        raise HTTPException(400, f"Layer peta tidak dikenal: {', '.join(unknown) or '-'}")
    no_bulk = [l for l in body.layers if not LAYERS[l]["bulk"]]
    if no_bulk:
        raise HTTPException(400, f"Layer {', '.join(no_bulk)} tidak boleh diunduh massal (kebijakan "
                                 "penyedia peta); layer ini tersimpan otomatis saat dilihat.")
    if body.south >= body.north or body.west >= body.east:
        raise HTTPException(400, "Batas area tidak valid")
    total = _area_count(body)
    if total > limit:
        raise HTTPException(400, f"Area terlalu luas ({total:,} tile, batas {limit:,}). "
                                 "Perbesar peta (zoom in) ke area lahan, lalu coba lagi.")
    return total


@router.post("/download")
async def start_download(body: DownloadIn):
    global _job, _job_task
    total = _check_area(body, MAX_DOWNLOAD_TILES)
    if body.dry_run:
        cached = sum(1 for t in _area_tiles(body) if _tile_path(*t).is_file())
        return {"tiles": total, "cached": cached,
                "estimate_mb": round((total - cached) * EST_BYTES_PER_TILE / 1e6, 1)}
    if _job.get("running"):
        raise HTTPException(409, "Unduhan peta lain masih berjalan")
    _reset_offline()
    _job = {"running": True, "cancel": False, "error": None, "layers": body.layers,
            "min_zoom": body.min_zoom, "max_zoom": body.max_zoom, "total": total,
            "done": 0, "saved": 0, "cached": 0, "failed": 0,
            "started_at": time.time(), "finished_at": None}
    _job_task = asyncio.create_task(_run_download(body))
    return download_status()


@router.get("/download")
def download_status():
    return {k: v for k, v in _job.items() if k != "cancel"}


@router.delete("/download")
def cancel_download():
    if _job.get("running"):
        _job["cancel"] = True
        _job["error"] = "Dibatalkan"
    return download_status()


@router.get("/stats")
def tile_stats():
    """Tiles and bytes stored per layer."""
    out = {}
    for layer in LAYERS:
        count = size = 0
        for root, _dirs, files in os.walk(TILE_ROOT / layer):
            for name in files:
                if not name.endswith(".part"):
                    count += 1
                    size += os.path.getsize(os.path.join(root, name))
        out[layer] = {"tiles": count, "mb": round(size / 1e6, 1)}
    return {"layers": out, "offline": time.monotonic() < _offline_until}


# --- background prefetch of the area a page shows --------------------------------------

_prefetch_queue: asyncio.Queue[DownloadIn] = asyncio.Queue(maxsize=PREFETCH_QUEUE)
_prefetch_task: asyncio.Task | None = None


async def _prefetch_loop() -> None:
    while True:
        body = await _prefetch_queue.get()
        missing = (t for t in _area_tiles(body) if not _tile_path(*t).is_file())

        async def worker():
            for tile in missing:
                await _fetch(*tile)

        try:
            async with asyncio.TaskGroup() as tg:
                for _ in range(PREFETCH_WORKERS):
                    tg.create_task(worker())
        except* _Offline:
            pass  # dropped; the page asks again the next time it opens
        except* Exception:
            log.exception("tile prefetch failed")


@router.post("/prefetch", status_code=202)
async def prefetch_area(body: DownloadIn):
    """Cache an area in the background (no progress, no dry run), skipping stored tiles."""
    global _prefetch_task
    _check_area(body, MAX_PREFETCH_TILES)
    if _prefetch_task is None or _prefetch_task.done():
        _prefetch_task = asyncio.create_task(_prefetch_loop())
    try:
        _prefetch_queue.put_nowait(body)
    except asyncio.QueueFull:
        return {"queued": False}
    return {"queued": True}
