"""Jaga Padi CV inference microservice — rice-disease CV+soil fusion.

Runs under /home/pi/venv_yolo (which has ultralytics/torch/torchvision/opencv).
Loads the UT-DCR DiseaseModel ONCE at startup and serves POST /detect. The main
backend (server/venv, no torch) proxies HTTPS same-origin /api/detect to here,
injecting the live soil reading — see server/app/routes/detection_proxy.py.

Kept as a SEPARATE process so the heavy torch stack never bloats/slows the main
API (which also owns the serial port, camera, DB and SPA). Bound to loopback
only; the browser never reaches it directly.
"""
import asyncio
import base64
import logging
import os
import sys
from contextlib import asynccontextmanager

CV_MODEL_DIR = os.getenv("CV_MODEL_DIR", "/home/pi/rikub-project/cv_model")
# cv_model/ has no __init__.py; import the module by putting its dir on the path.
sys.path.insert(0, CV_MODEL_DIR)

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from fusion_infer import DiseaseModel

logger = logging.getLogger("cv_service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

_model: DiseaseModel | None = None
# The model is NOT thread/concurrency-safe (YOLO + torch on CPU); serialize predict().
_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model
    logger.info("loading DiseaseModel from %s ...", CV_MODEL_DIR)
    _model = DiseaseModel(CV_MODEL_DIR, device="cpu")
    # Warm the YOLO path on a bundled sample so the FIRST real request isn't a cold
    # start (~seconds of graph build). Non-fatal if samples are missing.
    try:
        samples = os.path.join(CV_MODEL_DIR, "samples")
        first = next(
            (f for f in sorted(os.listdir(samples)) if f.lower().endswith((".jpg", ".jpeg", ".png"))),
            None,
        )
        if first:
            _model.predict(os.path.join(samples, first), soil=None)
            logger.info("warmup done on %s", first)
    except Exception:
        logger.exception("warmup failed (non-fatal)")
    logger.info("model ready")
    yield


app = FastAPI(lifespan=lifespan)


class DetectIn(BaseModel):
    image_b64: str
    soil: list[float] | None = None


@app.get("/health")
async def health() -> dict:
    return {"ready": _model is not None}


# Plant tissue by colour: yellow-green to green hue, not washed out or dark (OpenCV HSV).
# Brownish-orange (H 10-20) is included so yellowing/dying leaf still counts as leaf.
LEAF_HSV_LO = (10, 40, 40)
LEAF_HSV_HI = (95, 255, 255)
MIN_LEAF_FRACTION = 0.05  # below this the colour mask found no real leaf -> no percentage


def _lesion_percent(img_bgr, result):
    """Share of the leaf covered by the detector's disease masks, in %.

    The denominator is leaf pixels (colour mask) united with the lesion pixels - a
    lesion is often grey/brown and would fall outside a green mask - so a leaf shot on
    a white sheet or against soil is measured on the leaf, not on the whole photo.
    Returns None when there are no masks or no leaf-like area to measure against."""
    masks = getattr(result, "masks", None)
    if masks is None or not len(masks.xy):
        return None
    h, w = img_bgr.shape[:2]
    lesion = np.zeros((h, w), np.uint8)
    for poly in masks.xy:  # polygons already in original-image pixel coordinates
        if len(poly) >= 3:
            cv2.fillPoly(lesion, [poly.astype(np.int32)], 255)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    leaf = cv2.inRange(hsv, np.array(LEAF_HSV_LO, np.uint8), np.array(LEAF_HSV_HI, np.uint8))
    area = cv2.bitwise_or(leaf, lesion)
    n_area = int(np.count_nonzero(area))
    if n_area < MIN_LEAF_FRACTION * h * w:
        return None
    return round(100.0 * int(np.count_nonzero(lesion)) / n_area, 1)


def _segment_overlay(img_bgr):
    """Run the YOLO11s-seg detector once and draw its masks + boxes + class labels
    onto the image. fusion_infer.predict() discards these masks (it only uses the
    detector's per-class confidence), so we recover them here purely for display.

    Returns (jpeg_bytes | None, n_detections, lesion_percent | None). jpeg is None when the detector
    localized nothing — the diagnosis then comes from the whole-image classifier, so
    there is genuinely no region to segment (the UI says so rather than showing a
    mask-less copy of the original)."""
    try:
        r = _model.det.predict(
            img_bgr,
            imgsz=_model.yolo_imgsz,
            conf=_model.yolo_conf,
            device=_model.device,
            verbose=False,
        )[0]
        n = 0 if r.boxes is None else len(r.boxes)
        if n == 0:
            return None, 0, None
        try:
            lesion = _lesion_percent(img_bgr, r)
        except Exception:
            logger.exception("lesion area failed (non-fatal)")
            lesion = None
        annotated = r.plot()  # BGR ndarray with masks + boxes + labels rendered
        ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        return (buf.tobytes() if ok else None), n, lesion
    except Exception:
        logger.exception("segmentation overlay failed (non-fatal)")
        return None, 0, None


@app.post("/detect")
async def detect(inp: DetectIn):
    try:
        buf = np.frombuffer(base64.b64decode(inp.image_b64), np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "message": "invalid image data"})
    if img is None:
        return JSONResponse(status_code=400, content={"ok": False, "message": "cannot decode image"})
    if inp.soil is not None and len(inp.soil) not in (7, 8):
        # 7-d = deployment probe (model imputes Fertility); 8-d = incl. Fertility; both accepted.
        return JSONResponse(status_code=400, content={"ok": False, "message": "soil must be 7 or 8 floats or null"})

    # Both use the single-reader model; hold the lock across the diagnosis AND the
    # (second) YOLO pass for the mask overlay so nothing races the model.
    async with _lock:
        out = await run_in_threadpool(_model.predict, img, inp.soil, True)
        overlay, n_det, lesion = await run_in_threadpool(_segment_overlay, img)
    out["n_detections"] = n_det
    out["lesion_percent"] = lesion  # % of the leaf under disease masks; None = not measurable
    if overlay is not None:
        out["overlay_b64"] = base64.b64encode(overlay).decode("ascii")
    return out
