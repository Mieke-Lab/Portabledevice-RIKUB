import json
import os
import re
from typing import Any
from urllib.parse import urlparse

import grpc
from fastapi import HTTPException, Request

BACKEND_GRPC_ADDR = os.getenv("BACKEND_GRPC_ADDR")
FILE_SERVER_BASE_URL = os.getenv("FILE_SERVER_BASE_URL")
DEFAULT_GRPC_PORT = "50051"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}

_clients: dict[str, grpc.Channel] = {}


def sanitize_grpc_addr(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    value = re.sub(r"^[a-z][a-z0-9+.-]*://", "", value, flags=re.I)
    value = value.split("/", 1)[0].replace(" ", "")
    if not value:
        return None
    host, sep, port = value.rpartition(":")
    if not sep:
        host, port = value, DEFAULT_GRPC_PORT
    if not host or not re.fullmatch(r"[a-zA-Z0-9._-]+", host):
        return None
    if port and not port.isdigit():
        return None
    return f"{host}:{port or DEFAULT_GRPC_PORT}"


def drone_addr_from_request(request: Request) -> str:
    return sanitize_grpc_addr(request.headers.get("x-drone-addr")) or BACKEND_GRPC_ADDR


def _channel(addr: str) -> grpc.Channel:
    channel = _clients.get(addr)
    if channel is None:
        channel = grpc.insecure_channel(addr)
        _clients[addr] = channel
    return channel


def grpc_to_http_status(err: grpc.RpcError) -> int:
    return {
        grpc.StatusCode.INVALID_ARGUMENT: 400,
        grpc.StatusCode.NOT_FOUND: 404,
        grpc.StatusCode.FAILED_PRECONDITION: 409,
        grpc.StatusCode.DEADLINE_EXCEEDED: 504,
        grpc.StatusCode.UNAVAILABLE: 503,
    }.get(err.code(), 500)


def grpc_message(err: Exception) -> str:
    details = getattr(err, "details", None)
    if callable(details):
        text = details()
        if text:
            return text
    return str(err) or "backend error"


def call_grpc(method: str, payload: Any, timeout: float = 30.0, addr: str | None = None) -> Any:
    fn = _channel(addr or BACKEND_GRPC_ADDR).unary_unary(
        method,
        request_serializer=lambda data: json.dumps(data or {}).encode("utf-8"),
        response_deserializer=lambda data: json.loads(data.decode("utf-8") or "{}"),
    )
    try:
        return fn(payload or {}, timeout=timeout)
    except grpc.RpcError as exc:
        raise HTTPException(status_code=grpc_to_http_status(exc), detail=grpc_message(exc)) from exc


def reachable_artifact_url(url: str | None) -> str | None:
    if not url:
        return url
    try:
        parsed = urlparse(url)
        if FILE_SERVER_BASE_URL:
            base = urlparse(FILE_SERVER_BASE_URL)
            parsed = parsed._replace(scheme=base.scheme, netloc=base.netloc)
        elif parsed.hostname in LOOPBACK_HOSTS:
            backend_host = BACKEND_GRPC_ADDR.split(":", 1)[0]
            if backend_host not in LOOPBACK_HOSTS:
                host, _, port = BACKEND_GRPC_ADDR.partition(":")
                parsed = parsed._replace(netloc=f"{host}:{parsed.port or port or DEFAULT_GRPC_PORT}")
        return parsed.geturl()
    except Exception:
        return url


def normalize_session(job: dict[str, Any]) -> dict[str, Any]:
    # Only `artifacts` is rewritten (file-server URLs → a host the browser can
    # reach); everything else — including the `capture` flight-state block of a
    # drone-flown session — passes through untouched via **job.
    artifacts = job.get("artifacts")
    if not isinstance(artifacts, dict):
        return job
    return {
        **job,
        "artifacts": {
            "raw_dir": reachable_artifact_url(artifacts.get("raw_dir")) or artifacts.get("raw_dir"),
            "stitched_tif": reachable_artifact_url(artifacts.get("stitched_tif")),
            "clusters_kml": reachable_artifact_url(artifacts.get("clusters_kml")),
            "processed_dir": reachable_artifact_url(artifacts.get("processed_dir")),
        },
    }
