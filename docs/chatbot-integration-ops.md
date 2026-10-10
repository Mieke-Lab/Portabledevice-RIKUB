# Chatbot Integration Operations Runbook

Operations guide for the Jaga Padi pest/disease chatbot. This feature lets the web app
ask questions about rice pests and diseases and get an Indonesian, evidence-grounded
answer from a local Gemma LLM. The LLM does **not** run on the Raspberry Pi — it runs on
a separate Jetson Orin NX device, reached over a Tailscale VPN. The Pi only proxies.

Read this before restarting anything, changing IPs, or "fixing" what looks like a missing
feature — several apparent gaps here are deliberate decisions, documented at the end.

## Architecture

```txt
Browser (phone/laptop)
  https://100.64.85.33:8000  (self-signed TLS, secure context)
        |
        |  fetch POST /api/chat  or  /api/parameter   (same-origin, HTTPS)
        v
Raspberry Pi 5  (this repo, /home/pi/rikub-project)
  FastAPI + uvicorn on port 8000, served over self-signed HTTPS
  app/routes/chatbot_proxy.py  <-- server-side proxy
        |
        |  server-to-server POST (plain HTTP), over Tailscale
        |  CHATBOT_UPSTREAM_URL, default http://100.116.176.70:5000
        v
Jetson Orin NX  (hostname jetson-desktop / jetson-orin, Tailscale IP 100.116.176.70)
  hama-padi-chat.service  ->  sistem_llm_hama_padi_light_baru.py  (FastAPI, port 5000)
  retrieval (embeddings + TF-IDF over a curated pest/disease CSV)
        |
        v
  Ollama  ->  model gemma4:e2b  (~7.2 GB, swap-backed)
  narrates the retrieved evidence in Indonesian, strictly grounded to it
```

Two machines, two roles:

- **Raspberry Pi** serves the web app and proxies chat calls. It never runs the LLM.
- **Jetson Orin NX** does retrieval and runs Gemma via Ollama. It is the slow, memory-
  constrained part of the system.

## Why the proxy exists (mixed-content, not CORS)

The Pi's frontend is served over **HTTPS** with a self-signed certificate. HTTPS is
required so `navigator.geolocation` works on the Maps page — browsers only expose the
Geolocation API in a "secure context".

The Jetson's chat service is plain **HTTP** (no TLS). If the browser tried to fetch the
Jetson directly, it would be an HTTPS page requesting an HTTP resource. Browsers block
this as **mixed content** and surface a generic `NetworkError when attempting to fetch
resource` — with no useful detail.

The fix is `app/routes/chatbot_proxy.py`: the browser calls the Pi (HTTPS, same origin),
and the **Pi** calls the Jetson (HTTP, server-to-server). Mixed-content rules are a
browser-only policy and do not apply to server-to-server calls, so the HTTP hop is fine.

This is **not** a CORS workaround. It specifically solves browser mixed-content blocking
of HTTPS-page-to-HTTP-resource fetches. Do not "simplify" it away by pointing the frontend
straight at the Jetson — that reintroduces the block.

## The memory constraint (why answers take minutes)

The Jetson has only ~7.2 GB of usable RAM. Gemma `gemma4:e2b` (5.1B params, Q4_K_M, ~7 GB
of weights) needs nearly all of it. It is a multimodal model, so its vision and audio
towers load on every call even though this pipeline is 100% text — wasted footprint that
made things worse.

Loading Gemma repeatedly triggered the Linux **OOM-killer** (confirmed in `dmesg`:
`Out of memory: Killed process ... (ollama)`), crashing the service.

Keeping Gemma was a hard requirement (no swapping to a smaller model was acceptable), so
the fix was a **12 GB swap file** at `/swapfile` on the Jetson, persisted in
`/etc/fstab`:

```txt
/swapfile none swap sw 0 0
```

Consequences you must design and operate around:

- **Each answer takes roughly 1.5-3+ minutes** (~25 s to load the model, plus swap-
  thrashed generation). This is expected, not a hang.
- **The Jetson serves ONE Gemma request at a time.** Two concurrent inferences spike
  memory and risk re-triggering the OOM-killer.
- The Jetson script's internal Ollama timeout was raised from 90 s to 300 s
  (`ollama_generate(..., timeout=300)`) to accommodate this.
- The Pi proxy uses a matching **300 s** httpx timeout (`CHATBOT_PROXY_TIMEOUT`) and
  serializes upstream calls so it never sends two inferences at once — late requests
  queue and wait their turn rather than being rejected.

Do not "optimize" by removing the swap file or firing parallel requests. Both bring back
the OOM crashes.

## Request / response contracts

Both endpoints are served by the Pi proxy and forwarded verbatim to the Jetson. The
frontend must talk to the Pi, never the Jetson directly.

### POST /api/chat

Free-text question.

Request body:

```json
{ "query": "kenapa daun padi menguning?" }
```

### POST /api/parameter

Symptom + environment parameters. **Gotcha (easy to break):** every numeric-looking field
must be sent as a **string**, and the humidity/acidity field is **`pH`** with a capital H
(not `ph`). The Jetson's pydantic model types all four fields as `str`; sending numbers or
misspelling `pH` will fail validation upstream.

Request body:

```json
{
  "gejala": "daun menguning dan ada bercak coklat",
  "suhu": "30",
  "kelembapan": "80",
  "pH": "6.5"
}
```

- `gejala` — symptom description (string)
- `suhu` — temperature, **string** (e.g. `"30"`, not `30`)
- `kelembapan` — humidity, **string**
- `pH` — soil/water acidity, **string**, **capital H**

### Response shape (both endpoints)

On success the Jetson nests everything under a `prediksi` key. The narrative text lives at
`prediksi.narasi_gemma`, **not** at the top level (a previous frontend bug read
`data.narasi_gemma` instead of `data.prediksi.narasi_gemma`).

```json
{
  "ok": true,
  "prediksi": {
    "hama": "wereng batang coklat",
    "narasi_gemma": "Penjelasan berbasis bukti dalam Bahasa Indonesia...",
    "pencegahan": "...",
    "pengendalian": {
      "jenis": "...",
      "bahan_aktif": ["..."],
      "contoh_produk": ["..."],
      "catatan": "..."
    }
  },
  "mode": "chat",
  "lora": { }
}
```

The proxy passes the upstream status code and JSON body through unchanged. When the
upstream is unreachable or slow, the proxy returns a clean error envelope instead of a
stack trace:

- Upstream unreachable -> HTTP **502**, body `{ "ok": false, "message": "..." }`
- Upstream timeout -> HTTP **504**, body `{ "ok": false, "message": "..." }`
- Any other upstream error -> HTTP **502**, body `{ "ok": false, "message": "..." }`

The `message` is a safe, user-facing Indonesian string; internal error detail is logged on
the Pi (see `server/uvicorn.log`) and never returned to the client.

## Restarting each side

### Raspberry Pi (this repo)

From `/home/pi/rikub-project`:

```bash
./stop.sh
./start.sh
```

**Footgun:** `stop.sh` may use `pkill -f "uvicorn main:app"`. If you run that pattern by
hand from a shell whose own command line contains the string `uvicorn main:app`, `pkill`
matches its own process and can kill your session. To stop the backend manually and safely,
find the real PID and kill it by number:

```bash
pgrep -af "uvicorn main:app"    # list matching PIDs + full command lines
kill <pid>                      # kill the actual uvicorn process, not your shell
```

### Jetson Orin NX (over SSH / Tailscale)

```bash
# Restart the chat service (retrieval + Ollama call wrapper)
sudo systemctl restart hama-padi-chat.service

# Restart Ollama itself only if the model server needs a reset
sudo systemctl restart ollama.service

# Check health of both
sudo systemctl status hama-padi-chat.service ollama.service

# Recent logs from both
sudo journalctl -u hama-padi-chat -u ollama -n 50 --no-pager
```

The Jetson chat service file is
`/home/jetson/sistem-hama-padi/sistem_llm_hama_padi_light_baru.py`.

## Verifying end-to-end health

```bash
# Pi backend + database (DB check)
curl -sk https://127.0.0.1:8000/health

# Jetson reachability from the Pi (does NOT load Gemma; safe to poll)
curl -sk https://127.0.0.1:8000/api/chat/health
```

`GET /api/chat/health` returns `{ "reachable": <bool>, "queue_depth": <int> }`. It probes
the Jetson's static Swagger page rather than running an inference, so it stays fast even
while a 1.5-3 min answer is in flight and never triggers an OOM.

> TODO: confirm `/api/chat/health` is live. If a `curl` to it 404s, the health endpoint
> may not be deployed yet on the running instance — restart the Pi backend (`./stop.sh`
> then `./start.sh`) to pick up the latest `chatbot_proxy.py`, then re-check.

A full functional test (slow — expect minutes):

```bash
curl -sk -X POST https://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query":"kenapa daun padi menguning?"}'
```

## Known gotchas

### Self-signed certificate name mismatch

The HTTPS cert lives at `/home/pi/rikub-project/certs/cert.pem` and
`/home/pi/rikub-project/certs/key.pem`. Its Subject Alternative Name (SAN) must list the
Pi's current **LAN IP** and its **Tailscale IP `100.64.85.33`**.

If the Pi's LAN IP changes, the cert must be **regenerated** with the new LAN IP (plus the
Tailscale IP) in the SAN. Otherwise the browser shows a certificate name-mismatch warning
**on top of** the usual self-signed warning.

The Tailscale IP never changes, so give users the durable link:

```txt
https://100.64.85.33:8000
```

### Response narrative is nested

Read the answer text at `data.prediksi.narasi_gemma`, not `data.narasi_gemma`. See the
response shape above.

## Intentional decisions — do not silently "fix"

These are deliberate choices for a private LAN / Tailscale deployment, not oversights.
Check with the project owner before changing either:

- **No authentication on the API.** Access is restricted at the network layer (private
  LAN + Tailscale). Auth was intentionally left out. Do not bolt on tokens/login without
  confirming it is wanted.
- **No systemd autostart for the Pi backend.** Startup is manual via `start.sh` /
  `stop.sh` by design. The Pi backend is deliberately **not** enabled to auto-start at
  boot. Do not add a systemd unit to "fix" this without checking first.

(The Jetson side is different: `hama-padi-chat.service` and `ollama.service` are systemd
units and do autostart — that is expected.)
