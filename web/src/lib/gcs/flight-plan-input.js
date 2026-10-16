// Cross-page handoff for the flight-planning page. The Maps page stashes the
// finalised spray-target polygons here, then navigates to /flight-plan which
// reads them back. sessionStorage is used (not react-router navigate state,
// which this app never uses, and not localStorage, which is unreliable inside
// the pywebview kiosk) — mirroring the mission-plan.js / diagnostics.js pattern.

export const FLIGHT_PLAN_INPUT_KEY = "soerogis:flight-plan-input";

/**
 * @param {{ featureCollection: object, fieldName?: string,
 *   chamberProducts?: Object, createdAt?: string }} input
 *   chamberProducts maps a chamber (drug key) to a product id, e.g.
 *   `{ fungisida: "kontaf-50-sc" }`, used to derive per-chamber default doses.
 */
export function setFlightPlanInput(input) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(FLIGHT_PLAN_INPUT_KEY, JSON.stringify(input));
}

export function readFlightPlanInput() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(FLIGHT_PLAN_INPUT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearFlightPlanInput() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(FLIGHT_PLAN_INPUT_KEY);
}
