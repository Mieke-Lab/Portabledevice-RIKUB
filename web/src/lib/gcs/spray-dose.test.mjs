// Run: cd web && node --test src/lib/gcs/spray-dose.test.mjs   (Node's built-in runner; no dependencies)
//
// The Monitoring panel shows what dose (L/ha) each spray chamber applies. The numbers come from SprayMissionStatus.zones, so
// these pin the reading of that payload — the live one from the 2026-10-14 field plan (Z01 … ZM03) is used as is.
import assert from "node:assert/strict";
import test from "node:test";
import { doseRangeLabel, plannedDose, zoneDose } from "./spray-dose.js";

const ZONES = [
  { id: "Z01", area_ha: 0.00106, point_count: 6, rates: { right: 150, left: 500 } },
  { id: "Z02", area_ha: 0.0000055, point_count: 3, rates: { right: 0, left: 500 } },
  { id: "ZM01", area_ha: 0.002625, point_count: 3, rates: { right: 150, left: 500 } },
  { id: "ZM02", area_ha: 0.002162, point_count: 4, rates: { right: 150, left: 0 } },
  { id: "ZM03", area_ha: 0.001916, point_count: 3, rates: { right: 150, left: 0 } },
];

test("zoneDose: the dose of the zone the aircraft is in, per pump; 0 means 'not used here'", () => {
  assert.equal(zoneDose(ZONES, "Z01", "right"), 150);
  assert.equal(zoneDose(ZONES, "Z01", "left"), 500);
  assert.equal(zoneDose(ZONES, "ZM02", "left"), 0);
  assert.equal(zoneDose(ZONES, "Z02", "right"), 0);
});

test("zoneDose: unknown zone, no zone, no zones, junk: null (never a made-up 0)", () => {
  assert.equal(zoneDose(ZONES, "nope", "right"), null);
  assert.equal(zoneDose(ZONES, null, "right"), null);
  assert.equal(zoneDose(ZONES, "", "right"), null);
  assert.equal(zoneDose(undefined, "Z01", "right"), null);
  assert.equal(zoneDose([], "Z01", "right"), null);
  assert.equal(zoneDose([{ id: "Z01" }], "Z01", "right"), null);
  assert.equal(zoneDose([{ id: "Z01", rates: { right: "150" } }], "Z01", "right"), null); // a string is not a rate
});

test("plannedDose: only the zones that use the chamber count; liters = area x rate", () => {
  const right = plannedDose(ZONES, "right");
  assert.equal(right.zones, 4);
  assert.equal(right.minLpha, 150);
  assert.equal(right.maxLpha, 150);
  assert.ok(Math.abs(right.liters - (0.00106 + 0.002625 + 0.002162 + 0.001916) * 150) < 1e-9);

  const left = plannedDose(ZONES, "left");
  assert.equal(left.zones, 3);
  assert.equal(left.minLpha, 500);
  assert.equal(left.maxLpha, 500);
  assert.ok(Math.abs(left.liters - (0.00106 + 0.0000055 + 0.002625) * 500) < 1e-9);
});

test("plannedDose: a chamber used at different doses reports the span", () => {
  const zones = [
    { id: "a", area_ha: 1, rates: { right: 150, left: 0 } },
    { id: "b", area_ha: 2, rates: { right: 500, left: 0 } },
  ];
  const right = plannedDose(zones, "right");
  assert.equal(right.minLpha, 150);
  assert.equal(right.maxLpha, 500);
  assert.equal(right.liters, 1150);                       // 1 ha x 150 + 2 ha x 500
  assert.equal(doseRangeLabel(right), "150–500");
});

test("plannedDose: a chamber no zone uses has no dose; no zones at all is 'unknown', not 'unused'", () => {
  const unused = plannedDose([{ id: "a", area_ha: 1, rates: { right: 150, left: 0 } }], "left");
  assert.deepEqual(unused, { zones: 0, minLpha: null, maxLpha: null, liters: 0 });
  assert.equal(doseRangeLabel(unused), "—");
  assert.equal(plannedDose([], "right"), null);
  assert.equal(plannedDose(undefined, "right"), null);
  assert.equal(doseRangeLabel(null), "—");
});

test("plannedDose: a zone without an area still counts for the dose, just not for the liters", () => {
  const plan = plannedDose([{ id: "a", rates: { right: 100, left: 0 } }, { id: "b", area_ha: 0.5, rates: { right: 100, left: 0 } }], "right");
  assert.equal(plan.zones, 2);
  assert.equal(plan.liters, 50);
  assert.equal(doseRangeLabel(plan), "100");
});
