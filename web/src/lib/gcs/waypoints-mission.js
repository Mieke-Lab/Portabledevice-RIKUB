// Load a spray mission straight from a QGroundControl ".waypoints" file
// (QGC WPL 110) instead of the Maps → spray-targets workflow.
//
// A .waypoints file lists a boustrophedon spray track inside a single field.
// We don't fly those points verbatim — instead we derive a *field polygon* by
// taking the convex hull around the mission waypoints, then hand that single
// polygon to /flight-plan exactly like a Maps spray-target. The planner then
// re-sweeps it with the user's chosen angle / lane-gap / altitude, while the
// polygon itself stays fixed (it's baked from the static file).
//
// The whole field is assigned the LEFT pump ("insektisida" per spray-overlay.js)
// so the drone sprays left-only for the entire mission.

import * as turf from "@turf/turf";

// The LEFT pump lays "insektisida" (see lib/gcs/spray-overlay.js → PUMP_DRUGS).
// Tagging the single zone with just this chamber makes ratesFromChambers() drive
// the left pump only (right pump stays off) — i.e. "left pump the whole time".
export const LEFT_PUMP_CHAMBER = "insektisida";

// A real spray field encloses hundreds of m²; a hull under this is a collinear/
// near-collinear artifact (turf.convex returns a valid but ~0 m² sliver for a
// line of points) and must be rejected rather than flown as a degenerate zone.
const MIN_FIELD_AREA_M2 = 1;

/**
 * Parse a QGC WPL 110 ".waypoints" file into structured rows. Column layout:
 * seq, current, frame, command, p1, p2, p3, p4, x(lat), y(lng), z(alt), autocontinue.
 * @param {string} text raw file contents
 * @returns {Array<{seq,current,frame,command,lat,lng,alt,positional:boolean}>}
 */
export function parseQgcWpl(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^QGC\s+WPL/i.test(t)) continue; // format header line
    const c = t.split(/\s+/);
    if (c.length < 12) continue;
    const lat = Number(c[8]);
    const lng = Number(c[9]);
    const alt = Number(c[10]);
    // A row carries a real position when lat/lng are finite and not the (0,0)
    // placeholder used by non-navigation items (e.g. DO_CHANGE_SPEED).
    const positional =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      (Math.abs(lat) > 1e-6 || Math.abs(lng) > 1e-6);
    rows.push({
      seq: Number(c[0]),
      current: Number(c[1]),
      frame: Number(c[2]),
      command: Number(c[3]),
      lat,
      lng,
      alt,
      positional,
    });
  }
  return rows;
}

// MAVLink NAV_* mission commands that carry a real lat/lng and legitimately
// define a field waypoint (WAYPOINT, LOITER_*, LAND, TAKEOFF, SPLINE_WAYPOINT).
// Anything else that merely happens to hold a coordinate — DO_SET_ROI (195/201),
// DO_CHANGE_SPEED (178), CONDITION_* — must NOT be pulled into the field polygon.
const FIELD_NAV_COMMANDS = new Set([16, 17, 18, 19, 21, 22, 31, 82]);

/**
 * Extract the field (mission) waypoints from parsed rows. Excludes (a) the QGC
 * home/launch row — seq 0 / the `current` flag — which is the planned-home point
 * and frequently far from the field (its inclusion would balloon the hull), and
 * (b) any non-navigation item that merely carries a coordinate (e.g. DO_SET_ROI).
 * Only true NAV waypoints define the sprayed field. Too few → caller errors out.
 * @returns {{ waypoints: Array<{lat,lng,alt}>, home: {lat,lng,alt}|null }}
 */
export function extractFieldWaypoints(rows) {
  const positional = (Array.isArray(rows) ? rows : []).filter((r) => r.positional);
  const home = positional.find((r) => r.seq === 0 || r.current === 1) ?? null;
  const field = positional.filter(
    (r) => r !== home && FIELD_NAV_COMMANDS.has(r.command),
  );
  return {
    waypoints: field.map((r) => ({ lat: r.lat, lng: r.lng, alt: r.alt })),
    home: home ? { lat: home.lat, lng: home.lng, alt: home.alt } : null,
  };
}

/**
 * Convex-hull polygon around the waypoints as a GeoJSON Polygon feature.
 * Returns null when no non-degenerate polygon exists — fewer than 3 points, or
 * all points collinear / coincident. We deliberately do NOT fabricate a bbox
 * rectangle in that case: a line of points has no real 2-D coverage area, so
 * null propagates to a clear user-facing error rather than a bogus spray box.
 * @param {Array<{lat:number,lng:number}>} waypoints
 * @returns {object|null} GeoJSON Feature<Polygon>
 */
export function polygonAroundWaypoints(waypoints) {
  const pts = (Array.isArray(waypoints) ? waypoints : [])
    .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
    .map((w) => turf.point([w.lng, w.lat]));
  if (pts.length < 3) return null;
  const hull = turf.convex(turf.featureCollection(pts)); // concavity ∞ → convex hull
  // convex() returns null for coincident points, and a valid but ~0 m² sliver
  // for collinear ones — reject both as having no real coverage area.
  if (hull?.geometry?.type !== "Polygon") return null;
  return turf.area(hull) >= MIN_FIELD_AREA_M2 ? hull : null;
}

/** Turn "misi_jember.waypoints" into a friendly display name ("Misi Jember"). */
export function missionNameFromFile(fileName) {
  if (!fileName) return "Misi Waypoint";
  const base = String(fileName)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!base) return "Misi Waypoint";
  return base.replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Build a /flight-plan hand-off input (the `soerogis:flight-plan-input` shape)
 * from a raw .waypoints file: a single left-pump spray-target polygon (convex
 * hull around the waypoints) plus the original waypoints for on-map reference.
 * Throws a user-facing Error (Indonesian) when the file has too few points.
 * @param {string} text raw file contents
 * @param {{ fileName?: string, createdAt?: string }} [opts]
 * @returns {{ featureCollection, fieldName, source, sourceWaypoints, createdAt }}
 */
export function buildFlightPlanInputFromWaypoints(text, opts = {}) {
  const rows = parseQgcWpl(text);
  const { waypoints } = extractFieldWaypoints(rows);
  if (waypoints.length < 3) {
    throw new Error("File misi tidak memuat cukup titik (minimal 3 waypoint).");
  }
  const hull = polygonAroundWaypoints(waypoints);
  if (!hull) {
    throw new Error("Tidak dapat membentuk polygon dari waypoint (titik segaris?).");
  }
  const feature = {
    type: "Feature",
    geometry: hull.geometry,
    properties: {
      id: "wp-mission",
      zone_code: "M01",
      sequence_no: 1,
      area_m2: Math.round(turf.area(hull)),
      mean_ndvi: null,
      settings: {},
      selected_chambers: [LEFT_PUMP_CHAMBER],
      chamber_mode: "left-only",
      detections: [],
    },
  };
  return {
    featureCollection: { type: "FeatureCollection", features: [feature] },
    fieldName: missionNameFromFile(opts.fileName),
    source: "waypoints-file",
    sourceWaypoints: waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}
