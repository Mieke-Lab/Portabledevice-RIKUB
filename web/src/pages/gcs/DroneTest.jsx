import { useCallback, useEffect, useRef, useState } from "react";
import {
  armDrone,
  disarmDrone,
  fetchDroneStatus,
  gotoPoint,
  landDrone,
  pushMission,
  setDroneMode,
  takeoffDrone,
} from "@/lib/gcs/api";
import { useDiagnostics } from "@/lib/gcs/diagnostics";

const FLIGHT_MODES = ["STABILIZE", "GUIDED", "AUTO", "LOITER", "RTL", "LAND"];
const POLL_INTERVAL_MS = 2000;

function fmtStatus(s) {
  if (!s.available) return s.init_error || "controller unavailable";
  const z = s.position?.z;
  return [
    s.fcu_connected ? "FCU up" : "FCU down",
    s.armed ? "ARMED" : "disarmed",
    s.mode ?? "—",
    z != null ? `z=${z.toFixed(2)}m` : "z=—",
    s.mission_running ? "running" : "idle",
  ].join(" · ");
}

export function DroneTest() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [logEntries, setLogEntries] = useState([]);

  const [takeoffAlt, setTakeoffAlt] = useState(5);
  const [selectedMode, setSelectedMode] = useState("GUIDED");
  const [waypointCount, setWaypointCount] = useState(8);
  const [gotoXYZ, setGotoXYZ] = useState({ x: 5, y: 0, z: 5 });

  const diag = useDiagnostics();
  const logId = useRef(0);
  const busyRef = useRef(false);

  const log = useCallback((command, result, message, params) => {
    setLogEntries((prev) =>
      [
        {
          id: logId.current++,
          time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          command,
          params,
          result,
          message,
        },
        ...prev,
      ].slice(0, 100),
    );
  }, []);

  useEffect(() => {
    let active = true;
    async function poll() {
      if (busyRef.current) return;
      try {
        const s = await fetchDroneStatus();
        if (!active) return;
        setStatus(s);
        setStatusError(null);
      } catch (e) {
        if (!active) return;
        setStatusError(e instanceof Error ? e.message : "status unavailable");
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  const run = useCallback(async (command, params, fn) => {
    busyRef.current = true;
    setBusy(command);
    try {
      const s = await fn();
      setStatus(s);
      setStatusError(null);
      log(command, "ACK", fmtStatus(s), params);
    } catch (e) {
      log(command, "NAK", e instanceof Error ? e.message : String(e), params);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [log]);

  const refresh = useCallback(async () => {
    busyRef.current = true;
    try {
      const s = await fetchDroneStatus();
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "status unavailable");
    } finally {
      busyRef.current = false;
    }
  }, []);

  const ready = !!status?.available && !statusError;
  const blocked = busy !== null || !ready;
  const running = !!status?.mission_running;
  const armed = !!status?.armed;
  const altitude = status?.position?.z ?? null;

  const dState = diag.data?.state ?? null;
  const linkUp = dState?.connected ?? !!status?.fcu_connected;
  const displayArmed = dState?.armed ?? armed;
  const displayMode = dState?.mode ?? status?.mode ?? "—";

  const onArm = () => run("ARM", undefined, () => armDrone());
  const onDisarm = () => run("DISARM", undefined, () => disarmDrone());
  const onTakeoff = () => run("TAKEOFF", `${takeoffAlt} m`, () => takeoffDrone({ altitude: takeoffAlt }));
  const onLand = () => run("LAND", undefined, () => landDrone());
  const onSetMode = () => run("SET_MODE", selectedMode, () => setDroneMode(selectedMode));
  const onGoto = () =>
    run("GOTO", `${gotoXYZ.x},${gotoXYZ.y},${gotoXYZ.z}`, () =>
      gotoPoint({ x: gotoXYZ.x, y: gotoXYZ.y, z: gotoXYZ.z }),
    );
  const onPushMission = () => {
    const waypoints = Array.from({ length: waypointCount }, (_, i) => ({
      x: 100 + (i % 2) * 200,
      y: 100 + i * 40,
    }));
    run("PUSH_MISSION", `${waypointCount} wp`, () =>
      pushMission({ waypoints, altitude: takeoffAlt }),
    );
  };

  let badge;
  if (statusError) {
    badge = { tone: "error", icon: "cloud_off", text: `Backend unreachable — ${statusError}` };
  } else if (!status) {
    badge = { tone: "idle", icon: "sync", text: "Connecting to DroneService…" };
  } else if (!status.available) {
    badge = { tone: "warn", icon: "warning", text: status.init_error || "Controller unavailable" };
  } else {
    badge = {
      tone: "ok",
      icon: "cloud_done",
      text: `DroneService · FCU ${status.fcu_connected ? "connected" : "no link"}`,
    };
  }

  const badgeTone = {
    ok: "bg-gcs-primary/10 text-gcs-primary",
    warn: "bg-gcs-secondary-fixed/40 text-gcs-secondary",
    error: "bg-gcs-error/10 text-gcs-error",
    idle: "bg-white/70 text-gcs-muted",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-4xl text-gcs-primary uppercase leading-none">Flight Test Bench</h1>
          <p className="font-data text-lg text-gcs-muted mt-1">
            Manual command surface — arm · takeoff · land · set-mode · goto · push mission
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-technical text-xs font-bold uppercase tracking-wide max-w-[420px] ${badgeTone[badge.tone]}`}
          >
            <span className={`material-symbols-outlined text-base ${badge.tone === "idle" ? "animate-spin" : ""}`}>
              {badge.icon}
            </span>
            <span className="truncate">{badge.text}</span>
          </span>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-data text-sm text-gcs-muted hover:bg-gcs-primary/10 hover:text-gcs-primary transition-colors"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Mission-running banner */}
      {running && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gcs-secondary-fixed/40 border border-gcs-secondary/30 font-data text-gcs-secondary">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          <span className="font-bold uppercase tracking-wide text-sm">
            Mission running — fire-and-poll command in progress
          </span>
        </div>
      )}

      {/* Telemetry stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Link" value={linkUp ? "CONNECTED" : "NO LINK"} icon={linkUp ? "link" : "link_off"} tone={linkUp ? "ok" : "error"} />
        <StatCard label="Armed" value={displayArmed ? "ARMED" : "DISARMED"} icon={displayArmed ? "bolt" : "power_settings_new"} tone={displayArmed ? "active" : "idle"} />
        <StatCard label="Mode" value={displayMode} icon="tune" tone="idle" />
        <StatCard
          label="Altitude"
          value={altitude != null ? `${altitude.toFixed(1)} m` : "—"}
          icon={altitude != null && altitude > 0.2 ? "flight" : "flight_land"}
          tone={altitude != null && altitude > 0.2 ? "active" : "idle"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Controls */}
        <section className="lg:col-span-3 flex flex-col gap-4">
          <Panel title="Arming" icon="power_settings_new">
            <div className="grid grid-cols-2 gap-3">
              <CommandButton label="Arm" icon="bolt" tone="primary" onClick={onArm} loading={busy === "ARM"} disabled={blocked || armed} />
              <CommandButton label="Disarm" icon="power_off" tone="error" onClick={onDisarm} loading={busy === "DISARM"} disabled={blocked || !armed} />
            </div>
          </Panel>

          <Panel title="Takeoff & Land" icon="flight_takeoff">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <NumberField label="Target altitude (m)" value={takeoffAlt} min={0} step={0.5} onChange={setTakeoffAlt} />
              <div className="grid grid-cols-2 gap-3 flex-1">
                <CommandButton label="Takeoff" icon="flight_takeoff" tone="primary" onClick={onTakeoff} loading={busy === "TAKEOFF"} disabled={blocked || running} />
                <CommandButton label="Land" icon="flight_land" tone="neutral" onClick={onLand} loading={busy === "LAND"} disabled={blocked} />
              </div>
            </div>
          </Panel>

          <Panel title="Goto (local setpoint)" icon="my_location">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="grid grid-cols-3 gap-3 flex-1">
                <NumberField label="X (m)" value={gotoXYZ.x} step={0.5} onChange={(x) => setGotoXYZ((p) => ({ ...p, x }))} />
                <NumberField label="Y (m)" value={gotoXYZ.y} step={0.5} onChange={(y) => setGotoXYZ((p) => ({ ...p, y }))} />
                <NumberField label="Z (m)" value={gotoXYZ.z} min={0} step={0.5} onChange={(z) => setGotoXYZ((p) => ({ ...p, z }))} />
              </div>
              <CommandButton label="Goto" icon="near_me" tone="primary" onClick={onGoto} loading={busy === "GOTO"} disabled={blocked || running || !armed} />
            </div>
            <p className="font-technical text-xs text-gcs-muted mt-3">
              Requires the vehicle to be flying (GUIDED, e.g. after takeoff).
            </p>
          </Panel>

          <Panel title="Flight Mode" icon="tune">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <label className="flex flex-col gap-1.5 flex-1">
                <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">Mode</span>
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/70 border border-gcs-outline/40 font-technical text-base text-gcs-on-surface focus:outline-none focus:border-gcs-primary transition-colors"
                >
                  {FLIGHT_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <CommandButton label="Set Mode" icon="send" tone="primary" onClick={onSetMode} loading={busy === "SET_MODE"} disabled={blocked} />
            </div>
          </Panel>

          <Panel title="Mission" icon="route">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <NumberField label="Waypoints" value={waypointCount} min={1} step={1} onChange={setWaypointCount} />
              <CommandButton label="Push Mission" icon="upload" tone="primary" onClick={onPushMission} loading={busy === "PUSH_MISSION"} disabled={blocked} />
            </div>
            <p className="font-technical text-xs text-gcs-muted mt-3">
              Uploads {waypointCount} synthetic pixel waypoints (converted to local-NED server-side). Does not fly them.
            </p>
          </Panel>
        </section>

        {/* Command log */}
        <section className="lg:col-span-2">
          <div className="glass-panel rounded-2xl flex flex-col h-full min-h-[400px] max-h-[calc(100vh-240px)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gcs-outline/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-gcs-primary">terminal</span>
                <h2 className="font-data text-lg font-bold text-gcs-on-surface uppercase tracking-wide">Command Log</h2>
              </div>
              <button
                onClick={() => setLogEntries([])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-data text-sm text-gcs-muted hover:bg-gcs-error/10 hover:text-gcs-error transition-colors"
              >
                <span className="material-symbols-outlined text-base">clear_all</span>
                Clear
              </button>
            </div>
            <ol className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
              {logEntries.length === 0 ? (
                <li className="font-technical text-sm text-gcs-muted/60 text-center py-8">
                  No commands issued yet.
                </li>
              ) : (
                logEntries.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/50 font-technical text-xs">
                    <span className="text-gcs-muted/70 shrink-0">{e.time}</span>
                    <span className={`shrink-0 font-bold ${e.result === "ACK" ? "text-gcs-primary" : "text-gcs-error"}`}>
                      {e.result}
                    </span>
                    <span className="text-gcs-on-surface">
                      <span className="font-bold">{e.command}</span>
                      {e.params ? <span className="text-gcs-muted"> [{e.params}]</span> : null}
                      <span className="text-gcs-muted"> — {e.message}</span>
                    </span>
                  </li>
                ))
              )}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, tone }) {
  const toneClasses = {
    ok: "text-gcs-primary",
    error: "text-gcs-error",
    active: "text-gcs-secondary",
    idle: "text-gcs-muted",
  };
  return (
    <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
      <span className={`material-symbols-outlined text-3xl ${toneClasses[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="font-data text-xs text-gcs-muted uppercase tracking-wide">{label}</p>
        <p className={`font-technical text-lg font-bold truncate ${toneClasses[tone]}`}>{value}</p>
      </div>
    </div>
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

function CommandButton({ label, icon, tone, onClick, disabled, loading }) {
  const toneClasses = {
    primary: "bg-gcs-primary text-white hover:bg-gcs-primary/90 shadow-gcs-primary/20",
    error: "bg-gcs-error text-white hover:bg-gcs-error/90 shadow-gcs-error/20",
    neutral: "bg-white/70 text-gcs-on-surface border border-gcs-outline/40 hover:bg-white",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-headline text-lg uppercase shadow-lg transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${toneClasses[tone]}`}
    >
      <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`}>
        {loading ? "progress_activity" : icon}
      </span>
      {label}
    </button>
  );
}

function NumberField({ label, value, min, step, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-data text-sm text-gcs-muted uppercase tracking-wide">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-4 py-3 rounded-xl bg-white/70 border border-gcs-outline/40 font-technical text-base text-gcs-on-surface focus:outline-none focus:border-gcs-primary transition-colors"
      />
    </label>
  );
}
