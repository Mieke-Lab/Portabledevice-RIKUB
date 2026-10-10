import { useNavigate } from "react-router-dom";
import { gpsFixLabel, hasGpsFix, isStale, useDiagnostics } from "@/lib/gcs/diagnostics";
import { useDroneSettings } from "@/lib/gcs/drone-settings";

export function Header() {
  const navigate = useNavigate();
  const { data, error, updatedAt, loading } = useDiagnostics();
  const [{ pollIntervalMs }] = useDroneSettings();
  const degraded = !!error || isStale(updatedAt, Math.max(10_000, pollIntervalMs * 3));
  const gps = data?.gps_raw ?? null;
  const state = data?.state ?? null;
  const fix = gps?.fix_type;
  const sats = gps?.satellites_visible;
  const gpsValue = gps ? `${gpsFixLabel(fix)} · ${sats ?? "—"}` : "—";
  const gpsIcon = gps ? (hasGpsFix(fix) ? "gps_fixed" : "gps_off") : "satellite_alt";
  const connected = state?.connected ?? false;
  const linkValue = state ? (connected ? "LINK" : "NO LINK") : "—";
  const modeValue = state?.mode ?? "—";
  const armed = state?.armed ?? false;
  const valueTone = loading ? "text-gcs-primary/40" : "text-gcs-primary";

  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-16 w-full items-center justify-between border-b border-white/30 bg-white/70 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/maps")}
          className="flex items-center justify-center rounded-lg p-1.5 text-gcs-muted transition-colors hover:bg-gcs-primary/10 hover:text-gcs-primary"
          title="Back to Maps"
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <span className="font-headline text-2xl tracking-tight text-gcs-primary">
          BAYUCARAKA UAV
        </span>
      </div>

      <div className="flex items-center gap-4 text-gcs-primary">
        <div
          className={`flex items-center gap-4 transition-opacity ${degraded ? "opacity-50" : ""}`}
          title={error ? `Telemetry offline: ${error}` : degraded ? "Telemetry stale" : undefined}
        >
          <div className="flex items-center gap-1" title="GPS fix · satellites">
            <span className="material-symbols-outlined text-xl text-gcs-primary">{gpsIcon}</span>
            <span className={`font-technical text-[12px] font-medium ${valueTone}`}>{gpsValue}</span>
          </div>
          <div className="flex items-center gap-1" title="FCU connection">
            <span className="material-symbols-outlined text-xl text-gcs-primary">{connected ? "link" : "link_off"}</span>
            <span className={`font-technical text-[12px] font-medium ${valueTone}`}>{linkValue}</span>
          </div>
          <div className="flex items-center gap-1" title="Flight mode">
            <span className="material-symbols-outlined text-xl text-gcs-primary">tune</span>
            <span className={`font-technical text-[12px] font-medium ${valueTone}`}>{modeValue}</span>
            {armed && (
              <span className="material-symbols-outlined text-base text-gcs-error" title="Armed" aria-label="Armed">
                bolt
              </span>
            )}
          </div>
        </div>

        <div className="ml-2 flex items-center gap-2 border-l border-gcs-outline pl-4">
          <div className="text-right">
            <p className="font-technical text-[12px] font-medium leading-none">PILOT_ID</p>
            <p className="font-technical text-[10px] text-gcs-muted">ACTIVE</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-gcs-outline bg-gcs-surface">
            <span className="material-symbols-outlined text-gcs-muted">person</span>
          </div>
        </div>
      </div>
    </header>
  );
}
