import asyncio
import itertools
import logging
import os
import re
import sys
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

CHATBOT_UPSTREAM_URL = os.getenv("CHATBOT_UPSTREAM_URL", "http://100.116.176.70:5000")
# Gemma runs swap-backed on the Jetson (8GB RAM); a single reply can take 1.5-3+ min.
CHATBOT_PROXY_TIMEOUT = 300.0
# Health probe hits /docs (a static Swagger page), so keep it short and snappy.
CHATBOT_HEALTH_TIMEOUT = 5.0
# Agent reads (case list/detail) never touch Gemma.
CHATBOT_READ_TIMEOUT = 15.0
# Agent case ids are the Jetson vault note names, e.g. 20260923-194301-ec78dd.
_CASE_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")

# Self-contained logger: uvicorn's default config leaves the root logger without a
# handler, so INFO lines from a propagating logger would be dropped. Attach our own
# stderr handler (captured by uvicorn.log) and stop propagation to avoid double logs.
logger = logging.getLogger("chatbot_proxy")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# The Jetson can only serve ONE Gemma inference at a time; two concurrent calls spike
# memory and can OOM-kill ollama. A plain asyncio.Lock serializes upstream calls: this
# runs under a single uvicorn worker (one event loop), so no distributed lock is needed.
# Late arrivals await the lock and take their turn — queueing, not rejecting, is honest
# behavior since the Jetson genuinely processes requests one at a time.
_upstream_lock = asyncio.Lock()
_request_ids = itertools.count(1)


class _InflightCounter:
    """Counts proxy requests currently held (waiting for the lock + the one talking to
    Ollama), so /api/chat/health can report an accurate queue_depth."""

    def __init__(self) -> None:
        self.count = 0

    def __enter__(self) -> "_InflightCounter":
        self.count += 1
        return self

    def __exit__(self, *exc: object) -> bool:
        self.count -= 1
        return False


_inflight = _InflightCounter()


async def _proxy_post(path: str, body: dict) -> JSONResponse:
    req_id = next(_request_ids)
    with _inflight:
        logger.info(
            "[req %d] received path=%s queue_depth=%d", req_id, path, _inflight.count
        )
        arrived = time.monotonic()
        async with _upstream_lock:
            waited = time.monotonic() - arrived
            logger.info("[req %d] upstream start path=%s waited=%.1fs", req_id, path, waited)
            started = time.monotonic()
            try:
                # Timeout covers only the actual Ollama call, not the queue wait: a
                # request queued behind another 1.5-3 min inference must not fail merely
                # for waiting its turn, so the clock starts once the lock is acquired.
                async with httpx.AsyncClient(timeout=CHATBOT_PROXY_TIMEOUT) as client:
                    upstream = await client.post(
                        f"{CHATBOT_UPSTREAM_URL}{path}", json=body
                    )
                duration = time.monotonic() - started
                logger.info(
                    "[req %d] completed path=%s status=%d duration=%.1fs",
                    req_id,
                    path,
                    upstream.status_code,
                    duration,
                )
                return JSONResponse(
                    status_code=upstream.status_code, content=upstream.json()
                )
            except httpx.TimeoutException:
                logger.warning(
                    "[req %d] failed path=%s error=timeout after=%.1fs",
                    req_id,
                    path,
                    time.monotonic() - started,
                )
                return JSONResponse(
                    status_code=504,
                    content={"ok": False, "message": "Chatbot service tidak merespon (timeout)."},
                )
            except httpx.ConnectError:
                logger.warning("[req %d] failed path=%s error=connect", req_id, path)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "message": "Chatbot service tidak dapat dihubungi."},
                )
            except Exception:  # noqa: BLE001 -- never leak a stack trace to the client
                logger.exception("[req %d] failed path=%s error=unexpected", req_id, path)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "message": "Chatbot service mengalami kesalahan tak terduga."},
                )


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    """Read-only agent calls (case list/detail, health): no Gemma involved, so they skip
    the upstream lock and use a short timeout - they stay fast while an answer is running."""
    try:
        async with httpx.AsyncClient(timeout=CHATBOT_READ_TIMEOUT) as client:
            upstream = await client.get(f"{CHATBOT_UPSTREAM_URL}{path}", params=params)
        return JSONResponse(status_code=upstream.status_code, content=upstream.json())
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={"ok": False, "message": "Chatbot service tidak merespon (timeout)."})
    except httpx.ConnectError:
        return JSONResponse(status_code=502, content={"ok": False, "message": "Chatbot service tidak dapat dihubungi."})
    except Exception:  # noqa: BLE001
        logger.exception("agent GET failed path=%s", path)
        return JSONResponse(status_code=502, content={"ok": False, "message": "Chatbot service mengalami kesalahan tak terduga."})


def _case_id_ok(case_id: str) -> bool:
    return bool(_CASE_ID_RE.match(case_id or ""))


@router.post("/api/chat")
async def proxy_chat(request: Request) -> JSONResponse:
    return await _proxy_post("/api/chat", await request.json())


@router.post("/api/parameter")
async def proxy_parameter(request: Request) -> JSONResponse:
    return await _proxy_post("/api/parameter", await request.json())


# --- Interactive agent (Jetson agent_api.py: diagnosis + follow-up + Obsidian memory) ---
# Every POST runs Gemma on the Jetson, so it goes through the same one-at-a-time lock
# and rate limit as /api/chat.


@router.post("/api/agent/pesan")
async def proxy_agent_message(request: Request) -> JSONResponse:
    """One chat box: a question about the active case -> follow-up, else new diagnosis."""
    return await _proxy_post("/api/agent/pesan", await request.json())


@router.post("/api/agent/kasus")
async def proxy_agent_new_case(request: Request) -> JSONResponse:
    """New case from symptoms (+ optional suhu/kelembapan/pH = parameter mode)."""
    return await _proxy_post("/api/agent/kasus", await request.json())


@router.post("/api/agent/kasus/{case_id}/tanya")
async def proxy_agent_ask(case_id: str, request: Request) -> JSONResponse:
    if not _case_id_ok(case_id):
        return JSONResponse(status_code=400, content={"ok": False, "message": "case_id tidak valid"})
    return await _proxy_post(f"/api/agent/kasus/{case_id}/tanya", await request.json())


@router.get("/api/agent/kasus")
async def proxy_agent_cases(limit: int = 20) -> JSONResponse:
    return await _proxy_get("/api/agent/kasus", {"limit": max(1, min(limit, 200))})


@router.get("/api/agent/kasus/{case_id}")
async def proxy_agent_case(case_id: str) -> JSONResponse:
    if not _case_id_ok(case_id):
        return JSONResponse(status_code=400, content={"ok": False, "message": "case_id tidak valid"})
    return await _proxy_get(f"/api/agent/kasus/{case_id}")


@router.get("/api/agent/health")
async def proxy_agent_health() -> JSONResponse:
    return await _proxy_get("/api/agent/health")


@router.get("/api/chat/health")
async def chat_health() -> JSONResponse:
    # Probe /docs (static Swagger page) instead of /api/chat so a health check never
    # loads the swap-backed Gemma model. This does NOT take the lock, so it stays fast
    # even while an inference is in flight and reports queue_depth truthfully.
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=CHATBOT_HEALTH_TIMEOUT) as client:
            resp = await client.get(f"{CHATBOT_UPSTREAM_URL}/docs")
        # Any HTTP answer (even 404) means the service is up; only 5xx counts as down.
        reachable = resp.status_code < 500
    except httpx.HTTPError:
        reachable = False
    except Exception:  # noqa: BLE001 -- health must never raise
        logger.exception("health probe error")
        reachable = False
    return JSONResponse(content={"reachable": reachable, "queue_depth": _inflight.count})
