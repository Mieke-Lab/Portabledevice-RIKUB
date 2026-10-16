import { NumberInput, ReadonlyField } from "./SprayingRoutePanel";

export function FlightSettingsWidget({
  altitude,
  laneSpacing,
  sprayWidth,
  overlapPercent,
  onAltitudeChange,
  onLaneSpacingChange,
  routeReady,
  panelSwitch,
}) {
  return (
    <div className="absolute right-20 top-[82px] z-[1000] w-[184px] sm:top-4">
      {panelSwitch && <div className="mb-2 flex justify-end">{panelSwitch}</div>}
      <div className="rounded-xl border border-emerald-300/14 bg-house/92 p-2 text-white shadow-[0_18px_48px_rgba(2,6,23,0.42)] backdrop-blur-xl">
        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300/80" />
          <span className="truncate">Flight Settings</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberInput
            label="Altitude"
            min="2"
            max="10"
            step="0.5"
            value={altitude}
            unit="m"
            onChange={(value) => onAltitudeChange(Math.min(10, Math.max(2, value || 2)))}
          />
          <NumberInput
            label="Lane Spacing"
            min="0.1"
            step="0.1"
            value={laneSpacing}
            unit="m"
            onChange={(value) => onLaneSpacingChange(Math.max(0.1, value || 0.1))}
          />
          <ReadonlyField
            label="Spray Width"
            value={`${sprayWidth.toFixed(1)} m`}
            hint="Auto dari altitude"
          />
          <ReadonlyField label="Overlap" value={`${overlapPercent}%`} hint="Estimasi" />
        </div>
        <button
          type="button"
          disabled={!routeReady}
          className={`mt-1.5 flex h-8 w-full items-center justify-center rounded-lg text-[11px] font-black transition-colors ${
            routeReady
              ? "bg-emerald-400 text-house shadow-[0_8px_20px_rgba(16,185,129,0.28)] hover:bg-emerald-300"
              : "bg-white/5 text-slate-500"
          }`}
          title={routeReady ? "Generate route" : "Lengkapi chamber semua target dulu"}
        >
          Generate Route
        </button>
      </div>
    </div>
  );
}
