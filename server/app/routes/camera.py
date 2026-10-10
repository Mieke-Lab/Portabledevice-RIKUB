import asyncio
import logging
import time

import cv2
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import camera_analysis, camera_tuning

router = APIRouter(prefix="/api/camera", tags=["camera"])
logger = logging.getLogger("camera")

CAMERA_DEVICE = "/dev/video0"
STREAM_FPS_FALLBACK = 10  # used only if camera_config.json can't be read; see preview.fps
JPEG_QUALITY = 80

# The physical device only supports one open handle reliably; this lock keeps
# the live-preview stream and the "capture a still" endpoint from opening it
# concurrently (getUserMedia() in the WebKitGTK kiosk browser cannot read this
# webcam at all - a WebKit/GStreamer caps-negotiation bug confirmed via direct
# GStreamer testing, which worked fine outside the browser - so capture is
# done here, server-side, instead).
_camera_lock = asyncio.Lock()
_cap: cv2.VideoCapture | None = None


def _open() -> cv2.VideoCapture:
    global _cap
    if _cap is None or not _cap.isOpened():
        _cap = cv2.VideoCapture(CAMERA_DEVICE)
        if not _cap.isOpened():
            raise RuntimeError(f"Tidak dapat membuka kamera di {CAMERA_DEVICE}")
        # The preview reads slower than the camera delivers; with the default 4-deep
        # queue each read returns a frame that is already stale. 2 is the floor: with 1
        # the driver has no buffer to fill while we hold ours and fps halves (measured).
        _cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
    return _cap


def _release() -> None:
    global _cap
    if _cap is not None:
        _cap.release()
        _cap = None


def _read_frame():
    cap = _open()
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError("Gagal membaca frame dari kamera")
    return frame


def _encode(frame) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise RuntimeError("Gagal mengenkode frame ke JPEG")
    return buf.tobytes()


def _read_jpeg() -> bytes:
    return _encode(_read_frame())


def _preview_fps() -> float:
    try:
        return float(camera_tuning.load_config()["preview"]["fps"])
    except (camera_tuning.CameraControlError, KeyError, TypeError, ValueError):
        return STREAM_FPS_FALLBACK


# Latest leaf-area indicators from the preview (see app/camera_analysis.py), served
# by GET /metrics. Only updated while a preview stream is running.
_metrics: dict | None = None
_metrics_at = 0.0


def _preview_jpeg(overlay: bool) -> bytes:
    """One preview frame. Runs the leaf analysis at most every analysis.interval_s
    (every frame when the overlay is on, since it needs the mask). The overlay is
    drawn on a downscaled copy - captured stills never go through here."""
    global _metrics, _metrics_at
    frame = _read_frame()
    now = time.monotonic()
    try:
        cfg = camera_tuning.load_config()
    except camera_tuning.CameraControlError as exc:
        logger.warning("preview analysis skipped: %s", exc)
        return _encode(frame)
    if not overlay and now - _metrics_at < cfg["analysis"]["interval_s"]:
        return _encode(frame)
    small = camera_analysis.downscale(frame, cfg["analysis"]["width_px"])
    metrics, leaf, clipped = camera_analysis.analyze(small, cfg)
    if now - _metrics_at >= cfg["analysis"]["interval_s"]:
        _metrics, _metrics_at = metrics, now
    return _encode(camera_analysis.draw_overlay(small, leaf, clipped) if overlay else frame)


@router.get("/stream")
async def stream(request: Request, overlay: bool = False):
    async def frames():
        global _metrics
        try:
            while True:
                if await request.is_disconnected():
                    break
                started = time.monotonic()
                async with _camera_lock:
                    try:
                        jpeg = await run_in_threadpool(_preview_jpeg, overlay)
                    except RuntimeError as exc:
                        logger.warning("camera stream error: %s", exc)
                        break
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                )
                # Sleep only what's left of this frame's slot (read + encode already
                # took part of it), so the stream actually runs at preview.fps.
                await asyncio.sleep(max(0.0, 1 / _preview_fps() - (time.monotonic() - started)))
        finally:
            # Release as soon as the viewer navigates away/closes the tab so
            # the camera (and its LED) isn't left open indefinitely.
            async with _camera_lock:
                _release()
            _metrics = None  # stale once the preview stops

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.post("/capture")
async def capture():
    async with _camera_lock:
        try:
            jpeg = await run_in_threadpool(_read_jpeg)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
    return Response(content=jpeg, media_type="image/jpeg")


# --- Manual tuning ('Siang Terik Sawah' preset) - see app/camera_tuning.py ---------
# V4L2 controls are set on the device while the stream above keeps it open, so these
# don't take _camera_lock: slider moves land in the live preview immediately.


class TuningValues(BaseModel):
    ev: float | None = None
    wb_temperature: float | None = None
    focus: float | None = None


async def _tuning_call(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except camera_tuning.CameraControlError as exc:
        logger.warning("camera tuning error: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/tuning")
async def get_tuning():
    return await _tuning_call(camera_tuning.status)


@router.post("/tuning")
async def set_tuning(values: TuningValues):
    return await _tuning_call(camera_tuning.apply, values.model_dump(exclude_none=True))


@router.post("/tuning/auto")
async def tuning_auto():
    return await _tuning_call(camera_tuning.reset_auto)


@router.post("/tuning/reset")
async def tuning_reset():
    """Factory reset of the camera controls (see camera_tuning.reset_defaults)."""
    return await _tuning_call(camera_tuning.reset_defaults)


@router.post("/preset/save")
async def preset_save():
    return await _tuning_call(camera_tuning.save_preset)


@router.post("/preset/load")
async def preset_load():
    return await _tuning_call(camera_tuning.load_preset)


@router.get("/metrics")
async def metrics():
    """Latest leaf-area indicators from the running preview + CPU temperature and the
    thresholds the UI colours them against. metrics is null when no preview runs."""
    try:
        cfg = camera_tuning.load_config()
    except camera_tuning.CameraControlError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {
        "metrics": _metrics,
        "age_s": round(time.monotonic() - _metrics_at, 1) if _metrics else None,
        "cpu_temp_c": camera_analysis.cpu_temp_c(),
        "thresholds": {
            k: v for k, v in {**cfg["quality"], **cfg["thermal"]}.items() if not k.startswith("_")
        },
        "leaf_ranges": [
            {"name": r["name"], "enabled": r.get("enabled", True)} for r in cfg["leaf_mask"]["ranges"]
        ],
    }
