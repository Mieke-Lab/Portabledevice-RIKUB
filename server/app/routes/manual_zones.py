"""Manual spray zones: add, reshape and delete zones drawn on the map (see app/zones.py).

Every endpoint accepts ?dry_run=true: the change is carried out inside the transaction,
the resulting zones and clip report are returned, then everything is rolled back. The
map uses that to preview which automatic zones would be clipped before saving.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import zones
from app.db.database import get_db
from app.db.models import FieldImagery, SprayPolygon
from app.routes.fields import imagery_zones, spray_polygon_to_dict, spray_polygons_to_geojson

imagery_router = APIRouter(prefix="/imagery", tags=["manual-zones"])
polygon_router = APIRouter(prefix="/polygons", tags=["manual-zones"])


class ManualZoneGeometry(BaseModel):
    geometry: dict


def _imagery(db: Session, imagery_id) -> FieldImagery:
    imagery = db.get(FieldImagery, imagery_id)
    if imagery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Imagery not found: {imagery_id}")
    return imagery


def _manual_polygon(db: Session, polygon_id) -> SprayPolygon:
    polygon = db.get(SprayPolygon, polygon_id)
    if polygon is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zona tidak ditemukan: {polygon_id}")
    if polygon.source != "manual":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zona otomatis tidak bisa diubah manual. Gunakan NDVI Zones untuk membuat ulang.",
        )
    return polygon


def _finish(db: Session, imagery_id, report: dict, dry_run: bool, polygon_id=None) -> dict:
    """Serialise the imagery's zones as they are now, then commit or roll back."""
    polygons = imagery_zones(db, imagery_id)
    result = {
        "dry_run": dry_run,
        "report": report,
        "polygon": next((spray_polygon_to_dict(p) for p in polygons if p.id == polygon_id), None),
        "geojson": spray_polygons_to_geojson(polygons),
    }
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return result


def _run(db: Session, fn, *args):
    try:
        return fn(db, *args)
    except zones.ZoneError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    except Exception:
        db.rollback()
        raise


@imagery_router.post("/{imagery_id}/manual-zones", status_code=status.HTTP_201_CREATED)
def create_manual_zone(
    imagery_id: UUID,
    payload: ManualZoneGeometry,
    response: Response,
    dry_run: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict:
    imagery = _imagery(db, imagery_id)
    polygon, report = _run(db, zones.create_manual_zone, imagery, payload.geometry)
    if dry_run:
        response.status_code = status.HTTP_200_OK
    return _finish(db, imagery.id, report, dry_run, polygon.id)


@polygon_router.patch("/{polygon_id}/geometry")
def update_manual_zone(
    polygon_id: UUID,
    payload: ManualZoneGeometry,
    dry_run: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict:
    polygon = _manual_polygon(db, polygon_id)
    imagery = _imagery(db, polygon.field_imagery_id)
    report = _run(db, zones.update_manual_zone, imagery, polygon, payload.geometry)
    return _finish(db, imagery.id, report, dry_run, polygon_id)


@polygon_router.delete("/{polygon_id}")
def delete_manual_zone(
    polygon_id: UUID,
    dry_run: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict:
    polygon = _manual_polygon(db, polygon_id)
    imagery = _imagery(db, polygon.field_imagery_id)
    report = _run(db, zones.delete_manual_zone, imagery, polygon)
    return _finish(db, imagery.id, report, dry_run)
