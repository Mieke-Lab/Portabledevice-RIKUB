// Photogrammetry survey-grid planning for the mapping-mission planner.
//
// Given a drawn survey area (real lat/lng polygons) and camera/overlap settings,
// this derives a lawnmower coverage path — reusing the same `planFlightPath`
// engine the spraying planner uses — and samples it into discrete **capture
// stations** (photo points) at the along-track trigger spacing. Those stations
// become the `capture_points` of a `PushCaptureMission` (docs/mapping.md → the
// drone capture pipeline).
//
// The camera model is a standard pin-hole projection. GSD/footprint are honest
// estimates the UI labels as such; the operator tunes the two inputs that
// actually drive coverage — flight altitude (AGL) and front/side overlap.

import { planFlightPath } from "@/lib/gcs/flight-geo";

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Named payload presets. `sensor*Mm` is the physical sensor size, `focalLengthMm`
// the true (not 35mm-equivalent) focal length, `image*Px` the still resolution.
// Approximate — presets are editable/estimated, not a hardware spec. The MAPIR
// RGN ag camera is this deployment's usual mapping payload (memory + ortho is a
// false-colour RGN composite), so it is the default.
export const CAMERA_PRESETS = [
  {
    id: "mapir-survey3w",
    label: "MAPIR Survey3W (RGN)",
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.63,
    focalLengthMm: 3.37,
    imageWidthPx: 4000,
    imageHeightPx: 3000,
  },
  {
    id: "dji-half23-12mp",
    label: 'DJI 1/2.3" · 12 MP',
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.55,
    focalLengthMm: 4.3,
    imageWidthPx: 4000,
    imageHeightPx: 3000,
  },
  {
    id: "dji-1inch-20mp",
    label: 'DJI 1" · 20 MP',
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    focalLengthMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
  },
];

export const DEFAULT_CAMERA = CAMERA_PRESETS[0];

export function cameraById(id) {
  return CAMERA_PRESETS.find((c) => c.id === id) ?? DEFAULT_CAMERA;
}

/** Ground sample distance in metres/pixel at `altitudeM` (AGL). */
export function groundSampleDistance(cam, altitudeM) {
  const f = cam.focalLengthMm;
  const w = cam.imageWidthPx;
  if (!(f > 0) || !(w > 0)) return 0;
  return (cam.sensorWidthMm * altitudeM) / (f * w);
}

/**
 * Ground footprint of one frame at `altitudeM`: `{ width, height, gsd }` in
 * metres (image width = across-track, height = along-track).
 */
export function groundFootprint(cam, altitudeM) {
  const gsd = groundSampleDistance(cam, altitudeM);
  return { gsd, width: gsd * cam.imageWidthPx, height: gsd * cam.imageHeightPx };
}

/**
 * Lane spacing (across-track) and photo-trigger spacing (along-track), both in
 * metres, from the footprint and the requested overlaps (percent 0–100).
 * @returns {{ laneSpacing:number, photoSpacing:number, gsd:number, footprint:{width,height,gsd} }}
 */
export function surveySpacing(cam, { altitudeM, frontOverlap, sideOverlap }) {
  const footprint = groundFootprint(cam, altitudeM);
  const laneSpacing = Math.max(0.5, footprint.width * (1 - clamp01((sideOverlap ?? 0) / 100)));
  const photoSpacing = Math.max(0.5, footprint.height * (1 - clamp01((frontOverlap ?? 0) / 100)));
  return { laneSpacing, photoSpacing, gsd: footprint.gsd, footprint };
}

/**
 * Sample a metric polyline (`[{x,y}]`) into stations ~`spacing` metres apart,
 * keeping every turn vertex. Dedupes stations closer than half the spacing so
 * lane corners don't stack up. Mirrors the reference capture-station sampler.
 */
function sampleStations(path, spacing) {
  const out = [];
  const gap = Math.max(0.5, spacing);
  const push = (p) => {
    if (!out.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < gap * 0.5)) out.push(p);
  };
  push(path[0]);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const steps = Math.floor(len / gap);
    for (let s = 1; s <= steps; s++) {
      const t = (s * gap) / len;
      push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    push(b);
  }
  return out;
}

/**
 * Plan a photogrammetry survey over `areas`.
 * @param {object} opts
 * @param {Array<{id, ring: Array<{lat,lng}>}>} opts.areas survey-area polygons
 * @param {Array} [opts.obstacles] no-fly obstacles (planFlightPath shape)
 * @param {number} opts.laneSpacing across-track lane gap (metres)
 * @param {number} opts.photoSpacing along-track photo trigger (metres)
 * @param {number} opts.angleDeg sweep bearing (degrees)
 * @param {{lat,lng}|null} [opts.startLngLat] seed the traversal near this point
 * @returns {{ geoPath: Array<{lat,lng}>, captures: Array<{lat,lng}>, plan: object|null }}
 */
export function planSurvey({ areas, obstacles = [], laneSpacing, photoSpacing, angleDeg, startLngLat }) {
  const plan = planFlightPath({ targets: areas, obstacles, laneSpacing, angleDeg, startLngLat });
  const localPath = plan?.localPath ?? [];
  if (localPath.length < 2 || !plan?.proj) {
    return { geoPath: plan?.geoPath ?? [], captures: [], plan: plan ?? null };
  }
  const captures = sampleStations(localPath, photoSpacing).map((s) => {
    const g = plan.proj.toGeo(s.x, s.y);
    return { lat: g.lat, lng: g.lng };
  });
  return { geoPath: plan.geoPath, captures, plan };
}
