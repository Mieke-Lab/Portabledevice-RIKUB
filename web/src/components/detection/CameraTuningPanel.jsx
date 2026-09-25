import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Save, FolderOpen, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getCameraTuning, setCameraTuning, resetCameraDefaults, saveCameraPreset, loadCameraPreset,
} from '@/api';

const SEND_DELAY_MS = 120; // coalesce slider drags into a few control writes

function fmt(key, v) {
  if (v == null) return '–';
  if (key === 'ev') return `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`;
  if (key === 'wb_temperature') return `${Math.round(v)} K`;
  return String(Math.round(v));
}

// Manual camera controls for the 'Siang Terik Sawah' preset. Slider moves are applied to
// the webcam right away (the live MJPEG preview reflects them); ranges and which sliders
// exist come from the backend, which checks what the connected camera actually supports.
export function CameraTuningPanel() {
  const [open, setOpen] = useState(false);
  const [tuning, setTuning] = useState(null);
  const [values, setValues] = useState({});
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const pending = useRef({});

  function adopt(data) {
    setTuning(data);
    setValues(Object.fromEntries(Object.entries(data.sliders).map(([k, s]) => [k, s.value])));
  }

  useEffect(() => {
    if (!open || tuning) return;
    getCameraTuning().then(adopt).catch((e) => setMsg({ kind: 'error', text: e.message }));
  }, [open, tuning]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onSlide(key, v) {
    setValues((prev) => ({ ...prev, [key]: v }));
    pending.current[key] = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const batch = pending.current;
      pending.current = {};
      try {
        const data = await setCameraTuning(batch);
        setTuning(data);
        setMsg(null);
      } catch (e) {
        setMsg({ kind: 'error', text: e.message });
      }
    }, SEND_DELAY_MS);
  }

  async function run(fn, okText) {
    setBusy(true);
    try {
      const data = await fn();
      if (data.sliders) adopt(data);
      else setTuning((t) => t && { ...t });
      setMsg({ kind: 'ok', text: okText(data) });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const sliders = tuning ? Object.entries(tuning.sliders).filter(([, s]) => s.supported) : [];
  const driver = tuning?.driver ?? {};

  return (
    <div className="rounded-xl border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-forest"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" /> Preset Siang Terik Sawah
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {!tuning && !msg && <p className="text-xs text-muted-foreground">Membaca kontrol kamera…</p>}

          {sliders.map(([key, s]) => (
            <label key={key} className="flex flex-col gap-1 text-xs">
              <span className="flex justify-between font-semibold">
                <span>{s.label}</span>
                <span className="tabular-nums text-forest">{fmt(key, values[key])}</span>
              </span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={values[key] ?? s.default}
                onChange={(e) => onSlide(key, Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </label>
          ))}

          {tuning && (
            <p className="text-[11px] text-muted-foreground">
              Kamera: exposure {driver.auto_exposure === 1 ? `manual ${(driver.exposure_time_absolute / 10).toFixed(1)} ms` : 'otomatis'}
              {' · '}WB {driver.white_balance_automatic === 0 ? `${driver.white_balance_temperature} K` : 'otomatis'}
              {'focus_absolute' in driver && <>{' · '}fokus {driver.focus_automatic_continuous === 0 ? driver.focus_absolute : 'otomatis'}</>}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || !tuning}
              onClick={() => run(saveCameraPreset, (p) => `Preset disimpan (${new Date(p.saved_at).toLocaleTimeString()}).`)}>
              <Save className="h-3.5 w-3.5" /> Simpan preset
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !tuning}
              onClick={() => run(loadCameraPreset, () => 'Preset dimuat dan diterapkan.')}>
              <FolderOpen className="h-3.5 w-3.5" /> Muat preset
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || !tuning}
              onClick={() => run(resetCameraDefaults, () => 'Kamera kembali ke pengaturan default.')}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset default
            </Button>
          </div>

          {msg && (
            <p className={`text-xs ${msg.kind === 'error' ? 'text-destructive' : 'text-leaf'}`}>{msg.text}</p>
          )}

          {tuning?.unsupported?.length > 0 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Tidak didukung kamera ini ({tuning.unsupported.length})</summary>
              <ul className="mt-1 list-disc pl-4">
                {tuning.unsupported.map((u) => (
                  <li key={u.control}><b>{u.control}</b>: {u.reason} Pengganti: {u.alternative}.</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
