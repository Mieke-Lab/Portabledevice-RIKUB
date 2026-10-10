"""Jaga Padi - pywebview shell.

Thin native-window wrapper around the app that's already served by
rikub-backend.service (FastAPI + built SPA). Unlike the old app.py (pre-web-
migration), this does NOT run its own Flask server - the backend already
serves everything on :8000, so this just opens a window pointing at it.

Loopback (127.0.0.1, not the LAN/Tailscale URL) is used deliberately: it's
always reachable regardless of which network the Pi is on. The backend only
serves HTTPS (needed for navigator.geolocation on the Maps page), and its
cert is self-signed, so WebKitGTK would otherwise refuse the connection
("Connection terminated unexpectedly") - `add_tls_cert` tells it to trust
this one cert for 127.0.0.1 specifically (not a blanket TLS-errors bypass).

Run:
    python3 webview_launcher.py                # windowed
    python3 webview_launcher.py --fullscreen   # kiosk
"""
import argparse
import fcntl
import os
import ssl
import time
import urllib.request

# Must be set before WebKit initializes: without it, the Pi 5's GPU-accelerated
# compositing path renders corrupted colored noise instead of the page
# (a known WebKitGTK/VideoCore issue) - falls back to software compositing.
os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")

import webview
from webview.platforms.gtk import BrowserView, add_tls_cert

URL = "https://127.0.0.1:8000"
CERTFILE = "/home/pi/rikub-project/certs/cert.pem"

# Single-instance guard: a second launch (a manual start, or a systemd restart
# racing a stray) would open another fullscreen window on the same compositor and
# make the app look frozen (two stacked windows fighting for input). Hold an
# exclusive flock for the whole process lifetime; a duplicate that can't take it
# exits immediately instead of stacking. _lock_handle is module-global so the fd
# (and thus the lock) survives until the process ends.
_LOCK_PATH = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "jaga-padi-kiosk.lock")
_lock_handle = None


def acquire_single_instance_lock():
    global _lock_handle
    _lock_handle = open(_LOCK_PATH, "w")
    try:
        fcntl.flock(_lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("Jaga Padi kiosk already running; this duplicate will exit.", flush=True)
        raise SystemExit(0)

# Fullscreen kiosk mode has no title bar/close button - without this, closing
# the window means SSH in and `pkill -f webview_launcher.py`. Esc calls back
# into Python via pywebview's js_api bridge to destroy the window cleanly.
_EXIT_KEY_SCRIPT = """
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { window.pywebview.api.exit_app(); }
});
"""


class Api:
    def exit_app(self):
        window.destroy()


def _allow_permissions(_webview_widget, request):
    # WebKitGTK denies camera/mic/geolocation by default unless the embedding
    # app explicitly grants it here. Safe to auto-allow unconditionally: this
    # window only ever navigates within our own trusted app (127.0.0.1),
    # never third-party pages, so there's no untrusted origin to gate.
    request.allow()
    return True


def wait_for_backend(timeout=15):
    ctx = ssl._create_unverified_context()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"{URL}/health", timeout=2, context=ctx)
            return
        except Exception:
            time.sleep(0.5)


def main():
    global window
    parser = argparse.ArgumentParser(description="Jaga Padi pywebview shell")
    parser.add_argument("--fullscreen", action="store_true", help="kiosk fullscreen")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args()

    acquire_single_instance_lock()
    wait_for_backend()
    add_tls_cert(CERTFILE)
    window = webview.create_window(
        "Jaga Padi",
        URL,
        width=args.width,
        height=args.height,
        fullscreen=args.fullscreen,
        text_select=False,
        js_api=Api(),
    )
    window.events.loaded += lambda: window.run_js(_EXIT_KEY_SCRIPT)

    def _wire_permissions():
        BrowserView.instances[window.uid].webview.connect("permission-request", _allow_permissions)

    window.events.loaded += _wire_permissions
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()
