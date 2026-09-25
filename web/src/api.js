// API client for the Python AI services. Chat/parameter/detect are all proxied
// same-origin through this backend (chatbot_proxy.py → Jetson Gemma;
// detection_proxy.py → local CV fusion microservice), so the HTTPS kiosk never
// calls plain HTTP directly (avoids mixed-content blocking).

const CHATBOT = '';
const TIMEOUT = 30000;
const DETECT_TIMEOUT = 45000; // CV inference ~1-2s; kept above the backend proxy's 30s
const CHATBOT_TIMEOUT = 300000; // Gemma runs swap-backed on the Jetson (8GB RAM); can take 1.5-3+ min

async function request(url, options = {}, timeout = TIMEOUT, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!res.ok) {
      // Prefer the server's own message (e.g. the 429 rate-limit text or the Jetson
      // proxy's "tidak dapat dihubungi") over a bare status line.
      const body = await res.json().catch(() => null);
      const detail = body?.message || (typeof body?.detail === 'string' ? body.detail : null);
      throw new Error(detail || `HTTP Error ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      // Distinguish a caller-initiated cancel from the internal timeout so the
      // UI can react differently (silent cancel vs. "server still busy" hint).
      if (externalSignal?.aborted) {
        const cancelErr = new Error('Dibatalkan oleh pengguna.');
        cancelErr.name = 'AbortError';
        throw cancelErr;
      }
      const timeoutErr = new Error('Request timeout. Server tidak merespon.');
      timeoutErr.timeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

// The Jetson RAG service returns a rich diagnosis object nested under
// `prediksi` (prediksi.narasi_gemma, prediksi.pencegahan, prediksi.pengendalian,
// ...), not a plain {response}/{analysis} shape. Flatten it into text so
// callers get a readable message instead of a raw JSON dump.
export function summarizeDiagnosis(data) {
  const prediksi = data?.prediksi;
  const parts = [];
  if (prediksi?.narasi_gemma) parts.push(prediksi.narasi_gemma);
  const rec = prediksi?.pengendalian;
  if (rec) {
    const bahan = Array.isArray(rec.bahan_aktif) ? rec.bahan_aktif.join(', ') : '';
    const produk = Array.isArray(rec.contoh_produk) ? rec.contoh_produk.join(', ') : '';
    parts.push(
      `🛡️ Pengendalian (${rec.jenis || '-'}): ${bahan}${produk ? ` — contoh: ${produk}` : ''}`,
    );
  }
  return parts.join('\n\n') || 'Tidak ada respons dari sistem.';
}

function diagnosisRecommendations(data) {
  const prediksi = data?.prediksi;
  const recs = [];
  if (prediksi?.pencegahan) recs.push(`Pencegahan: ${prediksi.pencegahan}`);
  const rec = prediksi?.pengendalian;
  if (rec?.bahan_aktif?.length) recs.push(`Bahan aktif: ${rec.bahan_aktif.join(', ')}`);
  if (rec?.contoh_produk?.length) recs.push(`Contoh produk: ${rec.contoh_produk.join(', ')}`);
  if (rec?.catatan) recs.push(rec.catatan);
  return recs;
}

export function sendChatMessage(message, { signal } = {}) {
  return request(
    `${CHATBOT}/api/chat`,
    { method: 'POST', body: JSON.stringify({ query: message }) },
    CHATBOT_TIMEOUT,
    signal,
  ).then((data) => ({ response: summarizeDiagnosis(data), raw: data }));
}

export function analyzeParameters({ gejala, suhu, kelembapan, ph, pH }, { signal } = {}) {
  return request(
    `${CHATBOT}/api/parameter`,
    {
      method: 'POST',
      body: JSON.stringify({
        gejala,
        suhu: String(suhu ?? ''),
        kelembapan: String(kelembapan ?? ''),
        pH: String(pH ?? ph ?? ''),
      }),
    },
    CHATBOT_TIMEOUT,
    signal,
  ).then((data) => ({
    analysis: data?.prediksi?.narasi_gemma || `Prediksi: ${data?.prediksi?.hama || '-'}`,
    recommendations: diagnosisRecommendations(data),
    raw: data,
  }));
}

// Chat session/message history, persisted server-side (Postgres) instead of
// browser localStorage — WebKitGTK inside the pywebview kiosk does not
// reliably keep localStorage across process restarts, so history vanished
// every time the kiosk window was closed and reopened.
// --- Interactive agent on the Jetson (agent_api.py), through the Pi proxy -------------
// A conversation revolves around one *case*: the first message is diagnosed exactly like
// /api/chat, later questions ("obatnya apa?") are answered about that same case, grounded
// on the diagnosis + the Obsidian knowledge vault + the chat so far. Each case is also a
// Markdown note in the Jetson's vault.

// One chat box, routed by the agent itself: a question while a case is active -> follow-up,
// anything else -> new diagnosis. Response: {intent: 'diagnosa' | 'tanya', case_id, ...}.
export function agentMessage({ teks, caseId }, { signal } = {}) {
  return request(
    '/api/agent/pesan',
    { method: 'POST', body: JSON.stringify({ teks, case_id: caseId || null }) },
    CHATBOT_TIMEOUT,
    signal,
  );
}

// New case from the parameter panel (symptoms + suhu/kelembapan/pH, sent as strings).
export function agentNewCase({ gejala, suhu, kelembapan, ph }, { signal } = {}) {
  return request(
    '/api/agent/kasus',
    {
      method: 'POST',
      body: JSON.stringify({
        gejala,
        suhu: String(suhu ?? ''),
        kelembapan: String(kelembapan ?? ''),
        pH: String(ph ?? ''),
      }),
    },
    CHATBOT_TIMEOUT,
    signal,
  );
}

// Compact, render-ready payloads stored with the chat message (chat_messages.meta), so
// history re-renders the same cards without asking the Jetson again.
export function agentDiagnosisMeta(r) {
  const p = r?.diagnosis?.prediksi || {};
  return {
    kind: 'diagnosis',
    case_id: r?.case_id,
    mode: r?.kasus?.mode,
    hama: p.hama,
    label_keyakinan: p.label_keyakinan,
    skor: p.skor,
    narasi: p.narasi_gemma || null,
    pencegahan: p.pencegahan || null,
    pengendalian: p.pengendalian || null,
    gejala_serupa: Array.isArray(p.contoh_gejala_serupa) ? p.contoh_gejala_serupa.slice(0, 3) : [],
    catatan: r?.kasus?.catatan || null,
  };
}

export function agentFollowupMeta(r) {
  return {
    kind: 'followup',
    case_id: r?.case_id,
    ditolak: !!r?.ditolak,
    pengetahuan: Array.isArray(r?.pengetahuan) ? r.pengetahuan : [],
  };
}

export function listChatSessions() {
  return request('/api/chat/sessions?include_messages=true');
}

export function createChatSession() {
  return request('/api/chat/sessions', { method: 'POST' });
}

export function updateChatSession(sessionId, { agentCaseId }) {
  return request(`/api/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ agent_case_id: agentCaseId ?? null }),
  });
}

export function addChatMessage(sessionId, { sender, text, isError = false, meta = null }) {
  return request(`/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ sender, text, is_error: isError, meta }),
  });
}

export async function deleteChatSession(sessionId) {
  const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
}

// Recent saved detections (newest first) from the disease_detections table.
export async function listDetections(limit = 50) {
  const res = await fetch(`/api/detections?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Persist a "Perdalam via AI" result onto the detection row AND the LLM chat history.
// Returns {ok, session_id}: the deepening is also saved as a chat session (Riwayat), which
// continues the agent case when agentCaseId is given.
export async function saveDetectionNarrative(id, prompt, narrative, { meta = null, agentCaseId = null } = {}) {
  const res = await fetch(`/api/detections/${id}/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, narrative, meta, agent_case_id: agentCaseId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Attach a detection to a GIS spray zone (target_detections). The server auto-updates
// the zone's chamber from its detections. Used by the map's "Deteksi HPT" flow, where a
// polygon_id rides along in the /detection URL. Payload: { disease_name, chamber,
// confidence?, sample_lat?, sample_lng?, image_path? }.
export async function addTargetDetection(polygonId, payload) {
  const res = await fetch(`/polygons/${encodeURIComponent(polygonId)}/detections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Runs the rice-disease CV+soil fusion model (Pi, via same-origin /api/detect).
// The backend injects the LIVE soil reading server-side, so the caller only sends
// the image (+ optional lat/lng from camera mode). Returns the model's multi-label
// shape: { classes:[{name,p_img,p_final,gate,present}], present:[names],
// top:{name,p_final}, used_soil, timing_ms }.
export async function detectDisease(imageFile, { lat, lng, source, polygonId, zoneCode } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT);
  try {
    const form = new FormData();
    form.append('image', imageFile);
    if (lat != null) form.append('lat', lat);
    if (lng != null) form.append('lng', lng);
    if (source) form.append('source', source); // 'camera' | 'upload' — recorded in the DB
    // GIS "Deteksi HPT" flow: the server links the result to this spray zone (target_detections).
    if (polygonId) form.append('polygon_id', polygonId);
    if (zoneCode) form.append('zone_code', zoneCode);
    const res = await fetch('/api/detect', { method: 'POST', body: form, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `HTTP Error ${res.status}: ${res.statusText}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timeout. Server tidak merespon.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Manual camera tuning for the 'Siang Terik Sawah' preset (server/app/camera_tuning.py).
// Errors carry the backend's own message (e.g. unsupported control, camera missing).
async function cameraCall(path, body) {
  const res = await fetch(`/api/camera${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

export const getCameraTuning = () => cameraCall('/tuning');
export const setCameraTuning = (values) => cameraCall('/tuning', values);
// Every camera control back to its default + preview 20 fps (camera_tuning.reset_defaults).
export const resetCameraDefaults = () => cameraCall('/tuning/reset', {});
export const saveCameraPreset = () => cameraCall('/preset/save', {});
export const loadCameraPreset = () => cameraCall('/preset/load', {});
export const getCameraMetrics = () => cameraCall('/metrics');
