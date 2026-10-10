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
  const cog = gps?.cog;
  if (cog != null && Number.isFinite(cog) && cog >= 0 && cog < 36000) {
    return (cog / 100) % 360;
  }
  return null;
}
