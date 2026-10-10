import { ChevronDown, ChevronUp, Layers, X } from "lucide-react";

function Stat({ label, value, tone = "text-forest" }) {
  return (
    <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
      <div className={`text-[8px] font-black uppercase tracking-[0.1em] ${tone}`}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
        {value}
      </div>
    </div>
  );
}

// ponytail: rounds to the step's decimal precision so repeated +/- clicks
// never drift into floating-point noise (e.g. 4.2 + 0.1 -> 4.200000000000003).
function roundToStep(value, step) {
  const decimals = (String(step).split(".")[1] || "").length;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function NumberInput({ label, value, min, max, step, unit, onChange }) {
  const stepSize = Number(step) || 1;
  const minValue = Number(min) || 0;
  const maxValue = max !== undefined ? Number(max) : Infinity;

  return (
    <label className="block">
      <span className="block text-[7px] font-bold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </span>
      <div className="mt-0.5 flex h-7 items-center rounded-lg border border-white/10 bg-white/5 pl-1.5 focus-within:border-emerald-300/60">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-semibold tabular-nums text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pr-1 text-[9px] font-medium text-slate-400">{unit}</span>
        <div className="flex h-full flex-col border-l border-white/10">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onChange(roundToStep(Math.min(maxValue, value + stepSize), step))}
            className="flex h-1/2 w-4 items-center justify-center text-slate-400 transition-colors hover:text-emerald-300"
          >
            <ChevronUp className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onChange(roundToStep(Math.max(minValue, value - stepSize), step))}
            className="flex h-1/2 w-4 items-center justify-center border-t border-white/10 text-slate-400 transition-colors hover:text-emerald-300"
          >
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </label>
  );
}

export function ReadonlyField({ label, value, hint }) {
  return (
    <div className="block">
      <span className="block text-[7px] font-bold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </span>
      <div className="mt-0.5 flex h-7 items-center justify-center rounded-lg border border-white/5 bg-white/5 px-1.5">
        <span className="text-[12px] font-semibold tabular-nums text-slate-100">{value}</span>
      </div>
      {hint && (
        <span className="mt-0.5 block truncate text-center text-[7px] font-medium text-slate-400">
          {hint}
        </span>
      )}
    </div>
  );
}

function ChamberGroupRow({ group }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1">
          {group.chambers.map((chamber) => (
            <span
              key={chamber}
              className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] text-rose-700 ring-1 ring-rose-200"
            >
              {chamber}
            </span>
          ))}
        </div>
        <div className="mt-1 truncate text-[10px] font-semibold text-gray-500">
          {group.zoneCodes.join(", ")}
        </div>
      </div>
      <div className="shrink-0 text-right text-[10px] font-black tabular-nums text-gray-700">
        {group.sprayWidth.toFixed(1)}m &middot; {group.laneSpacing.toFixed(1)}m
      </div>
    </div>
  );
}

export function SprayingRoutePanel({
  panelSwitch,
  targetCount,
  waypointCount,
  readyCount,
  missingZones = [],
  groups = [],
  laneSpacingInvalid,
  onClose,
  onOpenTargets,
}) {
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-gray-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-tight text-gray-950">
            Misi Penyemprotan
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
            Rute, waypoint, dan status drone
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {panelSwitch}
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
            title="Tutup Spraying Route"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {targetCount === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50 to-cream">
          <div className="px-4 pb-5 pt-4 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white text-forest shadow-sm ring-1 ring-emerald-100">
              <Layers className="h-5 w-5" />
            </div>
            <div className="text-[13px] font-black text-emerald-950">
              Belum ada target semprot
            </div>
            <p className="mx-auto mt-1 max-w-[310px] text-xs font-semibold leading-snug text-emerald-800">
              Aktifkan Spray Targets atau approve NDVI Zones terlebih dahulu sebelum membuat rute.
            </p>
            <button
              type="button"
              onClick={onOpenTargets}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-xl bg-forest px-4 text-[11px] font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.18)] transition-colors hover:bg-house"
            >
              Buka Spray Targets
            </button>
          </div>
          <div className="grid grid-cols-3 border-t border-emerald-100 bg-white/70 text-center text-[9px] font-black uppercase tracking-[0.08em] text-emerald-800">
            <div className="px-2 py-2">Targets</div>
            <div className="border-x border-emerald-100 px-2 py-2">Route</div>
            <div className="px-2 py-2">Mission</div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Target" value={targetCount} />
            <Stat label="Waypoint" value={waypointCount} />
            <Stat
              label="Ready"
              value={`${readyCount}/${targetCount}`}
              tone="text-emerald-700"
            />
          </div>

          {missingZones.length > 0 && (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-700">
                Chamber belum lengkap
              </div>
              <div className="mt-1 text-xs font-semibold leading-snug text-rose-800">
                Lengkapi chamber untuk {missingZones.join(", ")} sebelum generate route.
              </div>
              <button
                type="button"
                onClick={onOpenTargets}
                className="mt-2 h-8 rounded-lg bg-white px-3 text-[10px] font-black text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-100"
              >
                Buka Spray Targets
              </button>
            </div>
          )}

          {missingZones.length === 0 && laneSpacingInvalid && (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-700">
                Lane spacing terlalu lebar
              </div>
              <div className="mt-1 text-xs font-semibold leading-snug text-rose-800">
                Lane spacing melebihi spray width. Area bisa tidak tersemprot.
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 bg-gray-50 px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                Chamber Groups
              </div>
              {groups.map((group) => (
                <ChamberGroupRow key={group.key} group={group} />
              ))}
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled
              className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
              title="Belum terhubung ke backend drone"
            >
              Upload Mission
            </button>
            <button
              type="button"
              disabled
              className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
              title="Belum terhubung ke backend drone"
            >
              Execute
            </button>
          </div>
        </>
      )}
    </div>
  );
}
