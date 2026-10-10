"""Manual spray zones, and clipping of automatic (NDVI) zones around them.

Rule: manual zones always win. Wherever a manual zone covers an automatic zone, the
automatic zone is cut away, so no ground is sprayed twice. The unclipped automatic zones
are kept on the imagery (FieldImagery.zone_origins), so every automatic row is derived:
origin - union(manual zones). That makes clipping repeatable and reversible - editing or
deleting a manual zone gives the automatic area back, even a zone that was fully covered.

A clip can split one automatic zone into several pieces ("Z05a", "Z05b"); leftovers of a
cut smaller than ZONE_MIN_PIECE_M2 are dropped as unsprayable slivers. Zones no manual
zone touches are never filtered, however small. HPT stay with their automatic
zone; only when a zone disappears entirely do its HPT move to the manual zone covering it
(or, failing that, stay stored but unlinked). Nothing here deletes an HPT row.

Geometries are GeoJSON in WGS84 [lng, lat]; areas are planar m² in the local UTM zone,
the same method the NDVI preview uses.
"""

import math
import os
from typing import Any

from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform, unary_union
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.db.models import FieldImagery, SprayPolygon, TargetDetection
from app.routes.fields import (
    VALID_CHAMBERS,
    auto_utm_epsg,
    iter_polygon_geometries,
    resolve_server_path,
)

MIN_PIECE_M2 = float(os.getenv("ZONE_MIN_PIECE_M2", "10"))  # smaller clip leftovers are dropped
MANUAL_OVERLAP_TOL_M2 = 0.5  # manual zones touching along an edge are fine; real overlap is not
UNCHANGED_TOL_M2 = 0.01
MANUAL_SEQ_BASE = 1000  # manual zones sort after the NDVI zones (Z01.. = 1..n)
MANUAL_PREFIX = "ZM"  # "M01" is already taken by waypoint missions (waypoints-mission.js)
NDVI_MAX_DIM = 1500  # read the NDVI window at most this many px per side (RAM on the Pi)


class ZoneError(Exception):
    """A request the zone rules reject - carries the HTTP status and a user-facing message."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def to_shape(geometry: Any):
    try:
        geom = shape(geometry)
    except Exception:
        return None
    if geom.is_empty:
        return None
    return geom if geom.is_valid else geom.buffer(0)


def _to_utm(geom):
    from pyproj import Transformer

    c = geom.centroid
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{auto_utm_epsg(c.x, c.y)}", always_xy=True)
    return shp_transform(tr.transform, geom)


def area_m2(geom) -> float:
    return float(_to_utm(geom).area) if geom is not None and not geom.is_empty else 0.0


def mean_ndvi(imagery: FieldImagery, geom, ndvi_range: tuple[float, float] | None = None) -> float | None:
    """Mean NDVI of the valid pixels inside geom (optionally only those within ndvi_range,
    which is how automatic zones are measured). None when the zone is off the raster or
    the raster can't be read - a missing mean is shown as '-', never an error."""
    try:
        import numpy as np
        import rasterio
        from pyproj import Transformer
        from rasterio import features
        from rasterio.enums import Resampling
        from rasterio.windows import Window, from_bounds

        path = resolve_server_path(imagery.ndvi_tif_path)
        with rasterio.open(path) as src:
            g = geom
            if src.crs and src.crs.to_epsg() != 4326:
                tr = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
                g = shp_transform(tr.transform, geom)
            win = from_bounds(*g.bounds, transform=src.transform).round_offsets().round_lengths()
            win = win.intersection(Window(0, 0, src.width, src.height))
            scale = max(1, math.ceil(max(win.width, win.height) / NDVI_MAX_DIM))
            h, w = max(1, int(win.height) // scale), max(1, int(win.width) // scale)
            data = src.read(1, window=win, out_shape=(h, w), resampling=Resampling.average)
            masks = src.read_masks(1, window=win, out_shape=(h, w), resampling=Resampling.nearest)
            wt = src.window_transform(win) * src.window_transform(win).scale(win.width / w, win.height / h)
            inside = features.rasterize([(mapping(g), 1)], out_shape=(h, w), transform=wt, fill=0, dtype="uint8")
            valid = (masks > 0) & np.isfinite(data) & (inside == 1)
            if src.nodata is not None and not math.isnan(src.nodata):
                valid &= ~np.isclose(data, src.nodata)
            values = np.clip(data[valid], -1, 1)
            if ndvi_range is not None:
                values = values[(values >= ndvi_range[0]) & (values <= ndvi_range[1])]
            return round(float(values.mean()), 4) if values.size else None
    except Exception:
        return None


def _ndvi_range(settings: dict | None) -> tuple[float, float] | None:
    try:
        return float(settings["ndvi_min"]), float(settings["ndvi_max"])
    except (TypeError, KeyError, ValueError):
        return None


def _chambers_from(values) -> list[str]:
    out: list[str] = []
    for v in values:
        c = (v or "").strip().lower()
        if c in VALID_CHAMBERS and c not in out:
            out.append(c)
    return out


def refresh_auto_chambers(db: Session, polygon_ids) -> None:
    """Chamber mode 'auto' follows the zone's HPT; a user's manual chamber choice is kept."""
    for pid in polygon_ids:
        polygon = db.get(SprayPolygon, pid)
        if polygon is None or polygon.chamber_mode == "manual":
            continue
        chambers = _chambers_from(
            c for (c,) in db.query(TargetDetection.chamber).filter(TargetDetection.polygon_id == pid)
        )
        polygon.selected_chambers = chambers
        polygon.chamber_mode = "auto" if chambers else "none"


def _move_detections(db: Session, from_ids: list, to_id) -> int:
    if not from_ids:
        return 0
    return db.query(TargetDetection).filter(TargetDetection.polygon_id.in_(from_ids)).update(
        {TargetDetection.polygon_id: to_id}, synchronize_session=False)


def _zone_origins(imagery: FieldImagery, auto_rows: list[SprayPolygon]) -> list[dict]:
    """The imagery's automatic-zone origins, ordered. Zones saved before clipping existed
    have none recorded: their current rows (never clipped then) become the origins."""
    if imagery.zone_origins:
        # Copies: reclip edits these dicts (held_chambers) and writes the list back.
        return [dict(o) for o in sorted(imagery.zone_origins, key=lambda o: (o.get("sequence_no") or 0, o["code"]))]
    by_code: dict[str, list[SprayPolygon]] = {}
    for r in auto_rows:
        by_code.setdefault(r.origin_code or r.zone_code, []).append(r)
    origins = []
    for code, members in by_code.items():
        shapes = [s for s in (to_shape(m.geometry) for m in members) if s is not None]
        if not shapes:
            continue
        origin = {
            "code": code,
            "sequence_no": min(m.sequence_no for m in members),
            "geometry": mapping(unary_union(shapes)),
            "settings": members[0].settings,
        }
        if len(members) == 1:  # an unclipped row: keep the NDVI tool's figures too
            origin.update(area_m2=members[0].area_m2, mean_ndvi=members[0].mean_ndvi)
        origins.append(origin)
    origins.sort(key=lambda o: (o["sequence_no"], o["code"]))
    return origins


def reclip_auto_zones(db: Session, imagery: FieldImagery) -> dict:
    """Recompute every automatic zone of this imagery as origin - union(manual zones).

    Rows are reused where a piece overlaps them (their id, HPT and chamber settings
    survive), new pieces get new rows, rows with no piece left are removed after their
    HPT are moved. An origin that is fully covered keeps its record in
    imagery.zone_origins (with any manual chamber setting parked there), so deleting or
    shrinking the manual zone brings it back. Returns a per-origin report for the UI.
    """
    rows = db.query(SprayPolygon).filter(SprayPolygon.field_imagery_id == imagery.id).all()
    manual = [(r, to_shape(r.geometry)) for r in rows if r.source == "manual"]
    manual = [(r, s) for r, s in manual if s is not None]
    cover = unary_union([s for _, s in manual]) if manual else None

    auto_rows = [r for r in rows if r.source != "manual"]
    origins = _zone_origins(imagery, auto_rows)
    groups: dict[str, list[SprayPolygon]] = {}
    for r in auto_rows:
        if not r.origin_code:  # zone saved before clipping existed: it is its own origin
            r.origin_code = r.zone_code
        groups.setdefault(r.origin_code, []).append(r)

    report = {"clipped": [], "restored": [], "removed": [], "hpt_moved": 0, "hpt_unzoned": 0}
    touched: set = set()
    surplus_moves: list[tuple[SprayPolygon, Any]] = []  # (row to delete, geometry for HPT)
    origin_codes = {o["code"] for o in origins}
    for code, members in groups.items():  # rows whose origin no longer exists
        if code not in origin_codes:
            surplus_moves += [(r, to_shape(r.geometry)) for r in members]

    for origin in origins:
        code = origin["code"]
        members = groups.get(code, [])
        original = to_shape(origin["geometry"])
        if original is None:
            continue
        under_manual = (
            cover is not None
            and original.intersects(cover)
            and area_m2(original.intersection(cover)) > UNCHANGED_TOL_M2
        )
        if not under_manual:
            # Not under any manual zone: keep the NDVI zone exactly as approved, however
            # small (NDVI zones can legitimately be a few m²).
            pieces = list(iter_polygon_geometries(original))
        else:
            # Only leftovers of a cut are dropped: pieces under MIN_PIECE_M2 that are also
            # less than half of the zone (a small zone just nicked by a manual one survives).
            original_m2 = area_m2(original)
            pieces = [
                p for p in iter_polygon_geometries(original.difference(cover))
                if area_m2(p) >= min(MIN_PIECE_M2, 0.5 * original_m2)
            ]
        pieces.sort(key=area_m2, reverse=True)
        # Compare shape with shape: stored area_m2 of an untouched NDVI zone is the NDVI
        # tool's figure (measured before smoothing), not the area of its geometry.
        before_m2 = sum(area_m2(to_shape(r.geometry)) for r in members if r.geometry)

        # Match pieces to existing rows by overlap, largest first.
        member_shapes = {r.id: to_shape(r.geometry) for r in members}
        pairs = sorted(
            ((p.intersection(member_shapes[r.id]).area if member_shapes[r.id] is not None else 0.0, i, r)
             for i, p in enumerate(pieces) for r in members),
            key=lambda t: t[0], reverse=True,
        )
        piece_row: dict[int, SprayPolygon] = {}
        used: set = set()
        for overlap, i, r in pairs:
            if overlap <= 0:
                break
            if i in piece_row or r.id in used:
                continue
            piece_row[i] = r
            used.add(r.id)

        # Chamber setting for brand-new pieces: a manual choice of this origin (from a
        # surviving row, or parked while the origin was fully covered) carries over.
        held = origin.get("held_chambers")
        manual_src = next((m for m in members if m.chamber_mode == "manual"), None)
        if manual_src is not None:
            held = {"selected_chambers": list(manual_src.selected_chambers or []),
                    "chamber_doses": dict(manual_src.chamber_doses or {})}

        settings_range = _ndvi_range(origin.get("settings"))
        codes = [code] if len(pieces) == 1 else [f"{code}{chr(97 + i)}" for i in range(len(pieces))]
        for i, piece in enumerate(pieces):
            row = piece_row.get(i)
            if row is None:
                row = SprayPolygon(
                    field_id=imagery.field_id,
                    field_imagery_id=imagery.id,
                    sequence_no=origin.get("sequence_no") or 0,
                    settings=origin.get("settings") or {},
                    selected_chambers=list(held["selected_chambers"]) if held else [],
                    chamber_mode="manual" if held else "none",
                    chamber_doses=dict(held["chamber_doses"]) if held else {},
                    source="auto",
                    origin_code=code,
                )
            current = to_shape(row.geometry) if row.geometry else None
            if current is None or area_m2(current.symmetric_difference(piece)) > UNCHANGED_TOL_M2:
                row.geometry = mapping(piece)
                if not under_manual and "area_m2" in origin:
                    # Whole NDVI zone coming back: restore the figures it was approved with.
                    row.area_m2 = origin["area_m2"]
                    row.mean_ndvi = origin.get("mean_ndvi")
                else:
                    row.area_m2 = area_m2(piece)
                    row.mean_ndvi = mean_ndvi(imagery, piece, settings_range)
            row.zone_code = codes[i]
            if i not in piece_row:
                db.add(row)  # only once every NOT NULL column is filled

        # Park (or clear) a manual chamber choice on the origin record while it has no rows.
        if pieces:
            origin.pop("held_chambers", None)
        elif held:
            origin["held_chambers"] = held

        for r in members:
            if r.id not in used:
                surplus_moves.append((r, member_shapes.get(r.id)))

        after_m2 = sum(area_m2(p) for p in pieces)
        entry = {"origin": code, "before_m2": round(before_m2, 1), "after_m2": round(after_m2, 1),
                 "pieces": len(pieces)}
        if not pieces and members:
            report["removed"].append(entry)
        elif pieces and after_m2 < before_m2 - 0.5:
            report["clipped"].append(entry)
        elif pieces and after_m2 > before_m2 + 0.5:
            report["restored"].append(entry)

    imagery.zone_origins = origins
    flag_modified(imagery, "zone_origins")  # JSONB: make sure the rewrite is persisted
    db.flush()  # new piece rows get their ids

    # Rows left without a piece: hand their HPT on, then delete them.
    surplus_ids = {r.id for r, _ in surplus_moves}
    kept_auto = [r for r in db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source != "manual").all()
        if r.id not in surplus_ids]
    for row, geom in surplus_moves:
        target = None
        if geom is not None:
            siblings = [r for r in kept_auto if r.origin_code == row.origin_code]
            target = _best_overlap(geom, siblings) or _best_overlap(geom, [r for r, _ in manual])
        n = _move_detections(db, [row.id], target.id if target is not None else None)
        if target is not None:
            report["hpt_moved"] += n
            touched.add(target.id)
        else:
            report["hpt_unzoned"] += n
    if surplus_ids:
        db.query(SprayPolygon).filter(SprayPolygon.id.in_(surplus_ids)).delete(synchronize_session=False)
    db.flush()
    db.expire_all()
    refresh_auto_chambers(db, touched)
    db.flush()
    return report


def _best_overlap(geom, candidates: list[SprayPolygon]) -> SprayPolygon | None:
    best, best_area = None, 0.0
    for c in candidates:
        s = to_shape(c.geometry)
        if s is not None and s.intersects(geom):
            a = s.intersection(geom).area
            if a > best_area:
                best, best_area = c, a
    return best


def validate_manual_geometry(db: Session, imagery: FieldImagery, geometry: Any, exclude_id=None):
    """A manual zone must be one simple polygon (no holes, no crossing edges), at least
    MIN_PIECE_M2, and must not overlap another manual zone. Returns (shape, area_m2)."""
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        raise ZoneError(400, "Zona manual harus berupa satu poligon.")
    try:
        geom = shape(geometry)
    except Exception:
        raise ZoneError(400, "Koordinat poligon tidak valid.")
    ring = list(geom.exterior.coords)
    if len(ring) < 4:
        raise ZoneError(400, "Poligon minimal 3 titik.")
    if any(not (-180 <= x <= 180 and -90 <= y <= 90) for x, y, *_ in ring):
        raise ZoneError(400, "Koordinat harus [lng, lat] WGS84.")
    if geom.interiors:
        raise ZoneError(400, "Zona manual tidak boleh berlubang.")
    if not geom.is_valid:
        raise ZoneError(400, "Garis poligon saling berpotongan. Gambar ulang tanpa garis yang menyilang.")
    area = area_m2(geom)
    if area < MIN_PIECE_M2:
        raise ZoneError(400, f"Zona terlalu kecil ({area:.1f} m², minimum {MIN_PIECE_M2:g} m²).")
    others = db.query(SprayPolygon).filter(
        SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source == "manual")
    for other in others:
        if other.id == exclude_id:
            continue
        s = to_shape(other.geometry)
        if s is not None and s.intersects(geom):
            overlap = area_m2(s.intersection(geom))
            if overlap > MANUAL_OVERLAP_TOL_M2:
                raise ZoneError(409, f"Zona bertumpuk dengan {other.zone_code} ({overlap:.1f} m²). "
                                     "Zona manual tidak boleh saling menimpa.")
    return geom, area


def _next_manual_code(db: Session, imagery: FieldImagery) -> tuple[str, int]:
    used = [0]
    for (code,) in db.query(SprayPolygon.zone_code).filter(
            SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source == "manual"):
        suffix = (code or "")[len(MANUAL_PREFIX):]
        if code and code.startswith(MANUAL_PREFIX) and suffix.isdigit():
            used.append(int(suffix))
    n = max(used) + 1
    return f"{MANUAL_PREFIX}{n:02d}", n


def create_manual_zone(db: Session, imagery: FieldImagery, geometry: Any) -> tuple[SprayPolygon, dict]:
    geom, area = validate_manual_geometry(db, imagery, geometry)
    code, n = _next_manual_code(db, imagery)
    polygon = SprayPolygon(
        field_id=imagery.field_id,
        field_imagery_id=imagery.id,
        zone_code=code,
        sequence_no=MANUAL_SEQ_BASE + n,
        geometry=mapping(geom),
        area_m2=area,
        mean_ndvi=mean_ndvi(imagery, geom),
        settings={"source": "manual"},
        selected_chambers=[],
        chamber_mode="none",
        chamber_doses={},
        source="manual",
    )
    db.add(polygon)
    db.flush()
    return polygon, reclip_auto_zones(db, imagery)


def update_manual_zone(db: Session, imagery: FieldImagery, polygon: SprayPolygon, geometry: Any) -> dict:
    geom, area = validate_manual_geometry(db, imagery, geometry, exclude_id=polygon.id)
    polygon.geometry = mapping(geom)
    polygon.area_m2 = area
    polygon.mean_ndvi = mean_ndvi(imagery, geom)
    db.flush()
    return reclip_auto_zones(db, imagery)


def delete_manual_zone(db: Session, imagery: FieldImagery, polygon: SprayPolygon) -> dict:
    """Remove a manual zone, give its area back to the automatic zones, and move its HPT
    to the automatic zone that now covers that ground (unlinked if none does)."""
    geom = to_shape(polygon.geometry)
    hpt_ids = [d for (d,) in db.query(TargetDetection.id).filter(TargetDetection.polygon_id == polygon.id)]
    _move_detections(db, [polygon.id], None)  # unlink first: the zone delete cascades
    db.query(SprayPolygon).filter(SprayPolygon.id == polygon.id).delete(synchronize_session=False)
    db.flush()
    db.expire_all()
    report = reclip_auto_zones(db, imagery)
    if hpt_ids:
        autos = db.query(SprayPolygon).filter(
            SprayPolygon.field_imagery_id == imagery.id, SprayPolygon.source != "manual").all()
        target = _best_overlap(geom, autos) if geom is not None else None
        if target is not None:
            db.query(TargetDetection).filter(TargetDetection.id.in_(hpt_ids)).update(
                {TargetDetection.polygon_id: target.id}, synchronize_session=False)
            refresh_auto_chambers(db, [target.id])
            report["hpt_moved"] += len(hpt_ids)
        else:
            report["hpt_unzoned"] += len(hpt_ids)
        db.flush()
    return report
