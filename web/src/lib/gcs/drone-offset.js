import { useSyncExternalStore } from "react";
import { ZERO_OFFSET } from "@/lib/gcs/gps-offset";

// Global, persisted store for the drone GPS-drift ("pose") offset — the single
// source of truth applied everywhere drone data is shown or a mission is pushed.
// Persisted in localStorage so a page reload mid-planning does not lose the
// calibration; `calibratedAt` lets the UI surface its age so a stale drift is
// never applied silently. See gps-offset.js for the maths and frame conventions.
export const DRONE_OFFSET_KEY = "soerogis:drone-offset";
const OFFSET_EVENT = "soerogis:drone-offset-changed";

function clampNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parse(raw) {
  if (!raw) return ZERO_OFFSET;
  try {
    const data = JSON.parse(raw);
    return {
      dLat: clampNum(data.dLat),
      dLon: clampNum(data.dLon),
      dHeading: clampNum(data.dHeading),
      calibratedAt: Number.isFinite(data.calibratedAt) ? data.calibratedAt : null,
    };
  } catch {
    return ZERO_OFFSET;
  }
}

export function getDroneOffset() {
  if (typeof window === "undefined") return ZERO_OFFSET;
  return parse(window.localStorage.getItem(DRONE_OFFSET_KEY));
}

/**
 * Replace the active offset (calibration is absolute, not incremental). Pass
 * the delta from computeDroneOffset(); `calibratedAt` is stamped here.
 */
export function setDroneOffset(offset) {
  if (typeof window === "undefined") return ZERO_OFFSET;
  const next = {
    dLat: clampNum(offset?.dLat),
    dLon: clampNum(offset?.dLon),
    dHeading: clampNum(offset?.dHeading),
    calibratedAt: Number.isFinite(offset?.calibratedAt) ? offset.calibratedAt : Date.now(),
  };
  window.localStorage.setItem(DRONE_OFFSET_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(OFFSET_EVENT));
  return next;
}

/** Clear the calibration back to a no-op offset. */
export function clearDroneOffset() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRONE_OFFSET_KEY);
  window.dispatchEvent(new Event(OFFSET_EVENT));
}

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key === DRONE_OFFSET_KEY) callback();
  };
  window.addEventListener(OFFSET_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(OFFSET_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedRaw = null;
let cached = ZERO_OFFSET;

function snapshot() {
  if (typeof window === "undefined") return ZERO_OFFSET;
  const raw = window.localStorage.getItem(DRONE_OFFSET_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

/** Reactive read of the active offset. */
export function useDroneOffset() {
  return useSyncExternalStore(subscribe, snapshot, () => ZERO_OFFSET);
}

// Re-export the pure helpers so call sites import everything offset-related from
// this one module.
export {
  ZERO_OFFSET,
  computeDroneOffset,
  applyOffsetToCoords,
  applyOffsetToHeading,
  correctWaypointForCommand,
  correctGeoWaypointsForCommand,
  correctPolygonForCommand,
  hasOffset,
  offsetMeters,
  offsetBearingDeg,
  bearingDeg,
  normalizeHeading,
  normalizeDeltaHeading,
} from "@/lib/gcs/gps-offset";
