import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { basemapUrl } from "@/lib/gcs/basemap";
import { generateFlightPath } from "@/lib/gcs/path-planner";
import { executeMission, pushMission } from "@/lib/gcs/api";
import { ConfirmationModal } from "@/components/gcs/ConfirmationModal";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";

const PHASES = ["Define Area", "Flight Path", "Flight Settings"];
const DEFAULT_CONFIG = { gap: 10, angle: 0, offset: 0, invert: false };
const DEFAULT_SETTINGS = { altitude: 30, speed: 5, holdTime: 2, acceptanceRadius: 3 };

const TOOL = { POLYGON: "polygon", OBSTACLE: "obstacle", CIRCLE: "circle", PAN: "pan" };

export function MappingNew() {
  const navigate = useNavigate();
  const mapRef = useRef(null);

  const [phase, setPhase] = useState(0);
  const [objects, setObjects] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [tool, setTool] = useState(TOOL.POLYGON);
  const [selectedId, setSelectedId] = useState(null);

  const [pathConfig, setPathConfig] = useState(DEFAULT_CONFIG);
  const [flightPath, setFlightPath] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [showCancel, setShowCancel] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const mapBg = basemapUrl({ width: 1280, height: 640 });

  const getRelativePos = (e) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMapClick = (e) => {
    if (tool === TOOL.PAN) return;
    const p = getRelativePos(e);
    if (tool === TOOL.POLYGON || tool === TOOL.OBSTACLE) {
      setCurrentPoints((prev) => [...prev, p]);
      setDrawing(true);
    } else if (tool === TOOL.CIRCLE) {
      const obj = {
        id: crypto.randomUUID(),
        type: "obstacle",
        shape: "circle",
        points: [p],
        radius: 20,
      };
      setObjects((prev) => [...prev, obj]);
    }
  };

  const handleMapDblClick = (e) => {
    e.preventDefault();
    if (!drawing || currentPoints.length < 3) return;
    const isObstacle = tool === TOOL.OBSTACLE;
    const obj = {
      id: crypto.randomUUID(),
      type: isObstacle ? "obstacle" : "area",
      shape: "polygon",
      points: currentPoints,
    };
    setObjects((prev) => [...prev, obj]);
    setCurrentPoints([]);
    setDrawing(false);
  };

  const deleteSelected = () => {
    setObjects((p) => p.filter((o) => o.id !== selectedId));
    setSelectedId(null);
  };

  const computePath = () => {
    const path = generateFlightPath(objects, pathConfig);
    setFlightPath(path);
  };

  const handleExecute = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const wp = flightPath.map((p, i) => [i, p.x, p.y, settings.altitude]);
      await pushMission({
        waypoints: wp,
        altitude: settings.altitude,
        speed: settings.speed,
        holdTime: settings.holdTime,
        acceptanceRadius: settings.acceptanceRadius,
      });
      await executeMission({ altitude: settings.altitude });
      navigate("/drone-dashboard/mapping");
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
    setShowAudit(false);
  };

  const areaCount = objects.filter((o) => o.type === "area").length;
  const obsCount = objects.filter((o) => o.type === "obstacle").length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-data text-2xl font-bold text-gcs-on-surface">Mission Planner</h1>
          <p className="text-sm text-gcs-muted">Define the survey area and generate a flight path.</p>
        </div>
        <button
          onClick={() => setShowCancel(true)}
          className="rounded-xl border border-gcs-outline px-3 py-2 text-sm text-gcs-muted transition hover:bg-white/30"
        >
          Cancel
        </button>
      </div>

      <div className="flex gap-2">
        {PHASES.map((label, i) => (
          <button
            key={label}
            onClick={() => phase > i && setPhase(i)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              i === phase
                ? "bg-gcs-primary text-white"
                : i < phase
                  ? "border border-gcs-primary text-gcs-primary hover:bg-gcs-primary/10"
                  : "border border-gcs-outline text-gcs-muted cursor-not-allowed opacity-50"
            }`}
          >
            <span>{i + 1}</span> {label}
          </button>
        ))}
      </div>

      {phase === 0 && (
        <>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                { id: TOOL.POLYGON, label: "🟩 Survey Area", desc: "Click to draw polygon" },
                { id: TOOL.OBSTACLE, label: "🔴 Obstacle Zone", desc: "Click to draw obstacle" },
                { id: TOOL.CIRCLE, label: "⭕ Circle Obstacle", desc: "Click to place circle" },
                { id: TOOL.PAN, label: "🖐 Pan", desc: "Navigate map" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTool(t.id); setCurrentPoints([]); setDrawing(false); }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    tool === t.id
                      ? "bg-gcs-primary text-white"
                      : "border border-gcs-outline text-gcs-on-surface hover:bg-white/30"
                  }`}
                  title={t.desc}
                >
                  {t.label}
                </button>
              ))}
              {selectedId && (
                <button
                  onClick={deleteSelected}
                  className="rounded-xl border border-gcs-error px-3 py-1.5 text-xs font-medium text-gcs-error transition hover:bg-gcs-error/10"
                >
                  🗑 Delete selected
                </button>
              )}
            </div>

            <div
              ref={mapRef}
              className="relative overflow-hidden rounded-xl bg-gcs-bg cursor-crosshair select-none"
              style={{ aspectRatio: "16/8" }}
              onClick={handleMapClick}
              onDoubleClick={handleMapDblClick}
            >
              <img
                src={mapBg}
                alt="basemap"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1280 640">
                {objects.map((obj) => {
                  const isSelected = obj.id === selectedId;
                  const stroke = obj.type === "area" ? "#005bb3" : "#ba1a1a";
                  const fill = obj.type === "area" ? "#005bb380" : "#ba1a1a50";
                  if (obj.shape === "circle") {
                    const c = obj.points[0];
                    return (
                      <circle
                        key={obj.id}
                        cx={c.x} cy={c.y} r={obj.radius ?? 20}
                        fill={fill} stroke={stroke} strokeWidth={isSelected ? 3 : 1.5}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setSelectedId(obj.id); }}
                      />
                    );
                  }
                  const pts = obj.points.map((p) => `${p.x},${p.y}`).join(" ");
                  return (
                    <polygon
                      key={obj.id}
                      points={pts}
                      fill={fill} stroke={stroke} strokeWidth={isSelected ? 3 : 1.5}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(obj.id); }}
                    />
                  );
                })}
                {drawing && currentPoints.length > 0 && (
                  <polyline
                    points={currentPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={tool === TOOL.OBSTACLE ? "#ba1a1a" : "#005bb3"}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                  />
                )}
                {currentPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill="#005bb3" />
                ))}
              </svg>
            </div>

            <div className="mt-2 flex gap-4 text-xs text-gcs-muted">
              <span>
                {areaCount} area{areaCount !== 1 ? "s" : ""} · {obsCount} obstacle{obsCount !== 1 ? "s" : ""}
              </span>
              {drawing && (
                <span className="text-gcs-primary">
                  {currentPoints.length} pts · double-click to close
                </span>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              disabled={areaCount === 0}
              onClick={() => setPhase(1)}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              Next: Flight Path →
            </button>
          </div>
        </>
      )}

      {phase === 1 && (
        <>
          <div className="glass-panel grid gap-5 rounded-2xl p-5 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">
                Line spacing (px) — {pathConfig.gap}
              </label>
              <input
                type="range" min={4} max={60} value={pathConfig.gap}
                onChange={(e) => setPathConfig((p) => ({ ...p, gap: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">
                Angle (°) — {pathConfig.angle}°
              </label>
              <input
                type="range" min={-90} max={90} value={pathConfig.angle}
                onChange={(e) => setPathConfig((p) => ({ ...p, angle: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gcs-on-surface">
                Offset — {pathConfig.offset}
              </label>
              <input
                type="range" min={0} max={pathConfig.gap} value={pathConfig.offset}
                onChange={(e) => setPathConfig((p) => ({ ...p, offset: Number(e.target.value) }))}
                className="mt-2 w-full accent-gcs-primary"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gcs-on-surface">
                <input
                  type="checkbox"
                  checked={pathConfig.invert}
                  onChange={(e) => setPathConfig((p) => ({ ...p, invert: e.target.checked }))}
                  className="accent-gcs-primary"
                />
                Invert direction
              </label>
            </div>
          </div>

          <button
            onClick={computePath}
            className="self-start rounded-xl bg-gcs-secondary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gcs-secondary/80"
          >
            ↻ Generate Path
          </button>

          <div
            className="relative overflow-hidden rounded-2xl border border-gcs-outline bg-gcs-bg"
            style={{ aspectRatio: "16/8" }}
          >
            <img
              src={mapBg}
              alt="basemap"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1280 640">
              {objects.map((obj) => {
                const stroke = obj.type === "area" ? "#005bb3" : "#ba1a1a";
                const fill = obj.type === "area" ? "#005bb340" : "#ba1a1a30";
                if (obj.shape === "circle") {
                  const c = obj.points[0];
                  return (
                    <circle key={obj.id} cx={c.x} cy={c.y} r={obj.radius ?? 20} fill={fill} stroke={stroke} strokeWidth={1} />
                  );
                }
                return (
                  <polygon key={obj.id} points={obj.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={fill} stroke={stroke} strokeWidth={1} />
                );
              })}
              {flightPath.length > 1 && (
                <polyline
                  points={flightPath.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#fbef00"
                  strokeWidth={2}
                  opacity={0.9}
                />
              )}
              {flightPath[0] && (
                <circle cx={flightPath[0].x} cy={flightPath[0].y} r={6} fill="#22c55e" />
              )}
              {flightPath.length > 1 && (
                <circle cx={flightPath[flightPath.length-1].x} cy={flightPath[flightPath.length-1].y} r={6} fill="#ef4444" />
              )}
            </svg>
          </div>

          <p className="text-xs text-gcs-muted">
            {flightPath.length} waypoints · {(flightPath.length * settings.speed / 60).toFixed(1)} min est.
          </p>

          <div className="flex justify-between">
            <button
              onClick={() => setPhase(0)}
              className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30"
            >
              ← Back
            </button>
            <button
              disabled={flightPath.length === 0}
              onClick={() => setPhase(2)}
              className="rounded-xl bg-gcs-primary px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-gcs-primary/80 disabled:opacity-40"
            >
              Next: Settings →
            </button>
          </div>
        </>
      )}

      {phase === 2 && (
        <>
          <div className="glass-panel grid gap-5 rounded-2xl p-5 sm:grid-cols-2">
            {[
              { key: "altitude", label: "Altitude (m)", min: 10, max: 120 },
              { key: "speed", label: "Speed (m/s)", min: 1, max: 15 },
              { key: "holdTime", label: "Hold time (s)", min: 0, max: 10 },
              { key: "acceptanceRadius", label: "Acceptance radius (m)", min: 0.5, max: 10, step: 0.5 },
            ].map(({ key, label, min, max, step = 1 }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gcs-on-surface">
                  {label} — {settings[key]}
                </label>
                <input
                  type="range" min={min} max={max} step={step}
                  value={settings[key]}
                  onChange={(e) => setSettings((p) => ({ ...p, [key]: Number(e.target.value) }))}
                  className="mt-2 w-full accent-gcs-primary"
                />
                <div className="flex justify-between text-xs text-gcs-muted">
                  <span>{min}</span><span>{max}</span>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-gcs-error">{error}</p>}

          <div className="flex justify-between">
            <button
              onClick={() => setPhase(1)}
              className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-muted transition hover:bg-white/30"
            >
              ← Back
            </button>
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
        title="Cancel mission planning?"
        message="All drawn areas and path settings will be discarded."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        isDanger
        onConfirm={() => navigate("/drone-dashboard")}
        onCancel={() => setShowCancel(false)}
      />

      <PreFlightAuditModal
        isOpen={showAudit}
        onClose={() => setShowAudit(false)}
        onExecute={handleExecute}
      />
    </div>
  );
}
