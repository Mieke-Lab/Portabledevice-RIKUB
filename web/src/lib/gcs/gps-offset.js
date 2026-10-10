// Pure, dependency-free maths for the drone GPS-drift ("pose") offset.
//
// The drone's flight controller reports a GPS position/heading that is drifted
// by a slowly-varying error relative to the satellite imagery the user plans
// over. We model this as a single constant offset between two frames:
//
//     map_frame = gps_frame + Δ          (Δ = { dLat, dLon, dHeading })
//
// The user calibrates Δ RViz-style: they "tell" us where the drone actually is
// (and which way it faces) while we know what its GPS is reporting at that
// instant, so  Δ = true_pose − reported_pose.
//
// It is then applied in TWO opposite directions — get these backwards and the
// drone flies to the wrong place, so they are spelled out and unit-tested:
//
//   • Displaying drone data  → display  = reported + Δ   (add)
//        show the live marker where the drone truly is over the field.
//   • Pushing a mission      → command  = planned  − Δ   (subtract)
//        waypoints are authored in the map frame; the drone navigates in its
//        own (drifted) GPS frame, so pre-subtract the drift before sending.
//
// Heading is a compass bearing: 0 = North, 90 = East, clockwise — matching
// `headingDeg()` in diagnostics.js and the marker icon's `rotate(deg)`.

const EARTH_RADIUS_M = 6378137;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const METERS_PER_DEG_LAT = DEG2RAD * EARTH_RADIUS_M;

/** A no-op offset (fresh / never calibrated). */
export const ZERO_OFFSET = { dLat: 0, dLon: 0, dHeading: 0, calibratedAt: null };

// Leaflet uses {lat, lng}; diagnosticsCoords() uses {lat, lon}. Accept either.
function lonOf(p) {
  if (!p) return NaN;
  return Number.isFinite(p.lng) ? p.lng : p.lon;
}

/** Wrap a heading DIFFERENCE into (-180, 180] degrees (shortest signed turn). */
export function normalizeDeltaHeading(deg) {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = (((deg % 360) + 540) % 360) - 180;
  // Prefer +180 over -180 for readability; both are the same turn.
  return wrapped === -180 ? 180 : wrapped;
}

/** Wrap an absolute heading into [0, 360) degrees. */
export function normalizeHeading(deg) {
  if (!Number.isFinite(deg)) return deg;
  return ((deg % 360) + 360) % 360;
}

/** Compass initial bearing from a → b, in [0, 360) (0 = N, 90 = E). */
export function bearingDeg(a, b) {
  if (!a || !b) return null;
  const phi1 = a.lat * DEG2RAD;
  const phi2 = b.lat * DEG2RAD;
  const dLambda = (lonOf(b) - lonOf(a)) * DEG2RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  if (x === 0 && y === 0) return null; // a == b, bearing undefined
  return normalizeHeading(Math.atan2(y, x) * RAD2DEG);
}

/**
 * Compute the drift offset Δ from a calibration.
 * @param {object} p
 * @param {{lat, lon|lng}} p.reported   live RAW GPS position at calibration time
 * @param {number|null} p.reportedHeading  live RAW heading (deg) or null
 * @param {{lat, lng|lon}} p.truePos    where the user says the drone actually is
 * @param {number|null} p.trueBearing   the drone's true facing (deg) or null
 * @param {object} [p.previous]         prior offset, to keep dHeading when no
 *                                      new bearing is supplied (position-only)
 * @returns {{dLat, dLon, dHeading}}    (caller stamps calibratedAt)
 */
export function computeDroneOffset({ reported, reportedHeading, truePos, trueBearing, previous } = {}) {
  if (!reported || !truePos) return null;
  const rLon = lonOf(reported);
  const tLon = lonOf(truePos);
  // Need finite coords on BOTH sides — a partial fix (e.g. lat present, lon
  // missing) would otherwise produce a NaN/garbage drift that gets stored.
  if (
    !Number.isFinite(reported.lat) ||
    !Number.isFinite(rLon) ||
    !Number.isFinite(truePos.lat) ||
    !Number.isFinite(tLon)
  ) {
    return null;
  }
  const dLat = truePos.lat - reported.lat;
  const dLon = tLon - rLon;
  let dHeading = Number.isFinite(previous?.dHeading) ? previous.dHeading : 0;
  // A heading delta needs BOTH a supplied facing and a reported baseline; with
  // either missing we cannot know the drift, so we keep the previous value.
  if (Number.isFinite(trueBearing) && Number.isFinite(reportedHeading)) {
    dHeading = normalizeDeltaHeading(trueBearing - reportedHeading);
  }
  return { dLat, dLon, dHeading };
}

/** Display direction: shift a reported coordinate to its true (map) position. */
export function applyOffsetToCoords(coords, offset) {
  if (!coords || !Number.isFinite(coords.lat)) return null;
  const lon = lonOf(coords);
  if (!Number.isFinite(lon)) return null;
  const lat = coords.lat + (offset?.dLat || 0);
  const lng = lon + (offset?.dLon || 0);
  return { lat, lng, lon: lng };
}

/** Display direction: shift a reported heading to its true (map) heading. */
export function applyOffsetToHeading(heading, offset) {
  if (!Number.isFinite(heading)) return heading;
  return normalizeHeading(heading + (offset?.dHeading || 0));
}

/**
 * Command direction: convert a map-frame waypoint into the GPS-frame coordinate
 * to actually send, so the drone physically arrives at the intended spot.
 */
export function correctWaypointForCommand(pt, offset) {
  if (!pt) return pt;
  return {
    lat: pt.lat - (offset?.dLat || 0),
    lng: lonOf(pt) - (offset?.dLon || 0),
  };
}

/** Command direction over a list of {lat, lng|lon} waypoints. */
export function correctGeoWaypointsForCommand(points, offset) {
  return (Array.isArray(points) ? points : []).map((p) => correctWaypointForCommand(p, offset));
}

/** Command direction over a [[lat, lng], ...] ring, returning the same shape. */
export function correctPolygonForCommand(ring, offset) {
  return (Array.isArray(ring) ? ring : []).map((pair) => {
    if (!Array.isArray(pair)) {
      const c = correctWaypointForCommand(pair, offset);
      return [c.lat, c.lng];
    }
    const c = correctWaypointForCommand({ lat: pair[0], lng: pair[1] }, offset);
    return [c.lat, c.lng];
  });
}

/** True when the offset moves anything (guards near-zero float noise). */
export function hasOffset(offset) {
  if (!offset) return false;
  return (
    Math.abs(offset.dLat || 0) > 1e-9 ||
    Math.abs(offset.dLon || 0) > 1e-9 ||
    Math.abs(offset.dHeading || 0) > 1e-6
  );
}

/** Decompose the position drift into ground metres at a given latitude. */
export function offsetMeters(offset, atLat = 0) {
  const metersPerDegLon = Math.cos(atLat * DEG2RAD) * METERS_PER_DEG_LAT;
  const north = (offset?.dLat || 0) * METERS_PER_DEG_LAT;
  const east = (offset?.dLon || 0) * metersPerDegLon;
  return { north, east, distance: Math.hypot(north, east) };
}

/** Compass bearing of the position-drift vector, in [0, 360) (0 = N, 90 = E). */
export function offsetBearingDeg(offset, atLat = 0) {
  const { north, east } = offsetMeters(offset, atLat);
  if (Math.hypot(north, east) < 1e-6) return null;
  return normalizeHeading(Math.atan2(east, north) * RAD2DEG);
}
