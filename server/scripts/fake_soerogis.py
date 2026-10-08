#!/usr/bin/env python3
"""Fake soerogis backend — a local stand-in for the aircraft's JSON-over-gRPC
services (soerogis.MappingJobService + soerogis.DroneService) so the mapping UI
and the FastAPI BFF can be exercised on this Pi without the drone.

It simulates the mapping-session registry of docs/mapping.md (ListJobs/GetJob/
CreateSession/StartStitching/CreateOdmJob/CancelJob/RemoveJob, incl. the `capture`
block and the FAILED_PRECONDITION guards: capture.active, captured frames that are
the only copy → force:true) and the multi-leg capture mission of docs/drone_api.md
(PushCaptureMission → ExecuteMission{mode:"mapping"} → (Pause → Resume → Execute)*
→ done, after which the ODM stitch starts by itself: stitching → clustering →
ready). The simulated aircraft walks the capture points so Diagnostics moves on
the map, and a tiny static file server on --http-port makes artifact URLs 404
instead of connection-refusing. Everything lives in memory (restart = clean slate
+ --seed fixtures); every RPC is logged, polls at most every 10 s.

Run against the BFF (from the repo root; the env var beats server/.env):

    server/venv/bin/python server/scripts/fake_soerogis.py --autofly
    cd server && BACKEND_GRPC_ADDR=127.0.0.1:50052 ./venv/bin/uvicorn main:app --port 8000

Flags: --port 50052 · --http-port 8765 · --tick 1.5 (seconds per photo) ·
       --autofly (start a live flight at boot) · --no-seed (empty registry).
"""
import argparse
import json
import math
import os
import re
import signal
import sys
import tempfile
import threading
import time
import uuid
from concurrent import futures
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import grpc

WIB = timezone(timedelta(hours=7))
HOME = (-7.28135, 112.79395)  # simulated takeoff spot (ITS Surabaya)
RESUMABLE = {"paused", "interrupted", "armed", "failed"}
RETURN_SECS, PROCESS_SECS, STITCH_SECS, CLUSTER_SECS = 3.0, 3.0, 20.0, 3.0
FAILED_PRECONDITION, NOT_FOUND, INVALID = (grpc.StatusCode.FAILED_PRECONDITION, grpc.StatusCode.NOT_FOUND,
                                           grpc.StatusCode.INVALID_ARGUMENT)
SHUTDOWN = threading.Event()


def now_iso():
    return datetime.now(WIB).isoformat(timespec="seconds")


def log(method, payload=None, note=""):
    brief = ""
    if payload:  # keep long lists (capture_points, waypoints) out of the log line
        compact = {k: (f"<{len(v)} items>" if isinstance(v, list) and len(v) > 3 else v) for k, v in payload.items()}
        brief = json.dumps(compact, separators=(",", ":"))[:140]
    print(f"{datetime.now().strftime('%H:%M:%S')} {method:<22} {brief} {note}".rstrip(), flush=True)


def lawnmower(center, rows, cols, spacing_m):
    """Boustrophedon grid of {lat,lng} around `center` (spacing in metres)."""
    dlat = spacing_m / 111_320.0
    dlng = spacing_m / (111_320.0 * math.cos(math.radians(center[0])))
    return [{"lat": round(center[0] + (r - (rows - 1) / 2) * dlat, 7),
             "lng": round(center[1] + (c - (cols - 1) / 2) * dlng, 7)}
            for r in range(rows) for c in (range(cols) if r % 2 == 0 else range(cols - 1, -1, -1))]


def bearing(a, b):
    lat1, lat2, dlng = math.radians(a[0]), math.radians(b[0]), math.radians(b[1] - a[1])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


class RpcFail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


class Leg:
    """One flight of a session: the plan (point indices) and its control flags."""

    def __init__(self, sid, plan):
        self.sid, self.plan, self.done, self.thread = sid, plan, 0, None
        self.pause, self.cancel = threading.Event(), threading.Event()


class Backend:
    def __init__(self, http_base, data_dir, tick):
        self.lock = threading.RLock()
        self.sessions = {}
        self.http_base, self.data_dir, self.tick = http_base, data_dir, tick
        self.leg = None  # the armed/flying mapping mission (only one at a time)
        self.last_leg = None  # what MappingMissionStatus keeps reporting once a leg settled
        self.drone = {"armed": False, "mode": "GUIDED", "lat": HOME[0], "lng": HOME[1], "alt": 0.0,
                      "heading": 90.0, "job_id": "idle", "mission_running": False, "last_command": "", "last_error": ""}

    # ---- sessions -----------------------------------------------------------
    def new_session(self, sid, name="", area_name="", captured_at="", capture=None, **over):
        s = {"id": sid, "name": name or sid, "status": "unstitched", "area_name": area_name, "area_m2": None,
             "captured_at": captured_at or now_iso(), "created_at": now_iso(), "updated_at": now_iso(),
             "image_count": 0, "image_glob": "*.png" if capture else "", "backend_ref": "", "progress": 0.0,
             "error": "", "has_stitched": False, "has_clusters": False, "cluster_count": None, "capture": capture or {}}
        s.update(over)
        self.sessions[sid] = s
        for sub in ("raw", "processed"):
            os.makedirs(os.path.join(self.data_dir, "sessions", sid, sub), exist_ok=True)
        return s

    def get(self, payload):
        sid = payload.get("session_id") or payload.get("job_id")
        if not sid:
            raise RpcFail(INVALID, "session_id is required")
        if sid not in self.sessions:
            raise RpcFail(NOT_FOUND, f"session not found: {sid}")
        return self.sessions[sid]

    def touch(self, s, **fields):
        s.update(fields)
        s["updated_at"] = now_iso()
        if s["capture"]:
            s["capture"]["updated_at"] = s["updated_at"]

    def view(self, s):
        # Copy the lists: json.dumps runs outside the lock while the flight
        # thread keeps appending to `pending`.
        sid, cap = s["id"], s["capture"]
        base = f"{self.http_base}/sessions/{sid}"
        cap_view = {**cap, "points": list(cap["points"]), "captured": list(cap["captured"]),
                    "pending": list(cap["pending"])} if cap else {}
        return {**s, "job_id": sid, "capture": cap_view, "artifacts": {
            "raw_dir": f"{base}/raw/",
            "stitched_tif": f"{base}/stitched.tif" if s["has_stitched"] else None,
            "clusters_kml": f"{base}/clusters.kml" if s["has_clusters"] else None,
            "processed_dir": f"{base}/processed/" if cap and cap["captured"] else None}}

    def guard_active(self, s, p, hint):
        if s["capture"].get("active") and not p.get("force"):
            raise RpcFail(FAILED_PRECONDITION,
                          f"session {s['id']} has a mapping mission in progress (capture.active) — {hint}, or pass force")

    # ---- MappingJobService ---------------------------------------------------
    def ListJobs(self, p):
        rows = [self.view(s) for s in self.sessions.values() if not p.get("capture_only") or s["capture"]]
        return {"sessions": rows, "jobs": rows}

    def GetJob(self, p):
        return self.view(self.get(p))

    def CreateSession(self, p):
        name = p.get("name") or "sesi"
        sid = datetime.now(WIB).strftime("%Y%m%dT%H%M%S") + "_" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        # A client session only "has images" when it copied them from source_dir.
        s = self.new_session(sid, name, p.get("area_name", ""), p.get("captured_at", ""),
                             image_count=24 if p.get("source_dir") else 0, image_glob=p.get("image_glob") or "")
        return self.view(s)

    def StartStitching(self, p):
        s = self.get(p)
        self.guard_active(s, p, "wait for the leg to land")
        if s["status"] == "stitching":
            raise RpcFail(INVALID, "session is already stitching")
        # A capture session reads image_count 0 until a stitch starts, yet its
        # raw/ holds one PNG per secured frame — the real backend recounts.
        if s["image_count"] <= 0 and not s["capture"].get("captured"):
            raise RpcFail(INVALID, "no images found in raw/")
        self._start_stitch(s)
        return self.view(s)

    def CreateOdmJob(self, p):
        if not p.get("source_dir"):
            raise RpcFail(INVALID, "source_dir is required")
        s = self.sessions[self.CreateSession(p)["id"]]
        self._start_stitch(s)
        return self.view(s)

    def CancelJob(self, p):
        s = self.get(p)
        self.guard_active(s, p, "CancelMappingMission first")
        if s["capture"].get("active"):
            self._end_leg(s, "canceled")
        self.touch(s, status="canceled")
        return self.view(s)

    def RemoveJob(self, p):
        s = self.get(p)
        self.guard_active(s, p, "CancelMappingMission first")
        if s["capture"].get("captured") and not p.get("force"):
            raise RpcFail(FAILED_PRECONDITION, f"session {s['id']} holds {len(s['capture']['captured'])} captured "
                          "frames that exist nowhere else; pass force to delete anyway")
        if s["capture"].get("active"):
            self._end_leg(s, "canceled")
        del self.sessions[s["id"]]
        return {"session_id": s["id"], "job_id": s["id"], "removed": True}

    # ---- stitch simulation ---------------------------------------------------
    def _start_stitch(self, s):
        ref = str(uuid.uuid4())
        # image_count is "recounted when StartStitching runs" (docs/mapping.md):
        # a capture session's raw/ holds one PNG per captured frame. A client
        # session ({} capture) keeps the count CreateSession set at ingest.
        count = len(s["capture"]["captured"]) if s["capture"] else s["image_count"]
        self.touch(s, status="stitching", progress=0.0, error="", backend_ref=ref, image_count=count)
        threading.Thread(target=self._stitch, args=(s["id"], ref, s["area_m2"] or self._area_m2(s)), daemon=True).start()

    def _advance(self, sid, ref, expect, **fields):
        """Apply `fields` only if this is still the same stitch (not canceled/removed/restarted)."""
        with self.lock:
            s = self.sessions.get(sid)
            if s is None or s["backend_ref"] != ref or s["status"] != expect:
                return False
            self.touch(s, **fields)
            return True

    def _stitch(self, sid, ref, area_m2):
        steps = int(STITCH_SECS / 0.5)
        for i in range(steps):
            if SHUTDOWN.wait(0.5) or not self._advance(sid, ref, "stitching", progress=round(100.0 * (i + 1) / steps, 1)):
                return
        # has_stitched flips before `ready`, as on the real backend.
        if self._advance(sid, ref, "stitching", status="clustering", has_stitched=True) and not SHUTDOWN.wait(CLUSTER_SECS):
            self._advance(sid, ref, "clustering", status="ready", has_clusters=True, cluster_count=3, area_m2=area_m2)

    @staticmethod
    def _area_m2(s):
        """Rough coverage: bbox of the capture points plus half a swath each side."""
        pts = s["capture"].get("points")
        if not pts:
            return 18400.0
        lats, lngs = [q["lat"] for q in pts], [q["lng"] for q in pts]
        m_per_deg_lng = 111_320.0 * math.cos(math.radians(lats[0]))
        return round(((max(lats) - min(lats)) * 111_320.0 + 15) * ((max(lngs) - min(lngs)) * m_per_deg_lng + 15), 1)

    # ---- DroneService --------------------------------------------------------
    def status(self):
        d = self.drone
        return {"available": True, "init_error": "", "mission_running": d["mission_running"],
                "last_command": d["last_command"], "last_error": d["last_error"], "fcu_connected": True,
                "armed": d["armed"], "mode": d["mode"], "position": {"x": 0.0, "y": 0.0, "z": d["alt"]}}

    def mission_status(self):
        leg = self.leg or self.last_leg
        s = self.sessions.get(leg.sid) if leg else None
        cap = s["capture"] if s else {}
        return {"running": self.leg is not None and bool(cap.get("active")),
                "session_id": leg.sid if leg else "", "phase": cap.get("state") or "idle",
                "captures_done": leg.done if leg else 0, "total_captures": len(leg.plan) if leg else 0,
                "odm_job_id": leg.sid if leg else "", "last_error": cap.get("last_error", "")}

    def mapping_reply(self, command):
        self.drone["last_command"] = command
        return {**self.status(), **self.mission_status()}

    def Diagnostics(self, p):
        d = self.drone
        yaw = math.radians((90 - d["heading"]) % 360)  # ENU yaw ← compass heading
        return {"available": True, "job_id": d["job_id"],
                "state": {"connected": True, "armed": d["armed"], "guided": True, "manual_input": False,
                          "mode": d["mode"], "system_status": 4},
                "global_position": {"latitude": d["lat"], "longitude": d["lng"], "altitude": 12.0 + d["alt"]},
                "imu": {"orientation": {"x": 0.0, "y": 0.0, "z": math.sin(yaw / 2), "w": math.cos(yaw / 2)}},
                "gps_raw": {"fix_type": 3, "satellites_visible": 14, "lat": int(d["lat"] * 1e7),
                            "lon": int(d["lng"] * 1e7), "alt": int((12.0 + d["alt"]) * 1000), "eph": 80, "epv": 120,
                            "vel": 350 if d["mission_running"] else 0, "cog": int(d["heading"] * 100),
                            "yaw": int(d["heading"] * 100) or 36000},
                "flow": None, "spray": None}

    def PushCaptureMission(self, p):
        points = [{"lat": float(q["lat"]), "lng": float(q["lng"])} for q in p.get("capture_points") or []]
        if not points:
            raise RpcFail(INVALID, "capture_points is required")
        if self.leg is not None:
            raise RpcFail(FAILED_PRECONDITION, f"a mapping mission is already active ({self.leg.sid}); cancel or finish it first")
        sid = p.get("session_id") or p.get("job_id") or f"map-{uuid.uuid4().hex[:8]}"
        if sid in self.sessions:
            raise RpcFail(FAILED_PRECONDITION, f"session {sid} already exists")
        self.new_session(sid, capture={
            "state": "armed", "active": True, "points": points, "captured": [], "pending": [],
            "altitude": float(p.get("altitude") or 5.0), "hold_time": float(p.get("hold_time") or 0.0),
            "final_action": "rtl", "leg": 1, "last_error": "", "updated_at": now_iso()})
        self.leg = Leg(sid, list(range(len(points))))
        return {**self.mapping_reply("push_capture_mission"), "session_id": sid}

    def ExecuteMission(self, p):
        sid = p.get("job_id") or p.get("session_id") or ""
        self.drone["last_command"] = "execute_mission"
        if p.get("mode") != "mapping":
            # Spray / plain waypoint mission: just look busy for a while.
            self.drone.update(mission_running=True, armed=True, mode="AUTO", job_id=sid or "idle")
            t = threading.Timer(8, lambda: self.drone.update(mission_running=False, armed=False, mode="GUIDED", job_id="idle"))
            t.daemon = True
            t.start()
            return self.status()
        leg = self.leg
        if leg is None or (sid and sid != leg.sid):
            raise RpcFail(FAILED_PRECONDITION, f"no armed mapping mission for {sid or '(none)'}")
        if leg.thread is not None:
            raise RpcFail(FAILED_PRECONDITION, "mission already executing")
        leg.thread = threading.Thread(target=self._fly, args=(leg,), daemon=True)
        leg.thread.start()
        return self.status()

    def PauseMappingMission(self, p):
        leg = self.leg
        s = self.sessions.get(leg.sid) if leg else None
        if s is None or s["capture"]["state"] not in ("armed", "flying"):
            raise RpcFail(FAILED_PRECONDITION, "no mapping mission is armed or flying")
        if leg.thread is None:  # never took off: nothing to bring home
            self._end_leg(s, "paused")
        else:
            leg.pause.set()  # the flight thread finishes its current point first
        return self.mapping_reply("pause_mapping_mission")

    def ResumeMappingMission(self, p):
        s = self.get(p)
        cap = s["capture"]
        if not cap:
            raise RpcFail(FAILED_PRECONDITION, f"session {s['id']} was not flown by the drone")
        if self.leg is not None and self.leg.sid != s["id"]:
            raise RpcFail(FAILED_PRECONDITION, f"another mapping mission is active ({self.leg.sid})")
        if cap["state"] not in RESUMABLE:
            raise RpcFail(FAILED_PRECONDITION, f"session is not resumable (capture.state={cap['state']})")
        remaining = [i for i in range(len(cap["points"])) if i not in cap["captured"]]
        if not remaining:
            raise RpcFail(FAILED_PRECONDITION, "nothing left to fly")
        # Pending points of a failed leg are re-flown, not left as holes: they
        # stay listed ("stays here", docs/mapping.md) until the resumed leg
        # re-secures them, so the photographed tally never goes backwards.
        # `leg` already names the next flight (bumped when a flown leg settles;
        # untouched for an `armed` session that never took off).
        cap.update(state="armed", active=True, last_error="",
                   altitude=float(p.get("altitude") or cap["altitude"]),
                   hold_time=float(p["hold_time"]) if p.get("hold_time") is not None else cap["hold_time"])
        self.touch(s)
        self.leg = Leg(s["id"], remaining)
        return {**self.mapping_reply("resume_mapping_mission"), "session_id": s["id"]}

    def CancelMappingMission(self, p):
        leg = self.leg
        if leg is not None:  # safe when idle, like CancelSprayMission
            if p.get("session_id") and p["session_id"] != leg.sid:
                raise RpcFail(FAILED_PRECONDITION, f"active mission is {leg.sid}, not {p['session_id']}")
            self._end_leg(self.sessions[leg.sid], "canceled")
        return self.mapping_reply("cancel_mapping_mission")

    def _end_leg(self, s, state):
        """Settle the active leg without processing: pending stays as-is."""
        if self.leg:
            self.leg.cancel.set()
            self.last_leg, self.leg = self.leg, None
        s["capture"].update(state=state, active=False)
        self.touch(s)
        self.drone.update(mission_running=False, job_id="idle")

    # Plain FCU commands — enough for the pre-flight panel: mutate the simulated
    # state and return the status object.
    SIMPLE = {"Arm": {"armed": True}, "Disarm": {"armed": False}, "PushMission": {},
              "Land": {"mode": "LAND", "alt": 0.0, "armed": False}}

    def simple(self, method, p):
        if method in ("MissionStatus", "MappingMissionStatus"):
            return self.status() if method == "MissionStatus" else self.mission_status()
        if method == "SetMode":
            if not p.get("mode"):
                raise RpcFail(INVALID, "mode is required")
            fields = {"mode": p["mode"]}
        elif method == "Takeoff":
            fields = {"armed": True, "mode": "GUIDED", "alt": float(p.get("altitude") or 2.0)}
        else:
            fields = self.SIMPLE[method]
        self.drone.update(fields, last_command=method.lower())
        return self.status()

    # ---- flight simulation ---------------------------------------------------
    def _glide(self, target, secs, leg):
        """Move the aircraft to `target` over `secs`, in small steps so the
        Diagnostics marker slides. Returns False when the leg was canceled."""
        steps = max(1, int(secs / 0.25))
        with self.lock:
            start = (self.drone["lat"], self.drone["lng"])
            if start != target:
                self.drone["heading"] = bearing(start, target)
        for i in range(1, steps + 1):
            if SHUTDOWN.wait(secs / steps) or leg.cancel.is_set():
                return False
            with self.lock:
                self.drone["lat"] = start[0] + (target[0] - start[0]) * i / steps
                self.drone["lng"] = start[1] + (target[1] - start[1]) * i / steps
        return True

    def _hop(self, s, state, **drone):
        with self.lock:
            self.drone.update(drone)
            s["capture"]["state"] = state
            self.touch(s)

    def _fly(self, leg):
        s = self.sessions[leg.sid]
        cap = s["capture"]
        home = (self.drone["lat"], self.drone["lng"])  # this leg's own takeoff spot
        self._hop(s, "flying", armed=True, mode="AUTO", alt=cap["altitude"], mission_running=True, job_id=leg.sid)
        for idx in leg.plan:
            if leg.pause.is_set():
                break
            pt = cap["points"][idx]
            if not self._glide((pt["lat"], pt["lng"]), self.tick, leg):
                return
            with self.lock:
                if idx not in cap["pending"]:  # a re-flown point is already listed
                    cap["pending"].append(idx)
                leg.done += 1
                self.touch(s)
            log("  photo", note=f"{leg.sid} point {idx + 1}/{len(cap['points'])} (leg {cap['leg']}: {leg.done}/{len(leg.plan)})")
        self._hop(s, "returning")
        if not self._glide(home, RETURN_SECS, leg):
            return
        self._hop(s, "processing", alt=0.0, armed=False, mode="GUIDED")  # touchdown, then drain the SD
        if SHUTDOWN.wait(PROCESS_SECS) or leg.cancel.is_set():
            return
        with self.lock:
            if self.leg is not leg:  # canceled / force-removed meanwhile
                return
            # Landing drains the SD: photographed frames become secured frames.
            # image_count stays 0 until the stitch recounts raw/ (docs/mapping.md),
            # so the UI's captured/points fallback is what a half-flown session shows.
            cap["captured"] = sorted(set(cap["captured"]) | set(cap["pending"]))
            cap["pending"] = []
            finished = len(cap["captured"]) == len(cap["points"])
            if not finished:
                # `leg` names the NEXT flight (docs/mapping.md), so a paused
                # session already reads leg 2 before Resume. Bumped here, where
                # a leg is known to have flown — not in _end_leg, which also
                # serves cancel and the never-took-off pause (leg 1 still owed).
                cap["leg"] += 1
            self._end_leg(s, "done" if finished else "paused")
            if finished:
                self._start_stitch(s)  # the last leg hands the session to ODM by itself
            log("  leg settled", note=f"{leg.sid} -> {cap['state']}")


# ---- seed fixtures -----------------------------------------------------------
def seed(b, autofly):
    def ago(**kw):
        return (datetime.now(WIB) - timedelta(**kw)).isoformat(timespec="seconds")

    def capture(state, points, captured, pending=(), leg=1, last_error=""):
        return {"state": state, "active": False, "points": points, "captured": list(captured),
                "pending": list(pending), "altitude": 20.0, "hold_time": 2.0, "final_action": "rtl",
                "leg": leg, "last_error": last_error, "updated_at": now_iso()}

    b.new_session("20260901T090000_sawah-blok-utara", "Blok Utara pagi", "Sawah Blok Utara",
                  "2026-09-01T09:00:00+07:00", status="ready", progress=100.0, image_count=132, area_m2=21500.0,
                  has_stitched=True, has_clusters=True, cluster_count=4, backend_ref=str(uuid.uuid4()),
                  created_at="2026-09-01T09:05:12+07:00", updated_at="2026-09-01T09:41:03+07:00")
    # Half-flown sessions: leg 1 has flown so `leg` (the NEXT flight) is 2, and
    # image_count stays 0 until a stitch — the kiosk shows captured/points instead.
    b.new_session("map-paused-demo", captured_at=ago(minutes=40), created_at=ago(minutes=40),
                  capture=capture("paused", lawnmower((-7.2812, 112.7942), 5, 4, 15), range(8), leg=2))
    b.new_session("map-interrupted-demo", captured_at=ago(hours=2), created_at=ago(hours=2),
                  capture=capture("interrupted", lawnmower((-7.2830, 112.7960), 3, 4, 15), range(3), leg=2))
    b.new_session("map-failed-demo", captured_at=ago(days=1), created_at=ago(days=1),
                  capture=capture("failed", lawnmower((-7.2795, 112.7925), 3, 4, 15), [0, 1], [2, 3], leg=2,
                                  last_error="leg 1: RAW decode failed for 2 frames"))
    if autofly:
        b.PushCaptureMission({"session_id": "map-flying-demo", "altitude": 20.0, "hold_time": 2.0,
                              "capture_points": lawnmower((-7.2812, 112.7942), 4, 4, 15)})
        b.ExecuteMission({"mode": "mapping", "job_id": "map-flying-demo"})


# ---- transport ---------------------------------------------------------------
class JsonHandler(grpc.GenericRpcHandler):
    """Routes /soerogis.<Service>/<Method> to Backend.<Method>; bodies are JSON
    (the BFF's call_grpc uses json.dumps / json.loads as the (de)serializers)."""

    SERVICES = {
        "soerogis.MappingJobService": {"ListJobs", "GetJob", "CreateSession", "StartStitching", "CreateOdmJob",
                                       "CancelJob", "RemoveJob"},
        "soerogis.DroneService": {"Diagnostics", "MissionStatus", "PushCaptureMission", "ExecuteMission",
                                  "MappingMissionStatus", "PauseMappingMission", "ResumeMappingMission",
                                  "CancelMappingMission", "Arm", "Disarm", "Takeoff", "Land", "SetMode", "PushMission"},
    }
    # Polls arrive every second or two from the kiosk; log them at most every 10 s.
    POLLS = {"Diagnostics", "MissionStatus", "MappingMissionStatus", "ListJobs", "GetJob"}

    def __init__(self, backend):
        self.backend = backend
        self._poll_logged = {}

    def service(self, handler_call_details):
        parts = handler_call_details.method.strip("/").split("/")
        service, method = parts if len(parts) == 2 else ("", handler_call_details.method)
        if method not in self.SERVICES.get(service, ()):
            log(method, note="(unknown method)")
            return None
        return grpc.unary_unary_rpc_method_handler(
            partial(self._call, method),
            request_deserializer=lambda b: json.loads(b.decode("utf-8") or "{}"),
            response_serializer=lambda d: json.dumps(d).encode("utf-8"))

    def _call(self, method, payload, context):
        payload = payload if isinstance(payload, dict) else {}
        fn = getattr(self.backend, method, None) or partial(self.backend.simple, method)
        try:
            with self.backend.lock:
                out = fn(payload)
            if method not in self.POLLS or time.monotonic() - self._poll_logged.get(method, 0.0) >= 10:
                self._poll_logged[method] = time.monotonic()
                log(method, payload)
            return out
        except RpcFail as e:
            log(method, payload, f"-> {e.code.name}: {e.msg}")
            context.abort(e.code, e.msg)
        except Exception as e:  # noqa: BLE001 — surface anything else as INTERNAL like the real server
            log(method, payload, f"-> INTERNAL: {e!r}")
            context.abort(grpc.StatusCode.INTERNAL, repr(e))


class QuietFiles(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        log("http", note=f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=50052)
    ap.add_argument("--http-port", type=int, default=8765)
    ap.add_argument("--tick", type=float, default=1.5, help="seconds per capture point")
    ap.add_argument("--autofly", action="store_true", help="start a live flight (map-flying-demo) at boot")
    ap.add_argument("--seed", action=argparse.BooleanOptionalAction, default=True)
    args = ap.parse_args()

    data_dir = tempfile.mkdtemp(prefix="fake-soerogis-")
    backend = Backend(f"http://127.0.0.1:{args.http_port}", data_dir, args.tick)
    if args.seed:
        seed(backend, args.autofly)

    httpd = ThreadingHTTPServer(("0.0.0.0", args.http_port), partial(QuietFiles, directory=data_dir))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8), handlers=[JsonHandler(backend)])
    server.add_insecure_port(f"0.0.0.0:{args.port}")
    server.start()
    print(f"fake soerogis: grpc 0.0.0.0:{args.port}  files http://127.0.0.1:{args.http_port}/  data {data_dir}", flush=True)
    print(f"  sessions: {', '.join(backend.sessions) or '(none)'}   (BACKEND_GRPC_ADDR=127.0.0.1:{args.port})", flush=True)

    signal.signal(signal.SIGINT, lambda *_: SHUTDOWN.set())
    signal.signal(signal.SIGTERM, lambda *_: SHUTDOWN.set())
    while not SHUTDOWN.wait(0.5):
        pass
    print("\nfake soerogis: stopping", flush=True)
    server.stop(grace=1).wait()
    httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())
