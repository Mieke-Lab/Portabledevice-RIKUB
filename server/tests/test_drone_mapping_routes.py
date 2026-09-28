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
