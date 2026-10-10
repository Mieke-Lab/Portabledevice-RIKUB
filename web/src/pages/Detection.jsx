import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ScanSearch, Upload, Camera, Sprout, Leaf,
  FlaskConical, Droplets, Thermometer, Zap, CheckCircle2, AlertTriangle,
  MapPin, MapPinOff, Wifi, WifiOff, Loader2, Sparkles, Maximize2, Minimize2, RotateCcw,
  Target, MapPinned, MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  detectDisease, saveDetectionNarrative, resetCameraDefaults,
  agentNewCase, agentDiagnosisMeta, summarizeDiagnosis,
  createChatSession, addChatMessage, updateChatSession,
} from '@/api';
import { CameraTuningPanel } from '@/components/detection/CameraTuningPanel';
import { CameraIndicators } from '@/components/detection/CameraIndicators';

// The CV model returns only class names + probabilities. Descriptions and
// treatment come from this static map (offline, instant) — keyed by the model's
// EXACT case-sensitive class names (note "Bercak-Cokelat-Sempit" vs "bercak-Cokelat").
const DISEASE_INFO = {
  'Hawar-Daun': {
    nama: 'Hawar Daun Bakteri',
    deskripsi: 'Infeksi bakteri Xanthomonas — daun mengering dari ujung/tepi, bergaris kuning-cokelat memanjang.',
    penanganan: 'Gunakan varietas tahan, kurangi pupuk N berlebih, perbaiki drainase, hindari lukai daun. Sanitasi tanaman sakit.',
  },
  Blast: {
    nama: 'Blas (Blast)',
    deskripsi: 'Jamur Pyricularia — bercak belah ketupat abu-abu bertepi cokelat pada daun; bisa menyerang leher malai.',
    penanganan: 'Varietas tahan, jangan kelebihan N, jaga air stabil. Fungisida (trisiklazol) saat tekanan tinggi/fase rentan.',
  },
  'Bercak-Cokelat-Sempit': {
    nama: 'Bercak Cokelat Sempit',
    deskripsi: 'Cercospora — bercak cokelat sempit memanjang sejajar tulang daun, umum pada tanah kurang subur/K rendah.',
    penanganan: 'Pemupukan berimbang (cukup K), varietas tahan, sanitasi jerami. Fungisida bila parah.',
  },
  'bercak-Cokelat': {
    nama: 'Bercak Cokelat',
    deskripsi: 'Bipolaris (Brown Spot) — bintik cokelat bulat/oval, tanda khas tanah miskin hara (terutama K & Si).',
    penanganan: 'Perbaiki kesuburan tanah (K, Si), benih sehat & perlakuan benih, pengairan cukup. Fungisida bila perlu.',
  },
  'Busuk-Pelepah': {
    nama: 'Busuk Pelepah',
    deskripsi: 'Rhizoctonia (Sheath blight) — bercak abu-abu kehijauan di pelepah dekat permukaan air, menjalar ke atas.',
    penanganan: 'Kurangi kerapatan tanam & N berlebih, jaga aerasi, drainase baik. Fungisida (validamisin/azoksistrobin) bila parah.',
  },
  'Busuk-Bulir': {
    nama: 'Busuk Bulir',
    deskripsi: 'Pembusukan/perubahan warna gabah oleh kompleks jamur-bakteri, sering saat lembap tinggi menjelang panen.',
    penanganan: 'Tanam serempak, varietas tahan, hindari kelembapan berlebih, panen tepat waktu, keringkan gabah segera.',
  },
  'Gosong-Palsu': {
    nama: 'Gosong Palsu (False Smut)',
    deskripsi: 'Ustilaginoidea — bulir berubah jadi bola spora hijau-kuning lalu hitam; dipicu N tinggi & cuaca lembap saat berbunga.',
    penanganan: 'Kurangi N akhir, varietas tahan, sanitasi bulir terinfeksi. Fungisida preventif menjelang fase berbunga bila endemik.',
  },
};

function prettyDisease(name) {
  return DISEASE_INFO[name]?.nama || (name ? name.replace(/-/g, ' ') : name);
}

// The Jetson LLM is a SYMPTOM->pest classifier (TF-IDF over a `Gejala` corpus), not a
// "given-disease advisor" — sending the disease NAME makes it re-classify (often wrong,
// and soil text steers it worse). Workaround: translate the detected disease into the KB's
// OWN symptom phrasing so the classifier lands on the right class and returns relevant
// narasi + pengendalian. Symptoms below are taken from the LLM's data_hama_sederhana.csv.
// Only the 5 CV classes present in the LLM KB are mapped; the other 2 (Busuk-Bulir,
// Gosong-Palsu) are not KB-covered, so the AI-deepen button is hidden for them.
// Soil is deliberately NOT sent (it misled the classifier; the KB advice is disease-based,
// and the live soil is already shown separately in the UI).
const DISEASE_SYMPTOMS = {
  Blast: 'Muncul bercak kecil berbentuk belah ketupat berwarna abu-abu dengan tepi coklat kemerahan. Serangan pada leher malai membuat malai mengering dan mudah patah.',
  'Hawar-Daun': 'Daun menguning dari ujung ke bawah seperti terbakar air panas. Bila digunting dan diremas keluar lendir kekuningan eksudat bakteri. Bercak panjang dimulai dari tepi daun berwarna hijau pucat lalu coklat.',
  'Busuk-Pelepah': 'Muncul bercak coklat keabu-abuan memanjang di pangkal pelepah bagian bawah. Jaringan pelepah lunak berbau khas busuk mudah robek bila ditekan.',
  'bercak-Cokelat': 'Bercak kecil bulat berwarna coklat gelap muncul di daun bawah. Pusat bercak menjadi abu-abu pucat dikelilingi halo kuning tipis. Bercak berkembang menjadi lonjong 2-10 mm sering bergabung.',
  'Bercak-Cokelat-Sempit': 'Bercak kecil coklat memanjang sempit sejajar tulang daun. Pusat bercak abu-abu pucat dikelilingi halo kuning tipis muncul di daun bawah pada tanah kurang subur.',
};

// The symptom-text query to send the LLM for the top detected disease, or null when that
// disease is not covered by the LLM knowledge base (so the deepen button stays hidden).
function buildSymptomQuery(result) {
  return result?.top ? (DISEASE_SYMPTOMS[result.top.name] || null) : null;
}

// --- Presentation helpers for the diagnosis card ----------------------------------

// The model's probability is calibrated but a bare "100%" reads as certainty; say it in words.
function confidenceLabel(p) {
  if (p >= 0.9) return 'sangat tinggi';
  if (p >= 0.75) return 'tinggi';
  if (p >= 0.5) return 'sedang';
  return 'rendah';
}

// Lesion share of the leaf, from the detector's masks (cv_service lesion_percent). A rough,
// indicative scale - measured on everything plant-coloured in the photo.
const SEVERITY_LEVELS = [
  { max: 5, label: 'ringan', tone: 'bg-leaf/12 text-forest' },
  { max: 25, label: 'sedang', tone: 'bg-harvest/15 text-harvest' },
  { max: Infinity, label: 'berat', tone: 'bg-destructive/10 text-destructive' },
];
function severityOf(pct) {
  return pct == null ? null : SEVERITY_LEVELS.find((l) => pct < l.max);
}

// The LLM dataset writes advice as one unpunctuated run of imperatives ("Gunakan benih sehat
// pupuk seimbang sanitasi jerami rotasi tanaman"). Split it into items before each action
// word, except right after another action word ("hindari tanam tumpang tindih") or when the
// word would stand alone at the end ("atur jarak tanam"). Text that already has separators
// is split on those instead.
const ADVICE_STARTERS = new Set([
  'gunakan', 'tanam', 'rotasi', 'hindari', 'drainase', 'sanitasi', 'pupuk', 'benamkan',
  'olah', 'bersihkan', 'perbaiki', 'kendalikan', 'atur', 'jaga', 'kurangi', 'cabut',
  'musnahkan', 'pasang', 'lakukan', 'pantau',
]);
function splitAdvice(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (/[;\n]|\.\s|,\s/.test(t)) {
    return t.split(/;|\n|\.\s+|,\s+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean).map(cap);
  }
  const words = t.split(/\s+/);
  const items = [];
  let cur = [];
  words.forEach((w, i) => {
    const lw = w.toLowerCase();
    const prev = (words[i - 1] || '').toLowerCase();
    const isStarter =
      (ADVICE_STARTERS.has(lw) || (lw === 'air' && /^\d/.test(words[i + 1] || ''))) &&
      i > 0 && i < words.length - 1 && !ADVICE_STARTERS.has(prev);
    if (isStarter && cur.length) { items.push(cur.join(' ')); cur = []; }
    cur.push(w);
  });
  if (cur.length) items.push(cur.join(' '));
  return items.map(cap);
}

// narasi_gemma comes as labelled lines ("Prediksi: …", "Alasan berbasis evidence RAG: …",
// "Pencegahan: …", "Catatan: …"). Keep only the reasoning: the prediction repeats the card
// title, prevention/control are rendered from the structured fields, and the "Catatan" line
// is a fixed disclaimer. Unlabelled free text (a plain Gemma answer) is kept whole.
function narasiReason(narasi) {
  const lines = String(narasi || '').split('\n');
  const sections = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]{2,40}):\s*(.*)$/);
    if (m) sections.push({ label: m[1].trim().toLowerCase(), text: m[2].trim() });
    else if (line.trim()) {
      if (sections.length) sections[sections.length - 1].text += ` ${line.trim()}`;
      else sections.push({ label: '', text: line.trim() });
    }
  }
  if (!sections.some((x) => x.label)) return String(narasi || '').trim();
  return sections.filter((x) => x.label.startsWith('alasan') || x.label === '').map((x) => x.text).join('\n');
}

// Live soil sensor: an ESP32 streams packets over the Pi's UART, the backend
// parses them and computes LOW/OK/HIGH status per parameter against literature
// thresholds for rice (server/app/routes/sensor.py). We just poll + render.
const SENSOR_ICONS = {
  moisture: Droplets, temp: Thermometer, ec: Zap,
  ph: FlaskConical, n: Leaf, p: FlaskConical, k: Sprout,
};
const STATUS = {
  ok: { label: 'Optimal', tone: 'bg-leaf/12 text-forest' },
  low: { label: 'Rendah', tone: 'bg-harvest/15 text-harvest' },
  high: { label: 'Tinggi', tone: 'bg-destructive/10 text-destructive' },
  na: { label: '—', tone: 'bg-muted text-muted-foreground' },
};

function fmtValue(key, v) {
  if (v == null) return '—';
  if (key === 'ph' || key === 'temp') return v.toFixed(1);
  return String(Math.round(v));
}

// Polls /api/sensor/latest once per second. Chained setTimeout (not setInterval)
// so a slow response never lets requests pile up. Keeps the last good snapshot
// on a transient fetch error; the `connected` flag reflects staleness.
function useSoilSensor(pollMs = 1000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer;
    async function tick() {
      try {
        const res = await fetch('/api/sensor/latest', { cache: 'no-store' });
        if (res.ok && alive) setData(await res.json());
      } catch { /* keep last snapshot */ }
      if (alive) timer = setTimeout(tick, pollMs);
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [pollMs]);
  return data;
}

// Live location while camera mode is open. Uses watchPosition (not a single
// getCurrentPosition) so the freshest fix is already on hand the instant the
// shutter is pressed, rather than waiting on a fix to resolve at click time.
function useLiveLocation(active) {
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | locating | ok | error

  useEffect(() => {
    if (!active || !navigator.geolocation) {
      if (!navigator.geolocation) setStatus('error');
      return;
    }
    setStatus('locating');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setStatus('ok');
      },
      () => setStatus('error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active]);

  return { location, status };
}

function LocationBadge({ status, location }) {
  if (status === 'ok' && location) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-leaf/12 px-2 py-0.5 text-[11px] font-semibold text-forest">
        <MapPin className="h-3 w-3" />
        {location.lat.toFixed(5)}, {location.lng.toFixed(5)} (±{Math.round(location.accuracy)}m)
      </span>
    );
  }
  if (status === 'locating') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        <MapPin className="h-3 w-3 animate-pulse" /> Mencari lokasi…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      <MapPinOff className="h-3 w-3" /> Lokasi tidak tersedia
    </span>
  );
}

export function Detection() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Arrived from the GIS map's "Deteksi HPT" button? Then a spray zone rides along and every
  // detected disease is linked back to it (target_detections), which sets the zone's chamber.
  const polygonId = searchParams.get('polygon_id') || null;
  const zoneCode = searchParams.get('zone_code') || null;
  const inZoneMode = !!polygonId;

  const [mode, setMode] = useState('upload');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState({ state: 'idle' });
  const [streaming, setStreaming] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedLocation, setCapturedLocation] = useState(null);
  const [camMax, setCamMax] = useState(false); // fullscreen (maximize) view in camera mode
  const [maskOverlay, setMaskOverlay] = useState(false); // leaf-mask overlay on the preview only
  const streamSrc = `/api/camera/stream${maskOverlay ? '?overlay=1' : ''}`;
  const [cameraReset, setCameraReset] = useState({ state: 'idle', n: 0 }); // idle|busy|done|error
  const [zoneSave, setZoneSave] = useState({ state: 'idle' }); // idle|saving|saved|empty|error
  const fileRef = useRef(null);
  const fileObj = useRef(null);

  // In the field, coming from a zone means the farmer wants to photograph that zone —
  // default to the camera tab (does not auto-start the stream).
  useEffect(() => { if (inZoneMode) setMode('camera'); }, [inZoneMode]);

  // Geolocation is ALWAYS active (from page load, both modes) — the coordinate is
  // mandatory on every detection. The hook keeps the last good fix even if it later drops.
  const { location: liveLocation, status: locationStatus } = useLiveLocation(true);

  const sensor = useSoilSensor();
  const sensorConnected = !!sensor?.connected;
  const readings = sensor?.readings ?? [];
  const issues = sensorConnected
    ? readings.filter((r) => r.status === 'low' || r.status === 'high')
    : [];

  // The live preview and the still capture both come from the backend
  // (server/app/routes/camera.py), not the browser's getUserMedia: WebKitGTK
  // inside the pywebview kiosk cannot read this USB webcam at all (confirmed
  // GStreamer caps-negotiation bug - the exact same device works perfectly
  // via a raw GStreamer pipeline outside the browser). The <img> below is an
  // MJPEG stream (multipart/x-mixed-replace); "Jepret" asks the server for a
  // single fresh frame instead of drawing the <img> to a canvas.
  function stopCamera() {
    setStreaming(false);
    setCameraError(null);
    setCamMax(false); // never leave the fullscreen overlay open once the stream stops
  }

  function toggleCamera() {
    setCameraError(null);
    setStreaming((v) => !v);
  }

  function switchMode(next) {
    if (mode === 'camera' && next !== 'camera') stopCamera();
    setMode(next);
  }

  // One tap back to a known state: every camera control to its default, preview at the
  // default 20 fps, mask overlay off. The preset panel is remounted so its sliders
  // show the reset values too. A saved preset stays on disk.
  async function resetCamera() {
    setCameraReset((r) => ({ ...r, state: 'busy' }));
    try {
      await resetCameraDefaults();
      setMaskOverlay(false);
      setCameraReset((r) => ({ state: 'done', n: r.n + 1 }));
    } catch (err) {
      setCameraReset((r) => ({ ...r, state: 'error', message: err.message }));
    }
    setTimeout(() => setCameraReset((r) => (r.state === 'busy' ? r : { ...r, state: 'idle' })), 2500);
  }

  async function capturePhoto() {
    setCapturing(true);
    try {
      const res = await fetch('/api/camera/capture', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      fileObj.current = blob;
      setPreview(URL.createObjectURL(blob));
      setCapturedLocation(liveLocation); // freeze whatever fix we have at capture time
      setResult({ state: 'ready' });
      stopCamera();
    } catch (err) {
      setCameraError(err.message || 'Gagal mengambil foto dari kamera.');
    } finally {
      setCapturing(false);
    }
  }

  function onPick(e) {
    const file = e.target.files[0];
    if (!file) return;
    fileObj.current = file;
    setCapturedLocation(null); // a file picked from storage carries no live GPS fix
    const reader = new FileReader();
    reader.onload = (ev) => { setPreview(ev.target.result); setResult({ state: 'ready' }); };
    reader.readAsDataURL(file);
  }

  async function run() {
    if (!fileObj.current) return;
    setResult({ state: 'loading' });
    if (inZoneMode) setZoneSave({ state: 'idle' });
    try {
      // Best-known location for BOTH modes: camera freezes it at capture, upload uses the
      // live fix. If the browser has no fix (e.g. the Pi kiosk), the backend falls back to
      // the ESP32 sensor GPS, so a coordinate is recorded whenever any source has a fix.
      const loc = capturedLocation || liveLocation;
      if (inZoneMode) setZoneSave({ state: 'saving' });
      const r = await detectDisease(fileObj.current, {
        ...(loc ? { lat: loc.lat, lng: loc.lng } : {}),
        source: mode, // 'camera' | 'upload' — persisted with the detection
        ...(inZoneMode ? { polygonId, zoneCode } : {}), // server links the result to this spray zone
      });
      const present = Array.isArray(r.present) ? r.present : [];
      setResult({
        state: 'ok',
        present,
        classes: Array.isArray(r.classes) ? r.classes : [],
        top: r.top || null,
        disease: present.length ? r.top?.name : null, // top is global max; if any present it's one of them
        confidence: r.top?.p_final ?? 0,
        usedSoil: !!r.used_soil,
        overlay: r.overlay_b64 || null, // YOLO-seg mask overlay (JPEG base64), null if nothing localized
        nDetections: r.n_detections ?? null,
        lesionPercent: r.lesion_percent ?? null, // % of the leaf under the detector's masks
        detectionId: r.detection_id || null, // DB row id, to attach the AI narrative later
      });

      // GIS "Deteksi HPT": the backend already linked this result to the spray zone
      // (target_detections) and recomputed its chamber, in the SAME /api/detect request.
      // Reflect the outcome it reported back in r.zone_linked — no fragile second call.
      if (inZoneMode) {
        const zl = r.zone_linked;
        if (zl?.ok && zl.count > 0) setZoneSave({ state: 'saved', count: zl.count });
        else if (zl?.ok) setZoneSave({ state: 'empty' });
        else setZoneSave({ state: 'error', message: zl?.reason || 'zona tidak tertaut' });
      }
    } catch (err) {
      setResult({ state: 'error', message: err.message });
      // Detection failed, so nothing reached the zone - drop the "saving…" banner
      // instead of leaving it spinning forever.
      if (inZoneMode) setZoneSave({ state: 'idle' });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/menu')}><ArrowLeft className="h-4 w-4" /> Menu</Button>
        <div className="flex items-center gap-2"><ScanSearch className="h-5 w-5 text-harvest" strokeWidth={1.9} /><span className="font-bold tracking-tight text-forest">Deteksi Penyakit Padi</span></div>
        {sensorConnected ? (
          <span className="hidden items-center gap-1.5 rounded-full bg-leaf/12 px-2.5 py-1 text-xs font-semibold text-forest sm:inline-flex"><Wifi className="h-3.5 w-3.5" /><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> sensor live</span>
        ) : (
          <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground sm:inline-flex"><WifiOff className="h-3.5 w-3.5" /> sensor terputus</span>
        )}
      </header>

      {inZoneMode && (
        <div className="mx-auto mb-4 w-full max-w-6xl">
          <div className="flex items-center gap-3 rounded-2xl border border-harvest/30 bg-harvest/10 px-4 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-harvest/20 text-harvest">
              <Target className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-forest">Deteksi untuk Zona {zoneCode || '—'}</p>
              <p className="text-xs text-muted-foreground">Hasil deteksi otomatis disimpan ke zona ini di peta &amp; menentukan chamber semprot drone.</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => navigate('/maps')}>
              <ArrowLeft className="h-4 w-4" /> Peta
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-2">
        {/* Image capture */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-forest">1 · Citra Daun</h3>
            <div className="flex gap-1.5 rounded-full bg-muted p-1">
              <button onClick={() => switchMode('upload')} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mode === 'upload' ? 'bg-card text-forest shadow-sm' : 'text-muted-foreground'}`}><Upload className="mr-1 inline h-3.5 w-3.5" />Upload</button>
              <button onClick={() => switchMode('camera')} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mode === 'camera' ? 'bg-card text-forest shadow-sm' : 'text-muted-foreground'}`}><Camera className="mr-1 inline h-3.5 w-3.5" />Kamera</button>
            </div>
          </div>

          {mode === 'upload' ? (
            <>
              <div className={`grid aspect-video w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed ${preview ? 'border-harvest/40' : 'border-border'} bg-muted/40 text-center text-sm text-muted-foreground`}>
                {preview ? <img src={preview} alt="Preview" className="h-full w-full object-contain" /> : <span>📷<br /><br />Pilih gambar daun padi</span>}
              </div>
              <Button variant="outline" className="w-full" onClick={() => fileRef.current.click()}><Upload className="h-4 w-4" /> Pilih Gambar</Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
            </>
          ) : (
            <>
              <div className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl bg-muted/40 text-center text-sm text-muted-foreground">
                {preview && !streaming ? (
                  <img src={preview} alt="Hasil jepretan" className="h-full w-full object-contain" />
                ) : streaming && camMax ? (
                  // Feed is showing in the fullscreen overlay below; keep only ONE
                  // MJPEG stream open at a time (the backend camera is single-reader).
                  <span>🔍<br /><br />Tampilan layar penuh aktif</span>
                ) : streaming ? (
                  // Live MJPEG feed from the backend (server/app/routes/camera.py) -
                  // the browser's own camera API can't read this webcam, see note above.
                  <img src={streamSrc} alt="Live kamera" className="h-full w-full object-cover" />
                ) : (
                  <span>📹<br /><br />{cameraError || 'Kamera belum aktif'}</span>
                )}
                {streaming && !camMax && (
                  <>
                    <div className="absolute bottom-2 left-2">
                      <LocationBadge status={locationStatus} location={liveLocation} />
                    </div>
                    <button
                      type="button"
                      onClick={resetCamera}
                      disabled={cameraReset.state === 'busy'}
                      title={cameraReset.state === 'error' ? cameraReset.message : 'Kembalikan semua pengaturan kamera ke default (20 fps)'}
                      className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors ${cameraReset.state === 'error' ? 'bg-red-600/80' : 'bg-black/55 hover:bg-black/70'}`}
                    >
                      {cameraReset.state === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {cameraReset.state === 'busy' ? 'Mereset…' : cameraReset.state === 'done' ? 'Default ✓' : cameraReset.state === 'error' ? 'Gagal reset' : 'Reset kamera'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCamMax(true)}
                      title="Perbesar (layar penuh)"
                      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/70"
                    >
                      <Maximize2 className="h-4 w-4" /> Perbesar
                    </button>
                  </>
                )}
              </div>
              {streaming ? (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={stopCamera} disabled={capturing}>Batal</Button>
                  <Button variant="accent" className="flex-1" onClick={capturePhoto} disabled={capturing}><Camera className="h-4 w-4" /> {capturing ? 'Memotret…' : 'Jepret'}</Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full" onClick={toggleCamera}><Camera className="h-4 w-4" /> Mulai Kamera</Button>
              )}
              {!streaming && capturedLocation && (
                <LocationBadge status="ok" location={capturedLocation} />
              )}
              {streaming && <CameraIndicators overlay={maskOverlay} onOverlayChange={setMaskOverlay} />}
              {streaming && <CameraTuningPanel key={cameraReset.n} />}
            </>
          )}
        </Card>

        {/* Soil sensors — live, auto-updating every second */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-forest">2 · Parameter Tanah</h3>
            {sensorConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-leaf">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <WifiOff className="h-3.5 w-3.5" /> Menunggu sensor…
              </span>
            )}
          </div>
          {readings.length === 0 ? (
            <div className="grid place-items-center py-8 text-center text-sm text-muted-foreground">
              <WifiOff className="mb-2 h-6 w-6" />
              Sensor tanah belum mengirim data. Pastikan alat terhubung.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {readings.map((r) => {
                const Icon = SENSOR_ICONS[r.key] ?? FlaskConical;
                const st = STATUS[r.status] ?? STATUS.na;
                return (
                  <div key={r.key} className="rounded-xl border border-border bg-background/60 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {r.label}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-foreground">{fmtValue(r.key, r.value)}<span className="ml-0.5 text-xs font-medium text-muted-foreground">{r.unit}</span></div>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.tone}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          {sensor?.gps?.fix && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" /> GPS sensor: {sensor.gps.lat.toFixed(5)}, {sensor.gps.lon.toFixed(5)} · {sensor.gps.sat} satelit
            </p>
          )}
        </Card>
      </div>

      {/* Combined diagnosis */}
      <div className="mx-auto mt-4 w-full max-w-6xl">
        <Card className="p-5">
          <h3 className="mb-3 font-bold text-forest">3 · Diagnosis Gabungan</h3>
          <Diagnosis result={result} issues={issues} sensorConnected={sensorConnected} onRun={run} canRun={!!preview} />
        </Card>
      </div>

      {/* GIS zone link status — only when we arrived from the map's "Deteksi HPT" button. */}
      {inZoneMode && zoneSave.state !== 'idle' && (
        <div className="mx-auto mt-4 w-full max-w-6xl">
          <Card className="p-5">
            <ZoneSaveStatus zoneSave={zoneSave} zoneCode={zoneCode} onBack={() => navigate('/maps')} />
          </Card>
        </div>
      )}

      {/* Fullscreen camera view — a fixed CSS overlay (not the browser Fullscreen
          API, which is unreliable in the WebKitGTK kiosk). Gives the whole screen to
          the live feed so the user can aim precisely. Only ONE MJPEG stream is mounted
          at a time (the inline feed shows a placeholder while this is open). */}
      {streaming && camMax && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between gap-3 p-3">
            <LocationBadge status={locationStatus} location={liveLocation} />
            <button
              type="button"
              onClick={() => setCamMax(false)}
              title="Perkecil"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/25"
            >
              <Minimize2 className="h-5 w-5" /> Perkecil
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <img src={streamSrc} alt="Live kamera (layar penuh)" className="h-full w-full object-contain" />
          </div>
          <div className="flex gap-3 p-4">
            <Button variant="outline" className="flex-1 border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={stopCamera} disabled={capturing}>Batal</Button>
            <Button variant="accent" className="flex-1" onClick={capturePhoto} disabled={capturing}>
              <Camera className="h-4 w-4" /> {capturing ? 'Memotret…' : 'Jepret'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SoilContext({ issues, sensorConnected }) {
  if (!sensorConnected) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><WifiOff className="h-4 w-4" /> Menunggu data sensor tanah — hubungkan alat untuk analisis parameter.</p>;
  }
  if (issues.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-forest"><CheckCircle2 className="h-4 w-4" /> Parameter tanah optimal — kondisi mendukung tanaman sehat.</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-harvest"><AlertTriangle className="h-4 w-4" /> Faktor tanah pendukung penyakit:</p>
      <ul className="ml-6 list-disc space-y-1 text-sm text-muted-foreground">
        {issues.map((r) => (
          <li key={r.key}><span className="font-medium text-foreground">{r.label} {r.status === 'low' ? 'rendah' : 'tinggi'}</span> ({fmtValue(r.key, r.value)}{r.unit}) — ideal {r.safe_min}–{r.safe_max}{r.unit}.</li>
        ))}
      </ul>
    </div>
  );
}

function ZoneSaveStatus({ zoneSave, zoneCode, onBack }) {
  const zone = zoneCode || '—';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <MapPinned className="h-3.5 w-3.5" /> Simpan ke Zona {zone}
      </div>
      {zoneSave.state === 'saving' && (
        <p className="flex items-center gap-2 text-sm text-forest"><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan hasil deteksi ke Zona {zone}…</p>
      )}
      {zoneSave.state === 'saved' && (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold text-forest"><CheckCircle2 className="h-4 w-4" /> {zoneSave.count} penyakit tersimpan ke Zona {zone}. Chamber semprot zona diperbarui otomatis.</p>
          <Button variant="accent" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali ke Peta</Button>
        </>
      )}
      {zoneSave.state === 'empty' && (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" /> Tidak ada penyakit terdeteksi — tidak ada yang disimpan ke zona.</p>
          <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali ke Peta</Button>
        </>
      )}
      {zoneSave.state === 'error' && (
        <>
          <p className="text-sm text-destructive">⚠️ Gagal menyimpan ke zona: {zoneSave.message}. Hasil deteksi tetap tersimpan di riwayat.</p>
          <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali ke Peta</Button>
        </>
      )}
    </div>
  );
}

// "Perdalam via AI" result, one source per topic: the model's reasoning (from narasi),
// prevention as a list (dataset text split into items), control from the structured
// fields. Falls back to the plain text if the reply has no structured diagnosis.
function AiDeepen({ ai }) {
  const navigate = useNavigate();
  const p = ai.prediksi;
  if (!p) return <div className="whitespace-pre-wrap rounded-xl border border-leaf/30 bg-leaf/5 p-3 text-sm text-foreground">{ai.text}</div>;
  const reason = narasiReason(p.narasi_gemma);
  const prevention = splitAdvice(p.pencegahan);
  const peng = p.pengendalian || {};
  return (
    <div className="space-y-2.5 rounded-xl border border-leaf/30 bg-leaf/5 p-3 text-sm text-foreground">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-forest"><Sparkles className="h-3.5 w-3.5" /> Pendalaman AI</p>
      {reason && <p className="whitespace-pre-wrap leading-relaxed">{reason}</p>}
      {prevention.length > 0 && (
        <div>
          <p className="font-semibold text-forest">Pencegahan</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">{prevention.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {(peng.jenis || peng.bahan_aktif?.length || peng.contoh_produk?.length || peng.catatan) && (
        <div>
          <p className="font-semibold text-forest">Pengendalian{peng.jenis ? ` · ${peng.jenis}` : ''}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {peng.bahan_aktif?.length > 0 && <li><span className="font-medium">Bahan aktif:</span> {peng.bahan_aktif.join(', ')}</li>}
            {peng.contoh_produk?.length > 0 && <li><span className="font-medium">Contoh produk:</span> {peng.contoh_produk.join(', ')}</li>}
            {peng.catatan && <li>{peng.catatan}</li>}
          </ul>
        </div>
      )}
      {ai.sessionId && (
        <div className="flex flex-wrap items-center gap-2 border-t border-leaf/20 pt-2.5">
          <Button size="sm" onClick={() => navigate(`/chatbot?session=${ai.sessionId}`)}>
            <MessageCircle className="h-4 w-4" /> Lanjutkan tanya di Chatbot
          </Button>
          <span className="text-xs text-muted-foreground">Tanyakan dosis, waktu semprot, atau pencegahan untuk kasus ini.</span>
        </div>
      )}
    </div>
  );
}

function Diagnosis({ result, issues, sensorConnected, onRun, canRun }) {
  const [ai, setAi] = useState({ state: 'idle' });
  // Reset any prior AI narrative whenever a new detection result comes in.
  useEffect(() => { setAi({ state: 'idle' }); }, [result]);

  const top = result.top;
  const info = top ? DISEASE_INFO[top.name] : null;
  const severity = severityOf(result.lesionPercent);

  async function askAI() {
    const query = buildSymptomQuery(result);
    if (!query) return; // disease not covered by the LLM KB
    setAi({ state: 'loading' });
    try {
      // Send the disease's SYMPTOMS (not its name) so the LLM's symptom-classifier agrees
      // with our CV detection and returns relevant narasi + pengendalian. It goes through the
      // Jetson agent, which diagnoses exactly like /api/chat but also opens a *case* - so the
      // conversation can be continued in the Chatbot with follow-up questions.
      const r = await agentNewCase({ gejala: query });
      if (!r?.ok) throw new Error(r?.message || 'Pendalaman AI gagal.');
      const meta = agentDiagnosisMeta(r);
      const text = `Diagnosis: ${meta.hama || '-'}\n\n${summarizeDiagnosis(r.diagnosis)}`;
      setAi({ state: 'ok', text, prediksi: r.diagnosis?.prediksi || null, sessionId: null });

      // Persist to the detection row + a chat session that continues this case (best-effort;
      // never blocks the result). Without a saved detection, build the session directly.
      const prompt = `📷 Pendalaman hasil deteksi foto: ${prettyDisease(top.name)}.\nGejala acuan: ${query}`;
      let sessionId = null;
      try {
        if (result.detectionId) {
          sessionId = (await saveDetectionNarrative(result.detectionId, prompt, text, { meta, agentCaseId: r.case_id }))?.session_id || null;
        }
      } catch { /* fall through to the direct session below */ }
      if (!sessionId) {
        try {
          const s = await createChatSession();
          await addChatMessage(s.id, { sender: 'user', text: prompt });
          await addChatMessage(s.id, { sender: 'bot', text, meta });
          await updateChatSession(s.id, { agentCaseId: r.case_id });
          sessionId = s.id;
        } catch { /* the result stays on screen; only the Chatbot hand-off is unavailable */ }
      }
      setAi((a) => (a.state === 'ok' ? { ...a, sessionId } : a));
    } catch (err) {
      setAi({ state: 'error', text: err.message });
    }
  }

  return (
    <div className="space-y-4">
      {result.state === 'ok' ? (
        <div className="space-y-3">
        {result.present?.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold text-foreground">{prettyDisease(top.name)}</span>
              <span className="rounded-full bg-harvest/15 px-2.5 py-0.5 text-xs font-semibold text-harvest" title={`skor model ${(result.confidence * 100).toFixed(0)}%`}>keyakinan {confidenceLabel(result.confidence)}</span>
              {severity && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${severity.tone}`} title="Dari luas area bercak yang dilingkari detektor dibanding bagian tanaman di foto">
                  keparahan {severity.label} · ±{result.lesionPercent.toFixed(result.lesionPercent < 10 ? 1 : 0)}% daun
                </span>
              )}
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${result.usedSoil ? 'bg-leaf/12 text-forest' : 'bg-muted text-muted-foreground'}`}>
                {result.usedSoil ? '🌱 disesuaikan dengan data tanah' : 'tanpa data tanah'}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-leaf" style={{ width: `${result.confidence * 100}%` }} /></div>
            <p className="text-[11px] text-muted-foreground">
              Hasil model dari foto — cocokkan dengan pengamatan langsung di lapangan.
              {severity && ' Keparahan adalah indikasi dari foto; foto dekat satu daun memberi angka paling akurat.'}
            </p>

            {result.present.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {result.present.map((n) => (
                  <span key={n} className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">{prettyDisease(n)}</span>
                ))}
              </div>
            )}

            {info && (
              <div className="space-y-1.5 rounded-xl border border-border bg-background/60 p-3">
                <p className="text-sm text-muted-foreground">{info.deskripsi}</p>
                {ai.state !== 'ok' && (
                  <p className="text-sm"><span className="font-semibold text-forest">Penanganan:</span> {info.penanganan}</p>
                )}
              </div>
            )}

            {ai.state === 'idle' && buildSymptomQuery(result) && (
              <Button variant="outline" size="sm" onClick={askAI}><Sparkles className="h-4 w-4" /> Perdalam via AI</Button>
            )}
            {ai.state === 'idle' && !buildSymptomQuery(result) && (
              <p className="text-xs text-muted-foreground">Pendalaman via AI belum tersedia untuk penyakit ini (di luar basis pengetahuan LLM).</p>
            )}
            {ai.state === 'loading' && <p className="flex items-center gap-2 text-sm text-forest"><Loader2 className="h-4 w-4 animate-spin" /> Meminta penjelasan AI… (bisa 1–3 menit)</p>}
            {ai.state === 'ok' && <AiDeepen ai={ai} />}
            {ai.state === 'error' && <p className="text-sm text-destructive">⚠️ {ai.text}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-forest"><CheckCircle2 className="h-4 w-4" /> Tidak terdeteksi penyakit — daun tampak sehat.</p>
            {top && <p className="text-xs text-muted-foreground">Kemungkinan tertinggi: {prettyDisease(top.name)} ({(top.p_final * 100).toFixed(0)}%, di bawah ambang).</p>}
          </div>
        )}

        {/* Segmentation overlay — the YOLO-seg masks recovered server-side. Shows the
            actual disease regions the detector localized, or explains their absence. */}
        <div className="space-y-1.5 border-t border-border/70 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Segmentasi Detektor</p>
          {result.overlay ? (
            <>
              <img src={`data:image/jpeg;base64,${result.overlay}`} alt="Segmentasi area penyakit" className="w-full rounded-xl border border-border" />
              <p className="text-xs text-muted-foreground">
                {result.nDetections} area penyakit dilingkari &amp; diberi mask oleh detektor
                {result.lesionPercent != null && <> — menutupi ±{result.lesionPercent.toFixed(1)}% bagian tanaman di foto</>}.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Detektor tidak menemukan area penyakit terlokalisasi — diagnosis berasal dari analisis seluruh daun.</p>
          )}
        </div>
        </div>
      ) : result.state === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-forest"><Loader2 className="h-4 w-4 animate-spin" /> Menganalisis citra + parameter tanah…</p>
      ) : result.state === 'error' ? (
        <p className="text-sm text-destructive">⚠️ {result.message}. Diagnosis tanah tetap tersedia di bawah.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Pilih atau ambil citra daun lalu jalankan deteksi. Hasil citra dipadukan dengan data sensor tanah.</p>
      )}

      <div className="border-t border-border/70 pt-3"><SoilContext issues={issues} sensorConnected={sensorConnected} /></div>

      <Button variant="accent" disabled={!canRun} onClick={onRun}><ScanSearch className="h-4 w-4" /> Mulai Deteksi</Button>
    </div>
  );
}
