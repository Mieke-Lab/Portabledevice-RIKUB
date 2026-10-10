import { useEffect, useRef } from "react";
import { fetchDiagnostics } from "@/lib/gcs/api";
import { readDiagnostics, writeDiagnostics } from "@/lib/gcs/diagnostics";
import { useDroneSettings } from "@/lib/gcs/drone-settings";

export function DroneTelemetryProvider() {
  const [{ pollIntervalMs, baseUrl }] = useDroneSettings();
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;

    async function tick() {
      if (!active || inFlight.current || document.hidden) return;
      inFlight.current = true;
      try {
        const data = await fetchDiagnostics();
        if (active) {
          writeDiagnostics({ data, error: null, updatedAt: Date.now(), loading: false });
        }
      } catch (error) {
        if (active) {
          const previous = readDiagnostics();
          writeDiagnostics({
            data: previous.data,
            error: error instanceof Error ? error.message : "diagnostics unavailable",
            updatedAt: previous.updatedAt,
            loading: false,
          });
        }
      } finally {
        inFlight.current = false;
      }
    }

    tick();
    const timer = setInterval(tick, pollIntervalMs);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollIntervalMs, baseUrl]);

  return null;
}
