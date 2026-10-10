import {
  AlertTriangle,
  Info,
  Loader2,
  MapPin,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

function Metric({ label, value, tone = "emerald" }) {
  const colors =
    tone === "rose"
      ? "border-rose-950/10 bg-rose-50 text-rose-700"
      : "border-emerald-950/10 bg-emerald-50 text-emerald-700";

  return (
    <div className={`rounded-xl border px-2 py-1.5 ${colors}`}>
      <div className="text-[8px] font-black uppercase tracking-[0.1em]">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
        {value}
      </div>
    </div>
  );
}

export function NdviZonesPanel({
  panelSwitch,
  settings,
  rangeMinPercent,
  rangeMaxPercent,
  loading,
  approveLoading,
  error,
  summary,
  features,
  selectedImagery,
  formatNumber,
  onClose,
  onSettingChange,
  onGenerate,
  onApprove,
  approveImpact,
  onConfirmApprove,
  onCancelApprove,
  onFocusZone,
  onDeleteZone,
}) {
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-gray-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-900/10">
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black leading-tight text-gray-950">
              NDVI Zones
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {panelSwitch}
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
            title="Tutup NDVI Zones"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2 rounded-xl border border-emerald-950/10 bg-white px-2.5 py-2 shadow-sm">
        <div className="min-w-0">
          <span className="flex items-center gap-1 text-[10px] font-black text-gray-600">
            <span>NDVI Range</span>
            <button
              type="button"
              className="group relative grid h-4 w-4 place-items-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 focus:outline-none"
              aria-label="Info NDVI Range"
              title="Threshold Min dan Max menentukan rentang nilai NDVI yang akan dijadikan kandidat zona."
            >
              <Info className="h-3 w-3" />
              <span className="pointer-events-none absolute left-0 top-full z-[1003] mt-1 hidden w-48 rounded-lg border border-emerald-100 bg-white px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-gray-700 shadow-[0_10px_28px_rgba(15,23,42,0.16)] group-hover:block group-focus:block">
                Threshold Min dan Max menentukan rentang nilai NDVI yang akan dijadikan kandidat zona.
              </span>
            </button>
          </span>

          <div className="ndvi-range-slider mt-3">
            <div className="ndvi-range-track" />
            <div
              className="ndvi-range-window"
              style={{
                left: `${rangeMinPercent}%`,
                width: `${Math.max(0, rangeMaxPercent - rangeMinPercent)}%`,
              }}
            />
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={settings.ndvi_min}
              onChange={(event) => onSettingChange("ndvi_min", event.target.value)}
              className="ndvi-range-input ndvi-range-input-min"
              style={{
                zIndex: settings.ndvi_min > settings.ndvi_max - 0.12 ? 5 : 3,
              }}
              aria-label="Geser NDVI minimum"
            />
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={settings.ndvi_max}
              onChange={(event) => onSettingChange("ndvi_max", event.target.value)}
              className="ndvi-range-input ndvi-range-input-max"
              aria-label="Geser NDVI maksimum"
            />
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[linear-gradient(to_right,#27272a_0%,#27272a_50%,#ef233c_50%,#f59e0b_60.5%,#7bd85a_70%,#1fbf63_80%,#0f7a3f_90%,#0f7a3f_100%)] shadow-inner" />
          <div className="mt-0.5 flex justify-between text-[8px] font-bold tabular-nums text-gray-400">
            <span>-1</span>
            <span>0</span>
            <span>1</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <label className="block">
              <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                Min
              </span>
              <input
                type="number"
                min="-1"
                max="1"
                step="0.01"
                value={settings.ndvi_min}
                onChange={(event) => onSettingChange("ndvi_min", event.target.value)}
                className="mt-0.5 h-7 w-full rounded-lg border border-gray-200 bg-gray-50 px-1 text-center text-[12px] font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-emerald-700"
                aria-label="NDVI minimum"
              />
            </label>
            <label className="block">
              <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                Max
              </span>
              <input
                type="number"
                min="-1"
                max="1"
                step="0.01"
                value={settings.ndvi_max}
                onChange={(event) => onSettingChange("ndvi_max", event.target.value)}
                className="mt-0.5 h-7 w-full rounded-lg border border-gray-200 bg-gray-50 px-1 text-center text-[12px] font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-emerald-700"
                aria-label="NDVI maksimum"
              />
            </label>
          </div>

          <div className="space-y-1">
            <label className="block">
              <span className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                <span>Area</span>
                <InfoTip label="Info area minimum">
                  Polygon lebih kecil dari nilai ini dibuang sebagai noise.
                </InfoTip>
              </span>
              <UnitInput
                min="0"
                step="0.1"
                value={settings.min_area_m2}
                unit="m2"
                onChange={(value) => onSettingChange("min_area_m2", value)}
              />
            </label>
            <label className="block">
              <span className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
                <span>Merge</span>
                <InfoTip label="Info merge distance">
                  Polygon yang jaraknya dekat akan digabung dalam radius ini.
                </InfoTip>
              </span>
              <UnitInput
                min="0"
                step="0.1"
                value={settings.merge_distance_m}
                unit="m"
                onChange={(value) => onSettingChange("merge_distance_m", value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading || !selectedImagery}
          className="flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-[12px] font-black text-white shadow-[0_10px_20px_rgba(6,95,70,0.18)] transition-colors hover:bg-emerald-900 disabled:bg-gray-200 disabled:text-gray-500"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Generate Zones
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={approveLoading || loading || features.length === 0}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 text-[11px] font-black text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
          title="Simpan zona preview sebagai Spray Targets"
        >
          {approveLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Approve Zones
        </button>
      </div>

      {approveImpact && (
        <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-black">
            <AlertTriangle className="h-3.5 w-3.5" /> Zona lama akan diganti
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-semibold">
            {approveImpact.hpt_total > 0 && (
              <li>
                {approveImpact.hpt_moved} dari {approveImpact.hpt_total} HPT dipindah ke zona baru
                {approveImpact.hpt_unzoned > 0 && (
                  <>; <b>{approveImpact.hpt_unzoned} tidak punya zona baru</b> dan akan dilepas dari zona (data tetap tersimpan)</>
                )}
              </li>
            )}
            {approveImpact.manual_total > 0 && (
              <li>
                {approveImpact.manual_kept} dari {approveImpact.manual_total} pengaturan chamber manual dipertahankan
                {approveImpact.manual_reset > 0 && (
                  <>; <b>{approveImpact.manual_reset} direset</b> karena tidak cocok dengan zona baru</>
                )}
              </li>
            )}
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCancelApprove}
              disabled={approveLoading}
              className="h-8 rounded-xl border border-amber-300 bg-white text-[11px] font-black text-amber-900 hover:bg-amber-100"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={onConfirmApprove}
              disabled={approveLoading}
              className="flex h-8 items-center justify-center gap-1.5 rounded-xl bg-emerald-800 text-[11px] font-black text-white hover:bg-emerald-900 disabled:bg-gray-300"
            >
              {approveLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lanjut Approve
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      )}

      {summary && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="Polygon" value={summary.polygon_count} />
            <Metric label="Area" value={formatNumber(summary.total_area_m2)} />
            <Metric
              label="Mean"
              value={formatNumber(summary.mean_ndvi, 4)}
              tone="rose"
            />
          </div>
          {features.length > 0 && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="grid grid-cols-[56px_1fr_76px_72px] items-center gap-2 border-b border-gray-100 bg-gray-50 py-2 pl-2.5 pr-[22px]">
                <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                  Zona
                </span>
                <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                  Area
                </span>
                <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                  NDVI
                </span>
                <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                  Aksi
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {features.map((feature, index) => {
                  const props = feature.properties ?? {};
                  const zoneId = props.id ?? index + 1;
                  return (
                    <div
                      key={zoneId}
                      className="grid w-full grid-cols-[56px_1fr_76px_72px] items-center gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0"
                    >
                      <span className="text-center text-[12px] font-black text-gray-950">
                        Z{String(zoneId).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 truncate text-center text-[11px] font-black tabular-nums text-gray-700">
                        {formatNumber(props.area_m2)} m2
                      </span>
                      <span className="inline-flex h-6 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-center text-[10px] font-black tabular-nums text-emerald-800">
                        {formatNumber(props.mean_ndvi, 4)}
                      </span>
                      <div className="mx-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onFocusZone(zoneId)}
                          className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50"
                          title="Lihat di peta"
                        >
                          <MapPin className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteZone(zoneId)}
                          className="grid h-8 w-8 place-items-center rounded-xl border border-red-100 bg-white text-red-400 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          title="Hapus zone"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoTip({ label, children }) {
  return (
    <button
      type="button"
      className="group relative grid h-3 w-3 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 focus:outline-none"
      aria-label={label}
      title={children}
    >
      <Info className="h-2.5 w-2.5" />
      <span className="pointer-events-none absolute bottom-full right-0 z-[1003] mb-1 hidden w-44 rounded-lg border border-emerald-100 bg-white px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-gray-700 shadow-[0_10px_28px_rgba(15,23,42,0.16)] group-hover:block group-focus:block">
        {children}
      </span>
    </button>
  );
}

function UnitInput({ min, step, value, unit, onChange }) {
  return (
    <div className="mt-0.5 flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-1 transition-colors focus-within:border-emerald-700">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-black tabular-nums text-gray-900 outline-none"
      />
      <span className="shrink-0 text-[8px] font-bold text-gray-400">
        {unit}
      </span>
    </div>
  );
}
