import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import chatbot_proxy

# Captured before any monkeypatch so the mock client factory can build a real
# AsyncClient without recursing into the patched attribute.
_RealAsyncClient = httpx.AsyncClient


def _client_factory(handler):
    transport = httpx.MockTransport(handler)

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return _RealAsyncClient(*args, transport=transport, **kwargs)

    return factory


@pytest.fixture(autouse=True)
def fresh_upstream_lock():
    # The module-level asyncio.Lock is loop-bound on first use; give each test a
    # fresh one so it binds to that test's TestClient event loop, not a dead one.
    chatbot_proxy._upstream_lock = asyncio.Lock()
    yield


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(chatbot_proxy.router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mock_upstream(monkeypatch):
    def _set(handler):
        monkeypatch.setattr(chatbot_proxy.httpx, "AsyncClient", _client_factory(handler))

    return _set


def test_chat_success_passes_through_status_and_body(client, mock_upstream):
    upstream_body = {
        "ok": True,
        "prediksi": {"hama": "wereng", "narasi_gemma": "Penjelasan grounded."},
        "mode": "chat",
    }
    mock_upstream(lambda request: httpx.Response(200, json=upstream_body))

    response = client.post("/api/chat", json={"query": "kenapa daun padi menguning"})

    assert response.status_code == 200
    assert response.json() == upstream_body


def test_chat_forwards_query_body_to_upstream_chat_path(client, mock_upstream):
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "prediksi": {"narasi_gemma": "x"}})

    mock_upstream(handler)

    client.post("/api/chat", json={"query": "gejala hawar daun"})

    assert captured["body"] == {"query": "gejala hawar daun"}
    assert captured["url"].endswith("/api/chat")


def test_chat_passes_through_non_200_upstream_status(client, mock_upstream):
    mock_upstream(lambda request: httpx.Response(422, json={"detail": "invalid"}))

    response = client.post("/api/chat", json={"query": "x"})

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid"}


def test_returns_502_when_upstream_unreachable(client, mock_upstream):
    def handler(request):
        raise httpx.ConnectError("connection refused")

    mock_upstream(handler)

    response = client.post("/api/chat", json={"query": "x"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert isinstance(body["message"], str) and body["message"]


def test_returns_504_when_upstream_times_out(client, mock_upstream):
    def handler(request):
        raise httpx.ReadTimeout("timed out")

    mock_upstream(handler)

    response = client.post("/api/chat", json={"query": "x"})

    assert response.status_code == 504
    body = response.json()
    assert body["ok"] is False
    assert isinstance(body["message"], str) and body["message"]


def test_returns_502_without_leaking_stack_trace_on_unexpected_error(client, mock_upstream):
    def handler(request):
        raise ValueError("internal boom detail")

    mock_upstream(handler)

    response = client.post("/api/chat", json={"query": "x"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert isinstance(body["message"], str) and body["message"]
    assert "boom" not in body["message"]


def test_parameter_forwards_string_typed_fields_to_upstream(client, mock_upstream):
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "prediksi": {"narasi_gemma": "x"}})

    mock_upstream(handler)

    payload = {"gejala": "daun menguning", "suhu": "30", "kelembapan": "80", "pH": "6.5"}
    response = client.post("/api/parameter", json=payload)

    assert response.status_code == 200
    assert captured["body"] == payload
    assert captured["url"].endswith("/api/parameter")


def test_parameter_returns_502_when_upstream_unreachable(client, mock_upstream):
    def handler(request):
        raise httpx.ConnectError("connection refused")

    mock_upstream(handler)

    response = client.post(
        "/api/parameter",
        json={"gejala": "x", "suhu": "30", "kelembapan": "80", "pH": "6.5"},
    )

    assert response.status_code == 502
    assert response.json()["ok"] is False
