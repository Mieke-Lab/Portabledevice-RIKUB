import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import grpc_backend
from app.routes import jobs

SESSION = {
    "id": "map-abc123",
    "job_id": "map-abc123",
    "status": "unstitched",
    "capture": {
        "state": "paused",
        "active": False,
        "points": [{"lat": -7.28, "lng": 112.79}, {"lat": -7.281, "lng": 112.795}],
        "captured": [0],
        "pending": [],
        "altitude": 20.0,
        "hold_time": 2.0,
        "final_action": "rtl",
        "leg": 2,
        "last_error": "",
        "updated_at": "2026-09-12T21:40:11+07:00",
    },
    "artifacts": {
        "raw_dir": "http://192.0.2.10:8000/sessions/map-abc123/raw/",
        "stitched_tif": None,
        "clusters_kml": None,
        "processed_dir": "http://192.0.2.10:8000/sessions/map-abc123/processed/",
    },
}


@pytest.fixture(autouse=True)
def pinned_backend_env(monkeypatch):
    # These are read from the environment at import time; pin them so the URL
    # rewrite in normalize_session is deterministic regardless of the shell.
    monkeypatch.setattr(grpc_backend, "FILE_SERVER_BASE_URL", None)
    monkeypatch.setattr(grpc_backend, "BACKEND_GRPC_ADDR", "192.0.2.10:50051")
    yield


@pytest.fixture
def grpc_calls(monkeypatch):
    """Replace call_grpc on the route module with a recorder returning canned data."""
    calls: list[dict] = []
    state = {"response": {"sessions": [SESSION]}, "error": None}

    def fake(method, payload, timeout=30.0, addr=None):
        calls.append({"method": method, "payload": payload, "timeout": timeout, "addr": addr})
        if state["error"] is not None:
            raise state["error"]
        return state["response"]

    monkeypatch.setattr(jobs, "call_grpc", fake)
    calls_api = {"calls": calls, "state": state}
    return calls_api


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(jobs.router)
    with TestClient(app) as test_client:
        yield test_client


# --- ListJobs / capture_only -------------------------------------------------


def test_list_jobs_sends_empty_payload_by_default(client, grpc_calls):
    response = client.get("/api/jobs")

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == "/soerogis.MappingJobService/ListJobs"
    assert call["payload"] == {}
    assert [item["id"] for item in response.json()] == ["map-abc123"]


def test_list_jobs_forwards_capture_only_when_true(client, grpc_calls):
    client.get("/api/jobs?capture_only=true")

    assert grpc_calls["calls"][0]["payload"] == {"capture_only": True}


def test_list_jobs_omits_capture_only_when_false(client, grpc_calls):
    client.get("/api/jobs?capture_only=false")

    assert grpc_calls["calls"][0]["payload"] == {}


def test_list_jobs_returns_plain_array_and_keeps_capture_block(client, grpc_calls):
    response = client.get("/api/jobs?capture_only=true")

    body = response.json()
    assert isinstance(body, list)
    assert body[0]["capture"] == SESSION["capture"]


# --- CancelJob / force --------------------------------------------------------


def test_cancel_job_without_body_sends_only_session_id(client, grpc_calls):
    grpc_calls["state"]["response"] = {**SESSION, "status": "canceled"}

    response = client.post("/api/jobs/map-abc123/cancel")

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == "/soerogis.MappingJobService/CancelJob"
    assert call["payload"] == {"session_id": "map-abc123"}
    assert response.json()["status"] == "canceled"


def test_cancel_job_with_force_false_omits_force(client, grpc_calls):
    client.post("/api/jobs/map-abc123/cancel", json={"force": False})

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}



@pytest.mark.parametrize("bad", ["false", "true", "0", 1, 0, [0], {}])
def test_cancel_job_rejects_non_boolean_force(client, grpc_calls, bad):
    # `force` is the only guard between this call and a flying mission, and a
    # JSON string like "false" is truthy — so anything but a real bool is a 400
    # and the backend is never called.
    response = client.post("/api/jobs/map-abc123/cancel", json={"force": bad})
    assert response.status_code == 400
    assert grpc_calls["calls"] == []


def test_cancel_job_null_force_counts_as_absent(client, grpc_calls):
    response = client.post("/api/jobs/map-abc123/cancel", json={"force": None})
    assert response.status_code == 200
    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}

def test_cancel_job_with_force_true_forwards_force(client, grpc_calls):
    client.post("/api/jobs/map-abc123/cancel", json={"force": True})

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123", "force": True}


def test_cancel_job_precondition_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(
        status_code=409, detail="capture mission active; cancel the mission first"
    )

    response = client.post("/api/jobs/map-abc123/cancel")

    assert response.status_code == 409
    assert "mission" in response.json()["detail"]


# --- RemoveJob / force --------------------------------------------------------


def test_remove_job_without_force_sends_only_session_id(client, grpc_calls):
    grpc_calls["state"]["response"] = {"session_id": "map-abc123", "removed": True}

    response = client.delete("/api/jobs/map-abc123")

    assert response.status_code == 200
    call = grpc_calls["calls"][0]
    assert call["method"] == "/soerogis.MappingJobService/RemoveJob"
    assert call["payload"] == {"session_id": "map-abc123"}
    assert response.json() == {"session_id": "map-abc123", "removed": True}


def test_remove_job_with_force_query_forwards_force(client, grpc_calls):
    grpc_calls["state"]["response"] = {"session_id": "map-abc123", "removed": True}

    client.delete("/api/jobs/map-abc123?force=true")

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123", "force": True}


def test_remove_job_with_force_false_omits_force(client, grpc_calls):
    grpc_calls["state"]["response"] = {"session_id": "map-abc123", "removed": True}

    client.delete("/api/jobs/map-abc123?force=false")

    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}


def test_remove_job_precondition_surfaces_as_409(client, grpc_calls):
    grpc_calls["state"]["error"] = HTTPException(
        status_code=409, detail="session holds the only copy of 8 captured frames"
    )

    response = client.delete("/api/jobs/map-abc123")

    assert response.status_code == 409
    assert "only copy" in response.json()["detail"]


# --- GetJob passthrough -------------------------------------------------------


def test_get_job_keeps_capture_and_processed_dir(client, grpc_calls):
    grpc_calls["state"]["response"] = SESSION

    response = client.get("/api/jobs/map-abc123")

    assert response.status_code == 200
    assert grpc_calls["calls"][0]["payload"] == {"session_id": "map-abc123"}
    body = response.json()
    assert body["capture"] == SESSION["capture"]
    assert body["artifacts"]["processed_dir"] == SESSION["artifacts"]["processed_dir"]


# --- normalize_session --------------------------------------------------------


def test_normalize_session_keeps_processed_dir_and_capture_block():
    out = grpc_backend.normalize_session(SESSION)

    assert out["capture"] == SESSION["capture"]
    assert out["capture"] is SESSION["capture"]  # passed through, not rebuilt
    assert set(out["artifacts"]) == {"raw_dir", "stitched_tif", "clusters_kml", "processed_dir"}
    assert out["artifacts"]["processed_dir"] == SESSION["artifacts"]["processed_dir"]
    assert out["artifacts"]["stitched_tif"] is None
    assert out["artifacts"]["clusters_kml"] is None


def test_normalize_session_rewrites_nothing_for_non_loopback_host():
    # FILE_SERVER_BASE_URL unset (fixture) and the artifact host is already a
    # LAN address: every URL must come back byte-for-byte unchanged.
    out = grpc_backend.normalize_session(SESSION)

    assert out["artifacts"]["raw_dir"] == SESSION["artifacts"]["raw_dir"]
    assert out["artifacts"]["processed_dir"] == SESSION["artifacts"]["processed_dir"]


def test_normalize_session_rewrites_loopback_to_backend_host():
    job = {
        **SESSION,
        "artifacts": {
            "raw_dir": "http://localhost:8000/sessions/map-abc123/raw/",
            "stitched_tif": "http://127.0.0.1:8000/sessions/map-abc123/stitched.tif",
            "clusters_kml": None,
            "processed_dir": "http://localhost:8000/sessions/map-abc123/processed/",
        },
    }

    out = grpc_backend.normalize_session(job)

    assert out["artifacts"]["raw_dir"] == "http://192.0.2.10:8000/sessions/map-abc123/raw/"
    assert out["artifacts"]["stitched_tif"] == "http://192.0.2.10:8000/sessions/map-abc123/stitched.tif"
    assert out["artifacts"]["clusters_kml"] is None
    assert out["artifacts"]["processed_dir"] == "http://192.0.2.10:8000/sessions/map-abc123/processed/"


def test_normalize_session_honours_file_server_base_url(monkeypatch):
    monkeypatch.setattr(grpc_backend, "FILE_SERVER_BASE_URL", "http://10.0.0.5:9000")

    out = grpc_backend.normalize_session(SESSION)

    assert out["artifacts"]["raw_dir"] == "http://10.0.0.5:9000/sessions/map-abc123/raw/"
    assert out["artifacts"]["processed_dir"] == "http://10.0.0.5:9000/sessions/map-abc123/processed/"


def test_normalize_session_tolerates_missing_processed_dir():
    # Older backends don't send processed_dir; it must read as "not produced"
    # (None), not blow up.
    job = {
        **SESSION,
        "artifacts": {"raw_dir": "http://192.0.2.10:8000/sessions/x/raw/", "stitched_tif": None},
    }

    out = grpc_backend.normalize_session(job)

    assert out["artifacts"]["processed_dir"] is None
    assert out["artifacts"]["clusters_kml"] is None
    assert out["artifacts"]["raw_dir"] == "http://192.0.2.10:8000/sessions/x/raw/"


def test_normalize_session_without_artifacts_returns_job_unchanged():
    job = {"id": "x", "status": "unstitched", "capture": {}, "artifacts": None}

    assert grpc_backend.normalize_session(job) is job
    assert grpc_backend.normalize_session({"id": "y"}) == {"id": "y"}
