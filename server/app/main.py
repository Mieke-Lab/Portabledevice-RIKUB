from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import app.db.models  # noqa: F401
from app.routes.camera import router as camera_router
from app.routes.chat_history import router as chat_history_router
from app.routes.chatbot_proxy import router as chatbot_proxy_router
from app.routes.detection_proxy import router as detection_proxy_router
from app.routes.drone import router as drone_router
from app.routes.fields import imagery_router, polygon_router, router as fields_router
from app.routes.health import router as health_router
from app.routes.jobs import router as jobs_router
from app.routes.kiosk import router as kiosk_router
from app.routes.manual_zones import imagery_router as manual_zones_imagery_router
from app.routes.manual_zones import polygon_router as manual_zones_polygon_router
from app.routes.sensor import router as sensor_router, start_reader
from app.security import add_security_middleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_reader()  # begin reading the soil sensor's UART stream in the background
    yield


app = FastAPI(lifespan=lifespan)
add_security_middleware(app)
app.include_router(health_router)
app.include_router(fields_router)
app.include_router(imagery_router)
app.include_router(polygon_router)
app.include_router(drone_router)
app.include_router(jobs_router)
app.include_router(chatbot_proxy_router)
app.include_router(chat_history_router)
app.include_router(camera_router)
app.include_router(sensor_router)
app.include_router(detection_proxy_router)
app.include_router(kiosk_router)
app.include_router(manual_zones_imagery_router)
app.include_router(manual_zones_polygon_router)
app.mount(
    "/imagery",
    StaticFiles(directory=Path(__file__).resolve().parents[1] / "storage" / "imagery"),
    name="imagery",
)
app.mount(
    "/detections",
    StaticFiles(directory=Path(__file__).resolve().parents[1] / "storage" / "detections"),
    name="detections",
)
# Self-serve utilities (e.g. the Coral Edge TPU compile notebook + weights) so they can
# be grabbed from a browser. html=True serves downloads/index.html at /downloads/.
app.mount(
    "/downloads",
    StaticFiles(directory=Path(__file__).resolve().parents[2] / "downloads", html=True),
    name="downloads",
)


# Built React SPA (web/dist). parents[2] == project root.
DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


# Serve the built SPA. MUST stay the LAST route so API routers and the
# /imagery, /detections mounts (registered above) win first. Real files under
# dist are served directly; anything else falls back to index.html so that
# client-side (react-router) routes like /maps, /menu survive refresh/deep-link.
@app.get("/{full_path:path}")
async def spa(full_path: str):
    target = (DIST / full_path).resolve()
    if target.is_file() and DIST.resolve() in target.parents and target.name != "index.html":
        # Hashed, content-addressed assets (index-<hash>.js/css) are immutable — cache freely.
        return FileResponse(target)
    # index.html / client-side routes: NEVER cache. The WebKitGTK kiosk keeps a persistent
    # on-disk cache and, without this, pins a stale index.html that points at an old bundle —
    # so a rebuilt SPA never reaches the screen no matter how often the kiosk is relaunched.
    return FileResponse(
        DIST / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"},
    )
