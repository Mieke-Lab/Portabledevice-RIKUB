import * as turf from "@turf/turf";
import { generateFlightPath } from "@/lib/gcs/path-planner";

// Turns real lat/lng spray-target polygons into a boustrophedon (zig-zag)
// coverage path, driving the existing pixel-agnostic `generateFlightPath`
// engine through a local equirectangular projection so that lane spacing is
// expressed in true metres and the sweep angle is a true compass-ish bearing.

const EARTH_RADIUS_M = 6378137;
const DEG2RAD = Math.PI / 180;

/**
 * Local equirectangular projection around an origin: converts lng/lat <-> local
 * metres (x = east, y = north). Accurate for the small extents of a single field.
 * @param {number} originLng
 * @param {number} originLat
 */
export function makeLocalProjection(originLng, originLat) {
  const metersPerDegLng = Math.cos(originLat * DEG2RAD) * DEG2RAD * EARTH_RADIUS_M;
  const metersPerDegLat = DEG2RAD * EARTH_RADIUS_M;
  return {
    toLocal(lng, lat) {
      return {
        x: (lng - originLng) * metersPerDegLng,
        y: (lat - originLat) * metersPerDegLat,
      };
    },
    toGeo(x, y) {
      return {
        lng: originLng + x / metersPerDegLng,
        lat: originLat + y / metersPerDegLat,
      };
    },
  };
}

function toRing(coords) {
  if (!Array.isArray(coords)) return null;
  const ring = coords
    .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => ({ lng: c[0], lat: c[1] }));
  // GeoJSON rings are closed (first == last); drop the duplicate for the engine.
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.lng === last.lng && first.lat === last.lat) ring.pop();
  }
  return ring;
}

/**
 * Every polygon part of a GeoJSON geometry with its holes: [{ring, holes: [ring]}].
 * A spray zone can have holes (an automatic zone clipped around a manual zone drawn
 * inside it) or several parts; reading only the first outer ring would plan - and
 * spray - over the hole and skip the other parts.
 */
export function polygonParts(geometry) {
  if (!geometry) return [];
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const parts = [];
  for (const rings of Array.isArray(polys) ? polys : []) {
    const ring = toRing(rings?.[0]);
    if (!ring || ring.length < 3) continue;
    const holes = (rings.slice(1) || []).map(toRing).filter((h) => h && h.length >= 3);
    parts.push({ ring, holes });
  }
  return parts;
}

/** Parts of a target; plain {ring} areas (e.g. survey areas) count as one hole-free part. */
function targetParts(target) {
  if (Array.isArray(target?.parts) && target.parts.length) return target.parts;
  return Array.isArray(target?.ring) && target.ring.length >= 3 ? [{ ring: target.ring, holes: [] }] : [];
}

const closed = (ring) => {
  const coords = ring.map((p) => [p.lng, p.lat]);
  return [...coords, coords[0]];
};

/**
 * Split a polygon with holes into hole-free polygons covering exactly the same ground.
 * The drone's spray loop only understands single rings (docs/drone_api.md: zones are
 * `[[lat,lng],...]`), so a holed zone sent as its outer ring would spray inside the
 * hole too - on top of the manual zone that owns it. Each hole is opened by cutting the
 * polygon along a north-south line through the hole's middle (such a line always crosses
 * the hole), recursing until no piece has holes left.
 * @param {{ring: Array<{lng,lat}>, holes: Array<Array<{lng,lat}>>}} part
 * @returns {Array<Array<{lng,lat}>>} hole-free rings
 */
export function holeFreeRings(part) {
  if (!part?.holes?.length) return [part.ring];
  const out = [];
  const queue = [turf.polygon([closed(part.ring), ...part.holes.map(closed)])];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const poly = queue.pop();
    const [outer, ...holes] = poly.geometry.coordinates;
    if (!holes.length) {
      out.push(toRing(outer));
      continue;
    }
    const xs = holes[0].map((c) => c[0]);
    const cut = (Math.min(...xs) + Math.max(...xs)) / 2;
    const [minX, minY, maxX, maxY] = turf.bbox(poly);
    const pad = Math.max(maxX - minX, maxY - minY) || 1e-6;
    for (const half of [
      turf.bboxPolygon([minX - pad, minY - pad, cut, maxY + pad]),
      turf.bboxPolygon([cut, minY - pad, maxX + pad, maxY + pad]),
    ]) {
      const piece = turf.intersect(turf.featureCollection([poly, half]));
      if (!piece) continue;
      const polys =
        piece.geometry.type === "Polygon" ? [piece.geometry.coordinates] : piece.geometry.coordinates;
      for (const rings of polys) {
        const p = turf.polygon(rings);
        if (turf.area(p) >= 0.01) queue.push(p); // drop float slivers along the cut
      }
    }
  }
  return out.filter((r) => r && r.length >= 3);
}

/**
 * Spray zones for the drone: one entry per hole-free ring of every target part,
 * polygon as [[lat, lng], ...]. Ids stay the zone code, suffixed "#2", "#3"... when a
 * zone had to be split, all pieces carrying the zone's own chambers and doses.
 */
export function missionZonesFromTargets(targets) {
  const zones = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const rings = targetParts(target).flatMap(holeFreeRings);
    const baseId = String(target.zoneCode ?? target.id);
    rings.forEach((ring, i) => {
      zones.push({
        id: i === 0 ? baseId : `${baseId}#${i + 1}`,
        zoneCode: target.zoneCode ?? null,
        polygon: ring.map((point) => [point.lat, point.lng]),
        chambers: target.chambers,
        chamberDoses: target.chamberDoses,
      });
    });
  }
  return zones;
}

/**
 * Normalise spray-target GeoJSON features into planning targets.
 * @param {Array} features GeoJSON features with polygon geometry
 * @returns {Array<{id, zoneCode, chambers: string[], chamberDoses: Object, areaM2: number, ring: Array<{lng, lat}>, parts: Array<{ring, holes}>}>}
 */
export function featuresToTargets(features) {
  const targets = [];
  for (const feature of Array.isArray(features) ? features : []) {
    const parts = polygonParts(feature?.geometry);
    if (!parts.length) continue;
    const props = feature.properties ?? {};
    targets.push({
      id: props.id ?? props.zone_code ?? targets.length,
      zoneCode: props.zone_code ?? null,
      chambers: Array.isArray(props.selected_chambers) ? props.selected_chambers : [],
      chamberDoses:
        props.chamber_doses && typeof props.chamber_doses === "object" ? props.chamber_doses : {},
      areaM2: Number(props.area_m2) || 0,
      ring: parts[0].ring, // first part's outer ring - kept for callers that only need an outline
      parts,
    });
  }
  return targets;
}

/** Axis-aligned lng/lat bounds + centre of all target vertices. */
export function targetsBounds(targets) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const target of targets) {
    for (const point of targetParts(target).flatMap((part) => part.ring)) {
      if (point.lng < minLng) minLng = point.lng;
      if (point.lng > maxLng) maxLng = point.lng;
      if (point.lat < minLat) minLat = point.lat;
      if (point.lat > maxLat) maxLat = point.lat;
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    cLng: (minLng + maxLng) / 2,
    cLat: (minLat + maxLat) / 2,
  };
}

/**
 * Sweep angle that runs the lanes along the field's longer axis (fewest turns).
 * Returns degrees in [0, 180): 0 = east-west lanes, 90 = north-south lanes.
 */
export function defaultAngleDeg(targets) {
  const bounds = targetsBounds(targets);
  if (!bounds) return 0;
  const proj = makeLocalProjection(bounds.cLng, bounds.cLat);
  const eastExtent = Math.abs(
    proj.toLocal(bounds.maxLng, bounds.cLat).x - proj.toLocal(bounds.minLng, bounds.cLat).x,
  );
  const northExtent = Math.abs(
    proj.toLocal(bounds.cLng, bounds.maxLat).y - proj.toLocal(bounds.cLng, bounds.minLat).y,
  );
  return eastExtent >= northExtent ? 0 : 90;
}

/** Great-circle distance in metres between two {lat, lng} points. */
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total ground length of a lat/lng path in metres. */
export function pathLengthMeters(geoPath) {
  let total = 0;
  for (let i = 1; i < geoPath.length; i++) {
    total += haversineMeters(geoPath[i - 1], geoPath[i]);
  }
  return total;
}

/**
 * Generate a coverage flight path over the given targets.
 * @param {object} opts
 * @param {Array} opts.targets normalised targets (see featuresToTargets)
 * @param {Array} [opts.obstacles] no-fly obstacles to exclude/avoid, each either
 *        {kind:"polygon", ring:[{lng,lat}]} (subtracted from the coverage area)
 *        or {kind:"circle", center:{lng,lat}, radiusM:number} (routed around)
 * @param {number} opts.laneSpacing lane spacing / line width, in metres
 * @param {number} opts.angleDeg sweep direction, in degrees
 * @param {{lat:number, lng:number}|null} [opts.startLngLat] seed the traversal
 *        so it begins at the field point nearest this location (e.g. the drone)
 * @returns {{proj, origin, bounds, localPath, geoPath}|null}
 */
export function planFlightPath({ targets, obstacles = [], laneSpacing, angleDeg, startLngLat }) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const bounds = targetsBounds(targets);
  if (!bounds) return null;

  const origin = { lng: bounds.cLng, lat: bounds.cLat };
  const proj = makeLocalProjection(origin.lng, origin.lat);

  try {
    const toLocal = (ring) => ring.map((point) => proj.toLocal(point.lng, point.lat));
    const objects = targets.flatMap((target) =>
      targetParts(target).map((part) => ({
        type: "area",
        shape: "polygon",
        id: target.id,
        points: toLocal(part.ring),
        holes: part.holes.map(toLocal), // subtracted from the coverage area
      })),
    );

    for (const obstacle of Array.isArray(obstacles) ? obstacles : []) {
      if (obstacle.kind === "polygon" && Array.isArray(obstacle.ring) && obstacle.ring.length >= 3) {
        objects.push({
          type: "obstacle",
          shape: "polygon",
          points: obstacle.ring.map((point) => proj.toLocal(point.lng, point.lat)),
        });
      } else if (obstacle.kind === "circle" && obstacle.center && obstacle.radiusM > 0) {
        objects.push({
          type: "obstacle",
          shape: "circle",
          points: [proj.toLocal(obstacle.center.lng, obstacle.center.lat)],
          radius: obstacle.radiusM,
        });
      }
    }

    const config = {
      gap: Math.max(0.1, Number(laneSpacing) || 0.1),
      angle: Number(angleDeg) || 0,
      offset: 0,
      invert: false,
    };
    if (startLngLat && Number.isFinite(startLngLat.lat) && Number.isFinite(startLngLat.lng)) {
      config.startPoint = proj.toLocal(startLngLat.lng, startLngLat.lat);
    }

    const localPath = generateFlightPath(objects, config);
    const geoPath = localPath.map((point) => {
      const { lng, lat } = proj.toGeo(point.x, point.y);
      return { lat, lng };
    });
    return { proj, origin, bounds, localPath, geoPath };
  } catch {
    // Degenerate / self-intersecting obstacle geometry can make turf throw;
    // degrade to an empty path instead of crashing the planning page.
    return { proj, origin, bounds, localPath: [], geoPath: [] };
  }
}
