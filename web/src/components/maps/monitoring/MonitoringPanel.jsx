import { Activity, Ban, Camera, Droplets, FolderOpen, Gauge, Loader2, Navigation2, Radar, Satellite } from "lucide-react";
import { gpsFixLabel } from "@/lib/gcs/diagnostics";
import { captureProgress, missionPhaseLabel } from "@/lib/gcs/mapping-capture";
import { PUMP_DRUGS, legendItems, chamberDisplayLabel } from "@/lib/gcs/spray-overlay";

// Phase → badge appearance. Mirrors the spray lifecycle in docs/drone_api.md.
const PHASE_META = {
  idle: { label: "Idle", dot: "bg-slate-400", text: "text-slate-300" },
  armed: { label: "Armed", dot: "bg-amber-300", text: "text-amber-200" },
  standby: { label: "Standby", dot: "bg-amber-300", text: "text-amber-200" },
  spraying: { label: "Menyemprot", dot: "bg-emerald-300 animate-pulse", text: "text-emerald-200" },
  complete: { label: "Selesai", dot: "bg-emerald-300", text: "text-emerald-200" },
  failed: { label: "Gagal", dot: "bg-rose-400", text: "text-rose-300" },
};

// Mapping-survey station colours, shared with the map in Monitoring.jsx.
export const STATION_COLORS = { captured: "#16a34a", pending: "#0ea5e9", remaining: "#f59e0b" };

const MAPPING_BUSY = ["arming", "armed", "capturing", "flying", "returning", "processing"];

function mappingPhaseMeta(phase) {
  const label = missionPhaseLabel(phase);
  if (MAPPING_BUSY.includes(phase)) return { label, dot: "bg-sky-300 animate-pulse", text: "text-sky-200" };
  if (phase === "done" || phase === "complete") return { label, dot: "bg-emerald-300", text: "text-emerald-200" };
  if (phase === "failed") return { label, dot: "bg-rose-400", text: "text-rose-300" };
  if (phase === "paused" || phase === "interrupted") return { label, dot: "bg-amber-300", text: "text-amber-200" };
  return { ...PHASE_META.idle, label };
}

function num(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function StatTile({ label, value, unit, Icon }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[7px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {Icon && <Icon className="h-2.5 w-2.5" />} {label}
      </div>
      <div className="mt-0.5 text-[15px] font-black leading-none tabular-nums text-white">
        {value}
        {unit && value !== "—" && <span className="ml-0.5 text-[9px] font-bold text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

function PumpCard({ drug, accent, pump }) {
  const target = Number.isFinite(pump?.target_lpm) ? pump.target_lpm : 0;
  const measured = Number.isFinite(pump?.measured_lpm) ? pump.measured_lpm : 0;
  const liters = Number.isFinite(pump?.liters) ? pump.liters : 0;
  const on = measured > 0.01 || target > 0.001 || pump?.on === true;
  const fill = target > 0 ? Math.min(1, measured / target) : on ? 1 : 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-slate-200">
          <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
          {drug}
        </span>
        <span className={`text-[8px] font-black uppercase tracking-[0.1em] ${on ? "text-emerald-300" : "text-slate-500"}`}>
          {on ? "ON" : "OFF"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.round(fill * 100)}%`, background: accent }} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-[7px] font-bold uppercase tracking-[0.08em] text-slate-400">Target</div>
          <div className="text-[11px] font-black tabular-nums text-white">{num(target, 2)}</div>
        </div>
        <div>
          <div className="text-[7px] font-bold uppercase tracking-[0.08em] text-slate-400">Ukur</div>
          <div className="text-[11px] font-black tabular-nums text-white">{num(measured, 2)}</div>
        </div>
        <div>
          <div className="text-[7px] font-bold uppercase tracking-[0.08em] text-slate-400">Liter</div>
          <div className="text-[11px] font-black tabular-nums text-white">{num(liters, 1)}</div>
        </div>
      </div>
    </div>
  );
}

function MappingCard({ status, job }) {
  const done = Number.isFinite(status?.captures_done) ? status.captures_done : 0;
  const total = Number.isFinite(status?.total_captures) ? status.total_captures : 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const session = captureProgress(job); // across legs: secured vs photographed-not-yet-secured
  const leg = status?.leg ?? job?.capture?.leg;
  const trigger = status?.last_trigger;
  const unverified = Array.isArray(status?.unverified_points) ? status.unverified_points.length : 0;
  const skipped = Array.isArray(status?.skipped_points) ? status.skipped_points.length : 0;
  const error = status?.last_error || job?.capture?.last_error || "";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
          Foto{leg ? ` · leg ${leg}` : ""}
        </span>
        <span className="text-[17px] font-black leading-none tabular-nums text-white">
          {done}
          <span className="text-[11px] font-bold text-slate-400">/{total || "—"}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {session.total > 0 && (
        <div className="mt-1.5 text-[10px] font-semibold tabular-nums text-slate-300">
          Sesi: {session.captured} aman · {session.pending} menunggu diamankan · {session.total} titik
        </div>
      )}
      {trigger?.ok === false && (
        <div className="mt-1.5 text-[10px] font-semibold text-amber-300">
          Pemicu kamera gagal: {trigger.error || "tanpa keterangan"}
        </div>
      )}
      {/* Photos over the blind PWM wire can't be confirmed; points no path could shoot are dropped. */}
      {unverified > 0 && (
        <div className="mt-1.5 text-[10px] font-semibold text-amber-300">
          {unverified} foto lewat kabel — tidak terverifikasi
        </div>
      )}
      {skipped > 0 && (
        <div className="mt-1.5 text-[10px] font-semibold text-rose-300">
          {skipped} titik dilewati — kamera tidak terpicu
        </div>
      )}
      {error && <div className="mt-1.5 text-[10px] font-semibold text-rose-300">{error}</div>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-400">
        {[
          ["captured", "Aman"],
          ["pending", "Terpotret"],
          ["remaining", "Belum"],
        ].map(([key, label]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full ring-1 ring-white/60" style={{ background: STATION_COLORS[key] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend({ chambers, chamberProducts }) {
  const rows = legendItems(chambers, chamberProducts);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="mb-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
        Area Tersemprot · dosis
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={`${row.label}-${row.side ?? ""}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[10px] font-bold text-slate-200">{row.label}</span>
              {row.side && (
                <span className="ml-1 text-[9px] font-semibold text-slate-400">· {row.side}</span>
              )}
            </span>
            <span className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-white/10">
              {row.ramp.map((c) => (
                <span key={c} className="h-3 w-5" style={{ background: c }} />
              ))}
            </span>
          </div>
        ))}
        <div className="pt-0.5 text-[8px] font-medium text-slate-500">Warna makin gelap = dosis makin tinggi</div>
      </div>
    </div>
  );
}

/**
 * Right-side monitoring panel: live flight telemetry + reactive-spray state.
 * Presentational — the page threads in the raw diagnostics `data` and the spray
 * `status`; derivation of display values happens here.
 */
export function MonitoringPanel({
  mode,
  mapping,
  onOpenMapping,
  fieldName,
  diagnostics,
  online,
  stale,
  spray,
  chambers,
  chamberProducts,
  onCancel,
  cancelling,
}) {
  const state = diagnostics?.state ?? null;
  const gps = diagnostics?.gps_raw ?? null;
  const global = diagnostics?.global_position ?? null;
  const current = spray?.current ?? null;
  const totals = spray?.totals ?? null;

  const isMapping = mode === "mapping";
  const phaseKey = spray?.phase ?? "idle";
  const phase = isMapping ? mappingPhaseMeta(mapping?.status?.phase) : PHASE_META[phaseKey] ?? PHASE_META.idle;
  const running = !isMapping && spray?.running === true;
  const missionLabel = isMapping ? "Misi Pemetaan" : mode === "spray" ? "Misi Semprot" : "Status Misi";

  const altitude = Number.isFinite(global?.altitude)
    ? global.altitude
    : Number.isFinite(gps?.alt)
      ? gps.alt / 1000
      : NaN;
  const speed = Number.isFinite(current?.speed_mps)
    ? current.speed_mps
    : Number.isFinite(gps?.vel)
      ? gps.vel / 100
      : NaN;
  const heading =
    gps?.yaw != null && Number.isFinite(gps.yaw) && gps.yaw !== 0 && gps.yaw !== 65535
      ? (gps.yaw / 100) % 360
      : gps?.cog != null && Number.isFinite(gps.cog) && gps.cog >= 0 && gps.cog < 36000
        ? (gps.cog / 100) % 360
        : NaN;

  const connText = online ? (stale ? "Telemetri usang" : "Drone terhubung") : "Drone offline";
  const connDot = online ? (stale ? "bg-amber-300" : "bg-emerald-300") : "bg-slate-400";

  return (
    <div className="pointer-events-auto flex max-h-full w-[320px] flex-col overflow-hidden rounded-[18px] border border-emerald-300/15 bg-house/95 text-white shadow-[0_18px_48px_rgba(2,6,23,0.5)] backdrop-blur-xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-emerald-400/90 text-house shadow-[0_8px_18px_rgba(16,185,129,0.28)]">
          <Radar className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-black leading-tight">Monitoring Drone</div>
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-300">
            {fieldName || "Pemantauan Misi"}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${connDot}`} />
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2.5 [-webkit-overflow-scrolling:touch]">
        {/* Mission / spray status */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <Activity className="h-3 w-3" /> {missionLabel}
          </span>
          <span className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.06em] ${phase.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${phase.dot}`} />
            {phase.label}
          </span>
        </div>
        <div className="text-[10px] font-semibold text-slate-400">{connText}</div>

        {/* Flight telemetry */}
        <div className="grid grid-cols-3 gap-1.5">
          <StatTile label="Mode" value={state?.mode ?? "—"} />
          <StatTile label="Arm" value={state ? (state.armed ? "ARM" : "SAFE") : "—"} />
          <StatTile label="Fix" value={gps ? gpsFixLabel(gps.fix_type) : "—"} Icon={Satellite} />
          <StatTile label="Sat" value={gps?.satellites_visible ?? "—"} />
          <StatTile label="Alt" value={num(altitude, 1)} unit="m" />
          <StatTile label="Laju" value={num(speed, 1)} unit="m/s" Icon={Gauge} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <StatTile label="Arah" value={Number.isFinite(heading) ? Math.round(heading) : "—"} unit="°" Icon={Navigation2} />
          {isMapping ? (
            <StatTile label="Leg" value={mapping?.status?.leg ?? mapping?.job?.capture?.leg ?? "—"} />
          ) : (
            <StatTile label="Zona" value={current?.in_zone ? current.zone_id || "—" : "Luar"} />
          )}
        </div>

        {isMapping ? (
          <>
            <div className="flex items-center gap-1.5 pt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300">
              <Camera className="h-3 w-3" /> Pemotretan
            </div>
            <MappingCard status={mapping?.status} job={mapping?.job} />
          </>
        ) : (
          <>
            {/* Pumps */}
            <div className="flex items-center gap-1.5 pt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-300">
              <Droplets className="h-3 w-3" /> Pompa Semprot
            </div>
            <PumpCard drug={chamberDisplayLabel(PUMP_DRUGS.right.key, chamberProducts)} accent={PUMP_DRUGS.right.ramp[2]} pump={current?.right} />
            <PumpCard drug={chamberDisplayLabel(PUMP_DRUGS.left.key, chamberProducts)} accent={PUMP_DRUGS.left.ramp[2]} pump={current?.left} />

            {totals && (
              <div className="grid grid-cols-2 gap-1.5">
                <StatTile label="Total Kanan" value={num(totals.right_liters, 1)} unit="L" />
                <StatTile label="Total Kiri" value={num(totals.left_liters, 1)} unit="L" />
              </div>
            )}

            <Legend chambers={chambers} chamberProducts={chamberProducts} />
          </>
        )}
      </div>

      {isMapping && onOpenMapping && (
        <div className="shrink-0 border-t border-white/10 p-2.5">
          <button
            type="button"
            onClick={onOpenMapping}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-sky-500/90 text-[13px] font-black text-white shadow-[0_10px_24px_rgba(14,165,233,0.3)] transition-all hover:-translate-y-0.5 hover:bg-sky-500"
          >
            <FolderOpen className="h-4 w-4" /> Buka Sesi Pemetaan
          </button>
        </div>
      )}

      {running && (
        <div className="shrink-0 border-t border-white/10 p-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500/90 text-[13px] font-black text-white shadow-[0_10px_24px_rgba(244,63,94,0.32)] transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-rose-500 disabled:opacity-60"
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            {cancelling ? "Membatalkan…" : "Batalkan Misi"}
          </button>
        </div>
      )}
    </div>
  );
}
