from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.grpc_backend import call_grpc, normalize_session

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
JOBS = "/soerogis.MappingJobService"


async def _read_json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@router.get("")
def list_jobs(capture_only: bool = False):
    """List mapping sessions (ListJobs). A drone-flown survey is in here from the
    moment its mission is pushed — with its flight state in `capture` — so this
    list doubles as the mapping-mission list; `?capture_only=true` keeps only
    those drone-produced sessions. See docs/mapping.md."""
    # Only send the flag when set so the request stays the `{}` it always was.
    payload = {"capture_only": True} if capture_only else {}
    result = call_grpc(f"{JOBS}/ListJobs", payload, timeout=30)
    if isinstance(result, list):
        sessions = result
    else:
        sessions = result.get("sessions") or result.get("jobs") or []
    return [normalize_session(item) for item in sessions]


@router.post("")
async def create_job(request: Request):
    body = await _read_json(request)
    source_dir = body.get("source_dir")
    if not source_dir:
        raise HTTPException(status_code=400, detail="source_dir is required")
    payload = {
        "source_dir": source_dir,
        "name": body.get("name"),
        "area_name": body.get("area_name"),
        "captured_at": body.get("captured_at"),
        "image_glob": body.get("image_glob"),
        "options": body.get("options") or {},
    }
    return normalize_session(call_grpc(f"{JOBS}/CreateOdmJob", payload, timeout=30))


@router.get("/{session_id}")
def get_job(session_id: str):
    return normalize_session(call_grpc(f"{JOBS}/GetJob", {"session_id": session_id}, timeout=30))


@router.post("/{session_id}/cancel")
async def cancel_job(session_id: str, request: Request):
    """Cancel the ODM stitch (CancelJob). Refused with FAILED_PRECONDITION (409)
    while a capture mission is flying the session (`capture.active`) — cancel the
    mission itself via `POST /api/drone/mapping-mission/cancel` — unless the
    optional JSON body carries `{force: true}`."""
    body = await _read_json(request)
    payload: dict[str, Any] = {"session_id": session_id}
    # Strict bool, not truthiness: `force` is the only thing standing between
    # this call and a session whose capture mission is in flight, and a JSON
    # string like "false" is truthy. Null counts as absent (same convention as
    # the optional keys in drone.py); anything else non-bool is a 400.
    force = body.get("force")
    if force is not None and not isinstance(force, bool):
        raise HTTPException(status_code=400, detail="force must be a boolean")
    if force:
        payload["force"] = True
    # `async def` (needed to read the body) means no automatic threadpool: a
    # blocking unary call here would stall every other request for up to the
    # timeout. `call_grpc` is resolved at call time so tests can monkeypatch it.
    result = await run_in_threadpool(call_grpc, f"{JOBS}/CancelJob", payload, 30)
    return normalize_session(result)


@router.delete("/{session_id}")
def remove_job(session_id: str, force: bool = False):
    """Delete the whole session folder (RemoveJob). Refused with 409 without
    `?force=true` while a mission is flying the session, or when `capture.captured`
    is non-empty — those frames were drained off the camera SD and the folder is
    the only copy, even though `image_count` still reads 0 before a stitch."""
    payload: dict[str, Any] = {"session_id": session_id}
    if force:
        payload["force"] = True
    return call_grpc(f"{JOBS}/RemoveJob", payload, timeout=30)
