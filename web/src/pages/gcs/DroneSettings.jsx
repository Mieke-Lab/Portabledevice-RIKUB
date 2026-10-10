import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDroneConfig, setFlowConfig } from "@/lib/gcs/api";
import { diagnosticsCoords, gpsFixLabel, isStale, useDiagnostics } from "@/lib/gcs/diagnostics";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PULSES_PER_LITER,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  normalizeBaseUrl,
  useDroneSettings,
} from "@/lib/gcs/drone-settings";

const HOST_PORT_RE = /^[a-z0-9.-]+:\d{1,5}$/i;
const POLL_PRESETS_S = [1, 2, 5];

// Which flowmeter a calibration applies to. "all" recalibrates every line (and
// updates the persisted local default); a numeric id targets one flowmeter.
const FLOW_TARGETS = [
  { id: "all", label: "Both lines" },
  { id: 1, label: "Line 1 · D32" },
  { id: 2, label: "Line 2 · D4" },
];

export function DroneSettings() {
  const [settings, setSettings] = useDroneSettings();
  const { data, error, updatedAt, loading } = useDiagnostics();

  const [defaultAddr, setDefaultAddr] = useState(null);
  useEffect(() => {
    let active = true;
    fetchDroneConfig()
      .then((c) => { if (active) setDefaultAddr(c.default_addr); })
      .catch(() => { if (active) setDefaultAddr(null); });
    return () => { active = false; };
  }, []);

  const [addrDraft, setAddrDraft] = useState(settings.baseUrl);
  const lastApplied = useRef(settings.baseUrl);
  useEffect(() => {
    if (settings.baseUrl !== lastApplied.current) {
      lastApplied.current = settings.baseUrl;
      setAddrDraft(settings.baseUrl);
    }
  }, [settings.baseUrl]);

  const normalizedDraft = normalizeBaseUrl(addrDraft);
  const draftDiffers = normalizedDraft !== settings.baseUrl;
  const draftLooksValid = normalizedDraft === "" || HOST_PORT_RE.test(normalizedDraft);

  const applyAddr = () => {
    const next = normalizeBaseUrl(addrDraft);
    lastApplied.current = next;
    setSettings({ baseUrl: next });
    setAddrDraft(next);
  };
  const useDefaultAddr = () => {
    lastApplied.current = "";
    setSettings({ baseUrl: "" });
    setAddrDraft("");
  };

  const pollSeconds = settings.pollIntervalMs / 1000;
  const pollHz = 1000 / settings.pollIntervalMs;
  const applyPollSeconds = (seconds) => {
    if (!Number.isFinite(seconds)) return;
    setSettings({ pollIntervalMs: Math.round(seconds * 1000) });
  };

  // --- Flow-sensor calibration (pulses per litre — ZJ-S402B) ---
  // Local draft applied on Save: persist to drone settings AND best-effort push
  // to the backend (SetFlowConfig).
  const [pplDraft, setPplDraft] = useState(String(settings.pulsesPerLiter));
  const lastAppliedPpl = useRef(settings.pulsesPerLiter);
  useEffect(() => {
    if (settings.pulsesPerLiter !== lastAppliedPpl.current) {
      lastAppliedPpl.current = settings.pulsesPerLiter;
      setPplDraft(String(settings.pulsesPerLiter));
    }
  }, [settings.pulsesPerLiter]);

  const pplParsed = Number(pplDraft);
  const pplValid = Number.isFinite(pplParsed) && pplParsed > 0;
  const pplDiffers = pplValid && pplParsed !== settings.pulsesPerLiter;

  const [flowTarget, setFlowTarget] = useState("all");
  const [flowSaving, setFlowSaving] = useState(false);
  const [flowError, setFlowError] = useState(null);
  const [flowSaved, setFlowSaved] = useState(false);

  // Save is enabled for a single line whenever valid (it may already differ
  // from the shared default); for "all", only when it differs from the default.
  const flowCanSave = pplValid && !flowSaving && (flowTarget !== "all" || pplDiffers);

  const applyPulsesPerLiter = async () => {
    if (!flowCanSave) return;
    const next = pplParsed;
    setPplDraft(String(next));
    // "Both lines" also updates the persisted local default; a single-line
    // target only pushes to the backend — its live value returns via flow.sensors.
    if (flowTarget === "all") {
      lastAppliedPpl.current = next;
      setSettings({ pulsesPerLiter: next });
    }
    setFlowSaving(true);
    setFlowError(null);
    setFlowSaved(false);
    try {
      await setFlowConfig(next, flowTarget === "all" ? undefined : flowTarget);
      setFlowSaved(true);
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : "failed to push calibration");
    } finally {
      setFlowSaving(false);
    }
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsAgo = updatedAt != null ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;

  const staleAfterMs = Math.max(10_000, settings.pollIntervalMs * 3);
  const stale = !error && isStale(updatedAt, staleAfterMs);

  const badge = useMemo(() => {
    if (loading && !data && !error) return { tone: "idle", icon: "sync", text: "Connecting…", spin: true };
    if (error) return { tone: "error", icon: "cloud_off", text: `Backend unreachable — ${error}` };
    if (data && !data.available) return { tone: "warn", icon: "warning", text: "Controller offline" };
    if (data && data.available) return { tone: "ok", icon: "cloud_done", text: "Online" };
    return { tone: "idle", icon: "sync", text: "Connecting…", spin: true };
  }, [loading, data, error]);

  const coords = diagnosticsCoords(data);
  const state = data?.state ?? null;
  const gps = data?.gps_raw ?? null;
  const gpos = data?.global_position ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-4xl text-gcs-primary uppercase leading-none">Drone Settings</h1>
          <p className="font-data text-lg text-gcs-muted mt-1">
            Backend connection · poll cadence · live link check
          </p>
        </div>
        <ConnectionBadge {...badge} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Configuration */}
        <section className="lg:col-span-3 flex flex-col gap-6">
          <Panel title="Backend Connection" icon="settings_input_antenna">
            <label className="flex flex-col gap-1.5">
              <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">
                gRPC address (host:port)
              </span>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={addrDraft}
                  placeholder={defaultAddr ?? "10.0.0.5:50051"}
                  onChange={(e) => setAddrDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyAddr(); }}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/70 border border-gcs-outline/40 font-technical text-base text-gcs-on-surface focus:outline-none focus:border-gcs-primary transition-colors"
                  aria-label="Drone backend gRPC address override"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={applyAddr}
                    disabled={!draftDiffers}
                    className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-headline text-base uppercase bg-gcs-primary text-white shadow-lg transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    <span className="material-symbols-outlined text-xl">save</span>
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={useDefaultAddr}
                    disabled={settings.baseUrl === "" && addrDraft.trim() === ""}
                    className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-headline text-base uppercase bg-white/70 text-gcs-on-surface border border-gcs-outline/40 transition-all active:scale-[0.97] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    <span className="material-symbols-outlined text-xl">restart_alt</span>
                    Use default
                  </button>
                </div>
              </div>
            </label>

            {!draftLooksValid && (
              <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-error mt-3">
                <span className="material-symbols-outlined text-base">warning</span>
                Doesn&apos;t look like <span className="font-bold">host:port</span> — saving anyway, but the backend may reject it.
              </p>
            )}

            <div className="mt-3 flex flex-col gap-1">
              {defaultAddr != null && (
                <p className="font-technical text-xs text-gcs-muted">
                  Default (.env): <span className="text-gcs-on-surface font-bold">{defaultAddr}</span>
                </p>
              )}
              {settings.baseUrl === "" ? (
                <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-primary">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  Env default in effect — no override set.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-secondary">
                  <span className="material-symbols-outlined text-base">edit_road</span>
                  Override active: <span className="font-bold text-gcs-on-surface">{settings.baseUrl}</span>
                </p>
              )}
            </div>

            <p className="font-technical text-xs text-gcs-muted/80 mt-3 leading-relaxed">
              The override is sent as the{" "}
              <code className="px-1 py-0.5 rounded bg-white/60 text-gcs-on-surface">x-drone-addr</code> header on
              every drone request — drone-scoped and applies instantly. Leave blank to use the server&apos;s{" "}
              <code className="px-1 py-0.5 rounded bg-white/60 text-gcs-on-surface">BACKEND_GRPC_ADDR</code> env value.
            </p>
          </Panel>

          <Panel title="Poll Frequency" icon="speed">
            <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
              <label className="flex flex-col gap-1.5">
                <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">
                  Interval (seconds)
                </span>
                <input
                  type="number"
                  value={pollSeconds}
                  min={MIN_POLL_INTERVAL_MS / 1000}
                  max={MAX_POLL_INTERVAL_MS / 1000}
                  step={0.5}
                  onChange={(e) => applyPollSeconds(Number(e.target.value))}
                  className="w-40 px-4 py-3 rounded-xl bg-white/70 border border-gcs-outline/40 font-technical text-base text-gcs-on-surface focus:outline-none focus:border-gcs-primary transition-colors"
                  aria-label="Diagnostics poll interval in seconds"
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">Rate</span>
                <div className="px-4 py-3 rounded-xl bg-white/40 border border-gcs-outline/30 font-technical text-base text-gcs-on-surface">
                  {pollHz.toFixed(2)} Hz
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">Presets</span>
                <div className="flex gap-2">
                  {POLL_PRESETS_S.map((s) => {
                    const active = Math.abs(pollSeconds - s) < 0.001;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => applyPollSeconds(s)}
                        className={`px-4 py-3 rounded-xl font-technical text-base font-bold transition-all active:scale-[0.97] ${
                          active
                            ? "bg-gcs-primary text-white shadow-lg"
                            : "bg-white/70 text-gcs-on-surface border border-gcs-outline/40 hover:bg-white"
                        }`}
                        aria-pressed={active}
                      >
                        {s}s
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="font-technical text-xs text-gcs-muted/80 mt-3">
              How often the global telemetry poller refreshes. Range {MIN_POLL_INTERVAL_MS / 1000}–
              {MAX_POLL_INTERVAL_MS / 1000} s · default {DEFAULT_POLL_INTERVAL_MS / 1000} s.
            </p>
          </Panel>

          <Panel title="Flow Sensor" icon="water_drop">
            <div className="flex flex-col gap-1.5 mb-4">
              <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">Apply to</span>
              <div className="flex flex-wrap gap-2">
                {FLOW_TARGETS.map((t) => {
                  const activeSel = flowTarget === t.id;
                  return (
                    <button
                      key={String(t.id)}
                      type="button"
                      onClick={() => setFlowTarget(t.id)}
                      aria-pressed={activeSel}
                      className={`px-4 py-2 rounded-xl font-data text-sm uppercase tracking-wide transition-colors ${
                        activeSel
                          ? "bg-gcs-primary text-white shadow"
                          : "bg-white/60 text-gcs-muted hover:bg-white/80"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">
                {flowTarget === "all"
                  ? "Calibration — pulses per liter (both lines)"
                  : `Calibration — ${FLOW_TARGETS.find((t) => t.id === flowTarget)?.label} pulses per liter`}
              </span>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
                <input
                  type="number"
                  inputMode="numeric"
                  value={pplDraft}
                  min={1}
                  step={1}
                  onChange={(e) => setPplDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyPulsesPerLiter(); }}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/70 border border-gcs-outline/40 font-technical text-base text-gcs-on-surface focus:outline-none focus:border-gcs-primary transition-colors"
                  aria-label="Flow sensor calibration — pulses per liter"
                />
                <button
                  type="button"
                  onClick={applyPulsesPerLiter}
                  disabled={!flowCanSave}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-headline text-base uppercase bg-gcs-primary text-white shadow-lg transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  <span className={`material-symbols-outlined text-xl ${flowSaving ? "animate-spin" : ""}`}>
                    {flowSaving ? "progress_activity" : "save"}
                  </span>
                  {flowSaving ? "Saving" : "Save"}
                </button>
              </div>
            </label>

            {!pplValid && (
              <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-error mt-3">
                <span className="material-symbols-outlined text-base">warning</span>
                Must be a positive number of pulses per liter.
              </p>
            )}
            {flowError && (
              <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-error mt-3">
                <span className="material-symbols-outlined text-base">cloud_off</span>
                Saved locally, but backend push failed — {flowError}
              </p>
            )}
            {flowSaved && !flowError && !flowSaving && (
              <p className="flex items-center gap-1.5 font-technical text-xs text-gcs-primary mt-3">
                <span className="material-symbols-outlined text-base">check_circle</span>
                Calibration pushed to{" "}
                {flowTarget === "all"
                  ? "both flowmeters"
                  : FLOW_TARGETS.find((t) => t.id === flowTarget)?.label}
                .
              </p>
            )}

            <p className="font-technical text-xs text-gcs-muted/80 mt-3 leading-relaxed">
              Pulse count per dispensed liter for the <span className="font-bold">ZJ-S402B</span>{" "}
              flowmeters (default {DEFAULT_PULSES_PER_LITER}). The sprayer has{" "}
              <span className="font-bold">two</span> independent lines — pick a target above to
              calibrate one, or <span className="font-bold">Both lines</span> together. Pushed to the
              backend via{" "}
              <code className="px-1 py-0.5 rounded bg-white/60 text-gcs-on-surface">SetFlowConfig</code>{" "}
              (with{" "}
              <code className="px-1 py-0.5 rounded bg-white/60 text-gcs-on-surface">sensor_id</code>{" "}
              for a single line). Only the <span className="font-bold">Both lines</span> default is
              saved on this tablet.
            </p>
          </Panel>
        </section>

        {/* Live status */}
        <section className="lg:col-span-2 flex flex-col gap-6">
          <Panel title="Live Link" icon="sensors">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="font-technical text-sm text-gcs-muted">
                {secondsAgo == null ? (
                  "Last updated —"
                ) : (
                  <>Last updated <span className="text-gcs-on-surface font-bold">{secondsAgo} s</span> ago</>
                )}
              </p>
              {stale && updatedAt != null && (
                <span className="inline-flex items-center gap-1.5 font-technical text-xs font-bold uppercase tracking-wide text-gcs-secondary">
                  <span className="material-symbols-outlined text-base">history</span>
                  Stale — updated {secondsAgo} s ago
                </span>
              )}
            </div>

            <ReadoutGroup title="State" icon="flight" className="mt-4">
              <Readout label="Connected" value={boolText(state?.connected)} tone={boolTone(state?.connected)} />
              <Readout label="Armed" value={boolText(state?.armed)} tone={state?.armed ? "warn" : "idle"} />
              <Readout label="Guided" value={boolText(state?.guided)} tone={boolTone(state?.guided)} />
              <Readout label="Mode" value={state?.mode || "—"} />
              <Readout label="System status" value={state?.system_status != null ? String(state.system_status) : "—"} />
            </ReadoutGroup>

            <ReadoutGroup title="GPS" icon="satellite_alt" className="mt-4">
              <Readout label="Fix" value={gpsFixLabel(gps?.fix_type)} tone={gpsTone(gps?.fix_type)} />
              <Readout label="Satellites" value={gps?.satellites_visible != null ? String(gps.satellites_visible) : "—"} />
              <Readout label="Coords" value={coords ? `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}` : "—"} wide />
              <Readout label="Ground speed" value={gps?.vel != null ? `${(gps.vel / 100).toFixed(2)} m/s` : "—"} />
              <Readout label="Course" value={gps?.cog != null ? `${(gps.cog / 100).toFixed(1)}°` : "—"} />
            </ReadoutGroup>

            <ReadoutGroup title="Global Position" icon="my_location" className="mt-4">
              <Readout label="Latitude" value={gpos?.latitude != null ? `${gpos.latitude.toFixed(6)}°` : "—"} />
              <Readout label="Longitude" value={gpos?.longitude != null ? `${gpos.longitude.toFixed(6)}°` : "—"} />
              <Readout label="Altitude" value={gpos?.altitude != null ? `${gpos.altitude.toFixed(1)} m` : "—"} />
            </ReadoutGroup>

            <p className="font-technical text-xs text-gcs-muted/70 mt-4 leading-relaxed">
              Live values from the shared diagnostics poller — a null section means no message has arrived on
              that topic yet. Save a new address or interval above to re-arm the poll immediately.
            </p>
          </Panel>
        </section>
      </div>
    </div>
  );
}

/* --- helpers --- */

function boolText(v) {
  if (v == null) return "—";
  return v ? "YES" : "NO";
}

function boolTone(v) {
  if (v == null) return "idle";
  return v ? "ok" : "idle";
}

function gpsTone(fixType) {
  if (fixType == null) return "idle";
  if (fixType >= 3) return "ok";
  if (fixType >= 2) return "warn";
  return "error";
}

/* --- sub-components --- */

function ConnectionBadge({ tone, icon, text, spin }) {
  const toneClasses = {
    ok: "bg-gcs-primary/10 text-gcs-primary",
    warn: "bg-gcs-secondary-fixed/40 text-gcs-secondary",
    error: "bg-gcs-error/10 text-gcs-error",
    idle: "bg-white/70 text-gcs-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-technical text-xs font-bold uppercase tracking-wide max-w-[420px] ${toneClasses[tone]}`}
      role="status"
      aria-live="polite"
    >
      <span className={`material-symbols-outlined text-base ${spin ? "animate-spin" : ""}`}>{icon}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

function Panel({ title, icon, children }) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-gcs-primary">{icon}</span>
        <h2 className="font-data text-lg font-bold text-gcs-on-surface uppercase tracking-wide">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ReadoutGroup({ title, icon, className, children }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined text-base text-gcs-muted">{icon}</span>
        <h3 className="font-data text-sm font-bold text-gcs-muted uppercase tracking-wide">{title}</h3>
      </div>
      <dl className="grid grid-cols-2 gap-2">{children}</dl>
    </div>
  );
}

function Readout({ label, value, tone = "idle", wide }) {
  const toneClasses = {
    ok: "text-gcs-primary",
    warn: "text-gcs-secondary",
    error: "text-gcs-error",
    idle: "text-gcs-on-surface",
  };
  return (
    <div className={`px-3 py-2 rounded-lg bg-white/50 ${wide ? "col-span-2" : ""}`}>
      <dt className="font-data text-xs text-gcs-muted uppercase tracking-wide">{label}</dt>
      <dd className={`font-technical text-sm font-bold truncate ${toneClasses[tone]}`}>{value}</dd>
    </div>
  );
}
