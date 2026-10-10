// Colour + dose model for the realtime sprayed-area overlay on the Monitoring
// page. The reactive sprayer drives two independent pumps (see
// docs/drone_api.md → "Spraying pipeline"); we treat each pump as one drug:
//
//   right pump  → Fungisida   (cyan ramp)
//   left  pump  → Insektisida (amber ramp)
//   both active → a distinct violet ramp
//
// Each sprayed sample is painted in its drug's hue, shaded by the live measured
// flow so heavier dosing reads darker. Pure module — no React, no Leaflet — so
// the same mapping is shared by the flight-plan hand-off and the overlay legend.

import { productById, productRateLpha } from "@/lib/gcs/product-doses";

/** Default per-liquid application rate (L/ha) assigned when a zone selects a
 *  drug but the UI never captured a numeric dose. */
export const DEFAULT_RATE_LPHA = 50;

/** Fallback nozzle swath width (m) when neither the mission nor status reports one. */
export const DEFAULT_SWATH_M = 4;

/** Which drug each pump lays down, plus its low→high colour ramp. */
export const PUMP_DRUGS = {
  right: { key: "fungisida", label: "Fungisida", ramp: ["#67e8f9", "#22d3ee", "#0891b2"] },
  left: { key: "insektisida", label: "Insektisida", ramp: ["#fcd34d", "#f59e0b", "#b45309"] },
};

/** Ramp used where both liquids are applied on the same spot. */
export const BOTH_DRUG = { label: "Keduanya", ramp: ["#c4b5fd", "#8b5cf6", "#6d28d9"] };

// Any product may be loaded into either chamber, so the old "Fungisida"/"Insektisida"
// names are just the stored keys now — not what the operator sees. Loadout is chosen
// by physical pump side (Kanan/Kiri); everywhere a chamber is selected or monitored we
// show the loaded product's name instead, falling back to the side when none is set.
export const CHAMBER_SIDE_LABEL = {
  [PUMP_DRUGS.right.key]: "Kanan",
  [PUMP_DRUGS.left.key]: "Kiri",
};

/** Physical pump side ("Kanan"/"Kiri") for a chamber (drug) key. */
export function chamberSideLabel(chamberKey) {
  return CHAMBER_SIDE_LABEL[chamberKey] ?? String(chamberKey ?? "");
}

/** Operator-facing label for a chamber: the loaded product's name, else its side. */
export function chamberDisplayLabel(chamberKey, chamberProducts) {
  const products =
    chamberProducts && typeof chamberProducts === "object" ? chamberProducts : {};
  const product = productById(products[chamberKey]);
  return product ? product.name : chamberSideLabel(chamberKey);
}

/**
 * Selected chambers (drug keys) → per-pump application rates (L/ha).
 *
 * Rate resolution per chamber (first that is a positive number wins):
 *   1. explicit dose typed by the user (`doses[key]`)
 *   2. the default rate of the product loaded into that chamber
 *      (`chamberProducts[key]` → product-doses catalogue)
 *   3. DEFAULT_RATE_LPHA — so a selected chamber is never sprayed at zero.
 *
 * `doses` is either a per-chamber map captured in the UI (e.g.
 * `{ fungisida: 40, insektisida: 60 }`) or a single numeric base rate applied to
 * every selected pump. `chamberProducts` maps a chamber (drug key) to a product
 * id (e.g. `{ fungisida: "kontaf-50-sc" }`).
 */
export function ratesFromChambers(chambers, doses = undefined, chamberProducts = undefined) {
  const selected = new Set(Array.isArray(chambers) ? chambers : []);
  const products =
    chamberProducts && typeof chamberProducts === "object" && !Array.isArray(chamberProducts)
      ? chamberProducts
      : {};
  const rateFor = (key) => {
    const raw =
      doses && typeof doses === "object" && !Array.isArray(doses) ? doses[key] : doses;
    const explicit = Number(raw);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const productRate = productRateLpha(products[key]);
    if (Number.isFinite(productRate) && productRate > 0) return productRate;
    return DEFAULT_RATE_LPHA;
  };
  return {
    right: selected.has(PUMP_DRUGS.right.key) ? rateFor(PUMP_DRUGS.right.key) : 0,
    left: selected.has(PUMP_DRUGS.left.key) ? rateFor(PUMP_DRUGS.left.key) : 0,
  };
}

/**
 * Default application rate (L/ha) for a chamber given the product loaded into it,
 * or DEFAULT_RATE_LPHA when no product is set. Used by the UI to show/placeholder
 * the effective dose before the user types an override.
 */
export function defaultRateForChamber(productId) {
  const rate = productRateLpha(productId);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_RATE_LPHA;
}

/** A pump counts as actively spraying when it is commanded or measuring flow. */
function pumpActive(pump) {
  if (!pump) return false;
  if (Number.isFinite(pump.measured_lpm) && pump.measured_lpm > 0.01) return true;
  if (Number.isFinite(pump.target_lpm) && pump.target_lpm > 0.001) return true;
  return pump.on === true;
}

/** Best available flow figure (L/min) for a pump — measured, else commanded. */
function pumpFlow(pump) {
  if (!pump) return 0;
  if (Number.isFinite(pump.measured_lpm) && pump.measured_lpm > 0) return pump.measured_lpm;
  if (Number.isFinite(pump.target_lpm)) return pump.target_lpm;
  return 0;
}

/** Bucket a flow rate (L/min) into a 0..2 shade index for the drug ramp. */
export function flowShade(lpm) {
  if (lpm >= 1.2) return 2;
  if (lpm >= 0.4) return 1;
  return 0;
}

/**
 * Classify one sprayed sample into a paint style for the overlay.
 * @returns {{ paint: false } | { paint: true, color: string, shade: number, drugs: string[] }}
 */
export function classifySample(sample) {
  const right = sample?.right;
  const left = sample?.left;
  const rightOn = pumpActive(right);
  const leftOn = pumpActive(left);
  if (!rightOn && !leftOn) return { paint: false };

  const shade = flowShade(Math.max(rightOn ? pumpFlow(right) : 0, leftOn ? pumpFlow(left) : 0));

  let drug;
  if (rightOn && leftOn) drug = { ramp: BOTH_DRUG.ramp, drugs: [PUMP_DRUGS.right.label, PUMP_DRUGS.left.label] };
  else if (rightOn) drug = { ramp: PUMP_DRUGS.right.ramp, drugs: [PUMP_DRUGS.right.label] };
  else drug = { ramp: PUMP_DRUGS.left.ramp, drugs: [PUMP_DRUGS.left.label] };

  return { paint: true, color: drug.ramp[shade], shade, drugs: drug.drugs };
}

/** Leaflet vector style for a classified sample's swath dot. */
export function sampleLeafletStyle(color) {
  return { stroke: false, weight: 0, fillColor: color, fillOpacity: 0.5 };
}

/**
 * Legend rows for the drugs present in a mission. When `chambers` is null/unknown
 * the full two-drug legend is shown. Each pump row is labelled by its loaded
 * product name (from `chamberProducts`, e.g. `{ fungisida: "kontaf-50-sc" }`),
 * with the physical side ("Kanan"/"Kiri") as a sub-label / fallback.
 */
export function legendItems(chambers, chamberProducts = null) {
  const known = Array.isArray(chambers);
  const selected = new Set(known ? chambers : []);
  const rows = [];
  for (const pump of ["right", "left"]) {
    const drug = PUMP_DRUGS[pump];
    if (!known || selected.has(drug.key)) {
      const side = chamberSideLabel(drug.key);
      const label = chamberDisplayLabel(drug.key, chamberProducts);
      rows.push({ label, side: label === side ? null : side, ramp: drug.ramp });
    }
  }
  if (rows.length === 2) rows.push({ label: BOTH_DRUG.label, side: null, ramp: BOTH_DRUG.ramp });
  return rows;
}
