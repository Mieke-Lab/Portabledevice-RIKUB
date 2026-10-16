import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { basemapUrl, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/gcs/basemap";
import { generateFlightPath } from "@/lib/gcs/path-planner";
import { parseKml, projectMaps } from "@/lib/gcs/kml";
import { fitZoom, projector, unprojector } from "@/lib/gcs/mercator";
import { fetchJob, fetchJobs, executeMission, pushMission } from "@/lib/gcs/api";
import { setMissionPlan } from "@/lib/gcs/mission-plan";
import { useDroneOffset, correctPolygonForCommand } from "@/lib/gcs/drone-offset";
import { ConfirmationModal } from "@/components/gcs/ConfirmationModal";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";

const VB_W = 1280;
const VB_H = 800;
const PHASES = [
  { id: 0, label: "Select Map", icon: "map" },
  { id: 1, label: "Zones & Doses", icon: "medication_liquid" },
  { id: 2, label: "Flight Path", icon: "route" },
  { id: 3, label: "Spray Settings", icon: "tune" },
];
const DEFAULT_SETTINGS = { altitude: 10, speed: 3, holdTime: 1, acceptanceRadius: 2 };
const DEFAULT_PATH_CONFIG = { gap: 15, angle: 0, offset: 0, invert: false };
const DOSE_COLORS = { null: "#94a3b8", 1: "#22c55e", 2: "#84cc16", 3: "#eab308", 4: "#f97316", 5: "#ef4444" };
const DOSE_LEVELS = [null, 1, 2, 3, 4, 5];

function sessionMercatorView(polygons) {
  if (!polygons.length) return null;
  const allCoords = polygons.flatMap((p) => p.coords);
  const lngs = allCoords.map((c) => c.lng);
  const lats = allCoords.map((c) => c.lat);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  const z = fitZoom(bbox, VB_W, VB_H);
  const cLng = (bbox[0] + bbox[2]) / 2;
  const cLat = (bbox[1] + bbox[3]) / 2;
  return { cLng, cLat, zoom: z };
}

export function Spraying() {
  const navigate = useNavigate();
  const droneOffset = useDroneOffset(); // GPS-drift correction (see gps-offset.js)
  const fileRef = useRef(null);

  const [phase, setPhase] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [kmlText, setKmlText] = useState(null);

  const [polygons, setPolygons] = useState([]);
  const [geoView, setGeoView] = useState(null);

  const [doses, setDoses] = useState({});
  const [pathConfig, setPathConfig] = useState(DEFAULT_PATH_CONFIG);
  const [flightPath, setFlightPath] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [showCancel, setShowCancel] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const importTokenRef = useRef(0);

  useEffect(() => {
    setJobsLoading(true);
    fetchJobs()
      .then((list) => setJobs(Array.isArray(list) ? list.filter((j) => j.status === "ready") : []))
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));

    const jobParam = new URLSearchParams(window.location.search).get("job");
    if (jobParam) {
      setSelectedJobId(jobParam);
    }
  }, []);

  const applyKmlMap = (maps) => {
    if (!maps.length) return;
    const firstMap = maps[0];
    const view = sessionMercatorView(firstMap.polygons);
    if (!view) return;
    setGeoView(view);
    setPolygons(firstMap.polygons);
    setDoses(Object.fromEntries(firstMap.polygons.map((p) => [p.id, null])));
  };

  useEffect(() => {
    if (!selectedJobId) return;
    const token = ++importTokenRef.current;
    fetchJob(selectedJobId)
      .then(async (job) => {
        if (importTokenRef.current !== token) return;
        const kmlUrl = job?.artifacts?.clusters_kml;
        if (!kmlUrl) return;
        const res = await fetch(kmlUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`kml ${res.status}`);
        const text = await res.text();
        if (importTokenRef.current !== token) return;
        setKmlText(text);
        const parsed = parseKml(text, { id: selectedJobId, name: job.name });
        applyKmlMap([parsed]);
      })
      .catch((e) => setError(e.message));
  }, [selectedJobId]);

  const handleKmlFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = ++importTokenRef.current;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (importTokenRef.current !== token) return;
      const text = ev.target.result;
      try {
        const parsed = parseKml(text, { id: file.name, name: file.name.replace(/\.kml$/i, "") });
        setKmlText(text);
        applyKmlMap([parsed]);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
  };

  const getProjector = () => {
    if (!geoView) return null;
    return projector(geoView.cLng, geoView.cLat, geoView.zoom, VB_W, VB_H);
  };

  const proj = getProjector();

  const computePath = () => {
    const activePoly = polygons.filter((p) => doses[p.id] != null);
    if (!activePoly.length || !proj) return;

    const screenPoly = activePoly.map((p) => ({
      ...p,
      points: p.coords.map((c) => proj(c.lng, c.lat)),
      type: "area",
      shape: "polygon",
    }));

    const path = generateFlightPath(screenPoly, pathConfig);
    setFlightPath(path);
  };

  const toGeoWaypoints = () => {
    if (!proj || !flightPath.length) return [];
    const unproj = unprojector(geoView.cLng, geoView.cLat, geoView.zoom, VB_W, VB_H);
    return flightPath.map((p) => {
      const { lng, lat } = unproj(p.x, p.y);
      return [lat, lng];
    });
  };

  const handleExecute = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const geoWp = toGeoWaypoints();
      const wp = flightPath.map((p, i) => [i, p.x, p.y, settings.altitude]);
      // Shift the map-frame path into the drone's GPS frame before sending, so a
      // calibrated drift flies the same intended ground track from this page as
      // from the flight-planner: command = planned − Δ. See lib/gcs/gps-offset.js.
      const geoWpCmd = correctPolygonForCommand(geoWp, droneOffset);

      setMissionPlan({
        jobId: selectedJobId,
        waypoints: wp,
        geoWaypoints: geoWp,
        gpsOffset: droneOffset,
        doses,
        settings,
        createdAt: new Date().toISOString(),
      });

      await pushMission({
        waypoints: wp,
        geoWaypoints: geoWpCmd,
        altitude: settings.altitude,
        speed: settings.speed,
        holdTime: settings.holdTime,
        acceptanceRadius: settings.acceptanceRadius,
      });
      await executeMission({ altitude: settings.altitude, jobId: selectedJobId });
      navigate("/drone-dashboard");
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
    setShowAudit(false);
  };

  const mapBg = geoView
    ? basemapUrl({ lng: geoView.cLng, lat: geoView.cLat, zoom: geoView.zoom, width: VB_W, height: VB_H })
    : basemapUrl({ lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1], zoom: DEFAULT_ZOOM, width: VB_W, height: VB_H });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-4xl text-gcs-primary uppercase leading-none">Spraying Planner</h1>
          <p className="font-data text-lg text-gcs-muted mt-1">
            Precision spray mission planning from KML field maps
          </p>
        </div>
        <button
          onClick={() => setShowCancel(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-data text-sm text-gcs-muted hover:bg-white/30 border border-gcs-outline transition-colors"
        >
          <span className="material-symbols-outlined text-base">close</span>
          Cancel
        </button>
      </div>

      <div className="flex items-center justify-center gap-1 md:gap-3">
        {PHASES.map((p) => (
          <div key={p.id} className="flex items-center gap-1 md:gap-3">
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => phase > p.id && setPhase(p.id)}
                disabled={phase <= p.id}
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  phase >= p.id
                    ? "bg-gcs-primary border-gcs-primary text-white shadow-lg shadow-gcs-primary/20"
                    : "border-gcs-outline/30 text-gcs-muted"
                }`}
              >
                <span className="material-symbols-outlined text-xl">{p.icon}</span>
              </button>
              <span
                className={`font-technical text-[9px] uppercase tracking-wider transition-all duration-300 ${
                  phase >= p.id ? "text-gcs-primary font-bold" : "text-gcs-muted"
                }`}
              >
                {p.label}
              </span>
            </div>
            {p.id < 3 && (
              <div
                className={`h-[2px] w-6 md:w-12 rounded-full mb-4 transition-all duration-500 ${
                  phase > p.id ? "bg-gcs-primary" : "bg-gcs-outline/20"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="rounded-xl bg-gcs-error/10 px-4 py-2 text-sm text-gcs-error">{error}</p>}

      {phase === 0 && (
        <>
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="mb-4 font-semibold text-gcs-on-surface">Select Field Map</h2>

            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gcs-muted">
                From completed mapping jobs
              </p>
              {jobsLoading ? (
                <p className="text-sm text-gcs-muted">Loading jobs…</p>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-gcs-muted">No ready jobs found.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {jobs.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => setSelectedJobId(j.id)}
                      className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left text-sm transition ${
                        selectedJobId === j.id
                          ? "border-gcs-primary bg-gcs-primary/10 text-gcs-primary"
                          : "border-gcs-outline text-gcs-on-surface hover:bg-white/30"
                      }`}
                    >
                      <span className="font-medium">{j.name || j.id}</span>
                      {j.area_name && <span className="text-xs text-gcs-muted">{j.area_name}</span>}
                      {j.cluster_count != null && (
                        <span className="text-xs text-gcs-muted">{j.cluster_count} zones</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 -top-2 flex items-center">
                <span className="flex-1 border-t border-gcs-outline" />
                <span className="mx-2 text-xs text-gcs-muted">or</span>
                <span className="flex-1 border-t border-gcs-outline" />
              </div>
              <div className="pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gcs-muted">
                  Import KML file
                </p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-gcs-outline py-4 text-sm text-gcs-muted transition hover:border-gcs-primary hover:text-gcs-primary flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined">folder_open</span>
                  Choose .kml file
                </button>
                <input ref={fileRef} type="file" accept=".kml" className="hidden" onChange={handleKmlFile} />
              </div>
            </div>
          </div>

          {polygons.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-gcs-outline" style={{ aspectRatio: `${VB_W}/${VB_H}` }}>
              <img src={mapBg} alt="basemap" className="absolute inset-0 h-full w-full object-cover" />
              {proj && (
                <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full">
                  {polygons.map((p) => {
                    const pts = p.coords.map((c) => {
                      const { x, y } = proj(c.lng, c.lat);
                      return `${x},${y}`;
                    });
                    return (
                      <polygon key={p.id} points={pts.join(" ")} fill="#005bb360" stroke="#005bb3" strokeWidth={2} />
                    );
                  })}
                </svg>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              disabled={polygons.length === 0}
              onClick={() => setPhase(1)}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              Next: Zones & Doses →
            </button>
          </div>
        </>
      )}

      {phase === 1 && (
        <>
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="mb-1 font-semibold text-gcs-on-surface">Zone Prescription</h2>
            <p className="mb-4 text-xs text-gcs-muted">Assign spray dose to each zone. Zones with no dose will be skipped.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {polygons.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-gcs-outline bg-white/20 px-3 py-2">
                  <p className="truncate text-sm font-medium text-gcs-on-surface">{p.name}</p>
                  <div className="ml-2 flex gap-1">
                    {DOSE_LEVELS.map((d) => (
                      <button
                        key={String(d)}
                        onClick={() => setDoses((prev) => ({ ...prev, [p.id]: d }))}
                        className="h-6 w-6 rounded text-xs font-bold transition"
                        style={{
                          background: doses[p.id] === d ? DOSE_COLORS[d] : "transparent",
                          border: `2px solid ${DOSE_COLORS[d]}`,
                          color: doses[p.id] === d ? "#fff" : DOSE_COLORS[d],
                        }}
                        title={d === null ? "Skip zone" : `Dose ${d}`}
                      >
                        {d ?? "—"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-gcs-outline" style={{ aspectRatio: `${VB_W}/${VB_H}` }}>
            <img src={mapBg} alt="basemap" className="absolute inset-0 h-full w-full object-cover" />
            {proj && (
              <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full">
                {polygons.map((p) => {
                  const d = parseInt(doses[p.id]) || null;
                  const pts = p.coords.map((c) => {
                    const { x, y } = proj(c.lng, c.lat);
                    return `${x},${y}`;
                  });
                  return (
                    <polygon key={p.id} points={pts.join(" ")} fill={`${DOSE_COLORS[d]}80`} stroke={DOSE_COLORS[d]} strokeWidth={2} />
                  );
                })}
              </svg>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setPhase(0)} className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30">← Back</button>
            <button
              disabled={!Object.values(doses).some((d) => d != null)}
              onClick={() => setPhase(2)}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              Next: Flight Path →
            </button>
          </div>
        </>
      )}

      {phase === 2 && (
        <>
          <div className="glass-panel grid gap-5 rounded-2xl p-5 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">Line spacing — {pathConfig.gap}</label>
              <input type="range" min={4} max={60} value={pathConfig.gap}
                onChange={(e) => setPathConfig((p) => ({ ...p, gap: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">Angle — {pathConfig.angle}°</label>
              <input type="range" min={-90} max={90} value={pathConfig.angle}
                onChange={(e) => setPathConfig((p) => ({ ...p, angle: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">Offset — {pathConfig.offset}</label>
              <input type="range" min={0} max={pathConfig.gap} value={pathConfig.offset}
                onChange={(e) => setPathConfig((p) => ({ ...p, offset: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gcs-on-surface">
              <input type="checkbox" checked={pathConfig.invert}
                onChange={(e) => setPathConfig((p) => ({ ...p, invert: e.target.checked }))}
                className="accent-gcs-primary" />
              Invert direction
            </label>
          </div>

          <button onClick={computePath} className="self-start rounded-xl bg-gcs-secondary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gcs-secondary/80">
            ↻ Generate Path
          </button>

          <div className="relative overflow-hidden rounded-2xl border border-gcs-outline" style={{ aspectRatio: `${VB_W}/${VB_H}` }}>
            <img src={mapBg} alt="basemap" className="absolute inset-0 h-full w-full object-cover" />
            {proj && (
              <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full">
                {polygons.map((p) => {
                  const d = parseInt(doses[p.id]) || null;
                  const pts = p.coords.map((c) => {
                    const { x, y } = proj(c.lng, c.lat);
                    return `${x},${y}`;
                  });
                  return (
                    <polygon key={p.id} points={pts.join(" ")} fill={`${DOSE_COLORS[d]}50`} stroke={DOSE_COLORS[d]} strokeWidth={1.5} />
                  );
                })}
                {flightPath.length > 1 && (
                  <polyline points={flightPath.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#fbef00" strokeWidth={2} opacity={0.9} />
                )}
                {flightPath[0] && <circle cx={flightPath[0].x} cy={flightPath[0].y} r={6} fill="#22c55e" />}
                {flightPath.length > 1 && (
                  <circle cx={flightPath[flightPath.length-1].x} cy={flightPath[flightPath.length-1].y} r={6} fill="#ef4444" />
                )}
              </svg>
            )}
          </div>

          {flightPath.length > 0 && (
            <p className="text-xs text-gcs-muted">{flightPath.length} waypoints</p>
          )}

          <div className="flex justify-between">
            <button onClick={() => setPhase(1)} className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30">← Back</button>
            <button
              disabled={flightPath.length === 0}
              onClick={() => setPhase(3)}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              Next: Settings →
            </button>
          </div>
        </>
      )}

      {phase === 3 && (
        <>
          <div className="glass-panel grid gap-5 rounded-2xl p-5 sm:grid-cols-2">
            {[
              { key: "altitude", label: "Altitude (m)", min: 3, max: 30 },
              { key: "speed", label: "Speed (m/s)", min: 1, max: 10 },
              { key: "holdTime", label: "Hold time (s)", min: 0, max: 5 },
              { key: "acceptanceRadius", label: "Acceptance radius (m)", min: 0.5, max: 5, step: 0.5 },
            ].map(({ key, label, min, max, step = 1 }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gcs-on-surface">
                  {label} — {settings[key]}
                </label>
                <input type="range" min={min} max={max} step={step} value={settings[key]}
                  onChange={(e) => setSettings((p) => ({ ...p, [key]: Number(e.target.value) }))}
                  className="mt-2 w-full accent-gcs-primary" />
                <div className="flex justify-between text-xs text-gcs-muted">
                  <span>{min}</span><span>{max}</span>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-gcs-error">{error}</p>}

          <div className="flex justify-between">
            <button onClick={() => setPhase(2)} className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30">← Back</button>
            <button
              onClick={() => setShowAudit(true)}
              disabled={submitting}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              {submitting ? "Sending…" : "🛡 Pre-Flight Check →"}
            </button>
          </div>
        </>
      )}

      <ConfirmationModal
        isOpen={showCancel}
        title="Cancel spray planning?"
        message="All zone assignments and path settings will be discarded."
        confirmLabel="Discard" cancelLabel="Keep editing" isDanger
        onConfirm={() => navigate("/drone-dashboard")}
        onCancel={() => setShowCancel(false)}
      />
      <PreFlightAuditModal isOpen={showAudit} onClose={() => setShowAudit(false)} onExecute={handleExecute} />
    </div>
  );
}
