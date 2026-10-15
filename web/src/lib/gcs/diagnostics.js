import { useSyncExternalStore } from "react";

export const DIAGNOSTICS_KEY = "soerogis:diagnostics";
const DIAGNOSTICS_EVENT = "soerogis:diagnostics-updated";
const EMPTY = { data: null, error: null, updatedAt: null, loading: true };

function parse(raw) {
  if (!raw) return EMPTY;
  try {
    return JSON.parse(raw);
  } catch {
    return EMPTY;
  }
}

export function readDiagnostics() {
  if (typeof window === "undefined") return EMPTY;
  return parse(window.sessionStorage.getItem(DIAGNOSTICS_KEY));
}

export function writeDiagnostics(snapshot) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(snapshot));
  window.dispatchEvent(new Event(DIAGNOSTICS_EVENT));
}

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key === DIAGNOSTICS_KEY) callback();
  };
  window.addEventListener(DIAGNOSTICS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DIAGNOSTICS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedRaw = null;
let cached = EMPTY;

function snapshot() {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.sessionStorage.getItem(DIAGNOSTICS_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

export function useDiagnostics() {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export const GPS_FIX_LABELS = {
  0: "NO FIX",
  1: "NO FIX",
  2: "2D",
  3: "3D",
  4: "DGPS",
  5: "RTK FLT",
  6: "RTK FIX",
};

export function gpsFixLabel(fixType) {
  if (fixType == null) return "-";
  return GPS_FIX_LABELS[fixType] ?? `FIX ${fixType}`;
}

export function hasGpsFix(fixType) {
  return fixType != null && fixType >= 2;
}

export function diagnosticsCoords(data) {
  if (!data) return null;
  if (data.global_position && Number.isFinite(data.global_position.latitude)) {
    return {
      lat: data.global_position.latitude,
      lon: data.global_position.longitude,
    };
  }
  if (data.gps_raw && Number.isFinite(data.gps_raw.lat)) {
    return {
      lat: data.gps_raw.lat / 1e7,
      lon: data.gps_raw.lon / 1e7,
    };
  }
  return null;
}

export function isStale(updatedAt, staleAfterMs = 10000) {
  if (updatedAt == null) return true;
  return Date.now() - updatedAt > staleAfterMs;
}

export function activeJobId(data) {
  const id = data?.job_id;
  return !id || id === "idle" ? null : id;
}

function quaternionYawDeg(q) {
  const { x, y, z, w } = q;
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return ((yaw * 180) / Math.PI + 360) % 360;
}

// A compass sample older than this is not the nose direction any more (FCU link stuck, backend replaying its last
// value): fall through to the other sources, or to "unknown".
const COMPASS_MAX_AGE_S = 5;

/**
 * Compass bearing the drone's nose points to (0 = N, 90 = E, clockwise), or null when nothing says.
 * First source present wins: GPS-derived yaw, the IMU quaternion, the backend's `compass` (the FCU's own heading,
 * MAVROS compass_hdg), then course over ground. gps_raw and imu need their own MAVLink streams and are null on the
 * FCU we fly (so every map marker sat at its rest pose, facing north); `compass` rides on the position stream and
 * is there whenever the marker is.
 */
export function headingDeg(data) {
  if (!data) return null;
  const gps = data.gps_raw;
  const yaw = gps?.yaw;
  if (yaw != null && Number.isFinite(yaw) && yaw !== 0 && yaw !== 65535) {
    return (yaw / 100) % 360;
  }
  if (data.imu?.orientation) {
    return (90 - quaternionYawDeg(data.imu.orientation) + 360) % 360;
  }
  const compass = data.compass?.heading_deg;
  if (Number.isFinite(compass) && compass >= 0 && compass <= 360 && !(data.compass.age_s > COMPASS_MAX_AGE_S)) {
    return compass % 360;
  }
  const cog = gps?.cog;
  if (cog != null && Number.isFinite(cog) && cog >= 0 && cog < 36000) {
    return (cog / 100) % 360;
  }
  return null;
}
