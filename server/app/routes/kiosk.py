"""Close the on-device kiosk window (the app icon's Chromium or pywebview window).

Chromium in --kiosk mode can't close itself from JavaScript (window.close() only works
for script-opened windows), so the menu's "Keluar" button asks the backend, which runs
as the same user, to terminate the kiosk processes. Loopback-only: a browser on the
LAN/Tailscale must never be able to shut the Pi's own screen.
"""

import logging
import os
import signal
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status

router = APIRouter(prefix="/api/kiosk", tags=["kiosk"])
logger = logging.getLogger("kiosk")

LOOPBACK = {"127.0.0.1", "::1"}
KIOSK_PROFILE_ARG = "--user-data-dir=/home/pi/.config/jaga-padi-kiosk"
CHROMIUM_NAMES = {"chromium", "chromium-browser", "chrome"}


def _is_kiosk(argv: list[str]) -> bool:
    """Match on the program itself and whole arguments - never on a substring of the
    command line, or any shell/editor/grep whose text merely mentions the kiosk would
    be killed too (happened while testing)."""
    if not argv:
        return False
    prog = Path(argv[0]).name
    if prog in CHROMIUM_NAMES:
        return KIOSK_PROFILE_ARG in argv[1:]
    if prog.startswith("python"):
        return any(Path(a).name == "webview_launcher.py" for a in argv[1:2])
    return False


def _kiosk_pids() -> list[int]:
    pids = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit() or int(proc.name) == os.getpid():
            continue
        try:
            argv = [a.decode(errors="replace") for a in (proc / "cmdline").read_bytes().split(b"\0") if a]
        except OSError:
            continue  # process exited or isn't readable
        if len(argv) == 1 and " " in argv[0]:
            # Chromium rewrites its process title: the whole command line becomes one
            # space-joined string instead of NUL-separated argv entries.
            argv = argv[0].split()
        if _is_kiosk(argv):
            pids.append(int(proc.name))
    return pids


@router.post("/exit")
async def exit_kiosk(request: Request):
    if request.client is None or request.client.host not in LOOPBACK:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hanya dari layar perangkat.")
    pids = _kiosk_pids()
    if not pids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jendela kiosk tidak ditemukan.")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)  # graceful: Chromium/pywebview shut down cleanly
        except ProcessLookupError:
            pass
    logger.info("kiosk exit requested, SIGTERM sent to %s", pids)
    return {"ok": True, "closed": len(pids)}
