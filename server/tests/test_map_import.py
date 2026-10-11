"""Importing a finished soerogis mapping session into the field-imagery store.

Real rasters go through the real `gdal_translate`; the HTTP source is a local
server; only the database is faked (the real DB path is exercised by registering
through /api/jobs/{id}/import against rikub-pg in the manual end-to-end run).
"""
import functools
import http.server
import json
import threading
import time
import urllib.parse

import numpy as np
import pytest
import rasterio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from rasterio.enums import ColorInterp
from rasterio.transform import from_origin

from app import grpc_backend, map_import
from app.db import database
from app.db.database import get_db
from app.routes import fields as fields_routes
from app.routes import jobs

SID = "20261011T162820_map-mv3mepnc"


# --- fixtures ----------------------------------------------------------------
@pytest.fixture
def server_root(tmp_path, monkeypatch):
    root = tmp_path / "server"
    (root / "storage" / "imagery").mkdir(parents=True)
    monkeypatch.setattr(fields_routes, "SERVER_ROOT", root)
    return root


def write_ortho(path, h=40, w=60):
    """RGBA uint8, UTM 49S, left third transparent (the ODM surround)."""
    rgb = np.random.default_rng(1).integers(40, 230, (3, h, w)).astype("uint8")
    alpha = np.full((h, w), 255, "uint8")
    alpha[:, : w // 3] = 0
    rgb[:, :, : w // 3] = 0
    with rasterio.open(path, "w", driver="GTiff", dtype="uint8", count=4, width=w, height=h,
                       crs="EPSG:32749", transform=from_origin(697000, 9195000, 0.5, 0.5)) as ds:
        ds.write(rgb, [1, 2, 3])
        ds.write(alpha, 4)
        ds.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]


def write_ndvi(path, h=40, w=60):
    nd = np.full((h, w), 0.4, "float32")
    nd[:, : w // 3] = -9999
    with rasterio.open(path, "w", driver="GTiff", dtype="float32", count=1, width=w, height=h, nodata=-9999,
                       crs="EPSG:32749", transform=from_origin(697000, 9195000, 0.5, 0.5)) as ds:
        ds.write(nd, 1)


@pytest.fixture
def source(tmp_path):
    """A local stand-in for the mapping backend's file server."""
    web = tmp_path / "web"
    web.mkdir()
    write_ortho(web / "stitched.tif")
    write_ndvi(web / "ndvi.tif")
    (web / "clusters.kml").write_text("<kml/>")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(web))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield {"base": base, "dir": web}
    srv.shutdown()


def session(base, **over):
    s = {
        "id": SID, "job_id": SID, "name": "map-mv3mepnc", "area_name": "", "status": "ready",
        "created_at": "2026-10-11T16:28:20+07:00", "captured_at": "",
        "artifacts": {"stitched_tif": f"{base}/stitched.tif", "ndvi_tif": f"{base}/ndvi.tif",
                      "clusters_kml": f"{base}/clusters.kml", "raw_dir": f"{base}/raw/", "processed_dir": None},
    }
    s.update(over)
    return s


class FakeQuery:
    def filter(self, *a, **k):
        return self

    def first(self):
        return None


class FakeDB:
    def __init__(self, imagery=None):
        self.imagery, self.added, self.closed = imagery, [], False

    def query(self, model):
        return FakeQuery()

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = "11111111-1111-1111-1111-111111111111"

    def get(self, model, ident):
        return self.imagery

    def close(self):
        self.closed = True


@pytest.fixture
def fake_register(monkeypatch):
    """Skip the Postgres-bound registration; keep everything file-side real."""
    seen = {}

    def upsert(field, payload, db):
        seen["payload"] = payload
        return type("Img", (), {"id": "22222222-2222-2222-2222-222222222222", "field": field})(), True

    monkeypatch.setattr(fields_routes, "upsert_imagery_for_field", upsert)
    monkeypatch.setattr(fields_routes, "imagery_to_dict", lambda i: {"id": i.id, "rgb_png_path": "/imagery/x/rgb.png"})
    monkeypatch.setattr(fields_routes, "field_to_dict", lambda f: {"id": "11111111-1111-1111-1111-111111111111", "name": f.name})
    monkeypatch.setattr(database, "SessionLocal", lambda: FakeDB())
    return seen


# --- planning ----------------------------------------------------------------
def test_plan_names_and_paths(source):
    plan = map_import.plan_import(session(source["base"]), None)
    assert plan.field_name == "map-mv3mepnc"
    assert plan.rel_dir == "storage/imagery/map-mv3mepnc/capture-2026-10-11-map-mv3mepnc"
    assert plan.capture_at.isoformat() == "2026-10-11T16:28:20+07:00"
    # explicit name > area_name > name
    assert map_import.plan_import(session(source["base"], area_name="Blok A"), None).field_name == "Blok A"
    p = map_import.plan_import(session(source["base"], area_name="Blok A"), "  Sawah Utara ")
    assert p.field_name == "Sawah Utara" and p.rel_dir.startswith("storage/imagery/sawah-utara/")


def test_plan_refuses_what_it_cannot_import(source):
    base = source["base"]
    for bad, code in [
        (session(base, status="failed"), 409),          # a failed re-stitch keeps the OLD artifacts
        (session(base, status="stitching"), 409),
        (session(base, artifacts={"stitched_tif": f"{base}/stitched.tif", "ndvi_tif": None}), 409),
        (session(base, artifacts={"stitched_tif": None, "ndvi_tif": f"{base}/ndvi.tif"}), 409),
        (session(base, id="../etc"), 400),
    ]:
        with pytest.raises(Exception) as exc:
            map_import.plan_import(bad, None)
        assert exc.value.status_code == code
    with pytest.raises(Exception) as exc:
        map_import.plan_import(session(base), "x" * 121)
    assert exc.value.status_code == 400


# --- download ----------------------------------------------------------------
def test_download_ok_progress_and_http_error(source, tmp_path):
    dest = tmp_path / "out.tif"
    calls = []
    n = map_import.download_file(f"{source['base']}/ndvi.tif", dest, lambda g, t: calls.append((g, t)))
    assert dest.read_bytes() == (source["dir"] / "ndvi.tif").read_bytes() and n == dest.stat().st_size
    assert calls and calls[-1][0] == calls[-1][1]
    with pytest.raises(map_import.ImportFailed, match="HTTP 404"):
        map_import.download_file(f"{source['base']}/missing.tif", tmp_path / "m.tif")
    assert not list(tmp_path.glob("*.part")) and not (tmp_path / "m.tif").exists()


def test_download_refuses_a_truncated_body(tmp_path):
    class Liar(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            self.wfile.write(b"x" * 10)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Liar)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with pytest.raises(map_import.ImportFailed):
            map_import.download_file(f"http://127.0.0.1:{srv.server_address[1]}/f", tmp_path / "f.tif")
    finally:
        srv.shutdown()
    assert not (tmp_path / "f.tif").exists() and not list(tmp_path.glob("*.part"))


def test_unreachable_backend_is_a_readable_error(tmp_path):
    with pytest.raises(map_import.ImportFailed, match="Tidak bisa mengunduh"):
        map_import.download_file("http://127.0.0.1:9/ndvi.tif", tmp_path / "n.tif", timeout=2)


# --- rgb.tif shaping -----------------------------------------------------------
def test_rgb_tif_is_three_band_nodata_zero_and_pngs_with_transparent_surround(server_root, source):
    src = server_root / "in.tif"
    src.write_bytes((source["dir"] / "stitched.tif").read_bytes())
    cap = server_root / "storage" / "imagery" / "f" / "c"
    cap.mkdir(parents=True)
    map_import.build_rgb_tif(src, cap / "rgb.tif")
    with rasterio.open(cap / "rgb.tif") as ds:
        assert (ds.count, ds.dtypes[0], ds.nodata) == (3, "uint8", 0.0)
        assert str(ds.crs) == "EPSG:32749"
    assert not list(cap.glob("*.new"))
    # the point of nodata=0: THEIR converter writes a tRNS chunk, so the surround is see-through
    fields_routes.convert_rgb_tif_to_png("storage/imagery/f/c/rgb.tif")
    im = Image.open(cap / "rgb.png")
    assert im.info.get("transparency") == (0, 0, 0)
    a = np.asarray(im.convert("RGBA"))
    assert 0.25 < (a[..., 3] == 0).mean() < 0.4          # the left third


def test_check_rasters_rejects_the_wrong_files(tmp_path, source):
    with pytest.raises(map_import.ImportFailed, match="ndvi.tif"):
        map_import.check_rasters(source["dir"] / "stitched.tif", source["dir"] / "stitched.tif")  # not 1-band float
    with pytest.raises(map_import.ImportFailed, match="stitched.tif"):
        map_import.check_rasters(source["dir"] / "ndvi.tif", source["dir"] / "ndvi.tif")
    (tmp_path / "junk.tif").write_bytes(b"not a tiff")
    with pytest.raises(map_import.ImportFailed, match="tidak terbaca"):
        map_import.check_rasters(tmp_path / "junk.tif", source["dir"] / "ndvi.tif")


# --- the whole import --------------------------------------------------------
def test_import_session_lays_files_out_like_the_dji_maps(server_root, source, fake_register):
    plan = map_import.plan_import(session(source["base"]), "Sawah Uji")
    steps = []
    out = map_import.import_session(plan, lambda s, p, m: steps.append((s, p)))
    cap = server_root / plan.rel_dir
    assert sorted(p.name for p in cap.iterdir()) == ["ndvi.tif", "rgb.tif", "source.json", "zones.kml"]
    with rasterio.open(cap / "rgb.tif") as ds:
        assert ds.count == 3 and ds.nodata == 0
    assert fake_register["payload"].rgb_tif_path == f"{plan.rel_dir}/rgb.tif"
    assert fake_register["payload"].ndvi_tif_path == f"{plan.rel_dir}/ndvi.tif"
    marker = json.loads((cap / "source.json").read_text())
    assert marker["session_id"] == SID and marker["imagery_id"] == "22222222-2222-2222-2222-222222222222"
    assert out["files"] == {
        "rgb_tif": "/imagery/sawah-uji/capture-2026-10-11-map-mv3mepnc/rgb.tif",
        "ndvi_tif": "/imagery/sawah-uji/capture-2026-10-11-map-mv3mepnc/ndvi.tif",
        "zones_kml": "/imagery/sawah-uji/capture-2026-10-11-map-mv3mepnc/zones.kml",
    }
    assert out["refreshed"] is False
    pcts = [p for _, p in steps]
    assert pcts == sorted(pcts) and pcts[0] < 10 and pcts[-1] >= 80


def test_failed_download_leaves_existing_imagery_untouched(server_root, source, fake_register):
    plan = map_import.plan_import(session(source["base"]), "Sawah Uji")
    cap = server_root / plan.rel_dir
    cap.mkdir(parents=True)
    (cap / "rgb.tif").write_bytes(b"previous rgb")
    (cap / "ndvi.tif").write_bytes(b"previous ndvi")
    (source["dir"] / "ndvi.tif").unlink()                      # 404 on the second download
    with pytest.raises(map_import.ImportFailed):
        map_import.import_session(plan, lambda *a: None)
    assert (cap / "rgb.tif").read_bytes() == b"previous rgb"
    assert (cap / "ndvi.tif").read_bytes() == b"previous ndvi"
    assert sorted(p.name for p in cap.iterdir()) == ["ndvi.tif", "rgb.tif"]    # temp files cleaned


def test_missing_kml_is_not_fatal(server_root, source, fake_register):
    (source["dir"] / "clusters.kml").unlink()
    plan = map_import.plan_import(session(source["base"]), "Sawah Uji")
    out = map_import.import_session(plan, lambda *a: None)
    assert out["files"]["zones_kml"] is None and not (server_root / plan.rel_dir / "zones.kml").exists()


# --- registry ------------------------------------------------------------------
def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def a_plan(base="http://x"):
    return map_import.plan_import(session(base), None)


def test_registry_is_idempotent_while_running_then_reports_done():
    reg, gate, runs = map_import.ImportRegistry(), threading.Event(), []

    def runner(plan, progress):
        runs.append(plan.session_id)
        progress("download-ortho", 33, "x")
        gate.wait(5)
        return {"imagery": {"id": "i"}, "field": {"id": "f"}, "files": {}, "refreshed": False}

    first = reg.start(a_plan(), runner)
    assert first["state"] == "running"
    assert wait_for(lambda: reg.get(SID)["progress"] == 33)
    second = reg.start(a_plan(), runner)             # a double-click must not start a second import
    assert second["state"] == "running" and runs == [SID]
    gate.set()
    assert wait_for(lambda: reg.get(SID)["state"] == "done")
    done = reg.get(SID)
    assert done["progress"] == 100 and done["imagery"] == {"id": "i"} and done["error"] is None
    assert reg.start(a_plan(), runner)["state"] == "running"     # a finished import can be refreshed


def test_registry_reports_failures_with_the_reason():
    reg = map_import.ImportRegistry()

    def boom(plan, progress):
        raise map_import.ImportFailed("Tidak bisa mengunduh ndvi.tif dari backend mapping: down")

    reg.start(a_plan(), boom)
    assert wait_for(lambda: reg.get(SID)["state"] == "failed")
    assert "ndvi.tif" in reg.get(SID)["error"]
    assert reg.get("other") is None


def test_find_import_rebuilds_done_from_the_marker(server_root, monkeypatch):
    cap = server_root / "storage" / "imagery" / "lahan" / "capture-2026-10-11-map-mv3mepnc"
    cap.mkdir(parents=True)
    (cap / "source.json").write_text(json.dumps({
        "session_id": SID, "imagery_id": "22222222-2222-2222-2222-222222222222",
        "field_id": "f", "imported_at": "2026-10-11T19:00:00+07:00"}))
    img = type("Img", (), {"id": "22222222-2222-2222-2222-222222222222", "field": type("F", (), {"name": "Lahan"})()})()
    monkeypatch.setattr(fields_routes, "imagery_to_dict", lambda i: {"id": i.id})
    monkeypatch.setattr(fields_routes, "field_to_dict", lambda f: {"name": f.name})
    found = map_import.find_import(SID, FakeDB(img))
    assert found["state"] == "done" and found["field"] == {"name": "Lahan"}
    assert found["files"]["rgb_tif"] == "/imagery/lahan/capture-2026-10-11-map-mv3mepnc/rgb.tif"
    assert found["files"]["zones_kml"] is None
    assert map_import.find_import(SID, FakeDB(None)) is None         # imagery row gone => stale marker
    assert map_import.find_import("other-session", FakeDB(img)) is None


# --- routes --------------------------------------------------------------------
@pytest.fixture
def client(monkeypatch, server_root):
    monkeypatch.setattr(grpc_backend, "FILE_SERVER_BASE_URL", None)
    monkeypatch.setattr(grpc_backend, "BACKEND_GRPC_ADDR", "192.0.2.10:50051")
    monkeypatch.setattr(map_import, "REGISTRY", map_import.ImportRegistry())
    app = FastAPI()
    app.include_router(jobs.router)
    app.dependency_overrides[get_db] = lambda: FakeDB()
    with TestClient(app) as c:
        yield c


def test_post_starts_an_import_and_get_reports_it(client, monkeypatch):
    sess = session("http://localhost:8000")
    sent = []
    monkeypatch.setattr(jobs, "call_grpc", lambda m, p, timeout=30.0, addr=None: (sent.append((m, p)), sess)[1])
    gate = threading.Event()
    monkeypatch.setattr(map_import, "import_session",
                        lambda plan, progress: (gate.wait(5), {"imagery": {"id": "i"}, "field": {}, "files": {}, "refreshed": False})[1])
    r = client.post(f"/api/jobs/{SID}/import", json={"field_name": "Sawah Uji"})
    assert r.status_code == 202 and r.json()["state"] == "running" and r.json()["field_name"] == "Sawah Uji"
    assert sent == [("/soerogis.MappingJobService/GetJob", {"session_id": SID})]
    assert client.get(f"/api/jobs/{SID}/import").json()["state"] == "running"
    gate.set()
    assert wait_for(lambda: client.get(f"/api/jobs/{SID}/import").json()["state"] == "done")


def test_post_refuses_unready_sessions_and_bad_input(client, monkeypatch):
    monkeypatch.setattr(jobs, "call_grpc", lambda *a, **k: session("http://x", status="failed"))
    assert client.post(f"/api/jobs/{SID}/import").status_code == 409
    assert client.post("/api/jobs/bad%20id/import").status_code == 400
    monkeypatch.setattr(jobs, "call_grpc", lambda *a, **k: session("http://x"))
    assert client.post(f"/api/jobs/{SID}/import", json={"field_name": 5}).status_code == 400


def test_get_for_a_never_imported_session_is_none(client):
    assert client.get(f"/api/jobs/{SID}/import").json() == {"state": "none", "session_id": SID}


def test_normalize_session_now_forwards_ndvi_tif(monkeypatch):
    monkeypatch.setattr(grpc_backend, "FILE_SERVER_BASE_URL", None)
    monkeypatch.setattr(grpc_backend, "BACKEND_GRPC_ADDR", "192.0.2.10:50051")
    out = grpc_backend.normalize_session({"artifacts": {"ndvi_tif": "http://localhost:8000/sessions/a/ndvi.tif"}})
    assert out["artifacts"]["ndvi_tif"] == "http://192.0.2.10:8000/sessions/a/ndvi.tif"
    assert grpc_backend.normalize_session({"artifacts": {}})["artifacts"]["ndvi_tif"] is None
