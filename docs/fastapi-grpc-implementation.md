# Implementasi gRPC di FastAPI Server

Dokumen ini menjelaskan struktur implementasi gRPC untuk menghubungkan `web/`
Vite ke backend Soerogis gRPC di `192.0.2.10:50051`.

## Arsitektur

```text
web/ Vite
  -> fetch("/api/...")
  -> server/ FastAPI
  -> JSON-over-gRPC
  -> 192.0.2.10:50051
```

Browser tidak memanggil gRPC langsung. FastAPI menjadi BFF/proxy agar frontend
tetap cukup pakai HTTP biasa.

## Struktur Folder

Tambahkan file berikut:

```text
server/
  app/
    grpc_backend.py
    routes/
      drone.py
      jobs.py
```

Update file berikut:

```text
server/
  app/
    main.py
  requirements.txt
```

## Dependency

Tambahkan ke `server/requirements.txt`:

```text
grpcio
```

Tidak perlu `grpcio-tools`, karena backend Soerogis memakai JSON-over-gRPC dan
tidak memakai `.proto` di frontend lama.

## Environment

Server memakai env:

```env
BACKEND_GRPC_ADDR=192.0.2.10:50051
FILE_SERVER_BASE_URL=
METERS_PER_PIXEL=0.05
```

Default:

```text
BACKEND_GRPC_ADDR=192.0.2.10:50051
METERS_PER_PIXEL=0.05
```

## `server/app/grpc_backend.py`

File ini berisi semua logic gRPC agar route tetap tipis.

Isi minimal:

```python
import json
import os
import re
from urllib.parse import urlparse, urlunparse

import grpc
from fastapi import HTTPException, Request

BACKEND_GRPC_ADDR = os.getenv("BACKEND_GRPC_ADDR")
FILE_SERVER_BASE_URL = os.getenv("FILE_SERVER_BASE_URL")
DEFAULT_GRPC_PORT = "50051"

_channels = {}


def sanitize_grpc_addr(raw):
    if not raw:
        return None
    value = re.sub(r"^[a-z][a-z0-9+.-]*://", "", raw.strip(), flags=re.I)
    value = re.sub(r"/.*$", "", value)
    value = re.sub(r"\s+", "", value)
    if not value:
        return None
    host, _, port = value.rpartition(":")
    if not host:
        host, port = value, DEFAULT_GRPC_PORT
    if not re.match(r"^[a-zA-Z0-9._-]+$", host):
        return None
    return f"{host}:{port or DEFAULT_GRPC_PORT}"


def drone_addr_from_request(request: Request):
    return sanitize_grpc_addr(request.headers.get("x-drone-addr")) or BACKEND_GRPC_ADDR


def _channel(addr):
    if addr not in _channels:
        _channels[addr] = grpc.insecure_channel(addr)
    return _channels[addr]


def call_grpc(method, payload=None, timeout=30, addr=None):
    fn = _channel(addr or BACKEND_GRPC_ADDR).unary_unary(
        method,
        request_serializer=lambda d: json.dumps(d or {}).encode("utf-8"),
        response_deserializer=lambda b: json.loads(b.decode("utf-8") or "{}"),
    )
    try:
        return fn(payload or {}, timeout=timeout)
    except grpc.RpcError as exc:
        raise HTTPException(status_code=grpc_to_http_status(exc), detail=exc.details()) from exc


def grpc_to_http_status(exc):
    code = exc.code()
    return {
        grpc.StatusCode.INVALID_ARGUMENT: 400,
        grpc.StatusCode.NOT_FOUND: 404,
        grpc.StatusCode.FAILED_PRECONDITION: 409,
        grpc.StatusCode.DEADLINE_EXCEEDED: 504,
        grpc.StatusCode.UNAVAILABLE: 503,
    }.get(code, 500)
```

Tambahkan self-check kecil di bawah file:

```python
def _demo():
    assert sanitize_grpc_addr("http://192.0.2.10:50051/x") == "192.0.2.10:50051"
    assert sanitize_grpc_addr("192.0.2.10") == "192.0.2.10:50051"
    assert sanitize_grpc_addr("") is None


if __name__ == "__main__":
    _demo()
```

## `server/app/routes/drone.py`

Route drone memakai prefix:

```python
from fastapi import APIRouter, Request

from app.grpc_backend import BACKEND_GRPC_ADDR, call_grpc, drone_addr_from_request

router = APIRouter(prefix="/api/drone", tags=["drone"])

DRONE = "/soerogis.DroneService"
```

Endpoint yang dibuat:

```text
GET  /api/drone/config
GET  /api/drone/diagnostics
GET  /api/drone/status
POST /api/drone/arm
POST /api/drone/disarm
POST /api/drone/setmode
POST /api/drone/takeoff
POST /api/drone/land
POST /api/drone/goto
POST /api/drone/mission
POST /api/drone/mission/execute
POST /api/drone/mapping-mission
GET  /api/drone/mapping-mission
POST /api/drone/mapping-mission/pause
POST /api/drone/mapping-mission/resume
POST /api/drone/mapping-mission/cancel
```

Mapping ke gRPC:

| FastAPI | gRPC |
| --- | --- |
| `GET /diagnostics` | `/soerogis.DroneService/Diagnostics` |
| `GET /status` | `/soerogis.DroneService/MissionStatus` |
| `POST /arm` | `/soerogis.DroneService/Arm` |
| `POST /disarm` | `/soerogis.DroneService/Disarm` |
| `POST /setmode` | `/soerogis.DroneService/SetMode` |
| `POST /takeoff` | `/soerogis.DroneService/Takeoff` |
| `POST /land` | `/soerogis.DroneService/Land` |
| `POST /goto` | `/soerogis.DroneService/Goto` |
| `POST /mission` | `/soerogis.DroneService/PushMission` |
| `POST /mission/execute` | `/soerogis.DroneService/ExecuteMission` |
| `POST /mapping-mission` | `/soerogis.DroneService/PushCaptureMission` |
| `GET /mapping-mission` | `/soerogis.DroneService/MappingMissionStatus` |
| `POST /mapping-mission/pause` | `/soerogis.DroneService/PauseMappingMission` |
| `POST /mapping-mission/resume` | `/soerogis.DroneService/ResumeMappingMission` |
| `POST /mapping-mission/cancel` | `/soerogis.DroneService/CancelMappingMission` |

Route `mapping-mission/*` mengelola misi pemetaan per-leg (push → pause → resume,
atau cancel). Body `resume` wajib `session_id`; `altitude`/`hold_time` opsional dan
hanya diteruskan kalau ada. Kontrak lengkap (termasuk blok `capture` di sesi) ada
di `docs/drone_api.md` bagian "Mapping capture mission" dan `docs/mapping.md`.

Contoh route:

```python
@router.get("/config")
def config():
    return {"default_addr": BACKEND_GRPC_ADDR, "defaultDroneAddr": BACKEND_GRPC_ADDR}


@router.get("/diagnostics")
def diagnostics(request: Request):
    return call_grpc(f"{DRONE}/Diagnostics", {}, timeout=15, addr=drone_addr_from_request(request))


@router.get("/status")
def status(request: Request):
    return call_grpc(f"{DRONE}/MissionStatus", {}, timeout=30, addr=drone_addr_from_request(request))
```

Untuk command POST, body diteruskan ke gRPC:

```python
@router.post("/arm")
async def arm(request: Request):
    body = await request.json()
    timeout = round(float(body.get("timeout", 30))) + 5
    return call_grpc(f"{DRONE}/Arm", body, timeout=timeout, addr=drone_addr_from_request(request))
```

### Mission Waypoints

`POST /api/drone/mission` perlu normalisasi waypoint.

Input frontend georeferenced:

```json
{
  "geo_waypoints": [{ "lng": 112.1, "lat": -7.1 }],
  "altitude": 15
}
```

Payload ke gRPC:

```json
{
  "waypoints": [[-7.1, 112.1]],
  "altitude": 15
}
```

Aturan:

- `geo_waypoints` menjadi `[lat, lng]`,
- fallback `waypoints` pixel dikali `METERS_PER_PIXEL`,
- kalau kosong, return `400`.

## `server/app/routes/jobs.py`

Route mapping jobs memakai prefix:

```python
router = APIRouter(prefix="/api/jobs", tags=["jobs"])

JOBS = "/soerogis.MappingJobService"
```

Endpoint:

```text
GET    /api/jobs
POST   /api/jobs
GET    /api/jobs/{id}
POST   /api/jobs/{id}/cancel
DELETE /api/jobs/{id}
```

Mapping ke gRPC:

| FastAPI | gRPC |
| --- | --- |
| `GET /api/jobs` | `/soerogis.MappingJobService/ListJobs` | response is a plain array for `fetchJobs()`; `?capture_only=true` diteruskan sebagai `{capture_only: true}` (hanya kalau true) |
| `POST /api/jobs` | `/soerogis.MappingJobService/CreateOdmJob` |
| `GET /api/jobs/{id}` | `/soerogis.MappingJobService/GetJob` |
| `POST /api/jobs/{id}/cancel` | `/soerogis.MappingJobService/CancelJob` | body JSON opsional `{force: true}` |
| `DELETE /api/jobs/{id}` | `/soerogis.MappingJobService/RemoveJob` | `?force=true` diteruskan sebagai `{force: true}` |

Sesi hasil misi drone sudah ada di `ListJobs` sejak misi di-push; status
terbangnya ada di blok `capture` yang diteruskan apa adanya oleh
`normalize_session` (hanya `artifacts` yang ditulis ulang, termasuk
`processed_dir`). `CancelJob`/`RemoveJob` ditolak backend dengan
`FAILED_PRECONDITION` → HTTP `409` saat `capture.active` (atau, untuk `RemoveJob`,
saat `capture.captured` tidak kosong) kecuali `force`. Lihat `docs/mapping.md`.

Contoh:

```python
@router.get("")
def list_jobs():
    result = call_grpc(f"{JOBS}/ListJobs", {})
    return [normalize_session(item) for item in result.get("sessions") or result.get("jobs") or []]


@router.get("/{session_id}")
def get_job(session_id: str):
    return call_grpc(f"{JOBS}/GetJob", {"session_id": session_id})
```

`POST /api/jobs` wajib punya `source_dir`.

## Register Router

Update `server/app/main.py`:

```python
from app.routes.drone import router as drone_router
from app.routes.jobs import router as jobs_router

app.include_router(drone_router)
app.include_router(jobs_router)
```

Router existing seperti `health`, `fields`, `imagery`, dan `polygon` tetap ada.

## Vite Frontend

`web/vite.config.ts` sudah benar:

```ts
server: {
  proxy: {
    "/api": { target: "http://localhost:8000", changeOrigin: true },
  },
}
```

`web/src/lib/gcs/api.js` tidak perlu diubah besar. File itu sudah memanggil
endpoint `/api/drone/*` dan `/api/jobs/*`.

## Telemetry

Untuk tahap ini:

```text
GET /api/drone/diagnostics = polling telemetry snapshot
```

Tidak pakai SSE/WebSocket dulu.

Kalau nanti mau streaming:

```text
GET /api/drone/diagnostics/stream
```

boleh ditambah sebagai SSE yang melakukan loop call ke gRPC `Diagnostics`.

## Urutan Implementasi

1. Tambah `grpcio`.
2. Buat `grpc_backend.py`.
3. Buat `routes/drone.py`.
4. Register `drone_router`.
5. Test:
   ```bash
   curl http://localhost:8000/api/drone/config
   curl http://localhost:8000/api/drone/diagnostics
   curl http://localhost:8000/api/drone/status
   ```
6. Buat `routes/jobs.py`.
7. Register `jobs_router`.
8. Test:
   ```bash
   curl http://localhost:8000/api/jobs
   ```
9. Jalankan Vite dan cek dashboard.

## Batasan Tahap Ini

- Tidak membuat gRPC streaming native.
- Tidak membuat `.proto`.
- Tidak membuat schema Pydantic lengkap.
- Tidak retry otomatis untuk command drone.
- Tidak mengubah besar frontend Vite.

