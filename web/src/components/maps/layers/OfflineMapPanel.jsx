import { useCallback, useEffect, useState } from "react";
import { CloudDownload, Loader2, X } from "lucide-react";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import {
  cancelTileDownload,
  getTileDownload,
  getTileStats,
  startTileDownload,
} from "@/api";

// Downloads the base-map tiles of the area on screen to the Pi, so the GIS map and the
// drone pages (which use the satellite layer) still load without internet.
const MIN_ZOOM = 10;
const MAX_ZOOM = 19; // the server stops each layer at its own native zoom

const fmt = (n) => Number(n || 0).toLocaleString("id-ID");

function layerLabel(id) {
  return BASE_LAYERS[id]?.label || id;
}

export function OfflineMapPanel({ getView }) {
  const [stats, setStats] = useState(null);
  const [job, setJob] = useState(null);
  const [plan, setPlan] = useState(null); // {area, tiles, cached, estimate_mb}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Only satellite may be bulk-downloaded; OSM/OpenTopoMap forbid it (cached as viewed).
  const layers = ["satellite"];

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([getTileStats(), getTileDownload()]);
      setStats(s);
      setJob(j && j.total ? j : null);
    } catch {
      /* stats are informative only */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!job?.running) return undefined;
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [job?.running, refresh]);

  async function prepare() {
    setError("");
    setPlan(null);
    const view = getView?.();
    if (!view) return;
    const area = { layers, ...view.bounds, min_zoom: MIN_ZOOM, max_zoom: MAX_ZOOM };
    setBusy(true);
    try {
      const est = await startTileDownload(area, true);
      setPlan({ area, ...est });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      setJob(await startTileDownload(plan.area));
      setPlan(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      setJob(await cancelTileDownload());
    } catch (err) {
      setError(err.message);
    }
  }

  const stored = stats
    ? Object.entries(stats.layers)
        .filter(([, v]) => v.tiles > 0)
        .map(([id, v]) => `${layerLabel(id)} ${fmt(v.tiles)} tile (${v.mb} MB)`)
        .join(" · ")
    : "";
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="border-t border-border pt-2">
      <div className="mb-1 flex items-center gap-1.5 text-[14px] font-bold text-foreground">
        <CloudDownload className="h-4 w-4 text-forest" /> Peta offline
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Peta yang pernah tampil tersimpan otomatis di alat. Unduh area lahan sebelum ke lokasi
        tanpa internet. {stored ? `Tersimpan: ${stored}.` : "Belum ada peta tersimpan."}
      </p>

      {job?.running ? (
        <div className="rounded-xl bg-muted/60 p-2.5 text-xs">
          <div className="mb-1 flex items-center justify-between font-semibold text-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-forest" /> Mengunduh {pct}%
            </span>
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-red-600 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" /> Batal
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-leaf transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {fmt(job.done)} / {fmt(job.total)} tile · baru {fmt(job.saved)} · sudah ada {fmt(job.cached)}
            {job.failed ? ` · tidak tersedia ${fmt(job.failed)}` : ""}
          </div>
        </div>
      ) : plan ? (
        <div className="rounded-xl bg-muted/60 p-2.5 text-xs">
          <div className="mb-2 text-foreground">
            Area yang terlihat ({layers.map(layerLabel).join(" + ")}, zoom {MIN_ZOOM}–{MAX_ZOOM}):{" "}
            <b>{fmt(plan.tiles)} tile</b>
            {plan.cached ? `, ${fmt(plan.cached)} sudah tersimpan` : ""} · ±{plan.estimate_mb} MB
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={start}
              disabled={busy || plan.tiles === plan.cached}
              className="rounded-lg bg-forest px-3 py-1.5 font-semibold text-white hover:bg-forest/90 disabled:opacity-50"
            >
              {plan.tiles === plan.cached ? "Sudah lengkap" : "Unduh"}
            </button>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="rounded-lg px-3 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
            >
              Batal
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={prepare}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-leaf/40 bg-leaf/5 px-3 py-2 text-xs font-semibold text-forest transition-colors hover:bg-leaf/15 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
          Unduh peta area yang terlihat
        </button>
      )}

      {!job?.running && job?.finished_at && !plan && (
        <div className={`mt-1.5 text-[11px] ${job.error ? "text-amber-700" : "text-forest"}`}>
          {job.error
            ? `${job.error} (${fmt(job.saved)} tile baru tersimpan)`
            : `Selesai: ${fmt(job.saved)} tile baru, ${fmt(job.cached)} sudah ada.`}
        </div>
      )}
      {error && <div className="mt-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
