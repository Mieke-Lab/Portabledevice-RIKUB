import { useEffect, useState } from "react";
import { ActiveMissionCard } from "@/components/gcs/ActiveMissionCard";
import { DroneMap } from "@/components/gcs/DroneMap";
import {
  activeJobId,
  diagnosticsCoords,
  gpsFixLabel,
  hasGpsFix,
  headingDeg,
  isStale,
  useDiagnostics,
} from "@/lib/gcs/diagnostics";
import { useDroneSettings } from "@/lib/gcs/drone-settings";
import { useMissionPlan } from "@/lib/gcs/mission-plan";
import { useActiveJob } from "@/lib/gcs/use-active-job";

// Flowmeter id → the ESP pin it's wired to (for labelling the per-line stats).
const FLOW_LINE_PIN = { 1: "D32", 2: "D4" };

function num(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function agoLabel(updatedAt, now) {
  if (updatedAt == null) return "never";
  const secs = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (secs < 1) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
}

export function Dashboard() {
  const { data, error, updatedAt, loading } = useDiagnostics();
  const [{ pollIntervalMs }] = useDroneSettings();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = updatedAt != null && isStale(updatedAt, Math.max(10000, pollIntervalMs * 3));
  const state = data?.state ?? null;
  const gps = data?.gps_raw ?? null;
  const global = data?.global_position ?? null;
  const imu = data?.imu ?? null;
  const flow = data?.flow ?? null;
  const coords = diagnosticsCoords(data);
  const mapCoords = coords ? { lat: coords.lat, lng: coords.lon } : null;
  const heading = headingDeg(data);
  const jobId = activeJobId(data);

  const missionPlan = useMissionPlan();
  const effectiveJobId = jobId ?? missionPlan?.jobId ?? null;
  const { job: activeJob, loading: jobLoading, error: jobError } = useActiveJob(effectiveJobId);

  let banner = { tone: "idle", icon: "sync", text: "Waiting for telemetry", spin: true };
  if (loading && !data) banner = { tone: "idle", icon: "sync", text: "Connecting to telemetry...", spin: true };
  else if (error) banner = { tone: "error", icon: "cloud_off", text: `Telemetry unreachable - ${error}` };
  else if (data && !data.available) banner = { tone: "warn", icon: "sensors_off", text: "Controller offline - no ROS/FCU link" };
  else if (data?.available) banner = { tone: "ok", icon: "cloud_done", text: `Telemetry online - updated ${agoLabel(updatedAt, now)}` };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-4xl uppercase leading-none text-gcs-primary">
            Dashboard
          </h1>
          <p className="mt-1 font-data text-lg text-gcs-muted">
            Live drone telemetry — state · GPS · global position · IMU
          </p>
        </div>
        {data?.available && (
          <span className="font-technical text-xs font-bold uppercase tracking-wide text-gcs-muted">
            updated {agoLabel(updatedAt, now)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 font-technical text-sm font-bold uppercase tracking-wide ${BANNER_TONE[banner.tone]}`}>
          <span className={`material-symbols-outlined text-lg ${banner.spin ? "animate-spin" : ""}`}>
            {banner.icon}
          </span>
          {banner.text}
        </span>
        {stale && (
          <span className="inline-flex items-center gap-2 rounded-full bg-gcs-secondary-fixed px-3 py-2 font-technical text-xs font-bold uppercase tracking-wide text-gcs-on-secondary-fixed">
            <span className="material-symbols-outlined text-base">history</span>
            Stale — no recent update
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DroneMap coords={mapCoords} headingDeg={heading} active={!!jobId} label={jobId} />
        </div>
        <ActiveMissionCard
          jobId={effectiveJobId}
          job={activeJob}
          loading={jobLoading}
          error={jobError}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Section title="Flight State" icon="flight" empty={!state}>
          <Stat label="Connected" value={state ? (state.connected ? "CONNECTED" : "NO LINK") : "-"} tone={state?.connected ? "ok" : "error"} icon={state?.connected ? "link" : "link_off"} />
          <Stat label="Armed" value={state ? (state.armed ? "ARMED" : "DISARMED") : "-"} tone={state?.armed ? "active" : "idle"} icon={state?.armed ? "bolt" : "power_settings_new"} highlight={state?.armed} />
          <Stat label="Guided" value={state ? (state.guided ? "YES" : "NO") : "-"} tone={state?.guided ? "ok" : "idle"} icon="travel_explore" />
          <Stat label="Mode" value={state?.mode || "-"} tone="idle" icon="tune" />
          <Stat label="System Status" value={state ? String(state.system_status) : "-"} tone="idle" icon="monitor_heart" />
        </Section>

        <Section title="GPS" icon="satellite_alt" empty={!gps}>
          <Stat label="Fix" value={gpsFixLabel(gps?.fix_type)} tone={hasGpsFix(gps?.fix_type) ? "ok" : "error"} icon={hasGpsFix(gps?.fix_type) ? "gps_fixed" : "gps_off"} />
          <Stat label="Satellites" value={gps ? String(gps.satellites_visible ?? "-") : "-"} tone="idle" icon="settings_input_antenna" />
          <Stat label="Latitude" value={gps ? `${num(gps.lat / 1e7, 6)} deg` : "-"} tone="idle" icon="my_location" />
          <Stat label="Longitude" value={gps ? `${num(gps.lon / 1e7, 6)} deg` : "-"} tone="idle" icon="my_location" />
          <Stat label="Ground Speed" value={gps ? `${num(gps.vel / 100)} m/s` : "-"} tone="idle" icon="speed" />
          <Stat label="Course" value={gps ? `${num(gps.cog / 100)} deg` : "-"} tone="idle" icon="explore" />
        </Section>

        <Section title="Global Position" icon="public" empty={!global}>
          <Stat label="Latitude" value={global ? `${num(global.latitude, 6)} deg` : "-"} tone="idle" icon="my_location" />
          <Stat label="Longitude" value={global ? `${num(global.longitude, 6)} deg` : "-"} tone="idle" icon="my_location" />
          <Stat label="Altitude" value={global ? `${num(global.altitude)} m` : "-"} tone="idle" icon="height" />
          <Stat label="Fix Source" value={coords ? (global ? "FUSED" : "RAW GPS") : "-"} tone="idle" icon="my_location" />
        </Section>

        <Section title="Flow" icon="water_drop" empty={!flow}>
          <Stat label="Total Flow" value={flow ? `${num(flow.flow_rate_lpm, 1)} L/min` : "-"} tone="idle" icon="water_drop" />
          <Stat label="Total Volume" value={flow ? `${num(flow.total_liters)} L` : "-"} tone="idle" icon="opacity" />
          <Stat label="Link" value={flow ? (flow.connected ? "CONNECTED" : "NO LINK") : "-"} tone={flow ? (flow.connected ? "ok" : "error") : "idle"} icon={flow?.connected ? "link" : "link_off"} />
          {(flow?.sensors ?? []).map((s) => (
            <Stat
              key={s.id}
              label={`Line ${s.id}${FLOW_LINE_PIN[s.id] ? ` · ${FLOW_LINE_PIN[s.id]}` : ""}`}
              value={`${num(s.flow_rate_lpm, 1)} L/min`}
              icon={s.id >= 1 && s.id <= 9 ? `filter_${s.id}` : "water_drop"}
              tone={s.connected ? "ok" : "error"}
            />
          ))}
        </Section>

        <Section title="IMU" icon="sensors" empty={!imu} className="md:col-span-2 lg:col-span-3">
          <Stat label="Accel X" value={imu ? `${num(imu.linear_acceleration?.x)} m/s2` : "-"} tone="idle" icon="arrow_right_alt" />
          <Stat label="Accel Y" value={imu ? `${num(imu.linear_acceleration?.y)} m/s2` : "-"} tone="idle" icon="arrow_right_alt" />
          <Stat label="Accel Z" value={imu ? `${num(imu.linear_acceleration?.z)} m/s2` : "-"} tone="idle" icon="arrow_right_alt" />
          <Stat label="Gyro X" value={imu ? `${num(imu.angular_velocity?.x, 4)} rad/s` : "-"} tone="idle" icon="sync" />
          <Stat label="Gyro Y" value={imu ? `${num(imu.angular_velocity?.y, 4)} rad/s` : "-"} tone="idle" icon="sync" />
          <Stat label="Gyro Z" value={imu ? `${num(imu.angular_velocity?.z, 4)} rad/s` : "-"} tone="idle" icon="sync" />
          <Stat label="Heading" value={heading == null ? "-" : `${num(heading, 1)} deg`} tone="active" icon="explore" highlight={heading != null} />
        </Section>
      </div>
    </div>
  );
}

const BANNER_TONE = {
  ok: "bg-gcs-primary/10 text-gcs-primary",
  warn: "bg-gcs-secondary-fixed text-gcs-on-secondary-fixed",
  error: "bg-gcs-error/10 text-gcs-error",
  idle: "bg-white/70 text-gcs-muted",
};

function Section({ title, icon, empty, className = "", children }) {
  return (
    <div className={`glass-panel flex flex-col rounded-2xl p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-gcs-primary">{icon}</span>
          <h2 className="font-data text-lg font-bold uppercase tracking-wide text-gcs-on-surface">
            {title}
          </h2>
        </div>
        {empty && <span className="font-technical text-xs uppercase tracking-wide text-gcs-muted/70">no data yet</span>}
      </div>
      {empty ? (
        <div className="flex flex-1 items-center justify-center py-6 font-technical text-gcs-muted/60">
          no data yet
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
      )}
    </div>
  );
}

const STAT_TONE = {
  ok: "text-gcs-primary",
  error: "text-gcs-error",
  active: "text-gcs-secondary",
  idle: "text-gcs-on-surface",
};

function Stat({ label, value, icon, tone, highlight }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl p-3 ${highlight ? "bg-gcs-secondary-fixed/70 ring-1 ring-gcs-secondary/40" : "bg-white/50"}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`material-symbols-outlined shrink-0 text-base ${highlight ? "text-gcs-on-secondary-fixed" : STAT_TONE[tone]}`}>
          {icon}
        </span>
        <span className="truncate font-data text-[0.7rem] uppercase tracking-wide text-gcs-muted">
          {label}
        </span>
      </div>
      <p className={`truncate font-technical text-base font-bold ${highlight ? "text-gcs-on-secondary-fixed" : STAT_TONE[tone]}`} title={value}>
        {value}
      </p>
    </div>
  );
}
