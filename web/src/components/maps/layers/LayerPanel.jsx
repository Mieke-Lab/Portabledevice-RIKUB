import { Layers, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BASE_LAYERS,
  MAP_ANALYSIS_LAYERS,
  MAP_IMAGERY_LAYERS,
} from "@/components/maps/mapConfig";

export function LayerPanel({
  open,
  active,
  baseLayer,
  imageryError,
  imageryLoading,
  onToggleOpen,
  onClose,
  onBaseLayer,
  onToggleImagery,
  onToggleAnalysis,
}) {
  return (
    <div className="absolute right-4 top-[188px] z-[1000] sm:top-[120px]">
      <Button
        size="icon"
        variant="outline"
        className="h-12 w-12 rounded-[16px] border-0 bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:bg-gray-50"
        onClick={onToggleOpen}
        title="Layers"
      >
        <Layers className="h-5 w-5" />
      </Button>
      {open && (
        <div className="absolute right-[56px] top-0 w-[min(360px,calc(100vw-88px))] rounded-2xl bg-card p-3 shadow-soft animate-fade-up sm:p-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-[14px] font-bold text-foreground">
              Map type
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Tutup lapisan"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-2.5 grid grid-cols-3 gap-2">
            {Object.entries(BASE_LAYERS).map(([id, layer]) => (
              <button
                key={id}
                onClick={() => onBaseLayer(id)}
                className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${baseLayer === id ? "text-forest" : "text-muted-foreground"}`}
              >
                <span
                  className={`block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${baseLayer === id ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                >
                  <img
                    src={layer.preview}
                    alt={layer.label}
                    className="h-full w-full rounded-[8px] object-cover"
                  />
                </span>
                {layer.label}
              </button>
            ))}
          </div>

          <div className="mb-1.5 border-t border-border pt-2 text-[14px] font-bold text-foreground">
            Map Imagery
          </div>
          {imageryError && (
            <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {imageryError}
            </div>
          )}
          <div className="mb-2.5 grid grid-cols-3 gap-2">
            {MAP_IMAGERY_LAYERS.map((layer) => (
              <button
                key={layer.id}
                onClick={() => onToggleImagery(layer.id)}
                disabled={imageryLoading}
                className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${active.has(layer.id) ? "text-forest" : "text-muted-foreground"} disabled:opacity-60`}
              >
                <span
                  className={`relative block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${active.has(layer.id) ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                >
                  <img
                    src={layer.preview}
                    alt={layer.label}
                    className="h-full w-full rounded-[8px] object-cover"
                  />
                  {imageryLoading && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-white/70">
                      <Loader2 className="h-4 w-4 animate-spin text-forest" />
                    </span>
                  )}
                </span>
                {layer.label}
              </button>
            ))}
          </div>

          <div className="mb-1.5 border-t border-border pt-2 text-[14px] font-bold text-foreground">
            Map Analysis
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MAP_ANALYSIS_LAYERS.map((layer) => (
              <button
                key={layer.id}
                onClick={() => onToggleAnalysis(layer.id)}
                className={`group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-semibold transition-colors hover:bg-muted sm:text-xs ${active.has(layer.id) ? "text-forest" : "text-muted-foreground"}`}
              >
                <span
                  className={`block h-12 w-12 overflow-hidden rounded-xl border-2 bg-white p-0.5 sm:h-[56px] sm:w-[56px] ${active.has(layer.id) ? "border-leaf ring-2 ring-leaf/20" : "border-border"}`}
                >
                  <img
                    src={layer.preview}
                    alt={layer.label}
                    className="h-full w-full rounded-[8px] object-cover"
                  />
                </span>
                <span className="w-full text-center leading-tight">
                  {layer.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
