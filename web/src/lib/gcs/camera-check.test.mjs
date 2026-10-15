// Run: cd web && node --test src/lib/gcs/camera-check.test.mjs   (Node's built-in runner; no dependencies)
//
// liveCameraSummary() is what the Monitoring panel shows about the camera while a mapping survey flies. The fixtures are the
// shapes the backend really sends in Diagnostics.camera (paths: wifi:<iface> / esp_wifi / wire — see docs/drone_api.md).
// Photo counts are NOT part of it: Diagnostics.camera.totals run for the life of the backend, the mapping status has the
// per-mission ones.
import assert from "node:assert/strict";
import test from "node:test";
import { liveCameraSummary } from "./camera-check.js";

const path = (name, state, extra = {}) => ({
  name,
  kind: name === "wire" ? "wire" : name === "esp_wifi" ? "esp_wifi" : "wifi",
  state,
  usable: ["ready", "degraded", "unverifiable"].includes(state),
  verified: name !== "wire",
  latency_ms: null,
  ...extra,
});

test("no camera section: nothing to show", () => {
  assert.equal(liveCameraSummary(null), null);
  assert.equal(liveCameraSummary(undefined), null);
  assert.equal(liveCameraSummary("camera"), null);
});

test("a Wi-Fi path works: photos are confirmed, the path in use leads, the rest are backups or down", () => {
  const live = {
    mode: "wifi",
    method: "wifi:wlo1",
    paths: [
      path("wifi:wlx1", "down"),
      path("wifi:wlo1", "ready", { latency_ms: 31 }),
      path("esp_wifi", "ready"),
      path("wire", "unverifiable"),
    ],
  };
  const s = liveCameraSummary(live);
  assert.equal(s.verified, true);
  assert.equal(s.method, "wifi:wlo1");
  assert.equal(s.headline, "Wi-Fi PC (wlo1)");
  assert.equal(s.tone, "warn");                           // an adapter is down: one backup less
  assert.match(s.detail, /1 jalur bermasalah/);
  assert.deepEqual(s.paths.map((p) => p.name), ["wifi:wlo1", "esp_wifi", "wire", "wifi:wlx1"]);
  assert.equal(s.paths[0].role, "next");
  assert.equal(s.paths[0].latencyMs, 31);
  assert.equal(s.paths[1].role, "backup");
  assert.equal(s.paths[3].role, null);
  assert.equal(s.paths[3].tone, "bad");
});

test("every path healthy: plain OK", () => {
  const s = liveCameraSummary({ mode: "wifi", method: "esp_wifi", paths: [path("esp_wifi", "ready"), path("wire", "unverifiable")] });
  assert.equal(s.tone, "ok");
  assert.equal(s.headline, "Wi-Fi ESP32");
  assert.equal(s.detail, "Foto terverifikasi");
});

test("an adapter busy on another network is not a problem, only a path that is not available", () => {
  const s = liveCameraSummary({
    mode: "wifi",
    method: "wifi:wlo1",
    paths: [path("wifi:wlo1", "ready"), path("wifi:wlx9", "blocked", { blocked_by: "bababoiy" }), path("wire", "unverifiable")],
  });
  assert.equal(s.tone, "ok");
  assert.equal(s.paths.find((p) => p.name === "wifi:wlx9").stateLabel, "Dipakai jaringan lain");
});

test("only the wire is left (the bench today): usable but unconfirmed, and it is flagged", () => {
  const s = liveCameraSummary({
    mode: "wifi",
    method: "wire",
    paths: [path("wifi:wlo1", "blocked"), path("esp_wifi", "down"), path("wire", "unverifiable")],
  });
  assert.equal(s.verified, false);
  assert.equal(s.tone, "warn");
  assert.equal(s.headline, "Kabel PWM");
  assert.match(s.detail, /tidak terverifikasi/);
  assert.equal(s.paths[0].name, "wire");
  assert.equal(s.paths[0].role, "next");
});

test("no way to the camera at all: bad, not 'unknown'", () => {
  const s = liveCameraSummary({ mode: "wifi", method: null, paths: [path("wifi:wlo1", "down"), path("esp_wifi", "down"), path("wire", "down")] });
  assert.equal(s.tone, "bad");
  assert.equal(s.headline, "Kamera tidak terjangkau");
  assert.equal(s.verified, false);
});

test("the monitor has not looked yet: muted, never an alarm", () => {
  assert.equal(liveCameraSummary({ mode: "wifi", method: null, paths: [] }).tone, "muted");
  assert.equal(liveCameraSummary({ mode: "wifi", method: null, paths: [path("wifi:wlo1", "unknown"), path("wire", "unknown")] }).headline, "Belum dipantau");
});

test("the legacy blind-pulse interface is never verified and has no paths to list", () => {
  const s = liveCameraSummary({ mode: "esp", totals: { wifi: 0, esp_wifi: 0, wire: 0, esp: 5, skipped: 2 } });
  assert.equal(s.verified, false);
  assert.equal(s.tone, "warn");
  assert.deepEqual(s.paths, []);
});

test("a payload with junk fields still summarises, and never throws", () => {
  const s = liveCameraSummary({ mode: "wifi", method: "wire", paths: [path("wire", "unverifiable", { latency_ms: "slow" })] });
  assert.equal(s.paths[0].latencyMs, null);
  assert.doesNotThrow(() => liveCameraSummary({ mode: "wifi", method: "wire" }));
  assert.doesNotThrow(() => liveCameraSummary({ mode: "wifi", method: "wifi:wlo1", paths: "nope" }));
});
