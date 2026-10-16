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

function setLocal(plan) {
  window.sessionStorage.setItem(MISSION_PLAN_KEY, JSON.stringify(plan));
  window.dispatchEvent(new Event(MISSION_PLAN_EVENT));
}

// The tab's copy is only a cache: the launched plan is also kept on the Pi
// (server/app/routes/mission_plans.py) so it survives closing the app or a reboot.
export function setMissionPlan(plan) {
  if (typeof window === "undefined") return;
  setLocal(plan);
  fetch("/api/mission-plans", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  }).catch(() => {});
}

const LATEST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Bring back the plan of the spray session the drone reports (or, with no session,
 * a plan launched in the last few hours) after the tab lost it. Resolves to the
 * restored plan or null.
 */
export async function restoreMissionPlan(sessionId) {
  if (typeof window === "undefined") return null;
  const url = sessionId ? `/api/mission-plans/${encodeURIComponent(sessionId)}` : "/api/mission-plans/latest";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const plan = await res.json();
    if (!plan || typeof plan !== "object") return null;
    if (!sessionId) {
      const age = Date.now() - Date.parse(plan.createdAt || "");
      if (!(age >= 0 && age < LATEST_MAX_AGE_MS)) return null;
    }
    setLocal(plan);
    return plan;
  } catch {
    return null;
  }
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
