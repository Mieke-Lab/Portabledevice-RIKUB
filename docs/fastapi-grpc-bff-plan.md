# Rencana FastAPI BFF untuk gRPC Soerogis

Tujuan: `web/` Vite tetap memakai `fetch("/api/...")`, sedangkan `server/`
FastAPI meneruskan request itu ke backend gRPC JSON-over-gRPC di
`192.0.2.10:50051`.

## Keputusan Utama

Jangan panggil gRPC langsung dari browser.

Alur final:

```text
Vite frontend
  -> HTTP /api/... ke FastAPI
  -> gRPC JSON-over-gRPC ke 192.0.2.10:50051
  -> Soerogis backend
```

Alasannya:

- browser tidak cocok untuk gRPC native,
- frontend Vite sudah punya wrapper `/api/...` di `web/src/lib/gcs/api.js`,
- `web/vite.config.ts` sudah mem-proxy `/api` ke `http://localhost:8000`,
- pola ini sama dengan frontend Next lama: browser -> BFF route -> gRPC.

## Kondisi Repo Sekarang

Yang sudah ada:

```text
server/
  app/main.py
  app/routes/health.py
  app/routes/fields.py
  requirements.txt

web/
  vite.config.ts
  src/lib/gcs/api.js
  src/lib/gcs/drone-settings.js
```

`web/src/lib/gcs/api.js` sudah memanggil endpoint ini:

```text
GET    /api/drone/diagnostics
GET    /api/drone/config
GET    /api/drone/status
POST   /api/drone/arm
POST   /api/drone/disarm
POST   /api/drone/setmode
POST   /api/drone/takeoff
POST   /api/drone/land
POST   /api/drone/goto
POST   /api/drone/mission
POST   /api/drone/mission/execute

GET    /api/jobs
POST   /api/jobs
GET    /api/jobs/{id}
POST   /api/jobs/{id}/cancel
DELETE /api/jobs/{id}
```

Jadi implementasi server cukup membuat endpoint yang kompatibel dengan daftar
di atas.

## Environment

Tambahkan env server:

```env
BACKEND_GRPC_ADDR=192.0.2.10:50051
FILE_SERVER_BASE_URL=
METERS_PER_PIXEL=0.05
```

Default kalau env kosong:

```text
BACKEND_GRPC_ADDR=192.0.2.10:50051
METERS_PER_PIXEL=0.05
```

`x-drone-addr` dari frontend tetap didukung untuk endpoint drone. Kalau header
ada dan valid, FastAPI memakai alamat itu. Kalau tidak ada, pakai
`BACKEND_GRPC_ADDR`.

Mapping job tidak perlu `x-drone-addr`; cukup pakai `BACKEND_GRPC_ADDR`.

## Dependency Server

Tambahkan satu dependency ke `server/requirements.txt`:

```text
grpcio
```

Tidak perlu `grpcio-tools` karena backend tidak memakai `.proto`.

## File Baru

Rencana file minimal:

```text
server/app/grpc_backend.py
server/app/routes/drone.py
server/app/routes/jobs.py
```

Update file existing:

```text
server/app/main.py
server/requirements.txt
```

## Helper gRPC

`server/app/grpc_backend.py` berisi helper kecil:

```python
call_grpc(method: str, payload: dict, timeout: float, addr: str | None = None) -> dict
```

Tanggung jawabnya:

- membuat/reuse `grpc.insecure_channel(addr)`,
- memanggil method full path seperti `/soerogis.DroneService/Diagnostics`,
- serializer: `json.dumps(payload or {}).encode()`,
- deserializer: `json.loads(bytes.decode() or "{}")`,
- mapping error gRPC ke `HTTPException`.

Mapping status:

| gRPC | HTTP |
| --- | --- |
| `INVALID_ARGUMENT` | `400` |
| `NOT_FOUND` | `404` |
| `FAILED_PRECONDITION` | `409` |
| `DEADLINE_EXCEEDED` | `504` |
| `UNAVAILABLE` | `503` |
| lainnya | `500` |

Cache channel cukup pakai dictionary per address:

```text
channels: dict[str, grpc.Channel]
```

Tidak perlu class client dulu.

## Sanitasi Alamat Drone

FastAPI perlu fungsi:

```python
sanitize_grpc_addr(raw: str | None) -> str | None
drone_addr_from_request(request: Request) -> str
```

Aturan:

- boleh input `192.0.2.10:50051`,
- boleh input `http://192.0.2.10:50051`,
- hapus scheme dan path,
- kalau port kosong, default `50051`,
- kalau invalid, fallback ke `BACKEND_GRPC_ADDR`.

Untuk sekarang cukup support hostname dan IPv4. IPv6 tidak perlu sampai ada
kebutuhan nyata.

## Route Drone

File: `server/app/routes/drone.py`

Prefix:

```python
router = APIRouter(prefix="/api/drone")
```

Endpoint:

| FastAPI route | gRPC method | Timeout |
| --- | --- | --- |
| `GET /diagnostics` | `/soerogis.DroneService/Diagnostics` | 15s |
| `GET /status` | `/soerogis.DroneService/MissionStatus` | 30s |
| `GET /config` | tidak ke gRPC, return config | - |
| `POST /mission` | `/soerogis.DroneService/PushMission` | 70s |
| `POST /mission/execute` | `/soerogis.DroneService/ExecuteMission` | 30s |
| `POST /arm` | `/soerogis.DroneService/Arm` | `timeout + 5s` |
| `POST /disarm` | `/soerogis.DroneService/Disarm` | `timeout + 5s` |
| `POST /setmode` | `/soerogis.DroneService/SetMode` | `timeout + 5s` |
| `POST /takeoff` | `/soerogis.DroneService/Takeoff` | 30s |
| `POST /land` | `/soerogis.DroneService/Land` | `timeout + 5s` |
| `POST /goto` | `/soerogis.DroneService/Goto` | 30s |

`GET /config` response:

```json
{
  "defaultDroneAddr": "192.0.2.10:50051"
}
```

Body diteruskan apa adanya, kecuali `POST /mission`.

### `POST /api/drone/mission`

Frontend mengirim salah satu:

```json
{
  "geo_waypoints": [{ "lng": 112.1, "lat": -7.1 }],
  "altitude": 15,
  "speed": 5,
  "hold_time": 0,
  "acceptance_radius": 1
}
```

atau:

```json
{
  "waypoints": [{ "x": 10, "y": 20 }]
}
```

Backend gRPC butuh:

```json
{
  "waypoints": [[-7.1, 112.1]]
}
```

Aturan:

- kalau ada `geo_waypoints`, ubah menjadi `[lat, lng]`,
- kalau hanya ada pixel `waypoints`, pakai konversi existing sederhana:
  `[x * METERS_PER_PIXEL, y * METERS_PER_PIXEL]`,
- kalau dua-duanya kosong, return `400`.

Catatan: pixel waypoint ini fallback untuk planner lama. Untuk flight nyata,
pakai `geo_waypoints`.

## Route Mapping Jobs

File: `server/app/routes/jobs.py`

Prefix:

```python
router = APIRouter(prefix="/api/jobs")
```

Endpoint:

| FastAPI route | gRPC method |
| --- | --- |
| `GET /` | `/soerogis.MappingJobService/ListJobs` |
| `POST /` | `/soerogis.MappingJobService/CreateOdmJob` |
| `GET /{id}` | `/soerogis.MappingJobService/GetJob` |
| `POST /{id}/cancel` | `/soerogis.MappingJobService/CancelJob` |
| `DELETE /{id}` | `/soerogis.MappingJobService/RemoveJob` |

Shape response untuk `GET /api/jobs` harus kompatibel dengan FE sekarang.

Paling aman return hasil mentah dari gRPC. Kalau backend return
`{ "sessions": [...] }`, normalisasi jadi:

```json
{
  "jobs": [...]
}
```

Alasannya `web/src/lib/gcs/api.js` saat ini langsung return response, bukan
`.jobs`, jadi UI harus dicek. Kalau page mengharapkan array, wrapper FE perlu
disamakan. Ini dicek saat implementasi.

Request:

```text
POST /api/jobs
```

Validasi minimal:

- `source_dir` wajib,
- field lain diteruskan:
  `name`, `area_name`, `captured_at`, `image_glob`, `options`.

Untuk route by id:

```json
{ "session_id": "<id>" }
```

## Artifact URL

Mapping session bisa berisi:

```json
"artifacts": {
  "raw_dir": "http://localhost:8000/...",
  "stitched_tif": "http://localhost:8000/...",
  "clusters_kml": "http://localhost:8000/..."
}
```

Kalau browser remote tidak bisa akses `localhost`, FastAPI perlu rewrite URL:

1. kalau `FILE_SERVER_BASE_URL` di-set, pakai origin itu,
2. kalau artifact host `localhost/127.0.0.1` dan backend host bukan loopback,
   ganti host ke host dari `BACKEND_GRPC_ADDR`,
3. path/query tetap.

Implementasi cukup fungsi kecil:

```python
normalize_session(job: dict) -> dict
```

Dipakai untuk response job/session saja.

## Update `server/app/main.py`

Tambahkan router:

```python
from app.routes.drone import router as drone_router
from app.routes.jobs import router as jobs_router

app.include_router(drone_router)
app.include_router(jobs_router)
```

Tidak perlu ubah routing existing `/fields` dan `/imagery`.

## Update Vite

`web/vite.config.ts` sudah cukup:

```ts
server: {
  proxy: {
    "/api": { target: "http://localhost:8000", changeOrigin: true },
  },
}
```

Tidak perlu ubah kecuali FastAPI port diganti.

## Urutan Implementasi

1. Tambah `grpcio`.
2. Buat `server/app/grpc_backend.py`.
3. Buat `server/app/routes/drone.py`.
4. Register drone router di `server/app/main.py`.
5. Test endpoint read-only:
   - `GET /api/drone/config`
   - `GET /api/drone/diagnostics`
   - `GET /api/drone/status`
6. Buat `server/app/routes/jobs.py`.
7. Register jobs router.
8. Test mapping:
   - `GET /api/jobs`
   - `GET /api/jobs/{id}` kalau ada id.
9. Test dari Vite:
   - halaman dashboard telemetry,
   - halaman mapping list,
   - tombol manual drone tanpa execute dulu.
10. Baru test command berisiko:
   - arm,
   - takeoff,
   - goto,
   - land,
   - execute mission.

## Smoke Test Manual

Jalankan FastAPI:

```bash
cd server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Test config:

```bash
curl http://localhost:8000/api/drone/config
```

Test diagnostics:

```bash
curl http://localhost:8000/api/drone/diagnostics
```

Test jobs:

```bash
curl http://localhost:8000/api/jobs
```

Jalankan Vite:

```bash
cd web
npm run dev
```

## Check Kecil yang Perlu Ada

Buat minimal self-check untuk helper alamat:

```text
sanitize_grpc_addr("http://192.0.2.10:50051/x") == "192.0.2.10:50051"
sanitize_grpc_addr("192.0.2.10") == "192.0.2.10:50051"
sanitize_grpc_addr("") is None
```

Tidak perlu test framework dulu. Cukup fungsi `_demo()` dengan `assert` di
`grpc_backend.py`, karena logic non-trivial cuma sanitasi alamat.

## Risiko

| Risiko | Mitigasi |
| --- | --- |
| backend gRPC offline | FastAPI return `503` |
| command drone timeout | return `504`, jangan retry otomatis |
| `x-drone-addr` salah | sanitize lalu fallback env |
| artifact URL `localhost` tidak bisa dibuka dari tablet | rewrite URL |
| FE mengharapkan shape jobs berbeda | samakan wrapper `/api/jobs` setelah cek page |

## Yang Sengaja Tidak Dibuat Dulu

- `.proto` generation: backend memang JSON-over-gRPC.
- Pydantic schema lengkap untuk semua response: shape backend besar dan berubah;
  dict pass-through lebih murah.
- Auth: belum ada di stack sekarang.
- Retry command drone: berbahaya untuk command fisik.
- Background worker: command fire-and-poll sudah ditangani backend gRPC.

