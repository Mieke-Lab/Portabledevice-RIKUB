import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field as PydanticField
from shapely.geometry import shape
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Field, FieldImagery, SprayPolygon, TargetDetection

router = APIRouter(prefix="/fields", tags=["fields"])
imagery_router = APIRouter(prefix="/imagery", tags=["imagery"])
polygon_router = APIRouter(prefix="/polygons", tags=["polygons"])

SERVER_ROOT = Path(__file__).resolve().parents[2]


class ImageryRegister(BaseModel):
    capture_at: datetime | None = None
    rgb_tif_path: str
    ndvi_tif_path: str


class AutoImageryRegister(ImageryRegister):
    field_name: str


class NdviZonePreviewRequest(BaseModel):
    ndvi_min: float = PydanticField(default=0.0, ge=-1.0, le=1.0)
    ndvi_max: float = PydanticField(default=0.6, ge=-1.0, le=1.0)
    min_area_m2: float = PydanticField(default=2.0, ge=0.0)
    merge_distance_m: float = PydanticField(default=0.5, ge=0.0)


class ApprovedZonesSaveRequest(BaseModel):
    settings: NdviZonePreviewRequest
    geojson: dict


class PolygonChambersUpdate(BaseModel):
    mode: str
    selected_chambers: list[str] | None = None
    # Per-chamber application rate (dose), L/ha: {"fungisida": 40, "insektisida": 60}.
    # Typed as Any (not float) so pydantic doesn't lax-coerce a JSON bool to 1.0
    # before normalize_chamber_doses can reject it.
    chamber_doses: dict[str, Any] | None = None


class ChamberProductsUpdate(BaseModel):
    # Either set one chamber ({"chamber": "fungisida", "product_id": "kontaf-50-sc"};
    # product_id null/"" clears it) or replace the whole map ({"chamber_products": {...}}).
    chamber: str | None = None
    product_id: str | None = None
    chamber_products: dict[str, Any] | None = None


class TargetDetectionCreate(BaseModel):
    disease_name: str
    confidence: float | None = None
    sample_lat: float | None = None
    sample_lng: float | None = None
    chamber: str
    image_path: str | None = None


def field_to_dict(field: Field) -> dict:
    return {
        "id": str(field.id),
        "name": field.name,
        "chamber_products": field.chamber_products or {},
        "created_at": field.created_at.isoformat() if field.created_at else None,
    }


def imagery_to_dict(imagery: FieldImagery) -> dict:
    return {
        "id": str(imagery.id),
        "field_id": str(imagery.field_id),
        "capture_at": imagery.capture_at.isoformat() if imagery.capture_at else None,
        "rgb_tif_path": imagery.rgb_tif_path,
        "ndvi_tif_path": imagery.ndvi_tif_path,
        "rgb_png_path": imagery.rgb_png_path,
        "ndvi_png_path": imagery.ndvi_png_path,
        "top_left": imagery.top_left,
        "top_right": imagery.top_right,
        "bottom_left": imagery.bottom_left,
        "bottom_right": imagery.bottom_right,
        "ndvi_stats": imagery.ndvi_stats,
        "created_at": imagery.created_at.isoformat() if imagery.created_at else None,
    }


VALID_CHAMBERS = {"fungisida", "insektisida"}
VALID_CHAMBER_MODES = {"none", "auto", "manual"}

# Reference product catalogue — mirror of web/src/lib/gcs/product-doses.js
# (derived from ref_dose.jpeg). The backend only needs the ids for validation and
# the default rate; the frontend holds the full display catalogue. Keep ids in sync.
# rate_lpha = "Volume Akhir per m²" (L/m²) × 10_000.
PRODUCT_DOSES = {
    "kontaf-50-sc": {"name": "Kontaf 50 SC", "rate_lpha": 150},
    "benlox-50-wp": {"name": "Benlox 50 WP", "rate_lpha": 500},
    "dithane-m-45": {"name": "Dithane M-45", "rate_lpha": 500},
    "cabzim-500-sc": {"name": "Cabzim 500 SC", "rate_lpha": 500},
    "fenosida-255-ec": {"name": "Fenosida 255 EC", "rate_lpha": 500},
    "besun-elite-300-sc": {"name": "Besun Elite 300 SC", "rate_lpha": 500},
    "starner-20-wp": {"name": "Starner 20 WP", "rate_lpha": 200},
}
VALID_PRODUCT_IDS = set(PRODUCT_DOSES)


def normalize_chamber_products(values: dict[str, Any] | None) -> dict[str, str]:
    """Keep only {valid chamber: known product id} pairs; drop everything else."""
    result: dict[str, str] = {}
    for key, value in (values or {}).items():
        chamber = str(key).strip().lower()
        if chamber not in VALID_CHAMBERS or value is None:
            continue
        product_id = str(value).strip().lower()
        if product_id and product_id in VALID_PRODUCT_IDS:
            result[chamber] = product_id
    return result


def normalize_chambers(values: list[str] | None) -> list[str]:
    chambers = []
    for value in values or []:
        chamber = value.strip().lower()
        if not chamber:
            continue
        if chamber not in VALID_CHAMBERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported chamber: {value}",
            )
        if chamber not in chambers:
            chambers.append(chamber)
    return chambers


def normalize_chamber_doses(
    values: dict[str, float] | None, selected_chambers: list[str]
) -> dict[str, float]:
    """Keep only positive, finite doses for chambers that are actually selected.

    Empty/invalid entries are dropped so the mission falls back to the default
    rate (see web/src/lib/gcs/spray-overlay.js → DEFAULT_RATE_LPHA)."""
    import math

    allowed = set(selected_chambers)
    doses: dict[str, float] = {}
    for key, value in (values or {}).items():
        chamber = str(key).strip().lower()
        if chamber not in VALID_CHAMBERS or chamber not in allowed:
            continue
        # bool is a subclass of int/float — reject it explicitly so a JSON `true`
        # can't slip through as 1.0 L/ha.
        if isinstance(value, bool):
            continue
        try:
            rate = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(rate) or rate <= 0:
            continue
        doses[chamber] = round(rate, 2)
    return doses


def auto_chambers_from_detections(polygon: SprayPolygon) -> list[str]:
    return normalize_chambers([
        detection.chamber
        for detection in polygon.detections
        if detection.chamber
    ])


def detection_to_dict(detection: TargetDetection) -> dict:
    return {
        "id": str(detection.id),
        "polygon_id": str(detection.polygon_id) if detection.polygon_id else None,
        "disease_name": detection.disease_name,
        "confidence": detection.confidence,
        "sample_lat": detection.sample_lat,
        "sample_lng": detection.sample_lng,
        "chamber": detection.chamber,
        "image_path": detection.image_path,
        "soil_snapshot": detection.soil_snapshot,
        "created_at": detection.created_at.isoformat()
        if detection.created_at
        else None,
    }


def spray_polygon_to_dict(polygon: SprayPolygon) -> dict:
    return {
        "id": str(polygon.id),
        "field_id": str(polygon.field_id),
        "field_imagery_id": str(polygon.field_imagery_id),
        "zone_code": polygon.zone_code,
        "sequence_no": polygon.sequence_no,
        "geometry": polygon.geometry,
        "area_m2": polygon.area_m2,
        "mean_ndvi": polygon.mean_ndvi,
        "settings": polygon.settings,
        "selected_chambers": polygon.selected_chambers or [],
        "chamber_mode": polygon.chamber_mode or "none",
        "chamber_doses": polygon.chamber_doses or {},
        "source": polygon.source or "auto",
        "origin_code": polygon.origin_code,
        "detections": [detection_to_dict(item) for item in polygon.detections],
        "created_at": polygon.created_at.isoformat()
        if polygon.created_at
        else None,
    }


def spray_polygons_to_geojson(polygons: list[SprayPolygon]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": polygon.geometry,
                "properties": {
                    "id": str(polygon.id),
                    "zone_code": polygon.zone_code,
                    "sequence_no": polygon.sequence_no,
                    "area_m2": polygon.area_m2,
                    "mean_ndvi": polygon.mean_ndvi,
                    "settings": polygon.settings,
                    "selected_chambers": polygon.selected_chambers or [],
                    "chamber_mode": polygon.chamber_mode or "none",
                    "chamber_doses": polygon.chamber_doses or {},
                    "source": polygon.source or "auto",
                    "origin_code": polygon.origin_code,
                    "detections": [
                        detection_to_dict(item) for item in polygon.detections
                    ],
                },
            }
            for polygon in polygons
        ],
    }


def resolve_server_path(relative_path: str) -> Path:
    path = Path(relative_path)
    if path.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path must be relative to server/",
        )

    resolved = (SERVER_ROOT / path).resolve()
    try:
        resolved.relative_to(SERVER_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path escapes server directory",
        ) from exc

    return resolved


def ensure_existing_file(relative_path: str) -> None:
    resolved = resolve_server_path(relative_path)
    if not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {relative_path}",
        )


def png_url_from_tif_path(tif_path: str) -> str:
    png_path = Path(tif_path).with_suffix(".png")
    try:
        imagery_path = png_path.relative_to("storage")
        return "/" + imagery_path.as_posix()
    except ValueError:
        return "/" + png_path.as_posix()


def run_gdal_command(command: list[str]) -> None:
    executable = command[0]
    if shutil.which(executable) is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{executable} is not installed on this server",
        )

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{executable} failed: {message}",
        ) from exc


def read_geotiff_corners(relative_path: str) -> dict | None:
    tif_path = resolve_server_path(relative_path)
    if shutil.which("gdalinfo") is None:
        return None

    try:
        result = subprocess.run(
            ["gdalinfo", "-json", str(tif_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        info = json.loads(result.stdout)
        coordinates = info["wgs84Extent"]["coordinates"][0]
    except (subprocess.CalledProcessError, KeyError, IndexError, json.JSONDecodeError):
        return None

    def point(index: int) -> dict:
        lng, lat = coordinates[index]
        return {"lat": lat, "lng": lng}

    return {
        "top_left": point(0),
        "top_right": point(3),
        "bottom_left": point(1),
        "bottom_right": point(2),
    }


def convert_rgb_tif_to_png(relative_path: str) -> str:
    tif_path = resolve_server_path(relative_path)
    png_path = tif_path.with_suffix(".png")

    run_gdal_command(
        [
            "gdal_translate",
            "-of",
            "PNG",
            "-b",
            "1",
            "-b",
            "2",
            "-b",
            "3",
            str(tif_path),
            str(png_path),
        ]
    )
    return png_url_from_tif_path(relative_path)


def compute_ndvi_stats(relative_path: str) -> dict | None:
    tif_path = resolve_server_path(relative_path)
    try:
        import math

        import numpy as np
        import rasterio
    except ImportError:
        return None

    try:
        with rasterio.open(tif_path) as src:
            ndvi = src.read(1)
            valid_mask = (src.read_masks(1) > 0) & np.isfinite(ndvi)
            if src.nodata is not None and not math.isnan(src.nodata):
                valid_mask &= ~np.isclose(ndvi, src.nodata)
            ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
            ndvi_clipped = np.clip(ndvi_clean, -1, 1)

            pixel_width = abs(src.transform[0])
            pixel_height = abs(src.transform[4])
            if src.crs and src.crs.is_geographic:
                bounds = src.bounds
                lat_center = (bounds.top + bounds.bottom) / 2
                lat_rad = math.radians(lat_center)
                pixel_area_m2 = (pixel_width * 111320 * math.cos(lat_rad)) * (pixel_height * 111320)
            else:
                pixel_area_m2 = pixel_width * pixel_height

        total_valid = int(np.sum(valid_mask))
        if total_valid == 0:
            return None

        cat_defs = [
            ("Sangat Sehat", "0.8–1.0", "#1a5c2a", (ndvi_clipped >= 0.8) & valid_mask),
            ("Sehat",        "0.6–0.8", "#1a9850", (ndvi_clipped >= 0.6) & (ndvi_clipped < 0.8) & valid_mask),
            ("Cukup Sehat",  "0.4–0.6", "#91cf60", (ndvi_clipped >= 0.4) & (ndvi_clipped < 0.6) & valid_mask),
            ("Kurang Sehat", "0.21–0.4","#f9a825", (ndvi_clipped >= 0.21) & (ndvi_clipped < 0.4) & valid_mask),
            ("Tidak Sehat",  "0–0.21",  "#d73027", (ndvi_clipped >= 0) & (ndvi_clipped < 0.21) & valid_mask),
            ("Non-Vegetasi", "< 0",     "#2d2d2d", (ndvi_clipped < 0) & valid_mask),
        ]

        categories = []
        for name, range_str, color, mask in cat_defs:
            count = int(np.sum(mask))
            area_ha = round((count * pixel_area_m2) / 10000, 4)
            pct = round((count / total_valid) * 100, 1)
            categories.append({"name": name, "range": range_str, "color": color, "area_ha": area_ha, "percentage": pct})

        total_area_ha = round((total_valid * pixel_area_m2) / 10000, 4)
        return {"total_area_ha": total_area_ha, "categories": categories}
    except Exception:
        return None


def convert_ndvi_tif_to_png(relative_path: str) -> str:
    tif_path = resolve_server_path(relative_path)
    png_path = tif_path.with_suffix(".png")
    matplotlib_config_dir = Path("/tmp/matplotlib")
    matplotlib_config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(matplotlib_config_dir))

    try:
        import matplotlib
        import numpy as np
        import rasterio
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "NDVI colormap dependencies are missing. "
                "Install rasterio, numpy, pillow, and matplotlib."
            ),
        ) from exc

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with rasterio.open(tif_path) as src:
        ndvi = src.read(1)
        valid_mask = (src.read_masks(1) > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not np.isnan(src.nodata):
            valid_mask &= ~np.isclose(ndvi, src.nodata)

    ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
    ndvi_clipped = np.clip(ndvi_clean, -1, 1)

    height, width = ndvi_clipped.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    mask_black = (ndvi_clipped < 0) & valid_mask
    rgba[mask_black] = [0, 0, 0, 255]

    mask_vegetation = (ndvi_clipped >= 0) & valid_mask
    ndvi_for_cmap = np.zeros_like(ndvi_clipped, dtype=float)
    ndvi_for_cmap[mask_vegetation] = ndvi_clipped[mask_vegetation]

    rgba_colored = (plt.cm.RdYlGn(ndvi_for_cmap) * 255).astype(np.uint8)
    rgba[mask_vegetation] = rgba_colored[mask_vegetation]
    rgba[~valid_mask, 3] = 0

    Image.fromarray(rgba).save(png_path, "PNG")

    return png_url_from_tif_path(relative_path)


def auto_utm_epsg(lng: float, lat: float) -> int:
    zone = int((lng + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def iter_polygon_geometries(geom):
    if geom.is_empty:
        return
    if geom.geom_type == "Polygon":
        yield geom
    elif geom.geom_type == "MultiPolygon":
        yield from geom.geoms
    elif geom.geom_type == "GeometryCollection":
        for part in geom.geoms:
            yield from iter_polygon_geometries(part)


def smooth_polygon_for_preview(polygon, tolerance_m: float = 1.0):
    if polygon.is_empty:
        return polygon

    smoothed = polygon.simplify(tolerance_m, preserve_topology=True)
    if smoothed.is_empty or not smoothed.is_valid:
        smoothed = polygon.buffer(tolerance_m).buffer(-tolerance_m)
    if smoothed.is_empty or not smoothed.is_valid:
        return polygon
    return smoothed


def generate_ndvi_zone_preview(
    imagery: FieldImagery,
    settings: NdviZonePreviewRequest,
) -> dict:
    try:
        import math

        import numpy as np
        import rasterio
        from PIL import Image, ImageFilter
        from rasterio import features
        from rasterio.enums import Resampling
        from rasterio.windows import Window, from_bounds
        from rasterio.windows import transform as window_transform
        from shapely.geometry import Polygon, mapping, shape
        from shapely.ops import transform as shapely_transform
        from pyproj import Transformer
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "NDVI zone dependencies are missing. "
                "Install shapely and pyproj in the server environment."
            ),
        ) from exc

    if settings.ndvi_min > settings.ndvi_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ndvi_min must be less than or equal to ndvi_max",
        )

    tif_path = resolve_server_path(imagery.ndvi_tif_path)
    if not tif_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {imagery.ndvi_tif_path}",
        )

    with rasterio.open(tif_path) as src:
        # ponytail: cap zone-preview processing resolution; polygons are
        # simplified to a 1m tolerance anyway (smooth_polygon_for_preview),
        # so native sub-cm GSD buys nothing here. Raise MAX_DIM (or make it
        # settings-driven) if a use case ever needs finer preview geometry.
        MAX_DIM = 3000
        scale = max(1, math.ceil(max(src.width, src.height) / MAX_DIM))
        out_height = max(1, src.height // scale)
        out_width = max(1, src.width // scale)

        if scale > 1:
            ndvi = src.read(1, out_shape=(out_height, out_width), resampling=Resampling.average)
            mask_arr = src.read_masks(
                1, out_shape=(out_height, out_width), resampling=Resampling.nearest
            )
            transform = src.transform * src.transform.scale(
                src.width / out_width, src.height / out_height
            )
        else:
            ndvi = src.read(1)
            mask_arr = src.read_masks(1)
            transform = src.transform

        valid_mask = (mask_arr > 0) & np.isfinite(ndvi)
        if src.nodata is not None and not math.isnan(src.nodata):
            valid_mask &= ~np.isclose(ndvi, src.nodata)

        ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
        ndvi_clipped = np.clip(ndvi_clean, -1, 1)
        target_mask = (
            (ndvi_clipped >= settings.ndvi_min)
            & (ndvi_clipped <= settings.ndvi_max)
            & valid_mask
        )

        if int(np.sum(target_mask)) == 0:
            return {
                "imagery_id": str(imagery.id),
                "settings": settings.model_dump(),
                "summary": {
                    "polygon_count": 0,
                    "total_area_m2": 0.0,
                    "total_area_ha": 0.0,
                    "mean_ndvi": None,
                },
                "geojson": {"type": "FeatureCollection", "features": []},
            }

        crs = src.crs
        if crs is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="NDVI GeoTIFF does not have a CRS",
            )

        # ponytail: merge nearby detections by closing the mask in raster
        # space (Pillow Max/MinFilter = dilate/erode) instead of buffering
        # and unary_union-ing thousands of raw per-pixel-blob polygons in
        # shapely. Profiling showed that vector buffer+union was ~70% of
        # total request time on a noisy threshold mask (22k+ raw blobs);
        # closing the mask first collapses them before shapes() ever runs.
        left, bottom, right, top = src.bounds
        center_lng, center_lat = (left + right) / 2, (bottom + top) / 2

        closing_mask = target_mask
        if settings.merge_distance_m > 0:
            buffer_distance_m = settings.merge_distance_m / 2
            if crs.is_geographic:
                px_size_m = (
                    abs(transform.a) * 111320 * math.cos(math.radians(center_lat))
                    + abs(transform.e) * 110540
                ) / 2
            else:
                px_size_m = (abs(transform.a) + abs(transform.e)) / 2
            radius_px = max(1, round(buffer_distance_m / max(px_size_m, 1e-9)))
            kernel_size = 2 * radius_px + 1

            mask_img = Image.fromarray((target_mask.astype(np.uint8) * 255), mode="L")
            closed_img = mask_img.filter(ImageFilter.MaxFilter(kernel_size)).filter(
                ImageFilter.MinFilter(kernel_size)
            )
            closing_mask = np.asarray(closed_img) > 0

        raw_polygons = [
            shape(geom)
            for geom, value in features.shapes(
                closing_mask.astype(np.uint8),
                mask=closing_mask,
                transform=transform,
            )
            if value == 1
        ]

        if not raw_polygons:
            return {
                "imagery_id": str(imagery.id),
                "settings": settings.model_dump(),
                "summary": {
                    "polygon_count": 0,
                    "total_area_m2": 0.0,
                    "total_area_ha": 0.0,
                    "mean_ndvi": None,
                },
                "geojson": {"type": "FeatureCollection", "features": []},
            }

        projected_crs = (
            f"EPSG:{auto_utm_epsg(center_lng, center_lat)}" if crs.is_geographic else crs
        )
        to_projected = Transformer.from_crs(crs, projected_crs, always_xy=True)
        to_original = Transformer.from_crs(projected_crs, crs, always_xy=True)
        to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        features_out = []
        summary_ndvi_values = []

        for raw_polygon in raw_polygons:
            if raw_polygon.is_empty or not raw_polygon.is_valid:
                raw_polygon = raw_polygon.buffer(0)
            if raw_polygon.is_empty:
                continue

            for original_polygon in iter_polygon_geometries(raw_polygon):
                projected_polygon = shapely_transform(to_projected.transform, original_polygon)

                # ponytail: drop interior holes smaller than min_area_m2 —
                # same "too small to matter" threshold already used for
                # standalone zones. Without this, isolated noise pixels
                # inside a big zone show up as visible holes in the sprayed
                # area instead of getting filtered out like everything else.
                if projected_polygon.interiors:
                    kept_interiors = [
                        ring
                        for ring in projected_polygon.interiors
                        if Polygon(ring).area >= settings.min_area_m2
                    ]
                    if len(kept_interiors) != len(projected_polygon.interiors):
                        projected_polygon = Polygon(projected_polygon.exterior, kept_interiors)
                        original_polygon = shapely_transform(to_original.transform, projected_polygon)

                area_m2 = float(projected_polygon.area)
                if area_m2 < settings.min_area_m2:
                    continue

                win = from_bounds(*original_polygon.bounds, transform=transform)
                win = win.round_offsets().round_lengths()
                win = win.intersection(Window(0, 0, ndvi_clipped.shape[1], ndvi_clipped.shape[0]))
                row_sl, col_sl = win.toslices()
                win_transform = window_transform(win, transform)

                poly_mask = features.rasterize(
                    [(mapping(original_polygon), 1)],
                    out_shape=(int(win.height), int(win.width)),
                    transform=win_transform,
                    fill=0,
                    dtype=np.uint8,
                )
                ndvi_values = ndvi_clipped[row_sl, col_sl][
                    (poly_mask == 1) & target_mask[row_sl, col_sl]
                ]
                mean_ndvi = round(float(np.mean(ndvi_values)), 4) if ndvi_values.size else None
                if ndvi_values.size:
                    summary_ndvi_values.append(ndvi_values)

                preview_polygon = smooth_polygon_for_preview(projected_polygon)
                preview_original_polygon = shapely_transform(to_original.transform, preview_polygon)
                wgs84_polygon = shapely_transform(to_wgs84.transform, preview_original_polygon)

                features_out.append(
                    {
                        "type": "Feature",
                        "geometry": mapping(wgs84_polygon),
                        "properties": {
                            "id": len(features_out) + 1,
                            "area_m2": round(area_m2, 2),
                            "area_ha": round(area_m2 / 10000, 4),
                            "mean_ndvi": mean_ndvi,
                            "ndvi_min": settings.ndvi_min,
                            "ndvi_max": settings.ndvi_max,
                        },
                    }
                )

        total_area_m2 = round(
            sum(feature["properties"]["area_m2"] for feature in features_out),
            2,
        )
        summary_values = (
            np.concatenate(summary_ndvi_values)
            if summary_ndvi_values
            else np.array([], dtype=float)
        )
        summary_mean_ndvi = (
            round(float(np.mean(summary_values)), 4) if summary_values.size else None
        )

        return {
            "imagery_id": str(imagery.id),
            "settings": settings.model_dump(),
            "summary": {
                "polygon_count": len(features_out),
                "total_area_m2": total_area_m2,
                "total_area_ha": round(total_area_m2 / 10000, 4),
                "mean_ndvi": summary_mean_ndvi,
            },
            "geojson": {
                "type": "FeatureCollection",
                "features": features_out,
            },
        }


def create_imagery_for_field(
    field: Field,
    payload: ImageryRegister,
    db: Session,
) -> FieldImagery:
    ensure_existing_file(payload.rgb_tif_path)
    ensure_existing_file(payload.ndvi_tif_path)
    corners = read_geotiff_corners(payload.rgb_tif_path) or {}
    rgb_png_path = convert_rgb_tif_to_png(payload.rgb_tif_path)
    ndvi_png_path = convert_ndvi_tif_to_png(payload.ndvi_tif_path)
    ndvi_stats = compute_ndvi_stats(payload.ndvi_tif_path)

    imagery = FieldImagery(
        field_id=field.id,
        capture_at=payload.capture_at,
        rgb_tif_path=payload.rgb_tif_path,
        ndvi_tif_path=payload.ndvi_tif_path,
        rgb_png_path=rgb_png_path,
        ndvi_png_path=ndvi_png_path,
        top_left=corners.get("top_left"),
        top_right=corners.get("top_right"),
        bottom_left=corners.get("bottom_left"),
        bottom_right=corners.get("bottom_right"),
        ndvi_stats=ndvi_stats,
    )
    db.add(imagery)
    db.commit()
    db.refresh(imagery)
    return imagery


@router.get("")
def list_fields(db: Session = Depends(get_db)) -> list[dict]:
    fields = db.query(Field).order_by(desc(Field.created_at)).all()
    return [field_to_dict(field) for field in fields]


@imagery_router.post("/register", status_code=status.HTTP_201_CREATED)
def register_imagery_with_field(
    payload: AutoImageryRegister,
    db: Session = Depends(get_db),
) -> dict:
    field_name = payload.field_name.strip()
    if not field_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="field_name is required",
        )

    field = db.query(Field).filter(Field.name == field_name).first()
    if field is None:
        field = Field(name=field_name)
        db.add(field)
        db.flush()

    imagery = create_imagery_for_field(field, payload, db)
    response = imagery_to_dict(imagery)
    response["field"] = field_to_dict(field)
    return response


@imagery_router.post("/{imagery_id}/ndvi-zones/preview")
def preview_ndvi_zones(
    imagery_id: UUID,
    payload: NdviZonePreviewRequest,
    db: Session = Depends(get_db),
) -> dict:
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found: {imagery_id}",
        )

    return generate_ndvi_zone_preview(imagery, payload)


def _safe_shape(geometry: Any):
    try:
        geom = shape(geometry)
        return geom if geom.is_valid else geom.buffer(0)
    except Exception:
        return None


def plan_zone_carryover(db: Session, imagery: FieldImagery, features: list) -> dict:
    """How the zones about to be replaced hand their data to the new zones.

    Re-approving zones deletes and recreates every SprayPolygon of this imagery, and
    target_detections cascade on delete - so without this, every HPT linked to a zone
    silently disappeared. Each old zone is located by a point guaranteed inside it
    (representative_point); the new zone covering that point inherits its HPT and, if
    unambiguous, its manual chamber settings. Fallback: the new zone overlapping the old
    one the most. HPT with no new zone at all are kept, just unlinked (polygon_id NULL).
    Uses the old zone's location, not the detection GPS: the operator picked the zone
    on purpose, while the phone's fix can sit on a boundary.
    """
    new_shapes = [
        _safe_shape(f.get("geometry")) if isinstance(f, dict) else None for f in features
    ]

    def locate(old_shape) -> int | None:
        if old_shape is None or old_shape.is_empty:
            return None
        point = old_shape.representative_point()
        for i, s in enumerate(new_shapes):
            if s is not None and s.covers(point):
                return i
        best, best_area = None, 0.0
        for i, s in enumerate(new_shapes):
            if s is not None:
                area = s.intersection(old_shape).area
                if area > best_area:
                    best, best_area = i, area
        return best

    # Manual (drawn) zones are not replaced by Approve Zones, so only automatic ones hand over.
    old = db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source != "manual").all()
    detections: list[dict] = []   # {id, chamber, new_index | None}
    manual_by_new: dict[int, list[dict]] = {}
    manual_total = 0
    for polygon in old:
        new_index = locate(_safe_shape(polygon.geometry))
        for d in polygon.detections:
            detections.append({"id": d.id, "chamber": d.chamber, "new_index": new_index})
        if polygon.chamber_mode == "manual":
            manual_total += 1
            if new_index is not None:
                manual_by_new.setdefault(new_index, []).append({
                    "selected_chambers": polygon.selected_chambers or [],
                    "chamber_doses": polygon.chamber_doses or {},
                })

    # Carry a manual setting only when every old manual zone landing on a new zone agrees.
    manual_carry = {
        i: settings[0] for i, settings in manual_by_new.items()
        if all(s == settings[0] for s in settings)
    }
    moved = sum(1 for d in detections if d["new_index"] is not None)
    manual_zones = db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source == "manual").count()
    return {
        "detections": detections,
        "manual_carry": manual_carry,
        "stats": {
            "existing_zones": len(old),
            "hpt_total": len(detections),
            "hpt_moved": moved,
            "hpt_unzoned": len(detections) - moved,
            "manual_total": manual_total,
            "manual_kept": sum(len(manual_by_new[i]) for i in manual_carry),
            "manual_reset": manual_total - sum(len(manual_by_new[i]) for i in manual_carry),
            # Drawn zones are kept as-is; the new automatic zones get clipped around them.
            "manual_zones": manual_zones,
        },
    }


def _zone_features(payload: ApprovedZonesSaveRequest) -> list:
    features = payload.geojson.get("features")
    if not isinstance(features, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="geojson.features must be a list",
        )
    return features


@imagery_router.post("/{imagery_id}/ndvi-zones/save-impact")
def ndvi_zones_save_impact(
    imagery_id: UUID,
    payload: ApprovedZonesSaveRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Dry run of /ndvi-zones/save: what happens to existing zones' HPT and manual
    chamber settings. Changes nothing - the UI shows this before approving."""
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found: {imagery_id}",
        )
    return plan_zone_carryover(db, imagery, _zone_features(payload))["stats"]


@imagery_router.post("/{imagery_id}/ndvi-zones/save", status_code=status.HTTP_201_CREATED)
def save_ndvi_zones(
    imagery_id: UUID,
    payload: ApprovedZonesSaveRequest,
    db: Session = Depends(get_db),
) -> dict:
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found: {imagery_id}",
        )

    features = _zone_features(payload)
    carry = plan_zone_carryover(db, imagery, features)

    # Unlink HPT first so the cascade on the zone delete below can't take them along.
    detection_ids = [d["id"] for d in carry["detections"]]
    if detection_ids:
        db.query(TargetDetection).filter(TargetDetection.id.in_(detection_ids)).update(
            {TargetDetection.polygon_id: None}, synchronize_session=False)
    db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id,
        SprayPolygon.source != "manual",
    ).delete(synchronize_session=False)
    db.expire_all()

    settings = payload.settings.model_dump()
    polygons = []
    for index, feature in enumerate(features, start=1):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        properties = feature.get("properties", {}) if isinstance(feature, dict) else {}
        if not geometry:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Feature {index} does not have geometry",
            )

        area_m2 = properties.get("area_m2")
        if area_m2 is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Feature {index} does not have area_m2",
            )

        polygon = SprayPolygon(
            field_id=imagery.field_id,
            field_imagery_id=imagery.id,
            zone_code=f"Z{index:02d}",
            sequence_no=index,
            geometry=geometry,
            area_m2=float(area_m2),
            mean_ndvi=properties.get("mean_ndvi"),
            settings=settings,
            selected_chambers=[],
            chamber_mode="none",
            chamber_doses={},
            source="auto",
            origin_code=f"Z{index:02d}",
        )
        db.add(polygon)
        polygons.append(polygon)
    db.flush()  # assigns the new polygon ids
    # The approved shapes become the clipping origins (manual zones are cut out of them).
    imagery.zone_origins = [
        {"code": p.zone_code, "sequence_no": p.sequence_no, "geometry": p.geometry, "settings": settings,
         "area_m2": p.area_m2, "mean_ndvi": p.mean_ndvi}
        for p in polygons
    ]

    # Re-link HPT to their new zones, then restore chambers: a carried manual setting
    # wins, otherwise zones with HPT go back to auto (chambers derived from the HPT).
    moved_chambers: dict[int, list] = {}
    for d in carry["detections"]:
        if d["new_index"] is not None:
            moved_chambers.setdefault(d["new_index"], []).append(d["chamber"])
            db.query(TargetDetection).filter(TargetDetection.id == d["id"]).update(
                {TargetDetection.polygon_id: polygons[d["new_index"]].id}, synchronize_session=False)
    for i, polygon in enumerate(polygons):
        manual = carry["manual_carry"].get(i)
        if manual:
            polygon.chamber_mode = "manual"
            polygon.selected_chambers = manual["selected_chambers"]
            polygon.chamber_doses = manual["chamber_doses"]
        elif i in moved_chambers:
            polygon.selected_chambers = normalize_chambers([c for c in moved_chambers[i] if c])
            polygon.chamber_mode = "auto" if polygon.selected_chambers else "none"

    # Manual zones win: cut the fresh automatic zones around any drawn zone.
    from app.zones import reclip_auto_zones  # local import: app.zones imports this module

    clip = reclip_auto_zones(db, imagery)
    db.commit()
    polygons = imagery_zones(db, imagery.id)

    return {
        "field_id": str(imagery.field_id),
        "field_imagery_id": str(imagery.id),
        "polygons": [spray_polygon_to_dict(polygon) for polygon in polygons],
        "geojson": spray_polygons_to_geojson(polygons),
        "carryover": carry["stats"],
        "clip": clip,
    }


def imagery_zones(db: Session, imagery_id) -> list[SprayPolygon]:
    """All spray zones of one imagery - automatic (Z..) first, then manual (ZM..)."""
    return db.query(SprayPolygon).filter(SprayPolygon.field_imagery_id == imagery_id).order_by(
        SprayPolygon.sequence_no, SprayPolygon.zone_code).all()


@router.get("/{field_id}/spray-targets")
def list_spray_targets(
    field_id: UUID,
    imagery_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    field = db.get(Field, field_id)
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field not found: {field_id}",
        )

    query = db.query(SprayPolygon).filter(SprayPolygon.field_id == field_id)
    if imagery_id is not None:
        query = query.filter(SprayPolygon.field_imagery_id == imagery_id)

    polygons = query.order_by(SprayPolygon.sequence_no, SprayPolygon.zone_code).all()
    return {
        "field_id": str(field_id),
        "field_imagery_id": str(imagery_id) if imagery_id else None,
        "polygons": [spray_polygon_to_dict(polygon) for polygon in polygons],
        "geojson": spray_polygons_to_geojson(polygons),
    }


@router.patch("/{field_id}/chamber-products")
def update_field_chamber_products(
    field_id: UUID,
    payload: ChamberProductsUpdate,
    db: Session = Depends(get_db),
) -> dict:
    # Lock the row for the whole read-modify-write: this is a sync endpoint run in
    # FastAPI's threadpool, so two concurrent single-chamber PATCHes could each read
    # the pre-update JSONB map and the later commit would blindly drop the other
    # chamber's product. FOR UPDATE serialises them so the second re-reads first.
    field = db.query(Field).filter(Field.id == field_id).with_for_update().first()
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field not found: {field_id}",
        )

    if payload.chamber_products is not None:
        current = normalize_chamber_products(payload.chamber_products)
    elif payload.chamber is not None:
        chamber = payload.chamber.strip().lower()
        if chamber not in VALID_CHAMBERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported chamber: {payload.chamber}",
            )
        current = dict(field.chamber_products or {})
        product_id = (payload.product_id or "").strip().lower()
        if product_id:
            if product_id not in VALID_PRODUCT_IDS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported product: {payload.product_id}",
                )
            current[chamber] = product_id
        else:
            current.pop(chamber, None)
        # Drop any legacy/invalid entries that may predate the current catalogue.
        current = normalize_chamber_products(current)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chamber or chamber_products is required",
        )

    field.chamber_products = current
    db.commit()
    db.refresh(field)
    return field_to_dict(field)


@polygon_router.patch("/{polygon_id}/chambers")
def update_polygon_chambers(
    polygon_id: UUID,
    payload: PolygonChambersUpdate,
    db: Session = Depends(get_db),
) -> dict:
    polygon = db.get(SprayPolygon, polygon_id)
    if polygon is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Polygon not found: {polygon_id}",
        )

    mode = payload.mode.strip().lower()
    if mode not in VALID_CHAMBER_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mode must be one of: none, auto, manual",
        )

    if mode == "manual":
        selected_chambers = normalize_chambers(payload.selected_chambers)
        if not selected_chambers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="selected_chambers is required for manual mode",
            )
    elif mode == "auto":
        selected_chambers = auto_chambers_from_detections(polygon)
    else:
        selected_chambers = []

    polygon.selected_chambers = selected_chambers
    polygon.chamber_mode = mode
    # Doses are only user-editable in manual mode; drop them otherwise so a
    # stale rate never lingers on an auto/none zone.
    polygon.chamber_doses = (
        normalize_chamber_doses(payload.chamber_doses, selected_chambers)
        if mode == "manual"
        else {}
    )
    db.commit()
    db.refresh(polygon)
    return spray_polygon_to_dict(polygon)


@polygon_router.post("/{polygon_id}/detections", status_code=status.HTTP_201_CREATED)
def add_target_detection(
    polygon_id: UUID,
    payload: TargetDetectionCreate,
    db: Session = Depends(get_db),
) -> dict:
    polygon = db.get(SprayPolygon, polygon_id)
    if polygon is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Polygon not found: {polygon_id}",
        )

    disease_name = payload.disease_name.strip()
    chamber = payload.chamber.strip().lower()
    if not disease_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="disease_name is required",
        )
    normalize_chambers([chamber])

    detection = TargetDetection(
        polygon_id=polygon.id,
        disease_name=disease_name,
        confidence=payload.confidence,
        sample_lat=payload.sample_lat,
        sample_lng=payload.sample_lng,
        chamber=chamber,
        image_path=payload.image_path,
    )

    db.add(detection)
    db.flush()
    if polygon.chamber_mode != "manual":
        polygon.selected_chambers = auto_chambers_from_detections(polygon)
        polygon.chamber_mode = "auto" if polygon.selected_chambers else "none"

    db.commit()
    db.refresh(detection)
    return detection_to_dict(detection)


@router.get("/{field_id}/imagery/latest")
def latest_imagery(field_id: UUID, db: Session = Depends(get_db)) -> dict:
    field = db.get(Field, field_id)
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field not found: {field_id}",
        )

    imagery = (
        db.query(FieldImagery)
        .filter(FieldImagery.field_id == field_id)
        .order_by(desc(FieldImagery.capture_at), desc(FieldImagery.created_at))
        .first()
    )
    if imagery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Imagery not found for field: {field_id}",
        )

    return imagery_to_dict(imagery)
