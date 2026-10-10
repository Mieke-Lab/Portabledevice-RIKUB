import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Search, RefreshCw, FolderOpen, Loader2, Layers,
  Image as ImageIcon, Calendar, X, AlertTriangle, MapPinned, Sprout, Plane,
  PlaneTakeoff, Play, Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchJobs, createJobFromFolder, pauseMappingMission } from "@/lib/gcs/api";
import {
  captureOf, captureStateMeta, captureProgress, captureSummary,
  isCaptureSession, isCaptureInFlight, isCaptureResumable, isCapturePausable, needsAttention,
} from "@/lib/gcs/mapping-capture";

// Lifecycle of a MappingJobService session (docs/mapping.md). `busy` drives the
// spinner + progress bar and marks a row as still in progress.
const STATUS_META = {
  unstitched: { label: "Menunggu", tone: "bg-muted text-muted-foreground", dot: "bg-slate-400", busy: false },
  stitching: { label: "Menjahit Peta", tone: "bg-harvest/15 text-harvest", dot: "bg-harvest", busy: true },
  clustering: { label: "Analisis Zona", tone: "bg-harvest/15 text-harvest", dot: "bg-harvest", busy: true },
  ready: { label: "Peta Siap", tone: "bg-leaf/15 text-forest", dot: "bg-emerald-500", busy: false },
  failed: { label: "Gagal", tone: "bg-destructive/10 text-destructive", dot: "bg-red-500", busy: false },
  canceled: { label: "Dibatalkan", tone: "bg-muted text-muted-foreground", dot: "bg-slate-400", busy: false },
};
const TERMINAL = new Set(["ready", "failed", "canceled"]);

function statusMeta(status) {
  return STATUS_META[status] ?? STATUS_META.unstitched;
}

// A drone-flown session sits at `unstitched` for the WHOLE flight — `status`
// tracks the ODM pipeline only (docs/mapping.md) — so "Menunggu" would be wrong
// from takeoff until the last frame is secured. Show the flight state from the
// `capture` block instead, and fall back to `status` once ODM has taken over.
function displayMeta(job) {
  const c = captureOf(job);
  if (c && job.status === "unstitched") return captureStateMeta(c.state);
  return statusMeta(job.status);
}

// The status buckets in the filter must agree with the badge (`displayMeta`):
// a drone session at `unstitched` is labelled by `capture.state`, not `status`,
// so bucketing on bare `status` would list "Sedang Terbang"/"Dijeda" cards under
// "Menunggu" and hide "Misi Dibatalkan" from "Dibatalkan". In-flight states
// (armed/flying/returning/processing/paused/interrupted) belong to the "Perlu
// tindakan" / "Misi terbang" views, so they map to no status bucket; a cancelled
// mission is "Dibatalkan"; a failed leg is "Gagal"; a session whose photos are
// complete but which ODM has not picked up yet is genuinely "Menunggu".
// The `status === "unstitched"` guard is deliberate: once ODM has taken over
// (stitching/…/ready) the badge follows `status` again — even if the mission
// was cancelled earlier and then force-stitched — so the bucket must too.
function filterStatus(job) {
  const c = captureOf(job);
  if (!c || job.status !== "unstitched") return job.status;
  if (c.state === "canceled") return "canceled";
  if (c.state === "failed") return "failed";
  if (c.state === "done") return "unstitched";
  return null;
}

function jobId(job) {
  return job.id || job.job_id;
}

// MappingPlan picks the session up from `?resume=` and flies the remaining
// points as a new leg (ResumeMappingMission → ExecuteMission).
function resumeUrl(job) {
  return `/mapping/plan?resume=${encodeURIComponent(jobId(job))}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

function coverageHa(job) {
  return job.area_m2 != null ? `${(job.area_m2 / 10_000).toFixed(2)} ha` : "—";
}

// Enter/Space on a nested button must not also "open" the row/card it sits in
// (the button's own click already navigates somewhere else).
function activateSelf(handler) {
  return (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
  };
}

function SessionCard({ job, onOpen, onResume }) {
  const meta = displayMeta(job);
  const odmMeta = statusMeta(job.status);
  const title = job.name || job.area_name || jobId(job);
  // `progress` is a PERCENTAGE 0–100 (NodeODM's value, passed through unscaled by
  // PyODM — see docs/mapping.md). Clamp rather than rescale.
  const pct = Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)));

  const c = captureOf(job);
  const prog = captureProgress(job);
  // Flight not finished yet: ODM hasn't taken over, so the card is about the
  // mission (flight state, capture progress), not about stitching.
  const flightPending = !!c && job.status === "unstitched";
  const captureBar = flightPending && needsAttention(job);
  const resumable = isCaptureResumable(job);
  const legNo = Number.isInteger(c?.leg) ? c.leg : 0;
  const flightError = c && (c.state === "failed" || c.state === "interrupted") && c.last_error;
  // `image_count` is counted at ingest / when a stitch starts, NOT a live
  // directory count — a half-flown session reports 0 and *looks* empty
  // (docs/mapping.md), so use the capture counters while it is still 0.
  const photoLabel = c && !(Number(job.image_count) > 0)
    ? `${prog.photographed}/${prog.total} foto`
    : `${job.image_count ?? 0} foto`;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job)}
      onKeyDown={activateSelf(() => onOpen(job))}
      className="group flex cursor-pointer flex-col overflow-hidden p-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,98,65,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      <div className="relative flex h-24 items-center justify-center overflow-hidden bg-gradient-to-br from-forest to-leaf">
        <MapPinned className="h-9 w-9 text-white/85" strokeWidth={1.6} />
        <span className={`absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${meta.tone}`}>
          {meta.busy
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
          {meta.label}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <h3 className="truncate font-bold leading-tight text-forest">{title}</h3>
          {job.area_name && (
            <p className="truncate text-xs text-muted-foreground">{job.area_name}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {formatDate(job.created_at)}</span>
          <span className="inline-flex items-center gap-1 tabular-nums"><ImageIcon className="h-3.5 w-3.5" /> {photoLabel}</span>
          {job.cluster_count != null && (
            <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> {job.cluster_count} zona</span>
          )}
          {legNo > 1 && (
            <span className="rounded-md bg-harvest/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-harvest">Leg {legNo}</span>
          )}
        </div>

        {captureBar ? (
          // photographed / total (secured + this leg's pending) — what the
          // operator sees the aircraft doing; `captureProgress` handles the maths.
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-harvest transition-all duration-300" style={{ width: `${Math.max(4, prog.pct)}%` }} />
          </div>
        ) : odmMeta.busy && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-harvest transition-all duration-300 ${job.status === "clustering" ? "animate-pulse" : ""}`}
              style={{ width: job.status === "clustering" ? "100%" : `${Math.max(4, pct)}%` }}
            />
          </div>
        )}
        {job.status === "failed" && job.error && (
          <p className="line-clamp-2 text-xs text-destructive">{job.error}</p>
        )}
        {flightError && (
          <p className="line-clamp-2 text-xs text-destructive">{c.last_error}</p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cakupan</p>
            <p className="text-sm font-bold text-foreground">{coverageHa(job)}</p>
          </div>
          {resumable ? (
            <Button
              variant="accent"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={(e) => { e.stopPropagation(); onResume(job); }}
            >
              <Play className="h-3.5 w-3.5" /> Lanjutkan
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-leaf">
              Buka <ArrowLeft className="h-3.5 w-3.5 rotate-180 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// Tray order: whatever is physically happening (in the air / draining the camera)
// first, then what waits on the operator (paused / interrupted / failed). Within
// a group, newest plan first — keyed on created_at, NOT capture.updated_at, which
// ticks every poll and would reorder rows under the operator's finger.
function traySort(a, b) {
  const fa = isCaptureInFlight(a) ? 0 : 1;
  const fb = isCaptureInFlight(b) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
}

function OngoingRow({ job, onOpen, onResume }) {
  // Pause is a two-step inline confirm (no window.confirm on the kiosk).
  // `pausedLeg` remembers which leg we asked to end so the "menjeda…" note stays
  // up until a poll moves the session past flying/armed — and does not come back
  // if this same row later flies a new leg (the leg number changes on resume).
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pauseError, setPauseError] = useState(null);
  const [pausedLeg, setPausedLeg] = useState(null);

  const c = captureOf(job);
  if (!c) return null;
  const meta = captureStateMeta(c.state);
  const prog = captureProgress(job);
  const title = job.name || job.area_name || jobId(job);
  const leg = Number.isInteger(c.leg) ? c.leg : 1;
  const pausing = pausedLeg === leg && isCapturePausable(job);
  const pausable = isCapturePausable(job) && !pausing;
  const resumable = isCaptureResumable(job);
  const flightError = (c.state === "failed" || c.state === "interrupted") && c.last_error;

  async function confirmPause() {
    setSubmitting(true);
    setPauseError(null);
    try {
      // PauseMappingMission takes {} — it always targets the mission in the air.
      // Landing comes first, the frames are only secured after touchdown
      // (returning → processing → paused), so the row keeps polling meanwhile.
      await pauseMappingMission();
      setPausedLeg(leg);
      setConfirming(false);
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : "Gagal menjeda misi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job)}
      onKeyDown={activateSelf(() => onOpen(job))}
      className="flex cursor-pointer flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-leaf/60 hover:bg-leaf/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.tone}`}>
          {meta.busy
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
          {meta.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-forest">{title}</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {captureSummary(job)}
            {job.name && job.area_name ? ` · ${job.area_name}` : ""}
          </p>
        </div>
        {/* Buttons live inside a clickable row: swallow the click so a tap on
            "Jeda" never also opens the detail page. */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {confirming ? (
            <>
              <span className="text-xs font-semibold text-foreground">Jeda &amp; pulang?</span>
              <Button size="sm" variant="accent" onClick={confirmPause} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Ya
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>Batal</Button>
            </>
          ) : (
            <>
              {resumable && (
                <Button size="sm" variant="accent" onClick={() => onResume(job)}>
                  <Play className="h-4 w-4" /> Lanjutkan
                </Button>
              )}
              {pausable && (
                <Button size="sm" variant="outline" onClick={() => { setPauseError(null); setConfirming(true); }}>
                  <Pause className="h-4 w-4" /> Jeda
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onOpen(job)}>Buka</Button>
            </>
          )}
        </div>
      </div>

      {/* Outer (lighter) = photographed incl. this leg's pending frames; inner
          (darker) = secured on disk. The gap is what a failed leg would re-fly. */}
      <div className="relative h-1 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-harvest/45 transition-all duration-300" style={{ width: `${prog.pct}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-harvest transition-all duration-300" style={{ width: `${prog.securedPct}%` }} />
      </div>

      {pausing && (
        <p className="flex items-center gap-1.5 text-xs text-sky-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menjeda — drone kembali &amp; mendarat…
        </p>
      )}
      {pauseError && (
        <p className="line-clamp-1 text-xs text-destructive">Gagal menjeda: {pauseError}</p>
      )}
      {flightError && (
        <p className="line-clamp-1 text-xs text-destructive">{c.last_error}</p>
      )}
    </div>
  );
}

// "Ongoing / needs attention" tray. A drone session is in ListJobs from the
// moment its mission is pushed (docs/mapping.md), so every half-flown survey —
// still airborne, paused for a battery swap, or orphaned by a backend restart —
// surfaces here regardless of search/filter and can be resumed from the list.
function OngoingTray({ jobs, onOpen, onResume }) {
  return (
    <Card className="mb-4 overflow-hidden border-harvest/40 p-0">
      <div className="border-b border-border/70 bg-harvest/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <PlaneTakeoff className="h-4 w-4 shrink-0 text-harvest" strokeWidth={2} />
          <h2 className="text-sm font-bold text-forest">Misi Pemetaan Berjalan</h2>
          <span className="rounded-full bg-harvest px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">{jobs.length}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sesi yang masih terbang, dijeda, atau terputus — bisa dilanjutkan kapan saja.
        </p>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {jobs.map((job) => (
          <OngoingRow key={jobId(job)} job={job} onOpen={onOpen} onResume={onResume} />
        ))}
      </div>
    </Card>
  );
}

// Two ways to start a mapping session: fly a new capture mission (drone
// photogrammetry survey → auto-created session, see MappingPlan), or run ODM on
// an image folder already on the GCS host (the original CreateOdmJob flow).
function ChooseCreateModal({ onClose, onPickFlight, onPickFolder }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-house/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-2xl p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold leading-tight text-forest">Pemetaan Baru</h2>
            <p className="text-xs text-muted-foreground">Pilih cara memulai pemetaan lahan.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Tutup">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={onPickFlight}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-border p-6 text-center transition-all hover:-translate-y-0.5 hover:border-leaf hover:bg-leaf/5 active:scale-[0.99]"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-harvest/15 text-harvest transition-transform group-hover:scale-110"><Plane className="h-7 w-7" /></span>
            <div>
              <h3 className="font-bold text-forest">Rencanakan Misi Terbang</h3>
              <p className="mt-1 text-xs text-muted-foreground">Gambar area di peta, atur ketinggian & tumpang tindih, lalu terbangkan drone untuk memotret lahan.</p>
            </div>
          </button>
          <button
            onClick={onPickFolder}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-border p-6 text-center transition-all hover:-translate-y-0.5 hover:border-leaf hover:bg-leaf/5 active:scale-[0.99]"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-leaf/12 text-leaf transition-transform group-hover:scale-110"><FolderOpen className="h-7 w-7" /></span>
            <div>
              <h3 className="font-bold text-forest">Dari Folder Gambar</h3>
              <p className="mt-1 text-xs text-muted-foreground">Jalankan penjahitan orthophoto (ODM) dari folder gambar hasil terbang yang sudah ada di server.</p>
            </div>
          </button>
        </div>
      </Card>
    </div>
  );
}

function CreateModal({ onClose, onCreated }) {
  const [sourceDir, setSourceDir] = useState("");
  const [name, setName] = useState("");
  const [areaName, setAreaName] = useState("");
  const [imageGlob, setImageGlob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const dir = sourceDir.trim();
    if (!dir) { setError("Folder sumber gambar wajib diisi."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createJobFromFolder(dir, {
        name: name.trim() || undefined,
        areaName: areaName.trim() || undefined,
        imageGlob: imageGlob.trim() || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat pemetaan.");
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-leaf focus:ring-2 focus:ring-leaf/20";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-house/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-lg p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-leaf/12 text-leaf"><FolderOpen className="h-5 w-5" /></span>
            <div>
              <h2 className="font-bold leading-tight text-forest">Pemetaan Baru</h2>
              <p className="text-xs text-muted-foreground">Jahit orthophoto dari folder gambar drone di server.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Tutup">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">Folder sumber gambar <span className="text-destructive">*</span></label>
            <input className={inputCls} value={sourceDir} onChange={(e) => setSourceDir(e.target.value)} placeholder="/data/sd_captures/20260612T0921" autoFocus />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Folder di host berisi gambar hasil terbang (.png/.jpg/.tif). Hasil unduhan SD kamera
              di <span className="font-mono">sd_captures/&lt;ts&gt;/</span> juga bisa dipakai.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Nama peta</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="otomatis dari folder" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Nama lahan</label>
              <input className={inputCls} value={areaName} onChange={(e) => setAreaName(e.target.value)} placeholder="Sawah Blok Utara" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">Filter gambar (opsional)</label>
            <input className={inputCls} value={imageGlob} onChange={(e) => setImageGlob(e.target.value)} placeholder="kosongkan = semua gambar" />
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Batal</Button>
            <Button type="submit" variant="accent" disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Memproses…</> : <><Sprout className="h-4 w-4" /> Mulai Pemetaan</>}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function Mapping() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [chooseOpen, setChooseOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const data = await fetchJobs();
      setJobs(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat daftar pemetaan");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Poll while any session is still in progress so stitching/clustering advance
  // live; fall back to a slow refresh otherwise. Chained setTimeout avoids pileup.
  useEffect(() => {
    let alive = true;
    let timer;
    async function tick() {
      try {
        const data = await fetchJobs();
        if (!alive) return;
        const list = Array.isArray(data) ? data : [];
        setJobs(list);
        setError(null);
        // Every non-terminal status is transient (clustering runs automatically
        // right after a stitch — docs/mapping.md), so poll them all quickly and
        // idle down only once nothing is in flight. A flying mission is spelled
        // out explicitly: its `status` is a plain `unstitched` the whole time and
        // the live part is `capture.state` / `capture.captured`.
        const anyBusy = list.some((j) => !TERMINAL.has(j.status) || isCaptureInFlight(j));
        timer = setTimeout(tick, anyBusy ? 4000 : 20000);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Gagal memuat daftar pemetaan");
        timer = setTimeout(tick, 8000);
      } finally {
        if (alive) setLoading(false);
      }
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // Tray rows are independent of search/filter on purpose — the tray exists so
  // a half-flown survey can't be hidden away and forgotten.
  const attention = useMemo(() => jobs.filter(needsAttention).sort(traySort), [jobs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .filter((j) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "capture") return isCaptureSession(j);
        if (statusFilter === "attention") return needsAttention(j);
        return filterStatus(j) === statusFilter;
      })
      .filter((j) => {
        if (!q) return true;
        return [j.name, j.area_name, j.id, j.job_id]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [jobs, search, statusFilter]);

  const openJob = (job) => navigate(`/mapping/${encodeURIComponent(jobId(job))}`);
  const resumeJob = (job) => navigate(resumeUrl(job));

  const inputCls =
    "w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-leaf focus:ring-2 focus:ring-leaf/20";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate("/menu")}><ArrowLeft className="h-4 w-4" /> Menu</Button>
        <div className="flex items-center gap-2">
          <MapPinned className="h-5 w-5 text-harvest" strokeWidth={1.9} />
          <span className="font-bold tracking-tight text-forest">Pemetaan Lahan</span>
        </div>
        <Button variant="accent" size="sm" onClick={() => setChooseOpen(true)}>
          <Plus className="h-4 w-4" /> Peta Baru
        </Button>
      </header>

      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={inputCls} placeholder="Cari peta atau lahan…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Semua status</option>
            {/* Flight views cut across `status` (a flying mission is `unstitched`). */}
            <option value="attention">Perlu tindakan</option>
            <option value="capture">Misi terbang</option>
            <option value="ready">Peta Siap</option>
            <option value="stitching">Menjahit Peta</option>
            <option value="clustering">Analisis Zona</option>
            <option value="unstitched">Menunggu</option>
            <option value="failed">Gagal</option>
            <option value="canceled">Dibatalkan</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing} className="shrink-0">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Segarkan
          </Button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {!loading && attention.length > 0 && (
          <OngoingTray jobs={attention} onOpen={openJob} onResume={resumeJob} />
        )}

        {loading ? (
          <div className="grid place-items-center py-24 text-center text-muted-foreground">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-leaf" />
            <p className="text-sm">Memuat daftar pemetaan…</p>
          </div>
        ) : error && jobs.length === 0 ? (
          // Backend unreachable and nothing cached: the error banner above already
          // explains it — don't also show the "no mappings yet" CTA (misleading).
          null
        ) : visible.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border py-20 text-center">
            <MapPinned className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <h2 className="font-bold text-forest">
              {jobs.length === 0 ? "Belum ada pemetaan" : "Tidak ada hasil"}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {jobs.length === 0
                ? "Mulai pemetaan dari folder gambar, atau jalankan misi pemotretan drone — sesi dari misi muncul di sini sejak lepas landas, termasuk misi yang dijeda atau terputus agar bisa dilanjutkan."
                : "Coba ubah kata kunci pencarian atau filter status."}
            </p>
            {jobs.length === 0 && (
              <Button variant="accent" className="mt-4" onClick={() => setChooseOpen(true)}>
                <Plus className="h-4 w-4" /> Buat Pemetaan
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((job) => (
              <SessionCard key={jobId(job)} job={job} onOpen={openJob} onResume={resumeJob} />
            ))}
          </div>
        )}
      </div>

      {chooseOpen && (
        <ChooseCreateModal
          onClose={() => setChooseOpen(false)}
          onPickFlight={() => { setChooseOpen(false); navigate("/mapping/plan"); }}
          onPickFolder={() => { setChooseOpen(false); setModalOpen(true); }}
        />
      )}

      {modalOpen && (
        <CreateModal
          onClose={() => setModalOpen(false)}
          onCreated={(created) => {
            setModalOpen(false);
            const id = created?.id || created?.job_id;
            if (id) navigate(`/mapping/${encodeURIComponent(id)}`);
            else load();
          }}
        />
      )}
    </div>
  );
}
