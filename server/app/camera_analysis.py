"""Leaf-area image indicators for the camera preview ('Siang Terik Sawah' preset).

Everything here runs on the small preview frame (downscaled to analysis.width_px) so it
stays cheap on the Pi. Thresholds and HSV ranges come from server/camera_config.json.
Nothing here ever modifies a frame that gets saved: draw_overlay() returns a copy that
is only used for the live preview.
"""

from pathlib import Path

import cv2
import numpy as np

CPU_TEMP_PATH = Path("/sys/class/thermal/thermal_zone0/temp")


def cpu_temp_c() -> float | None:
    try:
        return int(CPU_TEMP_PATH.read_text()) / 1000.0
    except (OSError, ValueError):
        return None


def downscale(frame: np.ndarray, width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    if w <= width:
        return frame
    return cv2.resize(frame, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)


def _kernel(px: int) -> np.ndarray | None:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px, px)) if px and px > 1 else None


def leaf_mask(bgr: np.ndarray, mask_cfg: dict) -> np.ndarray:
    """uint8 mask (255 = leaf): union of every enabled HSV range, specks removed."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = np.zeros(bgr.shape[:2], np.uint8)
    for r in mask_cfg["ranges"]:
        if r.get("enabled", True):
            mask |= cv2.inRange(hsv, np.array(r["lower"], np.uint8), np.array(r["upper"], np.uint8))
    k = _kernel(mask_cfg.get("morph_open_px", 0))
    if k is not None:
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    return mask


def clipped_on_leaf(clipped: np.ndarray, leaf: np.ndarray, ring_px: int, enclosed_ratio: float) -> np.ndarray:
    """Blobs of clipped pixels that sit on a leaf. A blown-out leaf highlight is white, so
    it is never inside the colour mask itself; instead a blob counts when at least
    enclosed_ratio of a ring_px ring around it is leaf. Glare on water that merely
    touches a leaf edge has mostly non-leaf surroundings and is left out."""
    n, labels = cv2.connectedComponents(clipped.astype(np.uint8), connectivity=8)
    if n <= 1:
        return np.zeros(clipped.shape, np.uint8)
    # Vectorised over all blobs at once: grow the label image by ring_px (grey dilation
    # takes the max label nearby - blobs closer than ring_px effectively share a ring),
    # then count ring pixels, and leaf ring pixels, per label with bincount.
    grown = cv2.dilate(labels.astype(np.float32), _kernel(2 * ring_px + 1)).astype(np.int32)
    ring = (grown > 0) & (labels == 0)
    total = np.bincount(grown[ring], minlength=n)
    on_leaf = np.bincount(grown[ring & (leaf > 0)], minlength=n)
    keep = (total > 0) & (on_leaf >= enclosed_ratio * total)
    keep[0] = False
    return keep[labels].astype(np.uint8) * 255


def analyze(bgr_small: np.ndarray, cfg: dict) -> tuple[dict, np.ndarray, np.ndarray]:
    """Indicators for one (already downscaled) BGR frame.

    Returns (metrics, leaf_mask, clipped_leaf_mask). clip_percent = clipped leaf pixels
    / (leaf pixels + clipped leaf pixels), i.e. the share of the true leaf area that is
    blown out. Sharpness is the Laplacian variance over leaf pixels only; the median luma
    of those pixels feeds the custom AE in stage 4.
    """
    mask_cfg, q = cfg["leaf_mask"], cfg["quality"]
    leaf = leaf_mask(bgr_small, mask_cfg)
    clipped_px = (bgr_small >= q["clip_level"]).any(axis=2)
    clipped_leaf = clipped_on_leaf(
        clipped_px, leaf, mask_cfg.get("clip_ring_px", 3), mask_cfg.get("clip_enclosed_ratio", 0.5))

    gray = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    leaf_px = leaf > 0
    n_leaf, n_clip = int(leaf_px.sum()), int((clipped_leaf > 0).sum())

    leaf_percent = 100.0 * n_leaf / leaf.size
    has_leaf = leaf_percent >= mask_cfg.get("min_leaf_percent", 0)
    metrics = {
        "leaf_percent": round(leaf_percent, 2),
        "has_leaf": has_leaf,
        "clip_percent": round(100.0 * n_clip / (n_leaf + n_clip), 3) if n_leaf else None,
        "sharpness": round(float(lap[leaf_px].var()), 1) if n_leaf > 1 else None,
        "leaf_median_luma": int(np.median(gray[leaf_px])) if n_leaf else None,
        "analysis_size": [bgr_small.shape[1], bgr_small.shape[0]],
    }
    return metrics, leaf, clipped_leaf


def draw_overlay(bgr_small: np.ndarray, leaf: np.ndarray, clipped: np.ndarray) -> np.ndarray:
    """Preview-only visualisation: leaf mask tinted green with its outline, clipped
    leaf pixels painted solid red. Returns a new image."""
    out = bgr_small.copy()
    tint = out.copy()
    tint[leaf > 0] = (0, 255, 0)
    out = cv2.addWeighted(tint, 0.35, out, 0.65, 0)
    contours, _ = cv2.findContours(leaf, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(out, contours, -1, (0, 255, 0), 1)
    out[clipped > 0] = (0, 0, 255)
    return out
