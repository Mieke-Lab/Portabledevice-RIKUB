import { useEffect, useRef, useState } from "react";
import { fetchSprayStatus } from "@/lib/gcs/api";
import { useDroneSettings } from "@/lib/gcs/drone-settings";

// Incremental poller for the reactive spray session. Accumulates the sprayed
// sample track across ticks using the server's `next_seq` cursor (lossless — see
// docs/drone_api.md → SprayMissionStatus) so the map overlay only ever draws the
// newly arrived points. Resets the accumulated track when the session changes.

const MAX_SAMPLES_PER_POLL = 400; // page forward through a long track, tick by tick
// Bound only the incremental JS sample buffer handed to consumers each tick.
// The map overlay persists sprayed coverage separately (it must not disappear),
// with its own generous safety cap — see Monitoring.jsx.
const RETAINED_SAMPLES_CAP = 5000;
const OVERLAY_POLL_CAP_MS = 1500; // the overlay wants a snappier cadence than telemetry

const EMPTY = { status: null, samples: [], error: null, updatedAt: null, loading: true };

export function useSprayStatus() {
  const [{ pollIntervalMs, baseUrl }] = useDroneSettings();
  const [state, setState] = useState(EMPTY);

  const cursorRef = useRef(null);
  const samplesRef = useRef([]);
  const sessionRef = useRef(undefined); // undefined = no observation yet
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    // A drone-address change means a different vehicle/session — start clean.
    cursorRef.current = null;
    samplesRef.current = [];
    sessionRef.current = undefined;

    async function tick() {
      if (!active || inFlight.current || document.hidden) return;
      inFlight.current = true;
      try {
        const res = await fetchSprayStatus({
          sinceSeq: cursorRef.current ?? undefined,
          maxSamples: MAX_SAMPLES_PER_POLL,
        });
        if (!active) return;

        const sessionId = res?.session_id ?? null;
        const firstObservation = sessionRef.current === undefined;

        // A real session change: drop the old track and refetch from seq 0 next
        // tick (the just-fetched samples were filtered by a now-stale cursor).
        if (!firstObservation && sessionId !== sessionRef.current) {
          sessionRef.current = sessionId;
          samplesRef.current = [];
          cursorRef.current = null;
          setState({ status: res, samples: [], error: null, updatedAt: Date.now(), loading: false });
          return;
        }
        sessionRef.current = sessionId;

        const incoming = Array.isArray(res?.samples) ? res.samples : [];
        if (incoming.length) {
          const merged = samplesRef.current.concat(incoming);
          samplesRef.current =
            merged.length > RETAINED_SAMPLES_CAP
              ? merged.slice(merged.length - RETAINED_SAMPLES_CAP)
              : merged;
        }
        if (res?.next_seq != null) cursorRef.current = res.next_seq;

        setState({
          status: res,
          samples: samplesRef.current,
          error: null,
          updatedAt: Date.now(),
          loading: false,
        });
      } catch (error) {
        if (active) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "spray status unavailable",
            loading: false,
          }));
        }
      } finally {
        inFlight.current = false;
      }
    }

    tick();
    const interval = Math.min(pollIntervalMs, OVERLAY_POLL_CAP_MS);
    const timer = setInterval(tick, interval);
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
