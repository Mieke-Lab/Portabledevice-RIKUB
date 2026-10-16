import { useEffect, useState } from "react";
import { fetchJob, fetchMappingMissionStatus } from "@/lib/gcs/api";
import { useDroneSettings } from "@/lib/gcs/drone-settings";
import { isMappingLegActive } from "@/lib/gcs/mapping-capture";

// Poller for the drone's mapping (photo survey) mission, for the monitoring page.
// MappingMissionStatus is the live per-leg view (phase, captures_done); the station
// coordinates and the captured/pending lists live in the session's `capture` block,
// so the session is re-read when the session or leg changes and periodically while
// the leg is active.
const JOB_REFRESH_MS = 5000;

export function useMappingStatus() {
  const [{ pollIntervalMs, baseUrl }] = useDroneSettings();
  const [state, setState] = useState({ status: null, job: null, error: null });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let job = null;
    let jobKey = null;
    let jobAt = 0;

    async function tick() {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const status = await fetchMappingMissionStatus();
        if (!active) return;
        // odm_job_id is the jobs-service id (the one GET /api/jobs/{id} resolves).
        const id = status?.odm_job_id || status?.session_id || "";
        const key = id ? `${id}#${status?.leg ?? ""}` : null;
        if (!key) {
          job = null;
          jobKey = null;
        } else if (key !== jobKey || (isMappingLegActive(status) && Date.now() - jobAt >= JOB_REFRESH_MS)) {
          try {
            job = await fetchJob(id);
          } catch {
            if (key !== jobKey) job = null; // keep the last good read of the same session
          }
          jobKey = key;
          jobAt = Date.now();
        }
        if (active) setState({ status, job, error: null });
      } catch (error) {
        if (active) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "mapping status unavailable",
          }));
        }
      } finally {
        inFlight = false;
      }
    }

    tick();
    const timer = setInterval(tick, Math.max(1500, Math.min(pollIntervalMs, 3000)));
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

  return state;
}
