"""HTTP hardening for the Jaga Padi backend: a conservative same-origin CORS policy,
security response headers, and an in-memory rate limiter guarding the expensive,
single-concurrency /api/chat and /api/parameter proxy endpoints.

The app runs as one uvicorn worker (single process, single event loop) served directly
over HTTPS with no reverse proxy in front, so plain in-memory rate-limit state is enough
(no Redis) and request.client.host is the real client IP (X-Forwarded-For would be
spoofable here, so it is deliberately ignored)."""

import os
import time
from collections import deque

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware

# The Pi's LAN IP has changed several times in this project (only the Tailscale IP is
# stable), so the origin list is overridable via CORS_ALLOWED_ORIGINS (comma-separated)
# without a code change. The frontend is served same-origin by this very app, so these
# are simply the URLs the app is actually reachable at — a wildcard would be meaningless
# protection. Defaults, in order: LAN, Tailscale, loopback (IP), loopback (name).
_DEFAULT_ALLOWED_ORIGINS = (
    "https://10.68.184.10:8000,"
    "https://100.64.85.33:8000,"
    "https://127.0.0.1:8000,"
    "https://localhost:8000"
)


def _allowed_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS", _DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


# Applied to every response. geolocation stays enabled for `self` because the Maps page
# uses navigator.geolocation; camera/microphone are denied outright. HSTS omits `preload`
# on purpose — this is a self-signed cert on a private IP that must never be submitted to
# the browser HSTS preload list.
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

# /api/chat and /api/parameter forward to a swap-backed Gemma model on the Jetson that
# handles ONE request at a time and takes 1.5-3+ min each. A per-IP sliding window caps
# abuse (a buggy retry loop, a script) without hurting real use: 4 requests / 600s is
# generous — a human waiting 1.5-3 min per reply cannot realistically exceed it, but a
# runaway loop trips it almost immediately. Only these POSTs (and /api/agent/*) are limited.
_RATE_LIMITED_PATHS = frozenset({"/api/chat", "/api/parameter"})
# Every agent POST (new case, follow-up, /pesan) is also a Gemma call on the Jetson and
# shares the same per-IP budget.
_RATE_LIMITED_PREFIX = "/api/agent/"
_RATE_LIMIT_MAX_REQUESTS = 4
_RATE_LIMIT_WINDOW_SECONDS = 600.0
_RATE_LIMIT_MESSAGE = {
    "ok": False,
    "message": "Terlalu banyak permintaan, coba lagi nanti.",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Sets baseline security headers on every response, overriding any weaker value a
    route might have set so the policy is always enforced."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        for key, value in _SECURITY_HEADERS.items():
            response.headers[key] = value
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory per-client-IP sliding-window limiter for the expensive chatbot proxy
    endpoints. State is a small dict of recent-hit timestamps; the private LAN/Tailscale
    client set is tiny and stale entries are pruned on access, so it stays bounded."""

    def __init__(self, app) -> None:
        super().__init__(app)
        self._hits: dict[str, deque] = {}

    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method == "POST" and (path in _RATE_LIMITED_PATHS or path.startswith(_RATE_LIMITED_PREFIX)):
            client = request.client.host if request.client else "unknown"
            now = time.monotonic()
            cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
            window = self._hits.get(client, deque())
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= _RATE_LIMIT_MAX_REQUESTS:
                retry_after = max(int(window[0] + _RATE_LIMIT_WINDOW_SECONDS - now) + 1, 1)
                self._hits[client] = window
                return JSONResponse(
                    status_code=429,
                    content=_RATE_LIMIT_MESSAGE,
                    headers={"Retry-After": str(retry_after)},
                )
            window.append(now)
            self._hits[client] = window
        return await call_next(request)


def add_security_middleware(app: FastAPI) -> None:
    """Register CORS, security headers, and rate limiting on the app.

    Order matters: add_middleware prepends, so the last call is the outermost layer.
    CORS is outermost (handles preflight and tags every response), security headers sit
    in the middle (so even a 429 gets them), and the rate limiter is innermost."""
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_credentials=False,  # no cookies/auth on this API, so credentials stay off
        allow_methods=["*"],
        allow_headers=["*"],
    )
