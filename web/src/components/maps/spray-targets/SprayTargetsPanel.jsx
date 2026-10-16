import { Loader2, MapPin, PenLine } from "lucide-react";

import { PRODUCTS, productById } from "@/lib/gcs/product-doses";
import { chamberDisplayLabel } from "@/lib/gcs/spray-overlay";

// Chambers are physical tanks (Kanan/Kiri = right/left pump); the stored keys stay
// "fungisida"/"insektisida" but the operator picks the loadout by side, and every
// per-area surface shows the loaded product's name instead.
const CHAMBERS = [
  { key: "fungisida", label: "Kanan" },
  { key: "insektisida", label: "Kiri" },
];

function Stat({ label, value, tone = "rose" }) {
  const colors =
    tone === "emerald"
      ? "border-emerald-950/10 bg-emerald-50 text-emerald-700"
      : "border-rose-950/10 bg-rose-50 text-rose-700";

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

function ChamberLoadout({ chamberProducts, onChamberProductChange }) {
  if (!onChamberProductChange) return null;
  const products = chamberProducts && typeof chamberProducts === "object" ? chamberProducts : {};
  return (
    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/60 p-2.5">
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-rose-600">
        Muatan Chamber
      </div>
      <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
        Produk tiap chamber menentukan dosis default
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {CHAMBERS.map(({ key, label }) => {
          const productId = products[key] ?? "";
          const product = productById(productId);
          return (
            <div key={key}>
              <div className="flex items-center gap-2">
                <span className="w-[74px] shrink-0 text-[11px] font-black text-gray-800">
                  {label}
                </span>
                <select
                  value={productId}
                  onChange={(event) => onChamberProductChange(key, event.target.value || null)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-900 focus:border-rose-400 focus:outline-none"
                  aria-label={`Produk chamber ${label}`}
                >
                  <option value="">— Kosong —</option>
                  {PRODUCTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              {product && (
                <div className="mt-1 pl-[82px] text-[9px] font-bold text-rose-500">
                  {product.activeIngredient} · dosis default {product.rateLpha} L/ha
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SprayTargetsPanel({
  panelSwitch,
  loading,
  error,
  features,
  totalAreaM2,
  readyCount,
  formatNumber,
  onFocusTarget,
  chamberProducts,
  onChamberProductChange,
  onStartManualDraw,
}) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-tight text-gray-950">
            Spray Targets
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
            Polygon final dari database
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-rose-600" />}
          {panelSwitch}
        </div>
      </div>
      {error && (
        <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="Target" value={features.length} />
        <Stat label="Area" value={formatNumber(totalAreaM2)} />
        <Stat label="Ready" value={readyCount} tone="emerald" />
      </div>
      <ChamberLoadout
        chamberProducts={chamberProducts}
        onChamberProductChange={onChamberProductChange}
      />
      {onStartManualDraw && (
        <button
          type="button"
          onClick={onStartManualDraw}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 text-[11px] font-black text-amber-800 transition-colors hover:bg-amber-100"
          title="Tambah zona semprot dengan menggambar di peta; zona otomatis di bawahnya dipotong"
        >
          <PenLine className="h-3.5 w-3.5" /> Gambar Zona Manual
        </button>
      )}
      {features.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 bg-gray-50 px-2.5 py-2">
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Zona
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Area
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Chamber
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Aksi
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {features.map((feature, index) => {
              const props = feature.properties ?? {};
              const targetId = props.id ?? props.zone_code ?? index;
              const selectedChambers = Array.isArray(props.selected_chambers)
                ? props.selected_chambers
                : [];
              const chamberLabel = selectedChambers
                .map((key) => chamberDisplayLabel(key, chamberProducts))
                .filter(Boolean)
                .join(", ");
              return (
                <div
                  key={targetId}
                  className="grid w-full grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0"
                >
                  <span
                    className={`text-center text-[12px] font-black ${props.source === "manual" ? "text-amber-700" : "text-gray-950"}`}
                    title={props.source === "manual" ? "Zona manual (digambar)" : "Zona otomatis (NDVI)"}
                  >
                    {props.zone_code ?? `Z${String(index + 1).padStart(2, "0")}`}
                  </span>
                  <span className="min-w-0 truncate text-center text-[11px] font-black tabular-nums text-gray-700">
                    {formatNumber(props.area_m2)} m2
                  </span>
                  <span
                    className={`inline-flex h-7 w-full max-w-[92px] items-center justify-center rounded-full border px-2 text-center text-[10px] font-black ${
                      selectedChambers.length > 0
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                    title={chamberLabel || "none"}
                  >
                    {chamberLabel || "none"}
                  </span>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => onFocusTarget(targetId)}
                      className="grid h-8 w-9 place-items-center rounded-xl border border-rose-200 bg-white text-rose-700 shadow-sm transition-colors hover:bg-rose-50"
                      title="Lihat di peta"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
