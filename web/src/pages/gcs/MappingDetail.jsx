import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { basemapUrl } from "@/lib/gcs/basemap";
import { fetchBlobWithProgress } from "@/lib/gcs/fetch-progress";
import { fetchJob } from "@/lib/gcs/api";
import { parseKml } from "@/lib/gcs/kml";
import { decodeNdvi } from "@/lib/gcs/ndvi";
import { fitZoom, projector } from "@/lib/gcs/mercator";

const MAP_W = 1280;
const MAP_H = 800;
const DOSES = [null, 1, 2, 3, 4, 5];
const DOSE_COLORS = {
  null: "#94a3b8",
  1: "#22c55e",
  2: "#84cc16",
  3: "#eab308",
  4: "#f97316",
  5: "#ef4444",
};

function ProgressBar({ pct, label }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-gcs-muted">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gcs-bg">
        <div
          className="h-full rounded-full bg-gcs-primary transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function JobDetail({ id }) {
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [kmlPolygons, setKmlPolygons] = useState([]);
  const [kmlProgress, setKmlProgress] = useState(null);
  const [ndviResult, setNdviResult] = useState(null);
  const [ndviProgress, setNdviProgress] = useState(null);
  const [doses, setDoses] = useState({});
  const [zoom, setZoom] = useState(null);
  const [project, setProject] = useState(null);

  useEffect(() => {
    if (!id) return;
    fetchJob(id)
      .then(setJob)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!job?.artifacts?.clusters_kml) return;
    const url = job.artifacts.clusters_kml;
    let active = true;
    setKmlProgress(0);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          url,
          (l, t) => { if (active && t) setKmlProgress((l / t) * 100); },
        );
        const text = await blob.text();
        if (!active) return;
        const parsed = parseKml(text, { id: url, name: job.name });

        const allCoords = parsed.polygons.flatMap((p) => p.coords);
        const lngs = allCoords.map((c) => c.lng);
        const lats = allCoords.map((c) => c.lat);
        const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
        const z = fitZoom(bbox, MAP_W, MAP_H);
        const cLng = (bbox[0] + bbox[2]) / 2;
        const cLat = (bbox[1] + bbox[3]) / 2;
        const proj = projector(cLng, cLat, z, MAP_W, MAP_H);

        setZoom(z);
        setProject(() => proj);
        setKmlPolygons(parsed.polygons);
        setDoses(Object.fromEntries(parsed.polygons.map((p) => [p.id, null])));
        setKmlProgress(100);
      } catch (e) {
        if (active) setError(e.message);
      }
    })();
    return () => { active = false; };
  }, [job]);

  useEffect(() => {
    if (!job?.artifacts?.stitched_tif) return;
    const url = job.artifacts.stitched_tif;
    let active = true;
    setNdviProgress(0);
    (async () => {
      try {
        const blob = await fetchBlobWithProgress(
          url,
          (l, t) => { if (active && t) setNdviProgress((l / t) * 80); },
        );
        const buf = await blob.arrayBuffer();
        if (!active) return;
        setNdviProgress(85);
        const result = await decodeNdvi(buf);
        if (active) {
          setNdviResult(result);
          setNdviProgress(100);
        }
      } catch {
        if (active) setNdviProgress(null);
      }
    })();
    return () => { active = false; };
  }, [job]);

  const handleUseMap = () => {
    navigate(`/drone-dashboard/spraying?job=${encodeURIComponent(id)}`);
  };

  if (error)
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-2xl">⚠️</p>
        <p className="text-gcs-error">{error}</p>
        <button
          onClick={() => navigate("/drone-dashboard/mapping")}
          className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30"
        >
          ← Back to Mapping
        </button>
      </div>
    );

  if (!job)
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gcs-primary/30 border-t-gcs-primary" />
      </div>
    );

  const mapBg = basemapUrl({ width: MAP_W, height: MAP_H });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate("/drone-dashboard/mapping")}
            className="mb-1 text-xs text-gcs-muted underline hover:text-gcs-on-surface"
          >
            ← Mapping jobs
          </button>
          <h1 className="font-data text-2xl font-bold text-gcs-on-surface">
            {job.name || job.id}
          </h1>
          {job.area_name && <p className="text-sm text-gcs-muted">{job.area_name}</p>}
        </div>
        {job.status === "ready" && (
          <button
            onClick={handleUseMap}
            className="shrink-0 rounded-xl bg-gcs-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gcs-primary/80"
          >
            Use This Map →
          </button>
        )}
      </div>

      {kmlProgress !== null && kmlProgress < 100 && (
        <ProgressBar pct={kmlProgress} label="Loading field clusters…" />
      )}
      {ndviProgress !== null && ndviProgress < 100 && (
        <ProgressBar pct={ndviProgress} label="Decoding NDVI orthophoto…" />
      )}

      <div
        className="relative overflow-hidden rounded-2xl border border-gcs-outline bg-gcs-bg"
        style={{ aspectRatio: `${MAP_W}/${MAP_H}` }}
      >
        <img
          src={mapBg}
          alt="basemap"
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
        />

        {ndviResult && (
          <img
            src={ndviResult.dataUrl}
            alt="NDVI"
            className="absolute inset-0 h-full w-full object-cover opacity-70"
          />
        )}

        {project && (
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            className="absolute inset-0 h-full w-full"
            style={{ pointerEvents: "none" }}
          >
            {kmlPolygons.map((p) => {
              const pts = p.coords.map((c) => {
                const { x, y } = project(c.lng, c.lat);
                return `${x},${y}`;
              });
              const d = parseInt(doses[p.id]) || null;
              return (
                <polygon
                  key={p.id}
                  points={pts.join(" ")}
                  fill={DOSE_COLORS[d] ?? DOSE_COLORS[null]}
                  fillOpacity={0.4}
                  stroke={DOSE_COLORS[d] ?? DOSE_COLORS[null]}
                  strokeWidth={1.5}
                />
              );
            })}
          </svg>
        )}
      </div>

      {kmlPolygons.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="mb-1 font-semibold text-gcs-on-surface">Prescription Matrix</h2>
          <p className="mb-4 text-xs text-gcs-muted">
            Assign spray doses to each field zone (1 = low, 5 = high). This is saved with the
            mission plan.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kmlPolygons.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-gcs-outline bg-white/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gcs-on-surface">{p.name}</p>
                  <p className="text-xs text-gcs-muted">
                    {p.coords.length} vertices
                  </p>
                </div>
                <div className="ml-3 flex gap-1">
                  {DOSES.map((d) => (
                    <button
                      key={String(d)}
                      onClick={() => setDoses((prev) => ({ ...prev, [p.id]: d }))}
                      className="h-6 w-6 rounded text-xs font-bold transition"
                      style={{
                        background: doses[p.id] === d ? DOSE_COLORS[d] : "transparent",
                        border: `2px solid ${DOSE_COLORS[d]}`,
                        color: doses[p.id] === d ? "#fff" : DOSE_COLORS[d],
                      }}
                      title={d === null ? "No dose" : `Dose ${d}`}
                    >
                      {d ?? "0"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel grid grid-cols-2 gap-3 rounded-2xl p-5 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-gcs-muted">Status</p>
          <p className="font-semibold text-gcs-on-surface capitalize">{job.status}</p>
        </div>
        <div>
          <p className="text-xs text-gcs-muted">Images</p>
          <p className="font-semibold text-gcs-on-surface">{job.image_count}</p>
        </div>
        {job.area_m2 != null && (
          <div>
            <p className="text-xs text-gcs-muted">Area</p>
            <p className="font-semibold text-gcs-on-surface">
              {(job.area_m2 / 10_000).toFixed(2)} ha
            </p>
          </div>
        )}
        {job.cluster_count != null && (
          <div>
            <p className="text-xs text-gcs-muted">Zones</p>
            <p className="font-semibold text-gcs-on-surface">{job.cluster_count}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function MappingDetail() {
  const { id } = useParams();
  return <JobDetail id={id} />;
}
