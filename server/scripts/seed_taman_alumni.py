"""Seed the 'Taman Alumni ITS' field from the legacy sessions/taman_alumni fixture.

Replaces the placeholder 'Lahan Uji NDVI' field (which was georeferenced to the
exact same Jember coordinates as 'Rute Spray Drone') with the real ITS Surabaya
capture, split into its two spray zones:

    Z01 -> fungisida, Z02 -> insektisida, 40 m no-spray corridor between them.

The zone polygons come straight from sessions/taman_alumni/spray-targets.geojson
(produced by that folder's convert_to_spray_targets.py). Imagery products are
derived from sessions/taman_alumni/stitched.tif, which is the NDVI raster
(single-band Float32, values -0.41..0.99, WGS84). No true RGB orthophoto was
captured for this fixture, so the RGB base layer is a natural-vegetation
colorization of the NDVI (tan -> deep green), clearly a derived product.

The 74 MP source raster is downsampled to a web-friendly size (~2000 px on the
long edge, matching the other fields) so the map overlay and on-demand NDVI-zone
previews stay responsive on the Pi.

Idempotent: safe to re-run. Regenerates imagery products and re-inserts the
field, imagery, and two polygons.

Run:  cd server && ./venv/bin/python3 scripts/seed_taman_alumni.py
"""
import json
import math
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parent
sys.path.insert(0, str(SERVER_ROOT))

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from PIL import Image  # noqa: E402
from rasterio import features as rfeatures  # noqa: E402

from app.db.database import SessionLocal  # noqa: E402
from app.db.models import Field, FieldImagery, SprayPolygon  # noqa: E402
from app.routes.fields import (  # noqa: E402
    compute_ndvi_stats,
    convert_ndvi_tif_to_png,
    png_url_from_tif_path,
    read_geotiff_corners,
)

# ---- configuration ---------------------------------------------------------
FIELD_NAME = "Taman Alumni ITS"
REPLACES_FIELD = "Lahan Uji NDVI"          # the placeholder to remove
CAPTURE_AT = datetime(2026, 5, 26, 17, 20, 0)   # from the raw DJI_20260526* frames
MAX_EDGE_PX = 2000                          # downsample target for the web overlay

SRC_NDVI = REPO_ROOT / "sessions" / "taman_alumni" / "stitched.tif"
GEOJSON = REPO_ROOT / "sessions" / "taman_alumni" / "spray-targets.geojson"

DEST_REL_DIR = Path("storage/imagery/taman-alumni/capture-2026-05-26")
DEST_DIR = SERVER_ROOT / DEST_REL_DIR
REL_NDVI = (DEST_REL_DIR / "ndvi.tif").as_posix()
REL_RGB = (DEST_REL_DIR / "rgb.tif").as_posix()

# Natural-vegetation ramp used for the derived RGB base layer.
COLOR_TAN = np.array([194, 178, 128], dtype="float32")   # low vigor  #c2b280
COLOR_GREEN = np.array([20, 83, 45], dtype="float32")    # high vigor #14532d
COLOR_SOIL = np.array([138, 127, 106], dtype="float32")  # NDVI < 0   #8a7f6a


def downsample_ndvi() -> None:
    """Downsample the 74 MP NDVI raster to <=MAX_EDGE_PX on its long edge,
    preserving CRS/bounds and nodata. Average resampling keeps NDVI honest."""
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    with rasterio.open(SRC_NDVI) as src:
        long_edge = max(src.width, src.height)
    if long_edge <= MAX_EDGE_PX:
        outsize = ["100%", "100%"]
    elif src_is_taller():
        outsize = ["0", str(MAX_EDGE_PX)]   # fix height, auto width
    else:
        outsize = [str(MAX_EDGE_PX), "0"]   # fix width, auto height

    cmd = [
        "gdal_translate", "-q", "-r", "average",
        "-outsize", outsize[0], outsize[1],
        "-a_nodata", "0",
        "-co", "COMPRESS=DEFLATE",
        str(SRC_NDVI), str(DEST_DIR / "ndvi.tif"),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def src_is_taller() -> bool:
    with rasterio.open(SRC_NDVI) as src:
        return src.height >= src.width


def build_rgb_products() -> None:
    """From the (downsampled) NDVI tif, write a 3-band RGB GeoTIFF plus a
    transparent-background RGBA PNG, both aligned to the NDVI grid."""
    ndvi_tif = DEST_DIR / "ndvi.tif"
    with rasterio.open(ndvi_tif) as src:
        ndvi = src.read(1).astype("float32")
        valid = (src.read_masks(1) > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not math.isnan(src.nodata):
            valid &= ~np.isclose(ndvi, src.nodata)
        profile = src.profile.copy()
        height, width = src.height, src.width

    ndvi_c = np.clip(np.nan_to_num(ndvi, nan=0.0), -1, 1)
    vigor = (np.clip(ndvi_c, 0.0, 0.9) / 0.9)[..., None]   # 0..1 for vegetation

    rgb = np.empty((height, width, 3), dtype="float32")
    veg = ndvi_c >= 0
    rgb[veg] = (COLOR_TAN + (COLOR_GREEN - COLOR_TAN) * vigor)[veg]
    rgb[~veg] = COLOR_SOIL
    rgb = rgb.astype("uint8")
    for channel in range(3):                                # zero out background
        rgb[~valid, channel] = 0

    profile.update(count=3, dtype="uint8", nodata=0,
                   compress="deflate", photometric="RGB")
    with rasterio.open(DEST_DIR / "rgb.tif", "w", **profile) as dst:
        for channel in range(3):
            dst.write(rgb[:, :, channel], channel + 1)
        dst.write_mask((valid * 255).astype("uint8"))

    rgba = np.zeros((height, width, 4), dtype="uint8")
    rgba[..., :3] = rgb
    rgba[..., 3] = np.where(valid, 255, 0).astype("uint8")
    Image.fromarray(rgba).save(DEST_DIR / "rgb.png", "PNG")


def zone_mean_ndvi() -> dict[str, float | None]:
    """Mean NDVI inside each spray zone, sampled on the downsampled raster."""
    features = json.loads(GEOJSON.read_text())["features"]
    with rasterio.open(DEST_DIR / "ndvi.tif") as src:
        ndvi = src.read(1).astype("float32")
        valid = (src.read_masks(1) > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not math.isnan(src.nodata):
            valid &= ~np.isclose(ndvi, src.nodata)
        transform, shape = src.transform, (src.height, src.width)

    means: dict[str, float | None] = {}
    for feature in features:
        mask = rfeatures.rasterize(
            [(feature["geometry"], 1)], out_shape=shape,
            transform=transform, fill=0, dtype="uint8",
        )
        values = ndvi[(mask == 1) & valid]
        code = feature["properties"]["zone_code"]
        means[code] = round(float(values.mean()), 4) if values.size else None
    return means


def seed_database() -> None:
    corners = read_geotiff_corners(REL_RGB) or {}
    if not corners:
        raise SystemExit("could not read georeferenced corners from rgb.tif")
    rgb_png_path = png_url_from_tif_path(REL_RGB)
    ndvi_png_path = convert_ndvi_tif_to_png(REL_NDVI)
    ndvi_stats = compute_ndvi_stats(REL_NDVI)
    means = zone_mean_ndvi()
    features = json.loads(GEOJSON.read_text())["features"]

    db = SessionLocal()
    try:
        # Inherit the default-selection slot: the frontend auto-selects the
        # earliest-created field, which was the placeholder we're replacing.
        placeholder = db.query(Field).filter(Field.name == REPLACES_FIELD).first()
        existing = db.query(Field).filter(Field.name == FIELD_NAME).first()
        created_at = (
            (placeholder.created_at if placeholder else None)
            or (existing.created_at if existing else None)
            or datetime.now()
        )

        if placeholder is not None:
            db.delete(placeholder)          # cascades imagery + polygons
        if existing is not None:
            db.delete(existing)             # idempotent re-run
        db.flush()

        field = Field(name=FIELD_NAME, created_at=created_at)
        db.add(field)
        db.flush()

        imagery = FieldImagery(
            field_id=field.id,
            capture_at=CAPTURE_AT,
            rgb_tif_path=REL_RGB,
            ndvi_tif_path=REL_NDVI,
            rgb_png_path=rgb_png_path,
            ndvi_png_path=ndvi_png_path,
            top_left=corners.get("top_left"),
            top_right=corners.get("top_right"),
            bottom_left=corners.get("bottom_left"),
            bottom_right=corners.get("bottom_right"),
            ndvi_stats=ndvi_stats,
        )
        db.add(imagery)
        db.flush()

        for feature in features:
            props = feature["properties"]
            db.add(SprayPolygon(
                id=UUID(props["id"]),
                field_id=field.id,
                field_imagery_id=imagery.id,
                zone_code=props["zone_code"],
                sequence_no=props["sequence_no"],
                geometry=feature["geometry"],
                area_m2=float(props["area_m2"]),
                mean_ndvi=means.get(props["zone_code"]),
                settings=props["settings"],
                selected_chambers=props.get("selected_chambers", []),
                chamber_mode=props.get("chamber_mode", "none"),
            ))

        db.commit()
        print(f"seeded field '{FIELD_NAME}' ({field.id})")
        print(f"  replaced placeholder : {REPLACES_FIELD if placeholder else '(already gone)'}")
        print(f"  imagery corners      : {corners['top_left']} .. {corners['bottom_right']}")
        print(f"  ndvi total area (ha) : {ndvi_stats.get('total_area_ha') if ndvi_stats else 'n/a'}")
        for feature in features:
            props = feature["properties"]
            print(f"  {props['zone_code']}  {props['area_m2']:>8.1f} m^2  "
                  f"mean_ndvi={means.get(props['zone_code'])}  "
                  f"{props.get('selected_chambers')}")
    finally:
        db.close()


def main() -> None:
    for path in (SRC_NDVI, GEOJSON):
        if not path.is_file():
            raise SystemExit(f"missing source: {path}")
    print(f"downsampling {SRC_NDVI.name} -> {REL_NDVI} (<= {MAX_EDGE_PX} px)")
    downsample_ndvi()
    build_rgb_products()
    seed_database()
    print("done.")


if __name__ == "__main__":
    main()
