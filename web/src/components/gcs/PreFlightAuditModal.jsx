import { useRef, useState } from "react";
import { CameraAuditBanner } from "@/components/gcs/CameraCheck";

const CHECKS = [
  {
    id: "battery",
    label: "Battery ≥ 20%",
    detail: "Check battery level on the dashboard telemetry bar.",
  },
  {
    id: "gps",
    label: "GPS Fix acquired (≥6 satellites)",
    detail: "Verify GPS fix type and satellite count in diagnostics.",
  },
  {
    id: "area",
    label: "Exclusion zones & field boundary confirmed",
    detail: "Review the planned path on the map. Abort if uncertain.",
  },
];

// `cameraCheck` is optional (the mapping planner passes it; the other pages don't): the
// camera pre-flight verdict — {level, title, summary, lines, requireAck, ackLabel,
// checking, onCheck}. It only ADDS a warning banner; when the verdict is a blind
// wire-only camera it also adds one more required acknowledgement before the slider
// unlocks. The three checks and the slide are unchanged.
export function PreFlightAuditModal({ isOpen, onClose, onExecute, cameraCheck }) {
  const [checked, setChecked] = useState({});
  const [sliderVal, setSliderVal] = useState(0);
  const isAuthorizedToSlide = useRef(false);

  if (!isOpen) return null;

  const ackNeeded = !!cameraCheck?.requireAck;
  const allChecked = CHECKS.every((c) => checked[c.id]) && (!ackNeeded || !!checked.camera);
  const isArmed = sliderVal >= 98;

  const toggle = (id) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSliderMouseDown = () => {
    if (allChecked) isAuthorizedToSlide.current = true;
  };

  const handleSliderChange = (e) => {
    if (!isAuthorizedToSlide.current) return;
    const v = Number(e.target.value);
    setSliderVal(v);
    if (v >= 98) {
      isAuthorizedToSlide.current = false;
    }
  };

  const handleSliderMouseUp = () => {
    if (!isArmed) {
      setSliderVal(0);
      isAuthorizedToSlide.current = false;
    }
  };

  // The slider can stay at 100 while the checks (or the camera acknowledgement) change under
  // it — e.g. the camera drops to wire-only between two openings — so Execute re-checks both.
  const canExecute = isArmed && allChecked;

  const handleExecute = () => {
    if (canExecute) {
      setChecked({});
      setSliderVal(0);
      onExecute();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xl">🛡️</span>
          <h2 className="text-lg font-bold text-gcs-on-surface">Pre-Flight Safety Audit</h2>
        </div>
        <p className="mb-5 text-sm text-gcs-muted">
          Complete all checks before authorizing autonomous flight.
        </p>

        <div className="space-y-3">
          {CHECKS.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                checked[c.id]
                  ? "border-gcs-primary/40 bg-gcs-primary/10"
                  : "border-gcs-outline bg-white/20"
              }`}
              onClick={() => toggle(c.id)}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  checked[c.id]
                    ? "border-gcs-primary bg-gcs-primary text-white"
                    : "border-gcs-outline"
                }`}
              >
                {checked[c.id] && (
                  <svg viewBox="0 0 14 14" fill="currentColor" className="h-3 w-3">
                    <path d="M2 7l4 4 6-8" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                )}
              </span>
              <div>
                <p className="text-sm font-medium text-gcs-on-surface">{c.label}</p>
                <p className="text-xs text-gcs-muted">{c.detail}</p>
              </div>
            </label>
          ))}
        </div>

        <CameraAuditBanner check={cameraCheck} />
        {ackNeeded && (
          <label
            className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              checked.camera ? "border-red-500/60 bg-red-500/10" : "border-red-500/50 bg-white/20"
            }`}
            onClick={() => toggle("camera")}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                checked.camera ? "border-red-600 bg-red-600 text-white" : "border-red-500"
              }`}
            >
              {checked.camera && (
                <svg viewBox="0 0 14 14" fill="currentColor" className="h-3 w-3">
                  <path d="M2 7l4 4 6-8" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              )}
            </span>
            <div>
              <p className="text-sm font-medium text-gcs-on-surface">{cameraCheck.ackLabel}</p>
              <p className="text-xs text-gcs-muted">Tanpa persetujuan ini slider tetap terkunci.</p>
            </div>
          </label>
        )}

        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-gcs-muted">
            {allChecked
              ? "Slide right to authorize launch →"
              : "Complete all checks to unlock authorization"}
          </p>
          <div className="relative">
            <input
              type="range"
              min={0}
              max={100}
              value={sliderVal}
              onMouseDown={handleSliderMouseDown}
              onTouchStart={handleSliderMouseDown}
              onChange={handleSliderChange}
              onMouseUp={handleSliderMouseUp}
              onTouchEnd={handleSliderMouseUp}
              disabled={!allChecked}
              className={`h-12 w-full cursor-pointer appearance-none rounded-xl transition ${
                isArmed
                  ? "bg-green-500/30"
                  : allChecked
                    ? "bg-gcs-primary/20"
                    : "cursor-not-allowed bg-gcs-bg opacity-50"
              }`}
              style={{
                background: `linear-gradient(to right, ${
                  isArmed ? "#16a34a" : "#005bb3"
                } ${sliderVal}%, transparent ${sliderVal}%)`,
              }}
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-gcs-on-surface">
              {isArmed ? "✓ AUTHORIZED" : allChecked ? "→ Slide to authorize" : "🔒 Locked"}
            </span>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-on-surface transition hover:bg-white/30"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={!canExecute}
            className="rounded-xl bg-gcs-primary px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
          >
            Execute Mission
          </button>
        </div>
      </div>
    </div>
  );
}
