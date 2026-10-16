// Run: cd web && node --test src/lib/gcs/diagnostics.test.mjs   (Node's built-in runner; no dependencies)
//
// headingDeg() drives the nose direction of every drone marker. On the FCU we fly, Diagnostics has `imu: null` and
// `gps_raw: null` (their MAVLink streams are off) and only `compass` (MAVROS compass_hdg) carries the heading — the
// markers used to sit at their rest pose, facing north, on exactly that payload.
import assert from "node:assert/strict";
import test from "node:test";
import { headingDeg } from "./diagnostics.js";

// ENU quaternion (x, y, z, w) for a yaw of `yawEnuDeg` counter-clockwise from East.
const enu = (yawEnuDeg) => {
  const half = (yawEnuDeg * Math.PI) / 360;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
};
const realFcu = (compass) => ({ available: true, imu: null, gps_raw: null, compass });

test("the real FCU payload (imu and gps_raw null) still gives a heading, from the compass", () => {
  assert.equal(headingDeg(realFcu({ heading_deg: 105.86, age_s: 0.1 })), 105.86);
});

test("no data, no compass, an FCU without a heading: unknown, never 0 (north)", () => {
  assert.equal(headingDeg(null), null);
  assert.equal(headingDeg(undefined), null);
  assert.equal(headingDeg(realFcu(null)), null);
  assert.equal(headingDeg({ available: true }), null);
  assert.equal(headingDeg(realFcu({ heading_deg: null, age_s: 0 })), null);
});

test("a stale compass sample is not trusted (the FCU link is stuck, the backend replays its last value)", () => {
  assert.equal(headingDeg(realFcu({ heading_deg: 105.86, age_s: 5 })), 105.86); // exactly at the limit still counts
  assert.equal(headingDeg(realFcu({ heading_deg: 105.86, age_s: 5.01 })), null);
  assert.equal(headingDeg(realFcu({ heading_deg: 105.86, age_s: 60 })), null);
});

test("an older backend without age_s is taken at its word", () => {
  assert.equal(headingDeg(realFcu({ heading_deg: 270 })), 270);
});

test("the compass circle: 0 is north, 360 wraps to 0, nonsense is ignored", () => {
  assert.equal(headingDeg(realFcu({ heading_deg: 0, age_s: 0 })), 0);
  assert.equal(headingDeg(realFcu({ heading_deg: 360, age_s: 0 })), 0);
  assert.equal(headingDeg(realFcu({ heading_deg: 359.99, age_s: 0 })), 359.99);
  for (const bad of [-1, 360.5, 655.35, NaN, Infinity, "90", undefined]) {
    assert.equal(headingDeg(realFcu({ heading_deg: bad, age_s: 0 })), null, `heading_deg=${bad}`);
  }
});

test("GPS-derived yaw wins over everything (cdeg; 0 and 65535 mean 'does not provide yaw')", () => {
  const data = { gps_raw: { yaw: 9000, cog: 18000 }, imu: { orientation: enu(0) }, compass: { heading_deg: 200, age_s: 0 } };
  assert.equal(headingDeg(data), 90);
  for (const none of [0, 65535]) {
    assert.equal(headingDeg({ gps_raw: { yaw: none }, compass: { heading_deg: 200, age_s: 0 } }), 200, `yaw=${none}`);
  }
});

test("the IMU quaternion (ENU yaw) becomes a compass bearing and beats the compass", () => {
  const at = (yawEnu, compass) => headingDeg({ imu: { orientation: enu(yawEnu) }, compass: { heading_deg: compass, age_s: 0 } });
  assert.ok(Math.abs(at(0, 200) - 90) < 1e-9, "facing East");
  assert.ok(Math.abs(at(90, 200) - 0) < 1e-9 || Math.abs(at(90, 200) - 360) < 1e-9, "facing North");
  assert.ok(Math.abs(at(180, 200) - 270) < 1e-9, "facing West");
  assert.ok(Math.abs(at(-90, 200) - 180) < 1e-9, "facing South");
});

test("course over ground is the last resort, behind a fresh compass", () => {
  assert.equal(headingDeg({ gps_raw: { cog: 18000 } }), 180);
  assert.equal(headingDeg({ gps_raw: { cog: 18000 }, compass: { heading_deg: 45, age_s: 0 } }), 45);
  assert.equal(headingDeg({ gps_raw: { cog: 18000 }, compass: { heading_deg: 45, age_s: 99 } }), 180);
  assert.equal(headingDeg({ gps_raw: { cog: 36000 } }), null, "65535-style / out-of-range cog is not a course");
});
