import { useState } from "react";
import { ChevronDown, ChevronUp, Sprout } from "lucide-react";

// The full card is ~480 px tall — on the kiosk screen it covers half of the map while the NDVI layer is on.
// The chevron in its header folds it down to that header (title, total area, dominant class). The choice is
// remembered per browser, so it stays folded when the layer is toggled or the page is reloaded.
const COLLAPSED_KEY = "soerogis:ndvi-health-collapsed";

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false; // storage blocked (private window, kiosk profile policy): start expanded
  }
}

function writeCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // the choice just does not survive a reload
  }
}

export function NdviHealthStats({ stats, categories, dominant, panelSwitch }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  };

  const CollapseIcon = collapsed ? ChevronDown : ChevronUp;
  const dominantPercent = Math.round(Number(dominant?.percentage || 0));
  const totalArea = `${stats ? stats.total_area_ha : "-"} Ha`;

  return (
    <div className="absolute right-4 top-[208px] z-[1000] w-[min(314px,calc(100vw-32px))] lg:right-20 lg:top-4">
      {panelSwitch && <div className="mb-2 flex justify-end">{panelSwitch}</div>}
      <div className="max-h-[calc(100dvh-160px)] overflow-y-auto overscroll-contain rounded-[20px] border border-white/70 bg-white/95 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur lg:max-h-[calc(100dvh-88px)]">
        <div className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-lime-700 px-4 pb-3 pt-3 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/14 ring-1 ring-white/20">
                <Sprout className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold leading-tight">
                  Kesehatan Tanaman
                </div>
                <div className="truncate text-[10px] font-medium text-emerald-50/75">
                  {collapsed
                    ? `${totalArea} · ${dominant?.name ?? "-"} ${dominantPercent}%`
                    : `Analisis NDVI · ${totalArea}`}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Perluas panel Kesehatan Tanaman" : "Ciutkan panel Kesehatan Tanaman"}
              title={collapsed ? "Perluas panel" : "Ciutkan panel"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/14 text-white ring-1 ring-white/20 transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <CollapseIcon className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>

          {!collapsed && (
            <div className="mt-2.5 grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-emerald-200/25 bg-white/10 px-3 py-2 shadow-inner">
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-50/70">
                  Dominan
                </div>
                <div className="truncate text-[14px] font-bold">
                  {dominant?.name}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[22px] font-black leading-none tabular-nums">
                  {Math.round(Number(dominant?.percentage || 0))}%
                </div>
                <div className="text-[9px] font-semibold text-emerald-50/70">
                  {dominant?.area_ha} Ha
                </div>
              </div>
            </div>
          )}
        </div>

        {!collapsed && (
          <>
            <div className="px-4 pb-2 pt-2.5">
              <div className="mb-1.5 text-[10px] font-semibold text-gray-500">
                <span>Skala NDVI</span>
              </div>
              <div
                className="h-2.5 w-full rounded-full shadow-inner"
                style={{
                  background:
                    "linear-gradient(to right,#27272a 0%,#27272a 50%,#ef233c 50%,#f59e0b 60.5%,#7bd85a 70%,#1fbf63 80%,#0f7a3f 90%,#0f7a3f 100%)",
                }}
              />
              <div className="relative mt-0.5 h-3">
                {[
                  { label: "-1", left: "0%" },
                  { label: "0", left: "50%" },
                  { label: "0.4", left: "70%" },
                  { label: "0.8", left: "90%" },
                  { label: "1", left: "100%" },
                ].map(({ label, left }) => (
                  <span
                    key={label}
                    className="absolute -translate-x-1/2 text-[9px] font-medium tabular-nums text-gray-400"
                    style={{ left }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="mx-4 h-px bg-gray-100" />

            <div className="space-y-0.5 px-3 pb-2.5 pt-2">
              {categories.map((cat) => (
                <div
                  key={cat.name}
                  className="rounded-xl border border-transparent px-2.5 py-1 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(15,23,42,0.05)]"
                        style={{ background: cat.color }}
                      />
                      <span className="min-w-0 truncate text-[12px] font-bold leading-tight text-gray-800">
                        {cat.name}
                      </span>
                      <span className="shrink-0 text-[9.5px] font-semibold tabular-nums text-gray-400">
                        NDVI {cat.range}
                      </span>
                    </div>
                    <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-gray-800">
                      {cat.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-[18px]">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80 shadow-inner">
                      <div
                        className="h-full min-w-[8px] rounded-full shadow-[0_0_0_1px_rgba(15,23,42,0.04)]"
                        style={{
                          width: `${Math.min(100, Math.max(0, Number(cat.percentage || 0)))}%`,
                          background: cat.color,
                        }}
                      />
                    </div>
                    <span className="w-[66px] shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-500">
                      {cat.area_ha} Ha
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
