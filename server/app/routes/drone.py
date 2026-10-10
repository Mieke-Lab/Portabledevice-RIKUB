import math
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.grpc_backend import BACKEND_GRPC_ADDR, call_grpc, drone_addr_from_request

router = APIRouter(prefix="/api/drone", tags=["drone"])
DRONE = "/soerogis.DroneService"


async def _read_json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _payload(body: dict[str, Any] | None) -> dict[str, Any]:
    return body or {}


async def _call_grpc_in_threadpool(
    method: str, payload: Any, timeout: float, request: Request
) -> Any:
    """Run the blocking gRPC call off the event loop.

    WHY: this BFF is one uvicorn worker / one event loop, and `call_grpc` is a
    synchronous `unary_unary(...)(payload, timeout=...)` that blocks until the
    backend answers or `timeout` expires (70 s for the blocking uploads when the
    FCU is not connected -> DEADLINE_EXCEEDED). Calling it straight from an
    `async def` handler freezes *every* other request for that long — the
    kiosk's 3-4 s Diagnostics/GetJob polls, /api/fields, even the SPA files.
    Plain `def` handlers are already dispatched to the threadpool by Starlette;
    the `async def` ones (which need `await request.json()`) must offload
    explicitly. `call_grpc` is passed positionally and looked up at call time so
    the tests' `monkeypatch.setattr(drone, "call_grpc", fake)` still applies."""
    return await run_in_threadpool(
        call_grpc, method, payload, timeout, drone_addr_from_request(request)
    )


@router.get("/config")
def config():
    return {"default_addr": BACKEND_GRPC_ADDR, "defaultDroneAddr": BACKEND_GRPC_ADDR}


@router.get("/diagnostics")
def diagnostics(request: Request):
    return call_grpc(f"{DRONE}/Diagnostics", {}, timeout=15, addr=drone_addr_from_request(request))


@router.get("/status")
def status(request: Request):
    return call_grpc(f"{DRONE}/MissionStatus", {}, timeout=30, addr=drone_addr_from_request(request))


@router.post("/mission")
async def push_mission(request: Request):
    body = await _read_json(request)
    geo_waypoints = body.get("geo_waypoints") or []
    waypoints = body.get("waypoints") or []

    if geo_waypoints:
        payload = {
            "waypoints": [[point["lat"], point["lng"]] for point in geo_waypoints],
            "altitude": body.get("altitude"),
            "speed": body.get("speed"),
            "hold_time": body.get("hold_time"),
            "acceptance_radius": body.get("acceptance_radius"),
        }
    elif waypoints:
        origin = waypoints[0]
        meters_per_pixel = float(body.get("meters_per_pixel") or os.getenv("METERS_PER_PIXEL", "0.05"))
        payload = {
            "waypoints": [
                [-(point["y"] - origin["y"]) * meters_per_pixel, (point["x"] - origin["x"]) * meters_per_pixel]
                for point in waypoints
            ],
            "altitude": body.get("altitude"),
            "speed": body.get("speed"),
            "hold_time": body.get("hold_time"),
            "acceptance_radius": body.get("acceptance_radius"),
        }
    else:
        raise HTTPException(status_code=400, detail="geo_waypoints or waypoints are required")

    return await _call_grpc_in_threadpool(f"{DRONE}/PushMission", payload, 70, request)


@router.post("/mission/execute")
async def execute_mission(request: Request):
    body = await _read_json(request)
    return await _call_grpc_in_threadpool(
        f"{DRONE}/ExecuteMission",
        {
            "mode": body.get("mode"),
            "altitude": body.get("altitude"),
            "job_id": body.get("job_id"),
            "session_id": body.get("session_id"),
        },
        30,
        request,
    )


@router.post("/mapping-mission")
async def push_capture_mission(request: Request):
    """Upload a discrete-capture-point mapping mission (PushCaptureMission): a
    LOITER_UNLIM mission that visits each `{lat,lng}` capture station in order,
    holding for a photo. Blocking upload — returns the drone status object. The
    mapping session is created by this call (its id is the `session_id` we sent,
    and the response's `session_id` confirms it), so it is already in
    `GET /api/jobs` with `capture.state == "armed"`. Then call
    `POST /api/drone/mission/execute` with `{mode: "mapping", job_id: session_id}`
    to fly it. See docs/mapping.md (capture block) + docs/drone_api.md."""
    body = await _read_json(request)
    points = body.get("capture_points") or []
    valid = [
        {"lat": p["lat"], "lng": p["lng"]}
        for p in points
        if isinstance(p, dict)
        and isinstance(p.get("lat"), (int, float))
        and isinstance(p.get("lng"), (int, float))
    ]
    if not valid:
        raise HTTPException(
            status_code=400,
            detail="capture_points must be a non-empty array of { lat, lng } numbers",
        )

    payload: dict[str, Any] = {
        "capture_points": valid,
        "altitude": body.get("altitude"),
        "hold_time": body.get("hold_time"),
        "session_id": body.get("session_id"),
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    return await _call_grpc_in_threadpool(f"{DRONE}/PushCaptureMission", payload, 70, request)


@router.get("/mapping-mission")
def mapping_mission_status(request: Request):
    """Read-only poll of the current mapping leg (MappingMissionStatus):
    `{running, session_id, phase, captures_done, total_captures, odm_job_id,
    last_error}`. `odm_job_id` equals the pushed `session_id` from the start —
    the session exists from the push — and the *persisted* flight state (points
    captured so far, paused / resumable, leg number) is
    `GET /api/jobs/{id}.capture`. `phase` may use the older vocabulary
    (idle/arming/capturing/complete) or the `capture.state` one (armed/flying/
    returning/processing/paused/done/failed/canceled)."""
    return call_grpc(
        f"{DRONE}/MappingMissionStatus", {}, timeout=30, addr=drone_addr_from_request(request)
    )


def _optional_number(body: dict[str, Any], key: str, *, allow_zero: bool) -> float | None:
    """Pull an optional numeric field, rejecting bools / NaN / inf / negatives the
    way the flow-config handler does (JSON `true` is an int to isinstance)."""
    value = body.get(key)
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or (value == 0 and not allow_zero)
    ):
        bound = ">= 0" if allow_zero else "> 0"
        raise HTTPException(status_code=400, detail=f"{key} must be a number {bound}")
    return value


@router.post("/mapping-mission/pause")
async def pause_mapping_mission(request: Request):
    """End the current mapping leg early (PauseMappingMission), keeping every
    frame taken so far. Not a hover: the aircraft finishes/aborts the capture in
    progress, flies to the plan's trailing RTL and lands — and only after
    touchdown are the frames pulled off the camera (retrieval flips it into USB
    mass-storage mode, which must not happen in flight), so `capture.state` goes
    returning → processing → paused. Returns the status object immediately; poll
    until phase / `capture.state` == "paused" before resuming."""
    return await _call_grpc_in_threadpool(f"{DRONE}/PauseMappingMission", {}, 30, request)


@router.post("/mapping-mission/resume")
async def resume_mapping_mission(request: Request):
    """Start the next leg of a resumable session (ResumeMappingMission —
    `capture.state` in paused/interrupted/armed/failed): uploads a new plan for
    the points not yet in `capture.captured`, reusing the session's altitude /
    hold_time unless overridden here. Blocking upload — returns the status
    object. Then call `POST /api/drone/mission/execute` with
    `{mode: "mapping", job_id: session_id}` again. Refused (409) while another
    mapping/spray session is active or the session is not resumable."""
    body = await _read_json(request)
    session_id = body.get("session_id") or body.get("job_id")
    if not isinstance(session_id, str) or not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    payload: dict[str, Any] = {"session_id": session_id}
    # Omit the overrides entirely when absent so the backend falls back to the
    # session's own capture.altitude / capture.hold_time.
    altitude = _optional_number(body, "altitude", allow_zero=False)
    if altitude is not None:
        payload["altitude"] = altitude
    hold_time = _optional_number(body, "hold_time", allow_zero=True)
    if hold_time is not None:
        payload["hold_time"] = hold_time
    return await _call_grpc_in_threadpool(f"{DRONE}/ResumeMappingMission", payload, 70, request)


@router.post("/mapping-mission/cancel")
async def cancel_mapping_mission(request: Request):
    """Drop the armed/flying mapping mission and tear the monitor down
    (CancelMappingMission). The session folder, its frames and
    `capture.captured` survive; `capture.state` becomes "canceled". This — not
    `POST /api/jobs/{id}/cancel` — is the way to stop a session while
    `capture.active` is true. `session_id` is forwarded only when given."""
    body = await _read_json(request)
    payload: dict[str, Any] = {}
    if body.get("session_id"):
        payload["session_id"] = body["session_id"]
    return await _call_grpc_in_threadpool(f"{DRONE}/CancelMappingMission", payload, 15, request)


@router.get("/spray/status")
def spray_status(
    request: Request,
    since_seq: int | None = None,
    max_samples: int | None = None,
):
    """Poll the reactive spray session (SprayMissionStatus): live per-pump state,
    cumulative totals, and the incremental sprayed-sample track for the map
    overlay. Read-only — never aborts. Pass the previous response's `next_seq`
    back as `since_seq` to fetch only newer samples."""
    payload: dict[str, Any] = {}
    if since_seq is not None:
        payload["since_seq"] = since_seq
    if max_samples is not None:
        payload["max_samples"] = max_samples
    return call_grpc(
        f"{DRONE}/SprayMissionStatus", payload, timeout=15, addr=drone_addr_from_request(request)
    )


@router.post("/spray/mission")
async def push_spray_mission(request: Request):
    """Upload a reactive spray mission (PushSprayMission): the flight path plus
    the spray polygons and their per-liquid application rates. Accepts
    `geo_waypoints` ([{lat,lng}]) or `waypoints` ([[lat,lng]]); zones are
    `{id?, polygon: [[lat,lng]], rates?: {right,left}}`."""
    body = await _read_json(request)
    geo_waypoints = body.get("geo_waypoints") or []
    waypoints = body.get("waypoints") or []
    if geo_waypoints:
        waypoints = [[point["lat"], point["lng"]] for point in geo_waypoints]
    if not waypoints:
        raise HTTPException(status_code=400, detail="geo_waypoints or waypoints are required")

    zones = body.get("zones") or []
    if not zones:
        raise HTTPException(status_code=400, detail="zones are required")

    payload: dict[str, Any] = {
        "session_id": body.get("session_id"),
        "waypoints": waypoints,
        "zones": zones,
        "rates": body.get("rates"),
        "swath_width_m": body.get("swath_width_m"),
        "altitude": body.get("altitude"),
        "speed": body.get("speed"),
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    return await _call_grpc_in_threadpool(f"{DRONE}/PushSprayMission", payload, 70, request)


@router.post("/spray/cancel")
async def cancel_spray_mission(request: Request):
    """Cancel/disarm the reactive spray monitor (CancelSprayMission): forces both
    pumps off and releases the session. Safe to call when idle."""
    return await _call_grpc_in_threadpool(f"{DRONE}/CancelSprayMission", {}, 15, request)


@router.post("/spray/config")
async def spray_config(request: Request):
    """Tune the reactive spray controller at runtime (SetSprayConfig). All fields
    optional; returns the full current config."""
    body = await _read_json(request)
    return await _call_grpc_in_threadpool(f"{DRONE}/SetSprayConfig", _payload(body), 10, request)


@router.post("/flow-config")
async def flow_config(request: Request):
    """Calibrate the sprayer flowmeters (SetFlowConfig). `sensor_id` (1=D32,
    2=D4) targets one line; omit it to calibrate both."""
    body = await _read_json(request)
    ppl = body.get("pulses_per_liter")
    if (
        isinstance(ppl, bool)
        or not isinstance(ppl, (int, float))
        or not math.isfinite(ppl)
        or ppl <= 0
    ):
        raise HTTPException(status_code=400, detail="pulses_per_liter must be a number > 0")
    payload: dict[str, Any] = {"pulses_per_liter": ppl}
    sensor_id = body.get("sensor_id")
    if sensor_id is not None:
        if isinstance(sensor_id, bool) or not isinstance(sensor_id, int) or sensor_id <= 0:
            raise HTTPException(status_code=400, detail="sensor_id must be a positive integer")
        payload["sensor_id"] = sensor_id
    return await _call_grpc_in_threadpool(f"{DRONE}/SetFlowConfig", payload, 10, request)


@router.post("/arm")
async def arm(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return await _call_grpc_in_threadpool(f"{DRONE}/Arm", _payload(body), timeout + 5, request)


@router.post("/disarm")
async def disarm(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return await _call_grpc_in_threadpool(f"{DRONE}/Disarm", _payload(body), timeout + 5, request)


@router.post("/setmode")
async def set_mode(request: Request):
    body = await _read_json(request)
    if not body.get("mode"):
        raise HTTPException(status_code=400, detail="mode is required")
    timeout = float(body.get("timeout", 30))
    return await _call_grpc_in_threadpool(f"{DRONE}/SetMode", _payload(body), timeout + 5, request)


@router.post("/takeoff")
async def takeoff(request: Request):
    body = await _read_json(request)
    return await _call_grpc_in_threadpool(f"{DRONE}/Takeoff", _payload(body), 30, request)


@router.post("/land")
async def land(request: Request):
    body = await _read_json(request)
    timeout = float(body.get("timeout", 30))
    return await _call_grpc_in_threadpool(f"{DRONE}/Land", _payload(body), timeout + 5, request)


@router.post("/goto")
async def goto(request: Request):
    body = await _read_json(request)
    for field in ("x", "y", "z"):
        if field not in body:
            raise HTTPException(status_code=400, detail=f"{field} is required")
    return await _call_grpc_in_threadpool(f"{DRONE}/Goto", _payload(body), 30, request)
