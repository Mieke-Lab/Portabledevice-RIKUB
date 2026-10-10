import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { gpsFixLabel, isStale, useDiagnostics } from "@/lib/gcs/diagnostics";
import { useDroneSettings } from "@/lib/gcs/drone-settings";

function TelemetrySection({ title, rows }) {
  return (
    <div className="rounded-2xl border border-emerald-300/16 bg-gradient-to-br from-house/92 to-slate-950/82 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" />
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 [&>span]:flex [&>span]:justify-between [&>span]:gap-2 [&>span>span]:text-slate-400">
        {rows.map(([label, value]) => (
          <span key={label}>
            <span className="text-slate-400">{label}</span> {value}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatLastUpdate(updatedAt, now) {
  if (updatedAt == null) return "never";

  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 1) return "now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s ago` : `${minutes}m ago`;
}


export function DroneTelemetryBar({ collapsed, onToggle }) {
  const { data, error, updatedAt, loading } = useDiagnostics()
  const [{ pollIntervalMs }] = useDroneSettings()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const state = data?.state ?? null
  const gps = data?.gps_raw ?? null
  const global = data?.global_position ?? null
  const imu = data?.imu ?? null
  const stale = !error && isStale(updatedAt, Math.max(10_000, pollIntervalMs * 3))
  const offline = !!error || !data || !data.available

  const heading =
    gps?.yaw != null && Number.isFinite(gps.yaw) && gps.yaw !== 0 && gps.yaw !== 65535
      ? `${((gps.yaw / 100) % 360).toFixed(0)}°`
      : gps?.cog != null && Number.isFinite(gps.cog) && gps.cog >= 0 && gps.cog < 36000
        ? `${((gps.cog / 100) % 360).toFixed(0)}°`
        : "—"

  const sections = [
    {
      title: "Flight State",
      rows: [
        ["Connected", state ? (state.connected ? "LINK" : "NO LINK") : "—"],
        ["Armed", state ? (state.armed ? "ARMED" : "DISARMED") : "—"],
        ["Guided", state ? (state.guided ? "YES" : "NO") : "—"],
        ["Manual", state ? (state.manual_input ? "YES" : "NO") : "—"],
        ["Mode", state?.mode ?? "—"],
        ["System", state?.system_status ?? "—"],
      ],
    },
    {
      title: "GPS",
      rows: [
        ["Fix", gps ? gpsFixLabel(gps.fix_type) : "—"],
        ["Sat", gps?.satellites_visible ?? "—"],
        ["Lat", gps?.lat != null ? (gps.lat / 1e7).toFixed(6) : "—"],
        ["Lon", gps?.lon != null ? (gps.lon / 1e7).toFixed(6) : "—"],
        ["Speed", gps?.vel != null ? `${(gps.vel / 100).toFixed(1)} m/s` : "—"],
        ["Course", heading],
        ["EPH", gps?.eph ?? "—"],
        ["EPV", gps?.epv ?? "—"],
        ["Alt MSL", gps?.alt != null ? `${(gps.alt / 1000).toFixed(1)} m` : "—"],
      ],
    },
    {
      title: "Global Position",
      rows: [
        ["Lat", global?.latitude != null ? global.latitude.toFixed(6) : "—"],
        ["Lon", global?.longitude != null ? global.longitude.toFixed(6) : "—"],
        ["Alt Ellip", global?.altitude != null ? `${global.altitude.toFixed(1)} m` : "—"],
        ["Source", global ? "FUSED" : "—"],
      ],
    },
    {
      title: "IMU",
      rows: [
        ["Accel X", imu?.linear_acceleration?.x != null ? imu.linear_acceleration.x.toFixed(2) : "—"],
        ["Accel Y", imu?.linear_acceleration?.y != null ? imu.linear_acceleration.y.toFixed(2) : "—"],
        ["Accel Z", imu?.linear_acceleration?.z != null ? imu.linear_acceleration.z.toFixed(2) : "—"],
        ["Gyro X", imu?.angular_velocity?.x != null ? imu.angular_velocity.x.toFixed(2) : "—"],
        ["Gyro Y", imu?.angular_velocity?.y != null ? imu.angular_velocity.y.toFixed(2) : "—"],
        ["Gyro Z", imu?.angular_velocity?.z != null ? imu.angular_velocity.z.toFixed(2) : "—"],
        ["Quat X", imu?.orientation?.x != null ? imu.orientation.x.toFixed(3) : "—"],
        ["Quat Y", imu?.orientation?.y != null ? imu.orientation.y.toFixed(3) : "—"],
        ["Quat Z", imu?.orientation?.z != null ? imu.orientation.z.toFixed(3) : "—"],
        ["Quat W", imu?.orientation?.w != null ? imu.orientation.w.toFixed(3) : "—"],
      ],
    },
  ]

  const statusText = loading && !data ? "Connecting to telemetry…" : offline ? "Drone Offline" : stale ? "Telemetry Stale" : "Drone Online"
  const lastUpdate = formatLastUpdate(updatedAt, now)

  return (
    <div className="absolute bottom-6 left-4 right-20 z-[1000] flex justify-end lg:left-auto lg:max-w-[calc(100vw-8rem)]">
      <div className="max-w-full rounded-[22px] border border-emerald-300/14 bg-house/92 px-3 py-2 text-white shadow-[0_18px_48px_rgba(2,6,23,0.42)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ring-4 ${
                offline
                  ? "bg-slate-400 ring-slate-400/15"
                  : stale
                    ? "bg-amber-300 ring-amber-300/15"
                    : "bg-emerald-300 ring-emerald-300/15"
              }`}
            />
            <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-slate-100">
              {statusText}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!collapsed && (
              <span className="rounded-full bg-slate-800/90 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-slate-100 ring-1 ring-emerald-200/10">
                Updated {lastUpdate}
              </span>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-slate-100 ring-1 ring-emerald-200/10 transition hover:bg-white/20"
              aria-label={collapsed ? "Expand telemetry" : "Collapse telemetry"}
              title={collapsed ? "Expand telemetry" : "Collapse telemetry"}
            >
              {collapsed ? (
                <ChevronLeft className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="mt-2 grid max-h-[34dvh] gap-2 overflow-y-auto overscroll-contain pr-1 text-[10px] font-bold tabular-nums text-slate-50 sm:grid-cols-2 xl:grid-cols-4">
            {sections.map((section) => (
              <TelemetrySection key={section.title} {...section} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
