import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import {
  ArrowLeft, Loader2, AlertTriangle, Download, Trash2, Ban, Layers,
  Image as ImageIcon, Ruler, MapPinned, CheckCircle2, X, SearchX,
  Play, Pause, Plane, ArrowUp, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchJob, cancelJob, removeJob, isPreconditionError,
  pauseMappingMission, cancelMappingMission,
} from "@/lib/gcs/api";
import {
  captureOf, captureProgress, captureStateMeta, capturePointsForDisplay,
  isCaptureSession, isCaptureActive, isCaptureResumable, isCapturePausable,
} from "@/lib/gcs/mapping-capture";
import { useDroneOffset } from "@/lib/gcs/drone-offset";
import { parseKml } from "@/lib/gcs/kml";
import { decodeOrthoPreview } from "@/lib/gcs/ortho";
import { fetchBlobWithProgress } from "@/lib/gcs/fetch-progress";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/gcs/basemap";

const STATUS_LABEL = {
  unstitched: "Menunggu",
  stitching: "Menjahit Peta",
  clustering: "Analisis Zona",
  ready: "Peta Siap",
  failed: "Gagal",
  canceled: "Dibatalkan",
};
const TERMINAL = new Set(["ready", "failed", "canceled"]);
const BUSY = new Set(["unstitched", "stitching", "clustering"]);
// capture.state values after which nothing on the flight side can change any
// more — everything else (paused/interrupted/failed/armed…) may still be resumed
// from the planner while this page is open.
const SETTLED_CAPTURE = new Set(["done", "canceled"]);
// capture.state values whose `last_error` is worth showing (a failed leg, a
// backend restart mid-flight, an operator cancel).
const FLIGHT_ERROR_STATES = new Set(["failed", "interrupted", "canceled"]);

// Per-state operator hint for a drone-flown session (docs/mapping.md → capture
// block). Written from the contract: the pause path lands FIRST and only then
// secures the frames, and failed / interrupted legs are resumable (their pending
// points get re-flown) — so none of these say "start over". Note `interrupted`
// only means the flight is no longer under BACKEND control (boot sweep after a
// restart) — NOT that the aircraft landed: the LOITER_UNLIM plan leaves it holding
// at the last station, so the hint must send the operator to bring it home first.
const CAPTURE_HINT = {
  armed: () => "Rencana terunggah, menunggu lepas landas.",
  flying: () => "Drone sedang memotret titik survei.",
  returning: () => "Foto terakhir selesai — drone kembali ke titik lepas landas & mendarat. Foto diamankan setelah mendarat.",
  processing: () => "Drone mendarat — menarik & menggeoreferensi foto dari kamera…",
  paused: (p) => `Misi dijeda. ${p.remaining} titik tersisa — lanjutkan kapan saja (ganti baterai, pindah titik lepas landas).`,
  interrupted: (p) => `Backend dimulai ulang saat misi berjalan — penerbangan tidak lagi dipantau dan drone TIDAK pulang sendiri (bisa masih melayang di titik terakhir). Pulangkan/daratkan drone lewat GCS (Dashboard Drone: RTL/Land) dan pastikan disarmed sebelum melanjutkan ${p.remaining} titik tersisa.`,
  failed: () => "Leg terakhir gagal — titik yang belum aman akan diterbangkan ulang saat dilanjutkan.",
  canceled: () => "Misi dibatalkan. Foto yang sudah aman tetap tersimpan.",
  done: () => "Semua titik terfoto — penjahitan peta dimulai otomatis.",
};

// Capture-plan overlay styling: captured = secured on disk, pending = shot this
// leg but not yet pulled off the camera, remaining = still to fly.
const CAPTURE_PATH_STYLE = { color: "#059669", weight: 2, dashArray: "4 4", interactive: false };
const CAPTURE_POINT_STYLE = {
  captured: { color: "#16a34a", fillColor: "#16a34a" },
  pending: { color: "#f59e0b", fillColor: "#f59e0b" },
  remaining: { color: "#64748b", fillColor: "#ffffff" },
};

const DESTRUCTIVE_BTN = "border-destructive bg-destructive hover:bg-destructive/90";
const DESTRUCTIVE_OUTLINE_BTN = "border-destructive text-destructive hover:bg-destructive/10";

function isNotFound(msg) {
  return /\b404\b/.test(msg) || /not[\s-]?found|tidak ditemukan/i.test(msg);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function zoneAreaHa(coords) {
  try {
    const ring = coords.map((c) => [c.lng, c.lat]);
    ring.push(ring[0]);
    return turf.area(turf.polygon([ring])) / 10_000;
  } catch {
    return 0;
  }
}

function formatNum(value, unit) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}` : null;
}

function ProgressBar({ pct, label }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-leaf transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatItem({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-leaf/10 text-leaf"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function Chip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/80 tabular-nums">
      <Icon className="h-3 w-3" /> {children}
    </span>
  );
}

// Inline confirm (kiosk: no window.confirm). `locked` keeps it open while the
// request it guards is in flight.
function ConfirmModal({ icon: Icon, iconTone, title, children, actions, onClose, locked }) {
  const close = () => { if (!locked) onClose(); };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-house/40 backdrop-blur-sm" onClick={close} />
      <Card className="relative z-10 w-full max-w-sm p-6">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${iconTone}`}><Icon className="h-5 w-5" /></span>
            <h2 className="font-bold text-forest">{title}</h2>
          </div>
          <button onClick={close} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Tutup"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-5 flex flex-col gap-2 text-sm text-muted-foreground">{children}</div>
        <div className="flex justify-end gap-2">{actions}</div>
      </Card>
    </div>
  );
}

export function MappingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const offset = useDroneOffset();

  const mapDiv = useRef(null);
  const map = useRef(null);
  const zonesLayer = useRef(null);
  const orthoOverlay = useRef(null);
  const captureLayer = useRef(null);
  // Which layer last fitted the view ("capture" | "zones" | "ortho"). The capture
  // plan only fits once and never over a view the real products already framed.
  const viewFit = useRef(null);
  const pollGen = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  // Bumped to restart the poll loop after an action invalidated it (pollGen++)
  // but the session is still there — a failed cancel / delete.
  const [pollEpoch, setPollEpoch] = useState(0);

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  const [zones, setZones] = useState([]);
  const [kmlProgress, setKmlProgress] = useState(null);
  const [kmlError, setKmlError] = useState(null);
  const [tifProgress, setTifProgress] = useState(null);
  const [tifError, setTifError] = useState(null);
  const [orthoProjected, setOrthoProjected] = useState(false);

  const [downloading, setDownloading] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // null | "delete" | "delete-force" | "delete-blocked" | "pause" | "cancel-mission" | "cancel-stitch"
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Leg number a pause was requested for. The "menjeda…" note is derived from it
  // (this leg still armed/flying) so it clears itself once the backend reports
  // returning/processing/paused — no effect needed.
  const [pausedLeg, setPausedLeg] = useState(null);

  const kmlUrl = job?.artifacts?.clusters_kml || null;
  const tifUrl = job?.artifacts?.stitched_tif || null;
  const status = job?.status;
  const busy = BUSY.has(status);
  const stitchBusy = status === "stitching" || status === "clustering";

  // Drone-flown session? `status` sits at `unstitched` for the whole flight —
  // the flight itself lives in the `capture` block (docs/mapping.md).
  const capture = captureOf(job);
  const progress = captureProgress(job);
  // Points not yet visited this survey (total − photographed). `progress.remaining`
  // is total − *captured* and is the right number for a resume (a failed leg's
  // pending points are re-flown) — but mid-leg, this leg's frames all still sit
  // in `pending` until the drain after touchdown, so `remaining` would tell the
  // pause modal that pausing throws this leg's work away. It doesn't.
  const unflown = progress.remainingIndices.length;
  const legNo = capture && Number.isInteger(capture.leg) && capture.leg > 0 ? capture.leg : 1;
  const flightMeta = status === "unstitched" && capture ? captureStateMeta(capture.state) : null;
  const flightError = capture && FLIGHT_ERROR_STATES.has(capture.state) && capture.last_error ? capture.last_error : null;
  const resumable = isCaptureResumable(job);
  const pausing = pausedLeg != null && pausedLeg === legNo && isCapturePausable(job);
  const pausable = isCapturePausable(job) && !pausing;
  const missionActive = isCaptureActive(job);

  // Cheap change key for the capture block: the poll hands back a fresh object
  // every 4 s, and only these fields move the overlay.
  const captureKey = capture
    ? `${capture.state}|${capture.captured?.length ?? 0}|${capture.pending?.length ?? 0}|${capture.points.length}|${capture.updated_at ?? ""}`
    : "";
  // capture.points are in the drone's GPS frame (command = planned − Δ); +Δ puts
  // them back where they belong on the imagery (gps-offset.js).
  const capturePoints = useMemo(
    () => capturePointsForDisplay(job, offset),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on captureKey so the poll's fresh `job` object doesn't redraw the layer every tick
    [captureKey, offset],
  );

  // --- Leaflet init (once; StrictMode-safe via cleanup + mapReady flag) --------
  useEffect(() => {
    const container = mapDiv.current;
    if (!container) return;
    const m = L.map(container, { attributionControl: true });
    const meta = BASE_LAYERS.satellite;
    L.tileLayer(meta.url, {
      attribution: meta.attribution,
      maxNativeZoom: meta.maxNativeZoom,
      maxZoom: meta.maxZoom,
    }).addTo(m);
    m.setView([DEFAULT_CENTER[1], DEFAULT_CENTER[0]], DEFAULT_ZOOM);
    map.current = m;
    setMapReady(true);
    return () => {
      m.remove();
      map.current = null;
      zonesLayer.current = null;
      orthoOverlay.current = null;
      captureLayer.current = null;
      viewFit.current = null;
      setMapReady(false);
    };
  }, []);

  // --- Poll the session until terminal; stop on not-found; back off on the
  //     documented-deferred `clustering` state; ignore responses from a stale
  //     generation so an in-flight poll can't revert an optimistic cancel. ------
  useEffect(() => {
    let alive = true;
    let timer;
    const gen = ++pollGen.current;
    async function tick() {
      try {
        const j = await fetchJob(id);
        if (!alive || gen !== pollGen.current) return;
        setJob(j);
        setError(null);
        setLoading(false);
        setPausedLeg((cur) => (cur != null && !isCapturePausable(j) ? null : cur));
        if (!TERMINAL.has(j.status)) {
          // Every non-terminal status is transient — clustering runs automatically
          // when a stitch completes (docs/mapping.md) — so keep polling quickly.
          // A flying survey sits at `unstitched` the whole time, so it is covered.
          timer = setTimeout(tick, 4000);
        } else if (isCaptureSession(j) && !SETTLED_CAPTURE.has(captureOf(j).state)) {
          // Terminal ODM status but the flight side can still move (a resume
          // started from the planner) — poll slowly so it shows up here too.
          timer = setTimeout(tick, 15000);
        }
      } catch (e) {
        if (!alive || gen !== pollGen.current) return;
        setLoading(false);
        const msg = e instanceof Error ? e.message : "Gagal memuat pemetaan";
        if (isNotFound(msg)) { setNotFound(true); return; }
        setError(msg);
        timer = setTimeout(tick, 6000);
      }
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, pollEpoch]);

  // --- Load cluster zones (KML) once the artifact exists -----------------------
  useEffect(() => {
    if (!kmlUrl || !mapReady) return;
    let alive = true;
    const controller = new AbortController();
    setKmlProgress(0);
    setKmlError(null);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          kmlUrl,
          (l, t) => { if (alive && t) setKmlProgress(Math.min(100, (l / t) * 100)); },
          controller.signal,
        );
        const text = await blob.text();
        if (!alive) return;
        const parsed = parseKml(text, { id, name: id });
        const parsedZones = parsed.polygons.map((p) => ({
          id: p.id,
          name: p.name,
          latlngs: p.coords.map((c) => [c.lat, c.lng]),
          areaHa: zoneAreaHa(p.coords),
        }));
        setZones(parsedZones);

        if (zonesLayer.current) zonesLayer.current.remove();
        const group = L.featureGroup();
        parsedZones.forEach((z) => {
          L.polygon(z.latlngs, {
            color: "#006241", weight: 2, opacity: 1,
            fillColor: "#00754A", fillOpacity: 0.2, lineJoin: "round",
          })
            .bindPopup(`<b>${escapeHtml(z.name)}</b><br/>${z.areaHa.toFixed(3)} ha`)
            .addTo(group);
        });
        group.addTo(map.current);
        zonesLayer.current = group;
        try {
          map.current.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 20 });
          viewFit.current = "zones";
        } catch { /* empty */ }
        setKmlProgress(100);
      } catch (e) {
        if (alive && e?.name !== "AbortError") {
          setKmlProgress(null);
          setKmlError(e instanceof Error ? e.message : "Gagal memuat zona");
        }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [kmlUrl, mapReady, id]);

  // --- Decode + overlay the orthophoto (true-colour GeoTIFF) once it exists -----
  useEffect(() => {
    if (!tifUrl || !mapReady) return;
    let alive = true;
    const controller = new AbortController();
    setTifProgress(0);
    setTifError(null);
    setOrthoProjected(false);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          tifUrl,
          (l, t) => { if (alive && t) setTifProgress(Math.min(90, (l / t) * 90)); },
          controller.signal,
        );
        const buf = await blob.arrayBuffer();
        if (!alive) return;
        setTifProgress(94);
        const result = await decodeOrthoPreview(buf);
        if (!alive) return;
        if (result.geographic && result.dataUrl) {
          const [minLng, minLat, maxLng, maxLat] = result.bbox;
          const bounds = [[minLat, minLng], [maxLat, maxLng]];
          if (orthoOverlay.current) orthoOverlay.current.remove();
          const overlay = L.imageOverlay(result.dataUrl, bounds, { opacity: 0.9, interactive: false });
          overlay.addTo(map.current);
          orthoOverlay.current = overlay;
          zonesLayer.current?.bringToFront();
          if (!zonesLayer.current) {
            try {
              map.current.fitBounds(bounds, { padding: [40, 40] });
              viewFit.current = "ortho";
            } catch { /* empty */ }
          }
        } else {
          // Projected CRS (e.g. UTM) — can't place on the lat/lng basemap without
          // reprojection. Zones still render; the full raster is downloadable.
          setOrthoProjected(true);
        }
        setTifProgress(100);
      } catch (e) {
        if (alive && e?.name !== "AbortError") {
          setTifProgress(null);
          setTifError(e instanceof Error ? e.message : "Gagal memuat orthophoto");
        }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [tifUrl, mapReady]);

  // --- Capture plan overlay (drone-flown sessions): the survey path plus one dot
  //     per point coloured by what the backend has secured. Redrawn only when the
  //     capture block actually changes (captureKey) and kept UNDER zones/ortho. --
  useEffect(() => {
    const m = map.current;
    if (!mapReady || !m) return;
    if (captureLayer.current) { captureLayer.current.remove(); captureLayer.current = null; }
    if (capturePoints.length === 0) return;
    const group = L.featureGroup();
    // Markers first, path last: FeatureGroup.bringToBack() walks layers in
    // insertion order, so the path ends up furthest back and the dots stay
    // legible on top of the dashes.
    capturePoints.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 4, weight: 1.5, fillOpacity: 0.95, interactive: false,
        ...CAPTURE_POINT_STYLE[p.status],
      }).addTo(group);
    });
    if (capturePoints.length > 1) {
      L.polyline(capturePoints.map((p) => [p.lat, p.lng]), CAPTURE_PATH_STYLE).addTo(group);
    }
    group.addTo(m);
    group.bringToBack();
    captureLayer.current = group;
    if (!viewFit.current) {
      try {
        m.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 19 });
        viewFit.current = "capture";
      } catch { /* empty */ }
    }
  }, [capturePoints, mapReady]);

  // One-off refetch outside the poll loop so the page reacts to a pause / cancel
  // within ~1 s instead of at the next 4 s tick. Honours pollGen so a stale
  // answer can never repaint over a newer generation.
  function refreshSoon(delays = [400, 1600]) {
    const gen = pollGen.current;
    delays.forEach((ms) => setTimeout(async () => {
      try {
        const j = await fetchJob(id);
        if (gen === pollGen.current) setJob(j);
      } catch { /* the poll loop reports fetch errors */ }
    }, ms));
  }

  async function download(url, filename, key) {
    setDownloading(key);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
    } catch (e) {
      setError(`Gagal mengunduh: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDownloading(null);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    pollGen.current++; // invalidate any in-flight poll so it can't revert status
    try {
      const j = await cancelJob(id);
      setJob(j);
      setModal(null);
    } catch (e) {
      // Close the confirm on failure too so the error lands in the page banner.
      setModal(null);
      // 409: the mapping monitor still owns this session — CancelJob refuses
      // rather than yanking a stitch out from under a flight (docs/mapping.md).
      setError(isPreconditionError(e)
        ? "Misi masih menerbangkan sesi ini — batalkan misinya dulu."
        : (e instanceof Error ? e.message : "Gagal membatalkan"));
    } finally {
      setCancelling(false);
      setPollEpoch((n) => n + 1); // resume polling from the server's truth
    }
  }

  async function handleDelete(force = false) {
    setDeleting(true);
    pollGen.current++;
    try {
      await removeJob(id, { force });
      navigate("/mapping");
    } catch (e) {
      setDeleting(false);
      if (isPreconditionError(e)) {
        // 409 without force means one of two very different things (docs/mapping.md
        // → RemoveJob): a mission is flying this session, or the session holds the
        // ONLY copy of frames moved off the camera SD. Decide on a fresh read — the
        // flight may have landed since the last poll — and ask again accordingly.
        let latest = job;
        try { latest = await fetchJob(id); setJob(latest); } catch { /* keep what we have */ }
        setModal(isCaptureActive(latest) ? "delete-blocked" : "delete-force");
      } else {
        setError(e instanceof Error ? e.message : "Gagal menghapus");
        setModal(null);
      }
      setPollEpoch((n) => n + 1); // the session is still there — keep polling it
    }
  }

  async function handlePause() {
    setSubmitting(true);
    setError(null);
    try {
      // PauseMappingMission takes {} — it always targets the mission in the air.
      // Landing comes first; the frames are secured only after touchdown
      // (returning → processing → paused), so the poll keeps running meanwhile.
      await pauseMappingMission();
      setPausedLeg(legNo);
      setModal(null);
      refreshSoon();
    } catch (e) {
      setModal(null);
      setError(`Gagal menjeda misi: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelMission() {
    setSubmitting(true);
    setError(null);
    try {
      // CancelMappingMission drops the plan and releases the session; the frames
      // and capture.captured survive, but the state becomes `canceled` (not
      // resumable). Passing session_id lets the backend refuse a mismatch.
      await cancelMappingMission(id);
      setModal(null);
      refreshSoon();
    } catch (e) {
      setModal(null);
      setError(`Gagal membatalkan misi: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubmitting(false);
    }
  }

  const closeModal = () => setModal(null);

  const zonesTotalHa = useMemo(() => zones.reduce((s, z) => s + (z.areaHa || 0), 0), [zones]);
  const title = job?.name || job?.area_name || id;
  const areaValue = job?.area_m2 != null
    ? `${(job.area_m2 / 10_000).toFixed(2)} ha`
    : (zonesTotalHa > 0 ? `${zonesTotalHa.toFixed(2)} ha` : "—");
  const zonesValue = job?.cluster_count ?? (zones.length || "—");
  // `image_count` is counted at ingest / when stitching starts, NOT live — a
  // half-flown session reports 0 (docs/mapping.md), so fall back to the plan.
  const imageValue = (job?.image_count ?? 0) > 0
    ? `${job.image_count} foto`
    : (capture ? `${progress.photographed}/${progress.total} foto` : "0 foto");
  const captureHint = capture ? (CAPTURE_HINT[capture.state]?.(progress) ?? null) : null;
  const altitudeValue = capture ? formatNum(capture.altitude, "m") : null;
  const holdValue = capture ? formatNum(capture.hold_time, "dtk") : null;

  if (notFound) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
        <header className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        </header>
        <div className="grid flex-1 place-items-center">
          <div className="text-center">
            <SearchX className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
            <h2 className="font-bold text-forest">Pemetaan tidak ditemukan</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Sesi <span className="font-mono">{id}</span> mungkin sudah dihapus atau ID-nya salah.</p>
            <Button variant="accent" className="mt-4" onClick={() => navigate("/mapping")}>Kembali ke daftar</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-5 w-5 shrink-0 text-harvest" strokeWidth={1.9} />
          <span className="truncate font-bold tracking-tight text-forest">{title}</span>
        </div>
        <div className="w-[84px]" aria-hidden />
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_320px]">
        {/* Map preview */}
        {/* `isolate`: Leaflet's panes sit at z-index 400+ and would otherwise paint
            over the page's fixed z-[100] modals — the map needs its own stacking
            context so the confirm dialogs stay on top. */}
        <Card className="isolate overflow-hidden p-0">
          <div ref={mapDiv} className="h-[46vh] min-h-[320px] w-full bg-[#dfe8e2]" />
          {capturePoints.length > 0 && mapReady && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">Titik foto</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#16a34a]" /> terfoto</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /> menunggu diamankan</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#64748b] bg-white" /> tersisa</span>
            </div>
          )}
          {(kmlProgress !== null && kmlProgress < 100) && (
            <div className="border-t border-border p-3"><ProgressBar pct={kmlProgress} label="Memuat zona lahan…" /></div>
          )}
          {(tifProgress !== null && tifProgress < 100) && (
            <div className="border-t border-border p-3"><ProgressBar pct={tifProgress} label="Membaca orthophoto…" /></div>
          )}
          {orthoProjected && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Orthophoto dalam proyeksi terproyeksi (mis. UTM) — pratinjau raster butuh reproyeksi; zona tetap tampil & orthophoto penuh dapat diunduh.
            </div>
          )}
          {kmlError && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Gagal memuat zona: {kmlError}
            </div>
          )}
          {tifError && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Gagal memuat orthophoto: {tifError}
            </div>
          )}
        </Card>

        {/* Side panel: status, stats, actions */}
        <div className="flex flex-col gap-4">
          {!job && loading ? (
            <Card className="grid place-items-center gap-3 p-8 text-center">
              <Loader2 className="h-7 w-7 animate-spin text-leaf" />
              <p className="text-sm text-muted-foreground">Memuat pemetaan…</p>
            </Card>
          ) : job ? (
            <>
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-forest">Status</h3>
                  {/* While a drone session is still flying, `status` says
                      "unstitched" — show where the flight is instead. */}
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${flightMeta ? flightMeta.tone : "bg-muted text-foreground"}`}>
                    {(flightMeta ? flightMeta.busy : busy) && <Loader2 className="h-3 w-3 animate-spin" />}
                    {status === "ready" && <CheckCircle2 className="h-3.5 w-3.5 text-leaf" />}
                    {flightMeta ? flightMeta.label : (STATUS_LABEL[status] ?? "—")}
                  </span>
                </div>

                {status === "stitching" && (
                  // `progress` is a PERCENTAGE 0–100 (unscaled NodeODM value —
                  // docs/mapping.md), and freezes at its last polled value.
                  <ProgressBar
                    pct={Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)))}
                    label="Menjahit peta"
                  />
                )}
                {status === "clustering" && (
                  <p className="flex items-center gap-2 text-sm text-harvest">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {job.has_stitched ? "Orthophoto siap — zona menyusul…" : "Menganalisis zona vegetasi…"}
                  </p>
                )}
                {status === "unstitched" && !capture && (
                  <p className="text-sm text-muted-foreground">Gambar tersimpan, menunggu proses penjahitan.</p>
                )}
                {status === "unstitched" && capture && (
                  <div className="flex flex-col gap-3">
                    {captureHint && <p className="text-sm text-muted-foreground">{captureHint}</p>}
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Foto terambil <span className="font-semibold text-foreground tabular-nums">{progress.photographed}/{progress.total}</span></span>
                        <span className="tabular-nums">{progress.pct}%</span>
                      </div>
                      {/* Outer (lighter) = photographed incl. this leg's pending
                          frames; inner (darker) = secured on disk. */}
                      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-harvest/45 transition-all duration-300" style={{ width: `${progress.pct}%` }} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-harvest transition-all duration-300" style={{ width: `${progress.securedPct}%` }} />
                      </div>
                      {progress.pending > 0 && (
                        <p className="mt-1 text-[11px] text-amber-700 tabular-nums">{progress.pending} foto menunggu diamankan</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip icon={Plane}>Leg {legNo}</Chip>
                      {altitudeValue && <Chip icon={ArrowUp}>{altitudeValue}</Chip>}
                      {holdValue && <Chip icon={Timer}>Tahan {holdValue}</Chip>}
                    </div>
                    {flightError && (
                      <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {flightError}
                      </p>
                    )}
                  </div>
                )}
                {status === "failed" && job.error && (
                  <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {job.error}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
                  <StatItem icon={ImageIcon} label="Gambar" value={imageValue} />
                  <StatItem icon={Ruler} label="Cakupan" value={areaValue} />
                  <StatItem icon={Layers} label="Zona" value={String(zonesValue)} />
                  <StatItem icon={MapPinned} label="ID" value={id} />
                </div>
              </Card>

              <Card className="flex flex-col gap-2.5 p-5">
                <h3 className="mb-1 font-bold text-forest">Aksi</h3>
                {tifUrl && (
                  <Button variant="outline" onClick={() => download(tifUrl, `${id}-orthophoto.tif`, "tif")} disabled={downloading === "tif"}>
                    {downloading === "tif" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Unduh Orthophoto
                  </Button>
                )}
                {kmlUrl && (
                  <Button variant="outline" onClick={() => download(kmlUrl, `${id}-zona.kml`, "kml")} disabled={downloading === "kml"}>
                    {downloading === "kml" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Unduh Zona (KML)
                  </Button>
                )}
                {resumable && (
                  // MappingPlan picks the session up from `?resume=` and flies the
                  // remaining points as a new leg (ResumeMappingMission → ExecuteMission).
                  <Button variant="accent" onClick={() => navigate(`/mapping/plan?resume=${encodeURIComponent(id)}`)}>
                    <Play className="h-4 w-4" /> Lanjutkan Misi ({progress.remaining} foto)
                  </Button>
                )}
                {pausable && (
                  <Button variant="outline" onClick={() => setModal("pause")} disabled={submitting}>
                    <Pause className="h-4 w-4" /> Jeda &amp; Pulang
                  </Button>
                )}
                {pausing && (
                  <p className="flex items-start gap-1.5 text-xs text-sky-700">
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> Menjeda — drone kembali &amp; mendarat, foto diamankan setelah mendarat.
                  </p>
                )}
                {missionActive && (
                  <Button variant="outline" className={DESTRUCTIVE_OUTLINE_BTN} onClick={() => setModal("cancel-mission")} disabled={submitting}>
                    <Ban className="h-4 w-4" /> Batalkan Misi
                  </Button>
                )}
                {stitchBusy && (
                  // CancelJob stops the ODM pipeline only — there is nothing to
                  // cancel on an `unstitched` session (a flight is cancelled above).
                  // Confirmed like every other action here: `canceled` is terminal
                  // and the kiosk has no re-stitch path (no StartStitching button).
                  <Button variant="outline" className={DESTRUCTIVE_OUTLINE_BTN} onClick={() => setModal("cancel-stitch")} disabled={cancelling}>
                    <Ban className="h-4 w-4" /> Batalkan Penjahitan
                  </Button>
                )}
                <Button variant="outline" className={DESTRUCTIVE_OUTLINE_BTN} onClick={() => setModal("delete")} disabled={deleting}>
                  <Trash2 className="h-4 w-4" /> Hapus Pemetaan
                </Button>
                {!tifUrl && !kmlUrl && !busy && (
                  <p className="text-xs text-muted-foreground">Belum ada artefak untuk diunduh.</p>
                )}
              </Card>
            </>
          ) : (
            <Card className="p-5">
              <p className="text-sm text-muted-foreground">Data pemetaan tidak dapat dimuat.</p>
            </Card>
          )}
        </div>

        {/* Zones list — spans full width under the map + panel */}
        {zones.length > 0 && (
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-forest">Zona Lahan</h3>
              <span className="text-xs text-muted-foreground">{zones.length} zona · {zonesTotalHa.toFixed(2)} ha total</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {zones.map((z, i) => (
                <div key={z.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-leaf/12 text-xs font-bold text-forest">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{z.name}</p>
                    <p className="text-xs text-muted-foreground">{z.areaHa.toFixed(3)} ha</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {error && (
        <div className="mx-auto mt-4 w-full max-w-6xl">
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        </div>
      )}

      {modal === "delete" && (
        <ConfirmModal
          icon={Trash2} iconTone="bg-destructive/10 text-destructive" title="Hapus pemetaan?"
          onClose={closeModal} locked={deleting}
          actions={<>
            <Button variant="outline" onClick={closeModal} disabled={deleting}>Batal</Button>
            <Button variant="default" className={DESTRUCTIVE_BTN} onClick={() => handleDelete(false)} disabled={deleting}>
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Menghapus…</> : <><Trash2 className="h-4 w-4" /> Hapus</>}
            </Button>
          </>}
        >
          <p>Gambar mentah, orthophoto, dan zona untuk pemetaan ini akan dihapus permanen dari server.</p>
          {capture && (
            <p>
              Sesi ini hasil terbang drone: foto yang sudah dipindahkan dari kartu SD kamera
              {progress.captured > 0 ? ` (${progress.captured} foto)` : ""} ikut terhapus.
            </p>
          )}
        </ConfirmModal>
      )}

      {modal === "delete-blocked" && (
        <ConfirmModal
          icon={AlertTriangle} iconTone="bg-harvest/15 text-harvest" title="Sesi masih dipakai misi"
          onClose={closeModal}
          actions={<Button variant="outline" onClick={closeModal}>Tutup</Button>}
        >
          <p>Misi sedang menerbangkan sesi ini. Jeda atau batalkan misinya dulu sebelum menghapus.</p>
        </ConfirmModal>
      )}

      {modal === "delete-force" && (
        <ConfirmModal
          icon={Trash2} iconTone="bg-destructive/10 text-destructive" title="Satu-satunya salinan"
          onClose={closeModal} locked={deleting}
          actions={<>
            <Button variant="outline" onClick={closeModal} disabled={deleting}>Batal</Button>
            <Button variant="default" className={DESTRUCTIVE_BTN} onClick={() => handleDelete(true)} disabled={deleting}>
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Menghapus…</> : <><Trash2 className="h-4 w-4" /> Hapus Permanen</>}
            </Button>
          </>}
        >
          <p>
            Sesi ini menyimpan <span className="font-semibold text-foreground tabular-nums">{progress.captured} foto</span> yang
            sudah dipindahkan dari kartu SD kamera — ini satu-satunya salinan. Hapus permanen?
          </p>
        </ConfirmModal>
      )}

      {modal === "pause" && (
        <ConfirmModal
          icon={Pause} iconTone="bg-harvest/15 text-harvest" title="Jeda & pulang?"
          onClose={closeModal} locked={submitting}
          actions={<>
            <Button variant="outline" onClick={closeModal} disabled={submitting}>Batal</Button>
            <Button variant="accent" onClick={handlePause} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Menjeda…</> : <><Pause className="h-4 w-4" /> Jeda &amp; Pulang</>}
            </Button>
          </>}
        >
          <p>Drone menyelesaikan foto yang sedang diambil, lalu kembali ke titik lepas landas dan mendarat.</p>
          {/* `unflown`, not `progress.remaining`: this leg's frames are still
              `pending` until the post-landing drain, so the resume-style count
              would claim the pause discards them. Restate the card's numbers. */}
          <p>
            {progress.pending > 0 && (
              <><span className="font-semibold text-foreground tabular-nums">{progress.pending} foto</span> dari leg ini diamankan setelah mendarat; </>
            )}
            <span className="font-semibold text-foreground tabular-nums">{unflown} titik</span> belum terfoto
            bisa dilanjutkan kapan saja.
          </p>
        </ConfirmModal>
      )}

      {modal === "cancel-mission" && (
        <ConfirmModal
          icon={Ban} iconTone="bg-destructive/10 text-destructive" title="Batalkan misi?"
          onClose={closeModal} locked={submitting}
          actions={<>
            <Button variant="outline" onClick={closeModal} disabled={submitting}>Batal</Button>
            <Button variant="default" className={DESTRUCTIVE_BTN} onClick={handleCancelMission} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Membatalkan…</> : <><Ban className="h-4 w-4" /> Batalkan Misi</>}
            </Button>
          </>}
        >
          <p>
            Rencana terbang dibuang dan misi tidak bisa dilanjutkan — titik tersisa perlu misi baru.
            Foto yang sudah diambil tetap tersimpan di sesi ini
            {progress.captured > 0 ? ` (${progress.captured} foto aman)` : ""}.
          </p>
          {/* CancelMappingMission leaves the aircraft where it is (docs/drone_api.md);
              only Pause brings it home. */}
          {(capture?.state === "flying" || capture?.state === "returning") && (
            <p className="flex items-start gap-1.5 text-harvest">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Drone tidak otomatis pulang — setelah dibatalkan, pulangkan (RTL) atau daratkan dari halaman Monitoring Drone. Untuk pulang sambil menjaga misi tetap bisa dilanjutkan, pilih Jeda &amp; Pulang.
            </p>
          )}
        </ConfirmModal>
      )}

      {modal === "cancel-stitch" && (
        <ConfirmModal
          icon={Ban} iconTone="bg-destructive/10 text-destructive" title="Batalkan penjahitan peta?"
          onClose={closeModal} locked={cancelling}
          actions={<>
            <Button variant="outline" onClick={closeModal} disabled={cancelling}>Batal</Button>
            <Button variant="default" className={DESTRUCTIVE_BTN} onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <><Loader2 className="h-4 w-4 animate-spin" /> Membatalkan…</> : <><Ban className="h-4 w-4" /> Batalkan Penjahitan</>}
            </Button>
          </>}
        >
          {/* `job.progress` (the ODM percentage) only moves while `stitching`; it
              freezes during `clustering`, when the orthophoto is already on disk —
              so branch the copy instead of quoting a stale number. */}
          {status === "stitching" ? (
            <p>
              Proses ODM yang sudah berjalan <span className="font-semibold text-foreground tabular-nums">{Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)))}%</span> dibuang.
            </p>
          ) : (
            <p>Penjahitan sudah selesai — hanya analisis zona yang masih berjalan. Membatalkan sekarang membuang hasilnya.</p>
          )}
          <p>Sesi menjadi <span className="font-semibold text-foreground">Dibatalkan</span> dan tidak bisa dijahit ulang dari aplikasi ini; foto mentah tetap tersimpan.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
