"""Spray mission plans kept on the Pi.

The planner pages used to hold the launched plan (zones, path, chamber products, GPS
offset) only in the browser tab's sessionStorage, so closing the app or a Pi reboot
mid-flight left the monitoring page without zones or path. The drone reports only a
zone summary, so the plan itself is stored here: per spray session id (what the
drone's SprayMissionStatus reports) plus the latest one.
"""
import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/mission-plans", tags=["mission-plans"])

ROOT = Path(__file__).resolve().parents[2] / "storage" / "mission-plans"
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
MAX_BYTES = 2_000_000


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


@router.put("")
async def save_plan(request: Request):
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Rencana misi terlalu besar")
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Rencana misi bukan JSON") from None
    if not isinstance(plan, dict):
        raise HTTPException(400, "Rencana misi harus berupa objek")
    data = json.dumps(plan).encode()
    _write(ROOT / "latest.json", data)
    session_id = plan.get("sessionId")
    if isinstance(session_id, str) and ID_RE.match(session_id):
        _write(ROOT / "sessions" / f"{session_id}.json", data)
    return {"saved": True, "sessionId": session_id if isinstance(session_id, str) else None}


@router.get("/latest")
def latest_plan():
    path = ROOT / "latest.json"
    if not path.is_file():
        raise HTTPException(404, "Belum ada rencana misi")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "no-store"})


@router.get("/{session_id}")
def session_plan(session_id: str):
    if not ID_RE.match(session_id):
        raise HTTPException(400, "ID sesi tidak valid")
    path = ROOT / "sessions" / f"{session_id}.json"
    if not path.is_file():
        raise HTTPException(404, "Rencana misi sesi ini tidak ada")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "no-store"})
