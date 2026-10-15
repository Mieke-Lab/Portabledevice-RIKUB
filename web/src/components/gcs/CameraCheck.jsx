import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Camera, CheckCircle2, ChevronRight, Ear, Loader2, Plane, RefreshCw, ShieldAlert, X, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cameraPreflight, triggerCamera } from "@/lib/gcs/api";
import { useDroneSettings } from "@/lib/gcs/drone-settings";
import {
  WIRE_TEST_FRESH_MS, ageLabel, assessCamera, cardInfo, explainCameraWarning, formatClock, methodLabel, orderPaths,
  pathAdvice, pathLabel, pathRole, pathStateMeta,
} from "@/lib/gcs/camera-check";

// Camera pre-flight UI for the mapping planner: the "Cek Kamera" button above the
// start button, the dialog it opens (which way will the photos be taken? what is
// wrong? test the wire by hand, or fly anyway) and the banner the pre-flight audit
// shows. The vocabulary and the decisions live in lib/gcs/camera-check.js; the
// backend contract is docs/drone_api.md → "Camera interface".

const STORE_KEY = "soerogis:camera-check";

function readStore() {
  try {
    const data = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || "null");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeStore(value) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // private mode / quota: the result just does not survive a reload
  }
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * State of the camera pre-flight on this page.
 *
 *   expectedShots  photos the mission will take (the backend projects how slow the SD listing gets)
 *   live, liveAt   Diagnostics.camera and when it was fetched (null when telemetry is stale)
 *
 * The last result and the hand test of the wire are kept in sessionStorage, per drone address,
 * so leaving the page and coming back does not throw them away (they still age out).
 */
export function useCameraCheck({ expectedShots = 0, live = null, liveAt = null } = {}) {
  const [{ baseUrl }] = useDroneSettings();
  const addr = baseUrl || "";
  const [stored, setStored] = useState(readStore);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [wireBusy, setWireBusy] = useState(false);
  const [wireShot, setWireShot] = useState(null); // trigger response waiting for the operator's "did it beep?"
  const busy = useRef(false);
  const now = useNow(30000);

  // Results belong to one drone: another address starts clean.
  const mine = stored.addr === addr ? stored : {};

  useEffect(() => {
    if (Object.keys(stored).length > 0) writeStore(stored);
  }, [stored]);

  const save = useCallback((patch) => {
    setStored((prev) => ({ ...(prev.addr === addr ? prev : {}), ...patch, addr }));
  }, [addr]);

  const assessment = useMemo(
    () => assessCamera({ report: mine.report, checkedAt: mine.checkedAt, live, liveAt, wireTest: mine.wireTest, now }),
    [mine.report, mine.checkedAt, mine.wireTest, live, liveAt, now],
  );

  /** Run the pre-flight. Resolves to the report, or null when it could not be fetched (see `error`). */
  const check = useCallback(async ({ heal = true } = {}) => {
    if (busy.current) return null;
    busy.current = true;
    setChecking(true);
    setError(null);
    try {
      const report = await cameraPreflight({ expectedShots: Math.max(0, Math.round(expectedShots || 0)), full: true, heal });
      save({ report, checkedAt: Date.now() });
      return report;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memeriksa kamera");
      return null;
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, [expectedShots, save]);

  /**
   * Adopt a report that arrived some other way (the push's `camera_check`). A `skipped` one (the
   * operator launched with the camera preflight switched off) says nothing about the camera —
   * adopting it would overwrite the last real check with a "no way to the camera" verdict.
   */
  const recordReport = useCallback((report) => {
    if (report && typeof report === "object" && !report.skipped) save({ report, checkedAt: Date.now() });
  }, [save]);

  /** Fire the PWM wire once — a REAL photo; the camera should beep and its live view freeze. */
  const fireWire = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setWireBusy(true);
    setWireShot(null);
    try {
      const res = await triggerCamera({ method: "wire" });
      setWireShot({ ...res, at: Date.now() });
      // The ESP refused the command: that is the wire's verdict, no ears needed.
      if (!res.ok) save({ wireTest: { at: Date.now(), result: "error", error: res.error || "" } });
    } catch (e) {
      // Not a verdict about the wire (armed, backend down…): show it, don't record it.
      setWireShot({ ok: false, error: e instanceof Error ? e.message : "Gagal memicu kamera", at: Date.now(), transport: true });
    } finally {
      busy.current = false;
      setWireBusy(false);
    }
  }, [save]);

  /** The operator's verdict on the wire test: did the camera beep and freeze? */
  const judgeWire = useCallback((heard) => {
    save({ wireTest: { at: Date.now(), result: heard ? "ok" : "fail" } });
    setWireShot(null);
  }, [save]);

  const dismissWireShot = useCallback(() => setWireShot(null), []);

  return {
    assessment, checking, error, check, recordReport,
    wireTest: mine.wireTest ?? null, wireBusy, wireShot, fireWire, judgeWire, dismissWireShot,
    checkedAt: mine.checkedAt ?? null, now,
  };
}

// --- look ----------------------------------------------------------------------

export const LEVEL_STYLE = {
  ok: { box: "border-emerald-500/40 bg-emerald-50 text-emerald-900", icon: CheckCircle2, iconCls: "text-emerald-600", dot: "bg-emerald-500" },
  caution: { box: "border-amber-500/50 bg-amber-50 text-amber-900", icon: AlertTriangle, iconCls: "text-amber-600", dot: "bg-amber-500" },
  warn: { box: "border-orange-500/60 bg-orange-50 text-orange-900", icon: AlertTriangle, iconCls: "text-orange-600", dot: "bg-orange-500" },
  danger: { box: "border-red-500/60 bg-red-50 text-red-900", icon: ShieldAlert, iconCls: "text-red-600", dot: "bg-red-500" },
  blocked: { box: "border-red-500/60 bg-red-50 text-red-900", icon: XCircle, iconCls: "text-red-600", dot: "bg-red-500" },
  unknown: { box: "border-border bg-muted/40 text-muted-foreground", icon: Camera, iconCls: "text-muted-foreground", dot: "bg-slate-400" },
};

const TONE_DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", muted: "bg-slate-400" };
const TONE_PILL = {
  ok: "bg-emerald-500/15 text-emerald-800",
  warn: "bg-amber-500/15 text-amber-800",
  bad: "bg-red-500/15 text-red-800",
  muted: "bg-slate-500/15 text-slate-700",
};

/** Levels that ask the operator to look before flying. */
export function needsAttention(level) {
  return level === "caution" || level === "warn" || level === "danger" || level === "blocked";
}

// --- the button above "Terbangkan Misi" -------------------------------------------------

/**
 * "Cek Kamera" + the current verdict in one line. Tapping the verdict opens the dialog.
 * `onCheck` runs the pre-flight (the page decides whether the result needs the dialog).
 */
export function CameraCheckBlock({ camera, droneArmed, onCheck, onOpen }) {
  const a = camera.assessment;
  const style = LEVEL_STYLE[a.level] ?? LEVEL_STYLE.unknown;
  const Icon = style.icon;
  const age = a.source === "check" && a.checkedAt ? ageLabel(a.checkedAt, camera.now) : "";
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <Button variant="outline" size="sm" className="w-full" onClick={onCheck} disabled={camera.checking || camera.wireBusy}>
        {camera.checking
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Memeriksa kamera…</>
          : <><Camera className="h-4 w-4" /> Cek Kamera</>}
      </Button>
      {camera.checking && (
        <p className="text-center text-[10px] text-muted-foreground">Mengecek tiap jalur ke kamera — bisa sampai 30 detik.</p>
      )}
      {camera.error && !camera.checking && (
        <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Gagal memeriksa kamera: {camera.error}
        </p>
      )}
      {a.level === "unknown" ? (
        <button
          type="button" onClick={onOpen}
          className="flex items-center justify-between gap-2 px-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
        >
          <span>{a.summary}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <button
          type="button" onClick={onOpen}
          className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left ${style.box}`}
        >
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconCls}`} />
          <span className="min-w-0 flex-1">
            <span className={`block text-[11px] leading-snug ${a.level === "danger" || a.level === "blocked" ? "font-bold" : "font-semibold"}`}>{a.summary}</span>
            <span className="mt-0.5 block text-[10px] opacity-75">
              {[age && `dicek ${age}`, droneArmed && "drone ARMED", "ketuk untuk detail"].filter(Boolean).join(" · ")}
            </span>
          </span>
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      )}
    </div>
  );
}

// --- the dialog ---------------------------------------------------------------------

function PathRow({ path, method }) {
  const meta = pathStateMeta(path.state);
  const role = pathRole(path, method);
  return (
    <li className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_DOT[meta.tone]}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{pathLabel(path)}</span>
        {role === "next" && (
          <span className="shrink-0 rounded-full bg-leaf px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Dipakai</span>
        )}
        {role === "backup" && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-foreground">Cadangan</span>
        )}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${TONE_PILL[meta.tone]}`}>{meta.label}</span>
      </div>
      <p className="mt-1 pl-[18px] text-[11px] leading-snug text-muted-foreground">{pathAdvice(path)}</p>
    </li>
  );
}

function WireTest({ camera, droneArmed }) {
  const [confirming, setConfirming] = useState(false);
  const { wireBusy, wireShot, wireTest, checking } = camera;
  const tested = wireTest && camera.now - wireTest.at < WIRE_TEST_FRESH_MS ? wireTest : null;
  const idle = !confirming && !wireBusy && !wireShot;
  return (
    <section className="rounded-xl border border-border p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-forest">
        <Ear className="h-3.5 w-3.5" /> Uji kabel (manual)
      </h3>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Kabel PWM tidak punya konfirmasi — satu-satunya buktinya telingamu: saat dipicu, kamera harus berbunyi &ldquo;bip&rdquo; dan live view-nya membeku sekitar 1 detik.
      </p>

      {tested && idle && (
        <p className={`mt-2 flex items-start gap-1.5 text-[11px] font-semibold ${tested.result === "ok" ? "text-emerald-700" : "text-destructive"}`}>
          {tested.result === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {tested.result === "ok"
            ? `Diuji ${formatClock(tested.at)} — kamera berbunyi & membeku. Kabel bekerja.`
            : tested.result === "fail"
              ? `Diuji ${formatClock(tested.at)} — kamera TIDAK berbunyi. Jangan andalkan kabel.`
              : `Diuji ${formatClock(tested.at)} — ESP32 menolak perintah${tested.error ? `: ${tested.error}` : ""}.`}
        </p>
      )}

      {idle && (
        <Button
          variant="outline" size="sm" className="mt-2 w-full"
          disabled={droneArmed || checking}
          onClick={() => setConfirming(true)}
        >
          <Ear className="h-4 w-4" /> {tested ? "Uji Kabel Lagi" : "Uji Kabel"}
        </Button>
      )}
      {idle && droneArmed && <p className="mt-1 text-[10px] text-destructive">Tidak bisa saat drone ARMED.</p>}

      {confirming && !wireBusy && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
          <p className="flex items-start gap-1.5 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>
              Ini MENGAMBIL 1 FOTO SUNGGUHAN lewat kabel. Pastikan lensa kamera aman, lalu dengarkan: kamera harus berbunyi &ldquo;bip&rdquo; dan live view membeku.
              Foto uji tertinggal di kartu SD dan ikut terunduh setelah mendarat — kosongkan kartu sebelum terbang bila bisa.
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="accent" onClick={() => { setConfirming(false); camera.fireWire(); }}>
              <Camera className="h-4 w-4" /> Picu kamera
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Batal</Button>
          </div>
        </div>
      )}

      {wireBusy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memicu kamera lewat kabel… dengarkan bunyinya.
        </p>
      )}

      {wireShot && !wireBusy && (wireShot.ok ? (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
          <p className="text-xs font-semibold text-foreground">
            Pulsa terkirim. Apakah kamera berbunyi &ldquo;bip&rdquo; dan live view-nya membeku?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="default" onClick={() => camera.judgeWire(true)}>
              <CheckCircle2 className="h-4 w-4" /> Ya, berbunyi
            </Button>
            <Button size="sm" variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => camera.judgeWire(false)}>
              <XCircle className="h-4 w-4" /> Tidak ada
            </Button>
          </div>
          <button type="button" className="text-left text-[11px] font-semibold text-leaf hover:underline" onClick={() => { camera.dismissWireShot(); setConfirming(true); }}>
            Picu sekali lagi
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {wireShot.transport ? "Perintah tidak sampai: " : "Kabel tidak bisa dipicu: "}{wireShot.error || "tanpa keterangan"}
          </p>
          <Button size="sm" variant="outline" onClick={camera.dismissWireShot}>Tutup</Button>
        </div>
      ))}
    </section>
  );
}

/**
 * The decision screen: which way the next photo goes, what is wrong, and what to do —
 * investigate the wireless links (Cek Ulang re-joins dropped adapters), test the wire
 * by hand, or fly anyway (`onProceed` opens the same audit as the start button).
 */
export function CameraCheckDialog({ open, onClose, camera, droneArmed, onProceed, canProceed }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const a = camera.assessment;
  const style = LEVEL_STYLE[a.level] ?? LEVEL_STYLE.unknown;
  const Icon = style.icon;
  const report = a.report;
  const paths = report?.paths?.length ? orderPaths(report.paths, report.method) : [];
  const card = cardInfo(report?.camera);
  const sdWarnings = (report?.camera?.warnings || []).map(explainCameraWarning).filter(Boolean);
  const when = a.source === "check" && a.checkedAt ? `Dicek ${formatClock(a.checkedAt)} (${ageLabel(a.checkedAt, camera.now)})` : a.source === "live" ? "Pemantauan langsung (belum termasuk kartu SD)" : "";
  const flyAnywayOffered = a.wireOnly && canProceed;
  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Pemeriksaan kamera" className="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 font-bold text-forest"><Camera className="h-5 w-5 text-harvest" /> Pemeriksaan Kamera</h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className={`rounded-xl border p-3 ${style.box}`}>
            <p className={`flex items-start gap-2 ${a.level === "unknown" ? "text-sm font-semibold" : "text-sm font-bold"}`}>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.iconCls}`} /> {a.title}
            </p>
            {a.level !== "unknown" && a.report && (
              <p className="mt-1 pl-7 text-xs font-semibold opacity-90">
                {a.ok && a.method ? `Foto berikutnya lewat: ${methodLabel(a.method)}` : "Tidak ada jalur untuk foto berikutnya"}
              </p>
            )}
            {a.lines.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-11 pr-1 text-xs leading-snug">
                {a.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
            {a.level === "unknown" && !a.report && (
              <p className="mt-1 pl-7 text-xs">
                Tekan &ldquo;Cek Ulang&rdquo; untuk memeriksa tiap jalur ke kamera: Wi-Fi tiap adaptor, Wi-Fi ESP32, kabel PWM, dan kartu SD.
              </p>
            )}
            {when && <p className="mt-2 pl-7 text-[10px] opacity-70">{when}{report?.elapsed_s != null && a.source === "check" ? ` · ${Number(report.elapsed_s).toFixed(1)} dtk` : ""}</p>}
          </div>

          {camera.error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Gagal memeriksa kamera: {camera.error}
            </p>
          )}

          {/* The wire is all there is: testing it by hand is the main thing to do, so it comes first. */}
          {a.wireOnly && <WireTest camera={camera} droneArmed={droneArmed} />}

          {paths.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-forest">Jalur foto</h3>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Tiap foto memakai jalur teratas yang siap; kalau gagal, drone pindah ke jalur di bawahnya. Hanya jalur Wi-Fi yang membuktikan foto benar-benar terambil.
              </p>
              <ul className="flex flex-col gap-1.5">
                {paths.map((p) => <PathRow key={p.name} path={p} method={report.method} />)}
              </ul>
            </section>
          )}

          {card && (
            <section className="rounded-xl border border-border px-3 py-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-forest">Kartu SD di kamera</h3>
              <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${card.status === "bad" ? "text-destructive" : card.status === "warn" ? "text-amber-700" : "text-foreground"}`}>
                {card.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4" />} {card.label}
              </p>
              {card.detail && <p className="text-[11px] text-muted-foreground">{card.detail}</p>}
              {sdWarnings.map((w) => <p key={w} className="mt-1 text-[11px] text-amber-800">{w}</p>)}
            </section>
          )}
          {!card && a.wireOnly && (
            <p className="rounded-xl border border-border px-3 py-2 text-[11px] text-muted-foreground">
              Kartu SD & sisa ruang tidak bisa dicek tanpa jalur Wi-Fi ke kamera.
            </p>
          )}

          {!a.wireOnly && <WireTest camera={camera} droneArmed={droneArmed} />}

          {report && (
            <details className="rounded-xl border border-border px-3 py-2 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Detail teknis</summary>
              <div className="mt-2 flex flex-col gap-1.5 break-words font-mono text-[10px] leading-snug">
                {report.summary && <p>{report.summary}</p>}
                {report.error && <p className="text-destructive">error: {String(report.error)}</p>}
                {(report.warnings || []).map((w) => <p key={w}>warning: {w}</p>)}
                {(report.camera?.warnings || []).map((w) => <p key={w}>camera: {w}</p>)}
                {(report.paths || []).filter((p) => p.error).map((p) => <p key={p.name}>{p.name}: {p.error}</p>)}
              </div>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {flyAnywayOffered && (
            <Button
              variant="outline" size="sm" className="mr-auto border-destructive text-destructive hover:bg-destructive/10"
              onClick={onProceed} title="Lanjut ke konfirmasi penerbangan — kamu akan diminta menyetujui risikonya"
            >
              <Plane className="h-4 w-4" /> Tetap terbang…
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
          <Button variant="default" size="sm" onClick={() => camera.check()} disabled={camera.checking || camera.wireBusy}>
            {camera.checking ? <><Loader2 className="h-4 w-4 animate-spin" /> Memeriksa…</> : <><RefreshCw className="h-4 w-4" /> Cek Ulang</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- the banner in the pre-flight audit -----------------------------------------------

/**
 * Non-blocking warning for the audit modal (the 3 checks + slide stay as they are). The
 * one level that asks for more is `danger`: the modal adds a required acknowledgement.
 * `check` = {level, title, lines, summary, checking, onCheck}.
 */
export function CameraAuditBanner({ check }) {
  if (!check) return null;
  const style = LEVEL_STYLE[check.level] ?? LEVEL_STYLE.unknown;
  const Icon = style.icon;
  const compact = check.level === "ok";
  // The audit modal is already tall (3 checks + slider) on a kiosk screen: two lines here, the rest is in the dialog.
  const lines = compact ? [] : check.lines.slice(0, 2);
  return (
    <div className={`mt-4 rounded-xl border p-3 ${style.box}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconCls}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">
            {check.level === "ok" ? check.summary : check.level === "unknown" ? check.summary : check.title}
          </p>
          {lines.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-snug">
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
        {check.onCheck && (
          <button
            type="button" onClick={check.onCheck} disabled={check.checking}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-current/30 px-2 py-1 text-[11px] font-semibold disabled:opacity-60"
          >
            {check.checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {check.level === "unknown" ? "Cek sekarang" : "Cek ulang"}
          </button>
        )}
      </div>
    </div>
  );
}
