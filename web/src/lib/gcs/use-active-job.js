import { useEffect, useState } from "react";
import { fetchJob } from "@/lib/gcs/api";
import { parseKml } from "@/lib/gcs/kml";

const REFRESH_MS = 10_000;

export function useActiveJob(jobId) {
  const [job, setJob] = useState(null);
  const [rings, setRings] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const load = async () => {
      try {
        const j = await fetchJob(jobId);
        if (active) {
          setJob(j);
          setErr(null);
        }
      } catch (e) {
        if (active)
          setErr({ id: jobId, msg: e instanceof Error ? e.message : "failed to load mission" });
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [jobId]);

  const matches = job != null && (job.id === jobId || job.job_id === jobId);
  const kmlUrl = job && matches ? job.artifacts?.clusters_kml ?? null : null;

  useEffect(() => {
    if (!kmlUrl) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(kmlUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`kml ${res.status}`);
        const text = await res.text();
        if (!active) return;
        setRings(
          parseKml(text, { id: kmlUrl, name: "field" }).polygons.map((p) => {
            const ring = p.coords.map((c) => [c.lng, c.lat]);
            if (ring.length) ring.push(ring[0]);
            return ring;
          }),
        );
      } catch {
        if (active) setRings([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [kmlUrl]);

  if (!jobId) return { job: null, rings: [], loading: false, error: null };
  const error = err && err.id === jobId ? err.msg : null;
  return {
    job: matches ? job : null,
    rings: kmlUrl ? rings : [],
    loading: !matches && !error,
    error,
  };
}
