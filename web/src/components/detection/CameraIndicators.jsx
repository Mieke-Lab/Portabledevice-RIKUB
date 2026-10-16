import { useEffect, useState } from 'react';
import { Layers, Thermometer } from 'lucide-react';
import { getCameraMetrics } from '@/api';

const POLL_MS = 1000;

// good | warn | bad | na -> chip colours
const TONE = {
  good: 'bg-emerald-500/15 text-emerald-700',
  warn: 'bg-amber-500/15 text-amber-700',
  bad: 'bg-red-500/15 text-red-700',
  na: 'bg-muted text-muted-foreground',
};

function Chip({ label, value, tone, title }) {
  return (
    <div title={title} className={`flex min-w-0 flex-1 flex-col rounded-lg px-2 py-1.5 ${TONE[tone]}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
      <span className="truncate text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}

// Live indicators computed server-side on the small preview frame (leaf area only):
// clipping %, sharpness (Laplacian variance) and CPU temperature, coloured against the
// thresholds in server/camera_config.json. Also hosts the leaf-mask overlay toggle.
export function CameraIndicators({ overlay, onOverlayChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const d = await getCameraMetrics();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const m = data?.metrics;
  const t = data?.thresholds ?? {};
  const noLeaf = m && !m.has_leaf;

  const clipTone = !m || m.clip_percent == null || noLeaf ? 'na'
    : m.clip_percent > t.clip_max_percent ? 'bad' : 'good';
  const sharpTone = !m || m.sharpness == null || noLeaf ? 'na'
    : m.sharpness < t.sharpness_min ? 'bad' : 'good';
  const temp = data?.cpu_temp_c;
  const tempTone = temp == null ? 'na'
    : temp > t.pause_above_c ? 'bad' : temp > t.resume_below_c ? 'warn' : 'good';
  const ranges = (data?.leaf_ranges ?? []).filter((r) => r.enabled).map((r) => r.name).join(', ');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Chip
          label="Clipping daun"
          value={m?.clip_percent != null && !noLeaf ? `${m.clip_percent.toFixed(2)}%` : '–'}
          tone={clipTone}
          title={`Piksel daun terbakar (≥${t.clip_level}). Batas ${t.clip_max_percent}%`}
        />
        <Chip
          label="Ketajaman"
          value={m?.sharpness != null && !noLeaf ? Math.round(m.sharpness) : '–'}
          tone={sharpTone}
          title={`Varians Laplacian di area daun. Minimum ${t.sharpness_min}`}
        />
        <Chip
          label={<><Thermometer className="-mt-0.5 inline h-3 w-3" /> CPU</>}
          value={temp != null ? `${temp.toFixed(1)}°C` : '–'}
          tone={tempTone}
          title={`Jeda di atas ${t.pause_above_c}°C, lanjut di bawah ${t.resume_below_c}°C`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {error ? <span className="text-destructive">{error}</span>
            : !m ? 'Menunggu frame preview…'
            : noLeaf ? `Daun tidak terdeteksi (${m.leaf_percent}% frame). Rentang aktif: ${ranges}.`
            : `Area daun ${m.leaf_percent}% frame · rentang: ${ranges}`}
        </span>
        <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-forest">
          <input type="checkbox" checked={overlay} onChange={(e) => onOverlayChange(e.target.checked)} className="accent-emerald-600" />
          <Layers className="h-3.5 w-3.5" /> Overlay mask
        </label>
      </div>
      {overlay && (
        <p className="text-[11px] text-muted-foreground">
          Hijau = area yang dianggap daun, merah = piksel daun yang clipping. Overlay hanya di preview, tidak ikut ke foto.
        </p>
      )}
    </div>
  );
}
