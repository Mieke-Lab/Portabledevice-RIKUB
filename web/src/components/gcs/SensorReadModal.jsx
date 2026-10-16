import { useEffect, useRef, useState } from "react";
import { generateSoilReading } from "@/lib/gcs/copilot";

const DURATION_MS = 1600;

export function SensorReadModal({ isOpen, onClose, onRead }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setDone(false);
      return;
    }

    startRef.current = performance.now();
    const tick = (now) => {
      const elapsed = now - startRef.current;
      const pct = Math.min(100, (elapsed / DURATION_MS) * 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDone(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (done) {
      onRead(generateSoilReading());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl text-center">
        <p className="mb-1 text-4xl">{done ? "✅" : "🌱"}</p>
        <h2 className="text-lg font-semibold text-gcs-on-surface">
          {done ? "Reading complete" : "Reading soil probe…"}
        </h2>
        <p className="mt-1 text-sm text-gcs-muted">
          {done ? "7 channels captured." : "Keep probe inserted during measurement."}
        </p>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gcs-bg">
          <div
            className="h-full rounded-full bg-gcs-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1 text-right text-xs text-gcs-muted">{Math.round(progress)}%</p>

        <div className="mt-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gcs-outline py-2 text-sm text-gcs-muted transition hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!done}
            className="flex-1 rounded-xl bg-gcs-primary py-2 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
          >
            Attach reading
          </button>
        </div>
      </div>
    </div>
  );
}
