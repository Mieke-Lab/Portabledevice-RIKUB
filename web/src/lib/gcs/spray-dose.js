// What the plan says each spray chamber applies, for the Monitoring panel.
//
// `zones` is SprayMissionStatus.zones (docs/drone_api.md → "Spraying pipeline"):
// [{ id, area_ha, rates: { right, left } }] — rates are L/ha, 0 meaning "this chamber is not used in that zone".
// `side` is the physical pump: "right" (chamber 1) or "left" (chamber 2).
//
// Pure — no React, no imports — so `node --test src/lib/gcs/spray-dose.test.mjs` runs it as is.

const finite = (value) => (Number.isFinite(value) ? value : null);

/** The dose (L/ha) `side` applies in zone `zoneId`; null when the zone or its rate is unknown. 0 = not used there. */
export function zoneDose(zones, zoneId, side) {
  if (!Array.isArray(zones) || zoneId == null || zoneId === "") return null;
  const zone = zones.find((candidate) => candidate?.id === zoneId);
  return finite(zone?.rates?.[side]);
}

/**
 * The plan's dose for one chamber over every zone that uses it (rate > 0):
 * `{ zones, minLpha, maxLpha, liters }` — `liters` ≈ Σ zone area × rate, the volume the plan expects this chamber to
 * spray (a fully covered zone; the sprayed total can differ a little with the lane layout).
 * Null when the status carries no zones at all (nothing pushed, or an older backend).
 */
export function plannedDose(zones, side) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  let count = 0;
  let min = Infinity;
  let max = 0;
  let liters = 0;
  for (const zone of zones) {
    const rate = finite(zone?.rates?.[side]);
    if (rate == null || rate <= 0) continue;
    count += 1;
    min = Math.min(min, rate);
    max = Math.max(max, rate);
    const area = finite(zone?.area_ha);
    if (area != null && area > 0) liters += area * rate;
  }
  return { zones: count, minLpha: count ? min : null, maxLpha: count ? max : null, liters };
}

/** "150" for a single dose, "150–500" when the zones differ, "—" when the chamber is not used. */
export function doseRangeLabel(plan) {
  if (!plan || plan.minLpha == null) return "—";
  const round = (value) => String(Math.round(value));
  return plan.minLpha === plan.maxLpha ? round(plan.minLpha) : `${round(plan.minLpha)}–${round(plan.maxLpha)}`;
}
