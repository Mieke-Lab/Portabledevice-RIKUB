import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp } from "lucide-react";
import { setFlightPlanInput } from "@/lib/gcs/flight-plan-input";
import { buildFlightPlanInputFromWaypoints } from "@/lib/gcs/waypoints-mission";

// Lets the user pick a QGC ".waypoints" mission file and jump straight to
// /flight-plan with a polygon auto-generated around the waypoints (left-pump
// spray). Self-contained: owns the hidden <input>, parsing, and navigation, so
// it can be dropped anywhere (Maps hub, the empty flight-plan screen, …).
//
// On a bad file it surfaces the parser's Indonesian message — via the parent's
// `onError` when given, otherwise a small self-dismissing toast.
export function LoadMissionFileButton({
  className,
  label = "Muat Misi (.waypoints)",
  icon: Icon = FileUp,
  onError,
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Auto-dismiss the error toast so it doesn't stay pinned over the map/controls.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  function fail(message) {
    if (onError) onError(message);
    else setToast(message);
  }

  async function handlePick(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    setToast(null);
    setBusy(true);
    try {
      const text = await file.text();
      const input = buildFlightPlanInputFromWaypoints(text, { fileName: file.name });
      setFlightPlanInput(input);
      navigate("/flight-plan");
    } catch (err) {
      fail(err instanceof Error ? err.message : "Gagal membaca file misi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".waypoints,.mission,.txt,text/plain"
        className="hidden"
        onChange={handlePick}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2.5 text-[13px] font-black text-emerald-900 shadow-[0_8px_24px_rgba(15,23,42,0.16)] ring-1 ring-emerald-900/10 backdrop-blur transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
        }
        title="Muat misi semprot dari file .waypoints"
      >
        <Icon className="h-4 w-4" />
        {busy ? "Memuat…" : label}
      </button>

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-[3000] flex justify-center px-4">
          <div
            role="alert"
            onClick={() => setToast(null)}
            className="max-w-md cursor-pointer rounded-2xl bg-rose-600 px-4 py-2.5 text-center text-[13px] font-bold text-white shadow-[0_12px_32px_rgba(2,6,23,0.35)]"
          >
            {toast}
          </div>
        </div>
      )}
    </>
  );
}
