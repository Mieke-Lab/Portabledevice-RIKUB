import { useSyncExternalStore } from "react";

export const MISSION_PLAN_KEY = "soerogis:mission-plan";
const MISSION_PLAN_EVENT = "soerogis:mission-plan-updated";

function parse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readMissionPlan() {
  if (typeof window === "undefined") return null;
  return parse(window.sessionStorage.getItem(MISSION_PLAN_KEY));
}

export function setMissionPlan(plan) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MISSION_PLAN_KEY, JSON.stringify(plan));
  window.dispatchEvent(new Event(MISSION_PLAN_EVENT));
}

export function clearMissionPlan() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(MISSION_PLAN_KEY);
  window.dispatchEvent(new Event(MISSION_PLAN_EVENT));
}

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e) => {
    if (e.key === null || e.key === MISSION_PLAN_KEY) cb();
  };
  window.addEventListener(MISSION_PLAN_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MISSION_PLAN_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedRaw = null;
let cachedPlan = null;
function getSnapshot() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(MISSION_PLAN_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPlan = parse(raw);
  }
  return cachedPlan;
}

export function useMissionPlan() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
