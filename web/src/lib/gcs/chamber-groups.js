// Drone spec (Spesifikasi ITS Agriculture Drone V3): max flight altitude 10m,
// Effective Swath Width 5-8m depending on speed/altitude/nozzle/wind — spec
// gives no formula for that dependency.
// ponytail: linear interpolation by altitude alone as a placeholder for the
// missing formula. SWATH_MIN_ALTITUDE (2m) is an assumption — not in the
// spec — for the altitude below which downwash/coverage stops being
// reliable on this class of spray drone. Replace with real field-calibration
// data (or fold in speed/wind) once available.
const SWATH_MIN_ALTITUDE = 2;
const SWATH_MAX_ALTITUDE = 10;
const SWATH_MIN_WIDTH = 5;
const SWATH_MAX_WIDTH = 8;

// ponytail: round to 1 decimal at the source so floating-point noise
// (e.g. 6.125 * 0.8 -> 4.899999999999999) never reaches state or the UI.
function round1(value) {
  return Math.round(value * 10) / 10;
}

export function lookupSprayWidth(altitude) {
  const clamped = Math.min(SWATH_MAX_ALTITUDE, Math.max(SWATH_MIN_ALTITUDE, altitude));
  const t = (clamped - SWATH_MIN_ALTITUDE) / (SWATH_MAX_ALTITUDE - SWATH_MIN_ALTITUDE);
  return round1(SWATH_MIN_WIDTH + t * (SWATH_MAX_WIDTH - SWATH_MIN_WIDTH));
}

export function defaultLaneSpacing(altitude) {
  return round1(lookupSprayWidth(altitude) * 0.8);
}

function chamberKey(chambers) {
  return [...chambers].sort().join("+");
}

function chamberLabel(chamber) {
  return chamber.charAt(0).toUpperCase() + chamber.slice(1);
}

/**
 * Groups spray target features by their unique selected_chambers combination,
 * and derives spray width / lane spacing per group.
 *
 * Two chambers active together spray at the full effective swath width; one
 * chamber alone sprays at half that width, so its lane spacing is tighter to
 * still cover the area without gaps.
 *
 * @param {{ features: object[], altitude: number, laneSpacingInput: number }} params
 */
export function computeChamberGroups({ features, altitude, laneSpacingInput }) {
  const sprayWidthFull = lookupSprayWidth(altitude);
  const overlapRatio = sprayWidthFull > 0 ? (sprayWidthFull - laneSpacingInput) / sprayWidthFull : 0;

  const byKey = new Map();
  for (const feature of features) {
    const chambers = Array.isArray(feature.properties?.selected_chambers)
      ? feature.properties.selected_chambers
      : [];
    if (chambers.length === 0) continue;
    const sortedChambers = [...chambers].sort();
    const key = chamberKey(sortedChambers);
    const zoneCode = feature.properties?.zone_code ?? "?";
    if (!byKey.has(key)) {
      byKey.set(key, { chambers: sortedChambers, zoneCodes: [] });
    }
    byKey.get(key).zoneCodes.push(zoneCode);
  }

  const groups = [...byKey.values()].map((group) => {
    const sprayWidth = round1(group.chambers.length >= 2 ? sprayWidthFull : sprayWidthFull / 2);
    const laneSpacing = round1(sprayWidth * (1 - overlapRatio));
    return {
      key: chamberKey(group.chambers),
      chambers: group.chambers,
      label: group.chambers.map(chamberLabel).join(" + "),
      zoneCodes: group.zoneCodes,
      sprayWidth,
      laneSpacing,
    };
  });

  const minSprayWidth = groups.length > 0 ? Math.min(...groups.map((g) => g.sprayWidth)) : sprayWidthFull;
  const laneSpacingInvalid = laneSpacingInput > 0 && laneSpacingInput > minSprayWidth;

  return {
    groups,
    sprayWidthFull,
    overlapPercent: Math.round(overlapRatio * 100),
    laneSpacingInvalid,
  };
}
