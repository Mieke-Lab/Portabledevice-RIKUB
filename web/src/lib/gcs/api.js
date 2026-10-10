import { droneAddrHeaders } from "@/lib/gcs/drone-settings";

async function jsonOrThrow(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || data?.detail || `request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return data;
}

// gRPC FAILED_PRECONDITION surfaces as HTTP 409 (grpc_backend.grpc_to_http_status):
// the mapping backend uses it for "this would disturb a flying mission / delete the
// only copy of captured frames" — retry with force once the operator confirms.
export function isPreconditionError(err) {
  return err?.status === 409;
}

export async function fetchDiagnostics() {
  return jsonOrThrow(
    await fetch("/api/drone/diagnostics", {
      cache: "no-store",
      headers: droneAddrHeaders(),
    }),
  );
}

export async function fetchDroneConfig() {
  return jsonOrThrow(await fetch("/api/drone/config", { cache: "no-store" }));
}

// List mapping sessions. A drone-flown survey is in here from takeoff on (with
// its live `capture` block — docs/mapping.md); `captureOnly` keeps just those.
export async function fetchJobs({ captureOnly } = {}) {
  const query = captureOnly ? "?capture_only=true" : "";
  return jsonOrThrow(await fetch(`/api/jobs${query}`, { cache: "no-store" }));
}

export async function fetchJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" }));
}

export async function createJobFromFolder(sourceDir, opts = {}) {
  const name = opts.name ?? sourceDir.split("/").filter(Boolean).pop();
  return jsonOrThrow(await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_dir: sourceDir, name, area_name: opts.areaName, image_glob: opts.imageGlob, options: opts.options }),
  }));
}

// Cancel the ODM stitch. Refused (409) while a capture mission is flying the
// session unless `force` — cancel the mission itself first (cancelMappingMission).
export async function cancelJob(id, { force = false } = {}) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(force ? { force: true } : {}),
  }));
}

// Delete the whole session folder. Refused (409) without `force` while a mission
// is flying it, or when it holds captured frames that are the only copy.
export async function removeJob(id, { force = false } = {}) {
  const query = force ? "?force=true" : "";
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}${query}`, { method: "DELETE" }));
}

async function postCommand(path, body = {}) {
  return jsonOrThrow(
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify(body),
    }),
  );
}

export const armDrone = (options = {}) => postCommand("/api/drone/arm", options);
export const disarmDrone = (options = {}) => postCommand("/api/drone/disarm", options);
export const takeoffDrone = (options = {}) => postCommand("/api/drone/takeoff", options);
export const landDrone = (options = {}) => postCommand("/api/drone/land", options);
export const setDroneMode = (mode, options = {}) =>
  postCommand("/api/drone/setmode", { mode, ...options });

export async function fetchDroneStatus() {
  return jsonOrThrow(
    await fetch("/api/drone/status", { cache: "no-store", headers: droneAddrHeaders() }),
  );
}

export async function gotoPoint(p) {
  return postCommand("/api/drone/goto", {
    x: p.x,
    y: p.y,
    z: p.z,
    tolerance: p.tolerance,
    hold_duration: p.holdDuration,
    method: p.method,
    max_speed: p.maxSpeed,
  });
}

export async function pushMission(p) {
  return jsonOrThrow(
    await fetch("/api/drone/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        waypoints: p.waypoints,
        geo_waypoints: p.geoWaypoints,
        altitude: p.altitude,
        speed: p.speed,
        hold_time: p.holdTime,
        acceptance_radius: p.acceptanceRadius,
      }),
    }),
  );
}

export async function executeMission(p = {}) {
  return jsonOrThrow(
    await fetch("/api/drone/mission/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        mode: p.mode,
        altitude: p.altitude,
        job_id: p.jobId,
        session_id: p.jobId,
      }),
    }),
  );
}

// --- Mapping capture mission (see docs/mapping.md → "drone capture pipeline") -

// Upload a discrete-capture-point mapping mission (PushCaptureMission): a
// LOITER_UNLIM mission visiting each { lat, lng } station, holding for a photo.
// Blocking upload; returns the drone status. Follow with
// executeMission({ mode: "mapping", jobId }) to fly it.
export async function pushCaptureMission(p) {
  return jsonOrThrow(
    await fetch("/api/drone/mapping-mission", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        capture_points: p.capturePoints,
        altitude: p.altitude,
        hold_time: p.holdTime,
        session_id: p.sessionId,
      }),
    }),
  );
}

// Read-only poll of the mapping capture mission. The session itself exists from
// the moment the mission is pushed (its id is the `session_id` you passed), so the
// persisted flight state lives in fetchJob(sessionId).capture — this is the live
// per-leg view (`phase`, `captures_done`, `last_error`).
export async function fetchMappingMissionStatus() {
  return jsonOrThrow(
    await fetch("/api/drone/mapping-mission", {
      cache: "no-store",
      headers: droneAddrHeaders(),
    }),
  );
}

// End the current leg early (PauseMappingMission): the aircraft returns to its
// takeoff point, lands, and the frames taken so far are secured. Poll until the
// session's capture.state is "paused" (or MappingMissionStatus.phase), then
// resumeMappingMission() flies the remaining points as a new leg.
export const pauseMappingMission = () => postCommand("/api/drone/mapping-mission/pause", {});

// Start the next leg of a paused / interrupted / failed session
// (ResumeMappingMission): uploads a plan for the points not yet captured, reusing
// the session's altitude / hold_time unless overridden. Follow with
// executeMission({ mode: "mapping", jobId: sessionId }) to fly it.
export async function resumeMappingMission({ sessionId, altitude, holdTime } = {}) {
  return jsonOrThrow(
    await fetch("/api/drone/mapping-mission/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        session_id: sessionId,
        ...(altitude != null && { altitude }),
        ...(holdTime != null && { hold_time: holdTime }),
      }),
    }),
  );
}

// Drop the capture mission (CancelMappingMission) and tear the monitor down
// cleanly. The session, its frames and `capture.captured` survive on disk.
export const cancelMappingMission = (sessionId) =>
  postCommand("/api/drone/mapping-mission/cancel", sessionId ? { session_id: sessionId } : {});

// --- Reactive spraying (see docs/drone_api.md → "Spraying pipeline") ---------

// Poll the reactive spray session. Pass the previous response's `next_seq` back
// as `sinceSeq` to fetch only the new sprayed samples for the realtime overlay.
export async function fetchSprayStatus({ sinceSeq, maxSamples } = {}) {
  const params = new URLSearchParams();
  if (sinceSeq != null) params.set("since_seq", String(sinceSeq));
  if (maxSamples != null) params.set("max_samples", String(maxSamples));
  const query = params.toString();
  return jsonOrThrow(
    await fetch(`/api/drone/spray/status${query ? `?${query}` : ""}`, {
      cache: "no-store",
      headers: droneAddrHeaders(),
    }),
  );
}

// Upload a reactive spray mission (path + spray zones + per-liquid rates), then
// call executeMission({ mode: "spraying", jobId }) to start actuating.
export async function pushSprayMission(p) {
  return jsonOrThrow(
    await fetch("/api/drone/spray/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        session_id: p.sessionId,
        geo_waypoints: p.geoWaypoints,
        zones: p.zones,
        rates: p.rates,
        swath_width_m: p.swathWidthM,
        altitude: p.altitude,
        speed: p.speed,
      }),
    }),
  );
}

export const cancelSprayMission = () => postCommand("/api/drone/spray/cancel", {});
export const setSprayConfig = (patch = {}) => postCommand("/api/drone/spray/config", patch);

// Calibrate the sprayer flowmeters (SetFlowConfig). Pass sensorId (1 = D32,
// 2 = D4) to recalibrate a single line; omit it to apply to every flowmeter.
// Returns the flow snapshot (full when an ESP sensor is attached, else just
// the echoed pulses_per_liter).
export async function setFlowConfig(pulsesPerLiter, sensorId) {
  return jsonOrThrow(
    await fetch("/api/drone/flow-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        pulses_per_liter: pulsesPerLiter,
        ...(sensorId !== undefined && { sensor_id: sensorId }),
      }),
    }),
  );
}
