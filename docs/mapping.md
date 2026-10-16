# Mapping API

Endpoints exposed by the `soerogis.MappingJobService` gRPC service. This is the
current mapping path: it organizes work into **mapping sessions** — persisted
folders under `data/sessions/<id>/` — and runs **OpenDroneMap** photogrammetry
over each session's images via a **NodeODM** instance (driven with PyODM).

State lives in `session_store.py` (`SessionStore`); `odm_jobs.py`
(`MappingJobService`) is the thin gRPC layer over it.

## Transport & conventions

- **Protocol:** gRPC with **JSON request/response bodies** — there is no
  `.proto`. Every request and response is a JSON object (a dict).
- **Service name:** `soerogis.MappingJobService`
- **Address:** `0.0.0.0:50051` (insecure channel by default)
- **Artifact files:** served over plain **HTTP** by a static file server on
  `0.0.0.0:8000` (separate from gRPC). Responses reference artifacts by URL, not
  by server path — see [Fetching artifacts](#fetching-artifacts).
- **Wiring:** `server.py` registers each method → `MappingJobService`
  (request validation) → `SessionStore` (folders, persistence, NodeODM).

### Session model

A **session** is one mapping run, persisted as a folder whose `metadata.json` is
the single source of truth (so the registry **survives restarts** — on boot it
rehydrates every session and re-attaches any in-flight stitch to its NodeODM
task by `backend_ref`).

```
data/sessions/<id>/
  metadata.json      # session state (the response object below)
  raw/               # input images, saved before any stitch — plus geo.txt on the capture path
  processed/         # per-frame NDVI GeoTIFF + KML (capture path only)
  stitched.tif       # ODM orthophoto, copied out of odm/
  clusters.kml       # vegetation-cluster polygons (mapping.generate_kml)
  odm/               # full NodeODM asset bundle
```

### Where sessions come from

Two producers write into the same registry, so `ListJobs`/`GetJob` see both:

1. **A client**, via `CreateSession` / `CreateOdmJob` (below).
2. **The drone capture pipeline** — `DroneService.PushCaptureMission` (see
   [drone_api.md](drone_api.md)). The session is created **when the mission is
   pushed**, not at mission end, so a mapping flight **appears in `ListJobs` from
   takeoff onward** with its live progress in the [`capture`](#capture-block)
   block. `PushCaptureMission` returns that session's `session_id`. The frames
   land directly in this session's `raw/` — there is no second folder and no
   second copy — and the ODM stitch starts only when the last point is captured.

Capture-produced `raw/` folders hold the MAPIR `.RAW`, the camera's own `.JPG`
of the same shot, **and** the `.png` demosaiced from the RAW. Only the PNGs are
sent to ODM (the session's `image_glob` is `*.png`); uploading both renders of a
frame at zero baseline confuses the reconstruction, and the JPGs carry no GPS
EXIF. Don't filter the listing on `.tif`.

### Two-phase flow

Photos are saved into the backend **first**, then stitched:

1. **`CreateSession`** — create the session folder and populate `raw/` (copy from
   a server-side `source_dir`, or let the camera driver write the tiffs directly).
   Status starts at `unstitched`.
2. **`StartStitching`** — send `raw/` to NodeODM. **Fire-and-poll:** returns
   immediately; poll `GetJob` until the session reaches a terminal status.

`CreateOdmJob` is a one-shot convenience that does both in a single call
(back-compat with the older job-oriented API).

### Status lifecycle

```
unstitched ──StartStitching──▶ stitching ──ODM done──▶ clustering ──▶ ready
                                   │                        │
                                   │                        └──▶ failed
                                   └──▶ failed / canceled
```

| Status | Meaning |
|--------|---------|
| `unstitched` | Session created, `raw/` present, no stitch started. |
| `stitching` | ODM task queued/running on NodeODM. `progress` advances 0→100. |
| `clustering` | ODM finished; the asset bundle is downloading and `generate_kml` (NDVI → DBSCAN → alpha-shape → polygons) is turning the orthophoto into `clusters.kml`. Runs **automatically** when a stitch completes. Transient — advances to `ready` on success, `failed` on error. `has_stitched` flips to `true` partway through, so gate an orthophoto fetch on `has_stitched` / a non-null `artifacts.stitched_tif`, **not** on this status. |
| `ready` | Terminal. `clusters.kml` exists — the frontend can build a spraying flight plan from it. Implies `stitched.tif` is also present. |
| `failed` | Terminal. See `error`. Reachable *after* a successful stitch too — both the asset download (`asset download failed: …`) and clustering (`clustering: stitched.tif missing`, `clustering failed: …`) fail the session. |
| `canceled` | Terminal. Stitch was cancelled. |

> A mapping mission that is still **flying** sits at `unstitched` the whole time:
> `status` tracks the ODM pipeline only. Where the *flight* has got to is
> `capture.state` — see below. Keeping them separate is deliberate, so a frontend
> `switch` on `status` never has to know about flights.

<a id="capture-block"></a>
### `capture` block — flight state of a mapping mission

Sessions produced by the drone carry an extra `capture` object (absent, or `{}`,
for a client-created session). It is what makes a half-flown survey resumable, and
it survives restarts along with the rest of `metadata.json`.

```json
"capture": {
  "state": "paused",
  "active": false,
  "points": [{"lat": -7.2812, "lng": 112.7942}, {"lat": -7.2813, "lng": 112.7951}],
  "captured": [0, 1, 2],
  "pending": [],
  "altitude": 20.0,
  "hold_time": 2.0,
  "final_action": "rtl",
  "leg": 2,
  "last_error": "",
  "updated_at": "2026-09-12T21:40:11+07:00"
}
```

| Field | Meaning |
|-------|---------|
| `state` | Where the flight is: see the table below. |
| `active` | The mapping monitor currently owns this folder. While true, `StartStitching`, `CancelJob` and `RemoveJob` refuse (see [Deleting](#deleting-a-mapping-session)). |
| `points` | **Every** capture point of the original plan, in order. Indices into this list are what `captured`/`pending` refer to. |
| `captured` | Point indices whose frames are on disk, paired with their geotag, **and** successfully turned into an ODM image. Only these count as done. |
| `pending` | Point indices photographed but not yet secured. Promoted to `captured` when the leg is processed; a point stays here — and is **re-flown** on resume rather than leaving a hole in the coverage — if its leg failed, or if its own RAW could not be decoded (a truncated card write, or a camera resolution the unpacker doesn't expect). |
| `altitude` / `hold_time` / `final_action` | The flight parameters, reused as defaults by `ResumeMappingMission`. |
| `leg` | Which flight of this session is next (1 = the original push). |
| `last_error` | Why the last leg failed, or empty. |

| `capture.state` | Meaning |
|-----------------|---------|
| `armed` | Plan uploaded, monitor armed, `ExecuteMission` not yet called (or not yet airborne). |
| `flying` | Captures in progress. |
| `returning` | Last (or paused) capture done; the aircraft is flying home and landing. **Nothing is processed yet** — retrieving the frames puts the camera into USB mass-storage mode, which must not happen in flight. |
| `processing` | Aircraft is down; frames are being pulled off the SD and georeferenced. |
| `paused` | Leg processed, aircraft down, points still owed. Resumable. |
| `done` | Every point captured; the session has been handed to ODM (`status` moves to `stitching`). |
| `failed` | A leg could not be retrieved or paired — see `last_error`. Still resumable: its `pending` points get re-flown. |
| `canceled` | Operator dropped the mission (`CancelMappingMission`). The frames and `captured` list survive. |
| `interrupted` | The backend restarted while this session was armed/flying. Set by the boot sweep, since nothing is in the air under backend control any more. Resumable. |

Resumable states are `paused`, `interrupted`, `armed` and `failed`.

### Session object

Every endpoint returns the **session object** (the same shape as `metadata.json`,
plus absolute artifact paths and a `job_id` alias):

```json
{
  "id": "20260612T092100_sawah-blok-utara",
  "job_id": "20260612T092100_sawah-blok-utara",
  "name": "Blok Utara pagi",
  "status": "stitching",
  "area_name": "Sawah Blok Utara",
  "area_m2": null,
  "captured_at": "2026-06-12T09:21:00+07:00",
  "created_at": "2026-06-12T09:21:05+07:00",
  "updated_at": "2026-06-12T09:23:40+07:00",
  "image_count": 142,
  "image_glob": "",
  "backend_ref": "a1b2c3d4-...",
  "progress": 37.0,
  "error": "",
  "has_stitched": false,
  "has_clusters": false,
  "cluster_count": null,
  "capture": {},
  "artifacts": {
    "raw_dir": "http://localhost:8000/sessions/<id>/raw/",
    "stitched_tif": "http://localhost:8000/sessions/<id>/stitched.tif",
    "clusters_kml": "http://localhost:8000/sessions/<id>/clusters.kml",
    "processed_dir": "http://localhost:8000/sessions/<id>/processed/"
  }
}
```

| Field | Meaning |
|-------|---------|
| `id` / `job_id` | Session id (filesystem-safe). `job_id` is a back-compat alias. |
| `name` | Human label. |
| `status` | Lifecycle status (see above). |
| `area_name` | Field/plot name supplied at creation. |
| `area_m2` | Best-effort coverage in m², computed from the ortho once stitched (only for projected CRS; `null` otherwise). |
| `captured_at` | Capture time, supplied by the caller (ISO 8601). |
| `created_at` / `updated_at` | Session create / last-change time (ISO 8601). |
| `image_count` | Images counted into `raw/` at ingest, recounted when `StartStitching` runs. **Not a live directory count** — a session created without `source_dir` (camera driver writing `raw/` itself) reports `0` until stitching starts. |
| `image_glob` | Glob used to select images at ingest (empty = all images). |
| `backend_ref` | NodeODM task uuid (the reconciliation handle). |
| `progress` | ODM progress as a **percentage, 0–100**, while `stitching` (NodeODM's value, passed through unscaled by PyODM). Frozen at the last polled value afterwards — not reset to 100 on completion. |
| `error` | Failure reason, or empty. |
| `has_stitched` / `has_clusters` | Whether `stitched.tif` / `clusters.kml` exist. |
| `cluster_count` | Number of vegetation clusters (set by the clustering step). |
| `capture` | Flight state for a drone-produced session; `{}` for a client-created one. See [the `capture` block](#capture-block). |
| `artifacts` | **HTTP URLs** (served by the file server): `raw_dir`, and `stitched_tif` / `clusters_kml` / `processed_dir` (`null` until produced). See [Fetching artifacts](#fetching-artifacts). |

### Error codes

| gRPC status | When |
|-------------|------|
| `INVALID_ARGUMENT` | Required field missing (`source_dir`, `session_id`), `source_dir` not found, or no images found in `raw/`. |
| `NOT_FOUND` | No session with the given `session_id`. |
| `FAILED_PRECONDITION` | The operation would disturb a mapping mission in progress, or delete frames that are the only copy — see [`RemoveJob`](#deleting-a-mapping-session). Retry with `force: true` once you mean it. |
| `INTERNAL` | Unexpected failure creating a session or starting a stitch. |

---

## Endpoints

### `CreateSession`

Create a session and save its input photos into the backend (`raw/`). Status
starts at `unstitched`. Does **not** start stitching.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `""` | Human label; also seeds the session id. |
| `area_name` | string | `""` | Field/plot name. |
| `captured_at` | string | `""` | Capture time (ISO 8601). |
| `source_dir` | string | `null` | Server-side folder to **copy** images from into `raw/`. Omit if the camera driver writes `raw/` directly. |
| `image_glob` | string | `null` | Glob to pick images out of `source_dir` (e.g. `"*_D.JPG"`). Omitted = all files with image extensions. |

```json
{ "name": "Blok Utara pagi", "area_name": "Sawah Blok Utara",
  "source_dir": "/data/incoming/2026-06-12-am", "image_glob": "*.tif" }
```

**Response:** session object (`status: "unstitched"`; `image_count` is set only
when `source_dir` was supplied, otherwise `0`).

---

### `StartStitching`

Send the session's `raw/` images to NodeODM. **Fire-and-poll** — returns
immediately with `status: "stitching"`; poll `GetJob` until terminal.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |
| `options` | object | `{}` | ODM task options passed through to NodeODM (e.g. `{ "orthophoto-resolution": 2 }`). |

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "options": {} }
```

**Response:** session object (`status: "stitching"`). Returns `INVALID_ARGUMENT`
if `raw/` is empty or the session is already stitching — but `INTERNAL` if the
`raw/` folder is *missing entirely* (e.g. deleted out-of-band from a session
rehydrated on boot).

---

### `StartClustering`

Run the clustering step (`generate_kml`: NDVI → DBSCAN → alpha-shape → polygons)
over the session's `stitched.tif`, producing `clusters.kml` and promoting the
session to `ready`. **Fire-and-poll.** Use this to (re)cluster a session that
already has a `stitched.tif`; the normal pipeline runs clustering automatically
when an ODM stitch completes.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "clustering"`). Poll `GetJob` until
`ready` (then `has_clusters: true`, `cluster_count` set, `clusters_kml` URL
populated) or `failed`. Returns `INVALID_ARGUMENT` if there is no `stitched.tif`.

---

### `CreateOdmJob`

One-shot convenience: `CreateSession` + `StartStitching` in a single call.
Requires `source_dir`. Back-compat with the older job API.

**Request:** the union of `CreateSession` (with `source_dir` **required**) and
`StartStitching` (`options`).

```json
{ "name": "Blok Utara pagi", "source_dir": "/data/incoming/2026-06-12-am",
  "image_glob": "*.tif", "options": {} }
```

**Response:** session object (`status: "stitching"`).

---

### `GetJob`

Fetch one session, refreshing it against NodeODM if it is mid-stitch.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object. `NOT_FOUND` if the id is unknown.

---

### `ListJobs`

List all sessions, refreshing any in-flight stitches. **This is the mapping-session
list, and it includes a mission that is still flying** — a drone session is created
when its mission is pushed, so it is here from takeoff on, with live progress in
`capture` (`state`, `captured`, `points`).

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capture_only` | bool | `false` | Return only sessions produced by the drone (those with a `capture` block). |

**Response**

```json
{ "sessions": [ { ...session object... } ], "jobs": [ ... ] }
```

> `jobs` duplicates `sessions` for back-compat; prefer `sessions`.

To render one list of mapping missions with progress:

```python
for s in call("ListJobs", {"capture_only": True})["sessions"]:
    c = s["capture"]
    print(s["id"], c["state"], f'{len(c["captured"])}/{len(c["points"])} points', s["status"])
```

---

### `CancelJob`

Cancel a session's stitch on NodeODM and mark it `canceled`.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |
| `force` | bool | `false` | Cancel even while a capture mission is flying this session. |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response:** session object (`status: "canceled"`). `FAILED_PRECONDITION` while
`capture.active` is true — cancel the *mission* first with
`DroneService.CancelMappingMission`, which tears the monitor down cleanly.

---

<a id="deleting-a-mapping-session"></a>
### `RemoveJob`

Delete a session: its NodeODM task **and its whole on-disk folder** (raw images,
NDVI outputs, orthophoto, KML, metadata — all of it). This is the "delete" in
list/pause/resume/delete.

**Request**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | — | **Required.** (`job_id` accepted as an alias.) |
| `force` | bool | `false` | Delete anyway (see the guard below). |

```json
{ "session_id": "20260612T092100_sawah-blok-utara" }
```

**Response**

```json
{ "session_id": "20260612T092100_sawah-blok-utara", "job_id": "...", "removed": true }
```

Returns `FAILED_PRECONDITION` without `force` when either:

- `capture.active` is true — a mission is flying this session right now; or
- `capture.captured` is non-empty — the session holds frames that, with
  `CAPTURE_DRAIN_SD` on (the default), were **moved** off the camera SD. The
  session folder is then the only copy. A half-flown session also *looks* empty in
  a listing (`image_count` stays 0 until a stitch starts), which is exactly how it
  gets deleted by accident.

---

## Managing a mapping mission

A mapping mission is flown in one or more **legs**. `PushCaptureMission` starts leg
1; `PauseMappingMission` ends the current leg early; `ResumeMappingMission` starts
the next one. All three live on `soerogis.DroneService` (they need the flight
controller) — see [drone_api.md](drone_api.md) for their request/response shapes.
List and delete are the `MappingJobService` endpoints above, on the same
`session_id`.

```text
PushCaptureMission  { capture_points: [...], altitude: 20 }   -> { session_id: "<sid>", ... }
ExecuteMission      { mode: "mapping", job_id: "<sid>" }

  ... flies, photographing each point ...

PauseMappingMission { }               # battery low: come home, land, keep what we have
  -> poll MappingMissionStatus until phase == "paused"
  -> GetJob { session_id } shows capture.state "paused", captured [0..7] of 20

  ... swap the battery, walk to a new takeoff spot ...

ResumeMappingMission { session_id: "<sid>" }   # new plan for the 12 remaining points
ExecuteMission       { mode: "mapping", job_id: "<sid>" }

  ... flies the rest, returns to THIS leg's takeoff point, lands ...

  -> capture.state "done", status "stitching"  (the ODM stitch starts itself)
GetJob { session_id }                 # poll until status == "ready"
```

**Return and land before processing.** After the last capture point of a leg — and
on pause — the aircraft advances to the plan's trailing `NAV_RETURN_TO_LAUNCH`,
flies back to the takeoff point and lands. Only once touchdown is confirmed does
the backend pull the frames off the camera: retrieval switches the camera into USB
mass-storage mode and drains its SD card, which must not happen mid-flight. The
takeoff point is the FCU's own HOME, recorded at arming — so a resumed leg returns
to where *that* leg took off, not where the survey originally started.

**Each leg is processed on landing.** A leg's frames are retrieved, demosaiced to
PNG, NDVI-georeferenced into `processed/`, and merged into the session's `geo.txt`
as soon as it lands. Frames accumulate in the one `raw/` folder across legs; only
the final leg starts the stitch. That per-leg drain is also what keeps the geotag
pairing honest — each leg pairs its own geotags against exactly the files that leg
brought in.

---

## Fetching artifacts

Artifact files are **not** returned over gRPC — `GetJob`/`ListJobs` give you HTTP
URLs in `artifacts`, which a static file server (default `0.0.0.0:8000`, rooted
at `data/`) serves. Fetch them directly:

| Artifact | URL (from `artifacts`) | Use |
|----------|------------------------|-----|
| `clusters_kml` | `…/sessions/<id>/clusters.kml` | Vegetation/spray zones — load onto the map, build the flight plan. |
| `stitched_tif` | `…/sessions/<id>/stitched.tif` | Orthophoto raster overlay. |
| `raw_dir` | `…/sessions/<id>/raw/` | Directory listing of the source images (PNG on the capture path, TIFF/JPEG when ingested from a `source_dir`). |

- `null` artifacts mean the file isn't produced yet (e.g. `clusters_kml` is
  `null` until `status: "ready"`). A **non-null URL is not proof the file is
  fetchable**: the HTTP server is best-effort — if it can't bind, gRPC still
  serves and the URLs still appear, they just won't resolve. Handle a connection
  failure separately from a `null` artifact.
- The server supports **HTTP Range requests** (`206 Partial Content`) and sends
  `Access-Control-Allow-Origin: *`, so browser clients (Leaflet/georaster) can
  page through the large GeoTIFF without downloading it whole.
- **Deployment:** set `FILE_SERVER_BASE_URL` (e.g. `http://192.168.1.10:8000`)
  so the URLs point at the server's reachable address rather than `localhost`.
  `FILE_SERVER_HOST` / `FILE_SERVER_PORT` set where it binds. It is
  unauthenticated — keep it on a trusted LAN.
- The `data/` root also serves **`sd_captures/<ts>/`** — manual camera-SD dumps
  produced by `DroneService.DownloadCaptures`. Those folders are a valid
  `source_dir` for `CreateSession`. Same unauthenticated port.

```bash
curl -s "http://localhost:8000/sessions/<id>/clusters.kml" -o clusters.kml
curl -s -r 0-1023 "http://localhost:8000/sessions/<id>/stitched.tif" -o head.bin   # range
```

## Typical flow

Two-phase: save photos, then stitch and poll to completion.

```text
CreateSession   { "name": "Blok Utara pagi", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
                  -> { "id": "<sid>", "status": "unstitched", "image_count": 142 }
StartStitching  { "session_id": "<sid>" }
                  -> { "status": "stitching" }
GetJob          { "session_id": "<sid>" }   # poll until status in {ready, failed, canceled}
                  -> { "status": "ready", "has_stitched": true, "artifacts": { "stitched_tif": ".../stitched.tif" } }
```

Or the one-shot equivalent:

```text
CreateOdmJob    { "name": "...", "source_dir": "/data/incoming/am", "image_glob": "*.tif" }
GetJob          { "session_id": "<sid>" }   # poll until terminal
```

## Example client

Using `grpc` with the JSON codec (raw bytes; the server (de)serializes JSON):

```python
import json
import grpc

channel = grpc.insecure_channel("localhost:50051")

def call(method: str, payload: dict) -> dict:
    fn = channel.unary_unary(
        f"/soerogis.MappingJobService/{method}",
        request_serializer=lambda d: json.dumps(d).encode("utf-8"),
        response_deserializer=lambda b: json.loads(b.decode("utf-8")),
    )
    return fn(payload)

s = call("CreateSession", {
    "name": "Blok Utara pagi",
    "source_dir": "/data/incoming/2026-06-12-am",
    "image_glob": "*.tif",
})
call("StartStitching", {"session_id": s["id"]})

while call("GetJob", {"session_id": s["id"]})["status"] not in ("ready", "failed", "canceled"):
    pass  # add a sleep in real code

job = call("GetJob", {"session_id": s["id"]})
print(job["status"], job["artifacts"]["stitched_tif"])
```
