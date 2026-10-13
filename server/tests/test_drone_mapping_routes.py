import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import grpc_backend
from app.routes import drone

STATUS = {
    "available": True,
    "mission_running": False,
    "last_command": "pause_mapping_mission",
    "last_error": "",
    "armed": True,
    "mode": "RTL",
}

DRONE = "/soerogis.DroneService"


@pytest.fixture(autouse=True)
def pinned_backend_addr(monkeypatch):
    # drone_addr_from_request falls back to this; pin it so `addr` is asserted
    # against a known value rather than whatever the shell exported.
    monkeypatch.setattr(grpc_backend, "BACKEND_GRPC_ADDR", "192.0.2.10:50051")
    yield


@pytest.fixture
def grpc_calls(monkeypatch):
    """Replace call_grpc on the route module with a recorder returning canned data."""
    calls: list[dict] = []
    state = {"response": STATUS, "error": None}

    def fake(method, payload, timeout=30.0, addr=None):
        calls.append({"method": method, "payload": payload, "timeout": timeout, "addr": addr})
        if state["error"] is not None:
            raise state["error"]
        return state["response"]

    monkeypatch.setattr(drone, "call_grpc", fake)
    return {"calls": calls, "state": state}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(drone.router)
    with TestClient(app) as test_client:
        yield test_client


# --- PauseMappingMission ------------------------------------------------------


def test_pause_sends_empty_payload_and_returns_status(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/pause")

    assert response.status_code == 200
    assert response.json() == STATUS
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/PauseMappingMission"
    assert call["payload"] == {}
    assert call["timeout"] == 30
    assert call["addr"] == "192.0.2.10:50051"


def test_pause_ignores_any_body(client, grpc_calls):
    client.post("/api/drone/mapping-mission/pause", json={"session_id": "map-abc123"})

    assert grpc_calls["calls"][0]["payload"] == {}


def test_pause_honours_x_drone_addr_header(client, grpc_calls):
    client.post("/api/drone/mapping-mission/pause", headers={"X-Drone-Addr": "10.0.0.7"})

    assert grpc_calls["calls"][0]["addr"] == "10.0.0.7:50051"


def test_pause_precondition_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(status_code=409, detail="no mapping mission active")

    response = client.post("/api/drone/mapping-mission/pause")

    assert response.status_code == 409
    assert response.json() == {"detail": "no mapping mission active"}


# --- ResumeMappingMission -----------------------------------------------------


def test_resume_requires_session_id(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/resume", json={})

    assert response.status_code == 400
    assert "session_id" in response.json()["detail"]
    assert grpc_calls["calls"] == []


def test_resume_requires_session_id_even_without_body(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/resume")

    assert response.status_code == 400
    assert grpc_calls["calls"] == []


def test_resume_rejects_non_string_session_id(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/resume", json={"session_id": 42})

    assert response.status_code == 400
    assert grpc_calls["calls"] == []


def test_resume_forwards_session_id_only_when_no_overrides(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/resume", json={"session_id": "map-abc123"})

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/ResumeMappingMission"
    assert call["payload"] == {"session_id": "map-abc123"}
    # Uploads a plan like PushCaptureMission, so it gets the same generous bound.
    assert call["timeout"] == 70
    assert call["addr"] == "192.0.2.10:50051"


def test_resume_accepts_job_id_alias(client, grpc_calls):
    client.post("/api/drone/mapping-mission/resume", json={"job_id": "map-abc123"})

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}


def test_resume_forwards_optional_altitude_and_hold_time(client, grpc_calls):
    client.post(
        "/api/drone/mapping-mission/resume",
        json={"session_id": "map-abc123", "altitude": 25, "hold_time": 1.5},
    )

    assert grpc_calls["calls"][0]["payload"] == {
        "session_id": "map-abc123",
        "altitude": 25,
        "hold_time": 1.5,
    }


def test_resume_drops_null_overrides(client, grpc_calls):
    client.post(
        "/api/drone/mapping-mission/resume",
        json={"session_id": "map-abc123", "altitude": None, "hold_time": None},
    )

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}


def test_resume_allows_zero_hold_time_but_not_zero_altitude(client, grpc_calls):
    ok = client.post(
        "/api/drone/mapping-mission/resume", json={"session_id": "map-abc123", "hold_time": 0}
    )
    assert ok.status_code == 200
    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123", "hold_time": 0}

    bad = client.post(
        "/api/drone/mapping-mission/resume", json={"session_id": "map-abc123", "altitude": 0}
    )
    assert bad.status_code == 400
    assert "altitude" in bad.json()["detail"]
    assert len(grpc_calls["calls"]) == 1


@pytest.mark.parametrize(
    "altitude",
    [True, "abc", -5, [20], {"m": 20}],
    ids=["bool", "string", "negative", "list", "dict"],
)
def test_resume_rejects_bad_altitude(client, grpc_calls, altitude):
    response = client.post(
        "/api/drone/mapping-mission/resume",
        json={"session_id": "map-abc123", "altitude": altitude},
    )

    assert response.status_code == 400
    assert "altitude" in response.json()["detail"]
    assert grpc_calls["calls"] == []


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_resume_rejects_non_finite_altitude(client, grpc_calls, literal):
    # Python's json.loads accepts these non-standard literals, so a client can
    # smuggle them past the parser; the route must still refuse them.
    response = client.post(
        "/api/drone/mapping-mission/resume",
        content=f'{{"session_id": "map-abc123", "altitude": {literal}}}',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 400
    assert "altitude" in response.json()["detail"]
    assert grpc_calls["calls"] == []


@pytest.mark.parametrize("hold_time", [True, "abc", -1], ids=["bool", "string", "negative"])
def test_resume_rejects_bad_hold_time(client, grpc_calls, hold_time):
    response = client.post(
        "/api/drone/mapping-mission/resume",
        json={"session_id": "map-abc123", "hold_time": hold_time},
    )

    assert response.status_code == 400
    assert "hold_time" in response.json()["detail"]
    assert grpc_calls["calls"] == []


def test_resume_precondition_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(
        status_code=409, detail="session map-abc123 is not resumable (state=done)"
    )

    response = client.post("/api/drone/mapping-mission/resume", json={"session_id": "map-abc123"})

    assert response.status_code == 409
    assert "not resumable" in response.json()["detail"]


def test_resume_not_found_surfaces_as_404(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(status_code=404, detail="no such session")

    response = client.post("/api/drone/mapping-mission/resume", json={"session_id": "nope"})

    assert response.status_code == 404


# --- CancelMappingMission -----------------------------------------------------


def test_cancel_without_session_id_sends_empty_payload(client, grpc_calls):
    response = client.post("/api/drone/mapping-mission/cancel", json={})

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/CancelMappingMission"
    assert call["payload"] == {}
    assert call["timeout"] == 15
    assert call["addr"] == "192.0.2.10:50051"


def test_cancel_without_body_sends_empty_payload(client, grpc_calls):
    client.post("/api/drone/mapping-mission/cancel")

    assert grpc_calls["calls"][0]["payload"] == {}


def test_cancel_forwards_session_id_when_given(client, grpc_calls):
    client.post("/api/drone/mapping-mission/cancel", json={"session_id": "map-abc123"})

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}


def test_cancel_drops_empty_session_id(client, grpc_calls):
    client.post("/api/drone/mapping-mission/cancel", json={"session_id": ""})

    assert grpc_calls["calls"][0]["payload"] == {}


def test_cancel_precondition_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(status_code=409, detail="controller unavailable")

    response = client.post("/api/drone/mapping-mission/cancel")

    assert response.status_code == 409
    assert response.json() == {"detail": "controller unavailable"}


# --- Existing mapping routes still wired the same ----------------------------


def test_status_poll_sends_empty_payload(client, grpc_calls):
    grpc_calls["state"]["response"] = {
        "running": True,
        "session_id": "map-abc123",
        "phase": "flying",
        "captures_done": 3,
        "total_captures": 20,
        "odm_job_id": "map-abc123",
        "last_error": "",
    }

    response = client.get("/api/drone/mapping-mission")

    assert response.status_code == 200
    assert response.json()["odm_job_id"] == "map-abc123"
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/MappingMissionStatus"
    assert call["payload"] == {}


def test_push_capture_mission_forwards_points_and_session_id(client, grpc_calls):
    response = client.post(
        "/api/drone/mapping-mission",
        json={
            "session_id": "map-abc123",
            "altitude": 20,
            "hold_time": None,
            "capture_points": [{"lat": -7.28, "lng": 112.79}, {"lat": "x", "lng": 1}],
        },
    )

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/PushCaptureMission"
    assert call["payload"] == {
        "capture_points": [{"lat": -7.28, "lng": 112.79}],
        "altitude": 20,
        "session_id": "map-abc123",
    }
    assert call["timeout"] == 70


# --- CameraPreflight / TriggerCamera ------------------------------------------

PREFLIGHT = {
    "ok": True,
    "mode": "wifi",
    "method": "wifi:wlo1",
    "via": "wifi",
    "verified": True,
    "wire_only": False,
    "degraded": False,
    "paths": [{"name": "wifi:wlo1", "kind": "wifi", "state": "ready", "usable": True}],
    "cached": False,
    "armed": False,
}


def test_camera_preflight_defaults_send_empty_payload(client, grpc_calls):
    grpc_calls["state"]["response"] = PREFLIGHT

    response = client.post("/api/drone/camera/preflight")

    assert response.status_code == 200
    assert response.json() == PREFLIGHT
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/CameraPreflight"
    assert call["payload"] == {}  # the backend's own defaults: full + heal
    assert call["timeout"] == 70
    assert call["addr"] == "192.0.2.10:50051"


def test_camera_preflight_forwards_options(client, grpc_calls):
    client.post("/api/drone/camera/preflight", json={"expected_shots": 42, "full": False, "heal": False})

    assert grpc_calls["calls"][0]["payload"] == {"expected_shots": 42, "full": False, "heal": False}


def test_camera_preflight_allows_zero_and_ignores_unknown_fields(client, grpc_calls):
    client.post("/api/drone/camera/preflight", json={"expected_shots": 0, "capture_points": [1], "x": 1})

    assert grpc_calls["calls"][0]["payload"] == {"expected_shots": 0}


def test_camera_preflight_drops_null_options(client, grpc_calls):
    client.post("/api/drone/camera/preflight", json={"expected_shots": None, "full": None, "heal": None})

    assert grpc_calls["calls"][0]["payload"] == {}


@pytest.mark.parametrize("expected", [-1, 1.5, "3", True, [], {}])
def test_camera_preflight_rejects_bad_expected_shots(client, grpc_calls, expected):
    response = client.post("/api/drone/camera/preflight", json={"expected_shots": expected})

    assert response.status_code == 400
    assert "expected_shots" in response.json()["detail"]
    assert grpc_calls["calls"] == []


@pytest.mark.parametrize("key", ["full", "heal"])
@pytest.mark.parametrize("value", ["false", 0, 1, []])
def test_camera_preflight_rejects_non_boolean_flags(client, grpc_calls, key, value):
    # backend does bool(value): the string "false" would read as True
    response = client.post("/api/drone/camera/preflight", json={key: value})

    assert response.status_code == 400
    assert key in response.json()["detail"]
    assert grpc_calls["calls"] == []


def test_camera_preflight_honours_x_drone_addr_header(client, grpc_calls):
    client.post("/api/drone/camera/preflight", headers={"x-drone-addr": "10.0.0.7"})

    assert grpc_calls["calls"][0]["addr"] == "10.0.0.7:50051"


def test_camera_preflight_backend_down_surfaces_as_503(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(status_code=503, detail="drone backend unreachable")

    response = client.post("/api/drone/camera/preflight")

    assert response.status_code == 503
    assert response.json() == {"detail": "drone backend unreachable"}


def test_trigger_camera_defaults_to_auto(client, grpc_calls):
    grpc_calls["state"]["response"] = {"ok": True, "via": "wifi", "verified": True}

    response = client.post("/api/drone/camera/trigger")

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == f"{DRONE}/TriggerCamera"
    assert call["payload"] == {"method": "auto"}
    assert call["timeout"] == 75


def test_trigger_camera_null_method_means_auto(client, grpc_calls):
    client.post("/api/drone/camera/trigger", json={"method": None})

    assert grpc_calls["calls"][0]["payload"] == {"method": "auto"}


@pytest.mark.parametrize("method", ["wire", "esp_wifi", "wifi:wlo1", "wlx60e3270db1e6", "auto"])
def test_trigger_camera_forwards_named_method(client, grpc_calls, method):
    client.post("/api/drone/camera/trigger", json={"method": f"  {method} "})

    assert grpc_calls["calls"][0]["payload"] == {"method": method}


def test_trigger_camera_forwards_fallback(client, grpc_calls):
    client.post("/api/drone/camera/trigger", json={"method": "wire", "fallback": True})

    assert grpc_calls["calls"][0]["payload"] == {"method": "wire", "fallback": True}


@pytest.mark.parametrize("method", ["", "   ", "wire; rm -rf /", "a b", "x" * 65, 5, True, ["wire"], {"m": 1}])
def test_trigger_camera_rejects_bad_method(client, grpc_calls, method):
    response = client.post("/api/drone/camera/trigger", json={"method": method})

    assert response.status_code == 400
    assert "method" in response.json()["detail"]
    assert grpc_calls["calls"] == []


def test_trigger_camera_rejects_non_boolean_fallback(client, grpc_calls):
    response = client.post("/api/drone/camera/trigger", json={"method": "wire", "fallback": "yes"})

    assert response.status_code == 400
    assert grpc_calls["calls"] == []


def test_trigger_camera_refused_while_armed_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(
        status_code=409, detail="TriggerCamera refused: the vehicle is ARMED (camera USB ops are ground-only)"
    )

    response = client.post("/api/drone/camera/trigger", json={"method": "wire"})

    assert response.status_code == 409
    assert "ARMED" in response.json()["detail"]


def test_trigger_camera_unknown_method_from_backend_surfaces_as_400(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(status_code=400, detail="unknown camera method 'nope'")

    response = client.post("/api/drone/camera/trigger", json={"method": "nope"})

    assert response.status_code == 400
