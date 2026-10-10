import {
  ArrowUpFromLine,
  Ban,
  Check,
  Circle,
  Compass,
  Crosshair,
  Hexagon,
  Loader2,
  LocateFixed,
  Route,
  Rocket,
  RotateCcw,
  RotateCw,
  Ruler,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { NumberInput } from "@/components/maps/spraying-route/SprayingRoutePanel";

// Friendly "Dikalibrasi N mnt lalu" age label for the active drift correction.
function formatAge(ts) {
  if (!Number.isFinite(ts)) return "Baru dikalibrasi";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "Dikalibrasi <1 mnt lalu";
  const m = Math.round(s / 60);
  if (m < 60) return `Dikalibrasi ${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `Dikalibrasi ${h} jam lalu`;
  return `Dikalibrasi ${Math.round(h / 24)} hari lalu`;
}

// GPS-drift ("pose") calibration: the user tells the map where the drone truly
// is and which way it faces, RViz-style. See lib/gcs/gps-offset.js for the model.
function PoseCalibrationSection({
  offsetInfo,
  droneAvailable,
  poseMode,
  poseHasAnchor,
  onStartPose,
  onSavePositionOnly,
  onCancelPose,
  onResetOffset,
}) {
  return (
    <div className="mt-2.5 rounded-xl border border-sky-400/20 bg-sky-400/5 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
          <LocateFixed className="h-3 w-3" /> Kalibrasi Pose Drone
        </span>
        {offsetInfo && !poseMode && (
          <span className="text-[9px] font-black uppercase tracking-[0.08em] text-emerald-300">
            Aktif
          </span>
        )}
      </div>

      {!poseMode && (
        <>
          {offsetInfo ? (
            <div className="mt-1.5 rounded-lg bg-emerald-400/10 px-2 py-1.5 ring-1 ring-emerald-400/20">
              <div className="flex items-center justify-between text-[10px] font-bold text-emerald-100">
                <span className="flex items-center gap-1">
                  <Crosshair className="h-3 w-3" /> Drift GPS
                </span>
                <span className="tabular-nums">
                  {offsetInfo.meters.toFixed(1)} m
                  {offsetInfo.bearing != null && ` · ${Math.round(offsetInfo.bearing)}°`}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] font-bold text-emerald-100">
                <span className="flex items-center gap-1">
                  <Compass className="h-3 w-3" /> Koreksi arah
                </span>
                <span className="tabular-nums">
                  {offsetInfo.headingDelta >= 0 ? "+" : ""}
                  {Math.round(offsetInfo.headingDelta)}°
                </span>
              </div>
              <div className="mt-0.5 text-[8px] font-semibold text-emerald-200/70">
                {formatAge(offsetInfo.calibratedAt)}
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] font-medium leading-snug text-slate-300">
              Beri tahu posisi &amp; arah drone yang sebenarnya di peta untuk mengoreksi drift GPS.
            </p>
          )}

          {offsetInfo ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onStartPose}
                disabled={!droneAvailable}
                className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                  droneAvailable
                    ? "bg-sky-400/90 text-house hover:bg-sky-300"
                    : "cursor-not-allowed bg-white/5 text-slate-500"
                }`}
                title={droneAvailable ? "Kalibrasi ulang" : "GPS drone belum tersedia"}
              >
                <LocateFixed className="h-3 w-3" /> Ulangi
              </button>
              <button
                type="button"
                onClick={onResetOffset}
                className="flex h-7 items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onStartPose}
              disabled={!droneAvailable}
              className={`mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                droneAvailable
                  ? "bg-sky-400/90 text-house hover:bg-sky-300"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
              title={droneAvailable ? "Mulai kalibrasi" : "GPS drone belum tersedia"}
            >
              <LocateFixed className="h-3 w-3" />
              {droneAvailable ? "Kalibrasi posisi drone" : "GPS drone belum ada"}
            </button>
          )}
        </>
      )}

      {poseMode && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium leading-snug text-sky-200">
            {poseHasAnchor
              ? "Ketuk arah hadap drone — atau simpan posisi saja."
              : "Ketuk peta tepat di posisi drone yang sebenarnya."}
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onSavePositionOnly}
              disabled={!poseHasAnchor}
              className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                poseHasAnchor
                  ? "bg-emerald-400/90 text-house hover:bg-emerald-300"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
            >
              <Check className="h-3 w-3" /> Posisi saja
            </button>
            <button
              type="button"
              onClick={onCancelPose}
              className="flex h-7 items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
            >
              <X className="h-3 w-3" /> Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ObstacleSection({
  obstacles,
  drawMode,
  draftPointCount,
  draftHasCenter,
  onStartPolygon,
  onStartCircle,
  onFinishPolygon,
  onUndoPoint,
  onCancelDraw,
  onDeleteObstacle,
}) {
  const drawing = drawMode !== "none";
  return (
    <div className="mt-2.5 rounded-xl border border-white/10 bg-white/5 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
          <Ban className="h-3 w-3" /> Area Terlarang
        </span>
        {obstacles.length > 0 && !drawing && (
          <span className="text-[9px] font-black tabular-nums text-slate-300">{obstacles.length}</span>
        )}
      </div>

      {!drawing && (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onStartPolygon}
              className="flex h-7 items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Hexagon className="h-3 w-3" /> Polygon
            </button>
            <button
              type="button"
              onClick={onStartCircle}
              className="flex h-7 items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Circle className="h-3 w-3" /> Lingkaran
            </button>
          </div>
          {obstacles.length > 0 && (
            // No inner scroll — the whole panel scrolls as one region (better on
            // touch than a nested scroll area).
            <div className="mt-1.5 space-y-1">
              {obstacles.map((obstacle) => (
                <div
                  key={obstacle.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/5 py-1 pl-2 pr-1"
                >
                  <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold text-slate-200">
                    {obstacle.kind === "polygon" ? (
                      <Hexagon className="h-3 w-3 shrink-0 text-slate-400" />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0 text-slate-400" />
                    )}
                    <span className="truncate">
                      {obstacle.kind === "polygon"
                        ? `Polygon · ${obstacle.ring.length} titik`
                        : `Lingkaran · ${obstacle.radiusM.toFixed(1)} m`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteObstacle(obstacle.id)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-rose-300"
                    title="Hapus"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {drawMode === "polygon" && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium leading-snug text-emerald-200">
            Ketuk peta untuk menambah titik ({draftPointCount}). Minimal 3 titik.
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={onFinishPolygon}
              disabled={draftPointCount < 3}
              className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                draftPointCount >= 3
                  ? "bg-emerald-400/90 text-house hover:bg-emerald-300"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
            >
              <Check className="h-3 w-3" /> Selesai
            </button>
            <button
              type="button"
              onClick={onUndoPoint}
              disabled={draftPointCount === 0}
              className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                draftPointCount > 0
                  ? "bg-white/5 text-slate-200 hover:bg-white/10"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
            >
              <Undo2 className="h-3 w-3" /> Undo
            </button>
            <button
              type="button"
              onClick={onCancelDraw}
              className="flex h-7 items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
            >
              <X className="h-3 w-3" /> Batal
            </button>
          </div>
        </div>
      )}

      {drawMode === "circle" && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium leading-snug text-emerald-200">
            {draftHasCenter ? "Ketuk lagi untuk mengatur radius." : "Ketuk peta untuk titik pusat."}
          </p>
          <button
            type="button"
            onClick={onCancelDraw}
            className="mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-lg bg-white/5 text-[10px] font-black text-slate-200 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
          >
            <X className="h-3 w-3" /> Batal
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, unit }) {
  return (
    <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2.5 py-2 text-center">
      <div className="text-[8px] font-black uppercase tracking-[0.12em] text-forest">{label}</div>
      <div className="mt-0.5 text-[15px] font-black tabular-nums leading-none text-gray-950">
        {value}
        {unit && <span className="ml-0.5 text-[9px] font-bold text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Right-side control panel for the flight-planning page. Purely presentational —
 * all state lives in the FlightPlan page and is threaded through callbacks.
 */
export function FlightControlsPanel({
  fieldName,
  laneSpacing,
  altitude,
  angleDeg,
  onLaneSpacingChange,
  onAltitudeChange,
  onAngleChange,
  onAngleAuto,
  droneAvailable,
  onResetStartToDrone,
  offsetInfo,
  poseMode,
  poseHasAnchor,
  onStartPose,
  onSavePositionOnly,
  onCancelPose,
  onResetOffset,
  waypointCount,
  distanceMeters,
  areaHa,
  chambers,
  obstacles,
  drawMode,
  draftPointCount,
  draftHasCenter,
  onStartPolygon,
  onStartCircle,
  onFinishPolygon,
  onUndoPoint,
  onCancelDraw,
  onDeleteObstacle,
  pathReady,
  submitting,
  error,
  onStartFlying,
}) {
  const distanceLabel =
    distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toFixed(2)}`
      : `${Math.round(distanceMeters)}`;
  const distanceUnit = distanceMeters >= 1000 ? "km" : "m";

  return (
    <div className="pointer-events-auto flex max-h-full w-[318px] flex-col overflow-hidden rounded-[18px] border border-white/70 bg-white p-3 shadow-[0_12px_34px_rgba(15,23,42,0.15)]">
      <div className="mb-2.5 flex shrink-0 items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-forest text-white shadow-[0_8px_18px_rgba(6,78,59,0.22)]">
          <Route className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-black leading-tight text-gray-950">
            Rencana Terbang
          </div>
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">
            {fieldName || "Rute penyemprotan"}
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <StatCard label="Waypoint" value={waypointCount} />
        <StatCard label="Jarak" value={distanceLabel} unit={distanceUnit} />
        <StatCard label="Luas" value={areaHa.toFixed(2)} unit="ha" />
      </div>

      <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {/* Dark flight-settings card mirrors the on-map FlightSettingsWidget look. */}
        <div className="rounded-2xl border border-emerald-300/15 bg-house/95 p-2.5 text-white shadow-[0_18px_48px_rgba(2,6,23,0.42)]">
          <div className="mb-2 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300/80" />
            <span>Pengaturan Terbang</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="col-span-1">
              <div className="mb-0.5 flex items-center gap-1 text-[7px] font-bold uppercase tracking-[0.1em] text-slate-400">
                <Ruler className="h-2.5 w-2.5" /> Line Width
              </div>
              <NumberInput
                label=""
                min="0.5"
                max="20"
                step="0.5"
                value={laneSpacing}
                unit="m"
                onChange={(value) => onLaneSpacingChange(Math.min(20, Math.max(0.5, value || 0.5)))}
              />
            </div>
            <div className="col-span-1">
              <div className="mb-0.5 flex items-center gap-1 text-[7px] font-bold uppercase tracking-[0.1em] text-slate-400">
                <ArrowUpFromLine className="h-2.5 w-2.5" /> Altitude
              </div>
              <NumberInput
                label=""
                min="2"
                max="30"
                step="0.5"
                value={altitude}
                unit="m"
                onChange={(value) => onAltitudeChange(Math.min(30, Math.max(2, value || 2)))}
              />
            </div>
          </div>

          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <Compass className="h-3 w-3" /> Arah Zigzag
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black tabular-nums text-emerald-300">
                  {Math.round(angleDeg)}°
                </span>
                <button
                  type="button"
                  onClick={onAngleAuto}
                  className="flex items-center gap-0.5 rounded-md bg-white/5 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-slate-300 transition-colors hover:bg-white/10 hover:text-emerald-300"
                  title="Selaraskan otomatis ke sisi terpanjang"
                >
                  <RotateCw className="h-2.5 w-2.5" /> Auto
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={180}
              step={1}
              value={angleDeg}
              onChange={(event) => onAngleChange(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400"
            />
          </div>

          <PoseCalibrationSection
            offsetInfo={offsetInfo}
            droneAvailable={droneAvailable}
            poseMode={poseMode}
            poseHasAnchor={poseHasAnchor}
            onStartPose={onStartPose}
            onSavePositionOnly={onSavePositionOnly}
            onCancelPose={onCancelPose}
            onResetOffset={onResetOffset}
          />

          <div className="mt-2.5 rounded-xl border border-white/10 bg-white/5 p-2">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
              <Crosshair className="h-3 w-3" /> Titik Awal
            </div>
            <p className="mt-1 text-[10px] font-medium leading-snug text-slate-300">
              Seret bendera hijau di peta untuk memindahkan titik mulai.
            </p>
            <button
              type="button"
              onClick={onResetStartToDrone}
              disabled={!droneAvailable}
              className={`mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-lg text-[10px] font-black transition-colors ${
                droneAvailable
                  ? "bg-emerald-400/90 text-house hover:bg-emerald-300"
                  : "cursor-not-allowed bg-white/5 text-slate-500"
              }`}
              title={droneAvailable ? "Mulai dari posisi drone" : "GPS drone belum tersedia"}
            >
              <Crosshair className="h-3 w-3" />
              {droneAvailable ? "Mulai dari drone" : "GPS drone belum ada"}
            </button>
          </div>

          <ObstacleSection
            obstacles={obstacles}
            drawMode={drawMode}
            draftPointCount={draftPointCount}
            draftHasCenter={draftHasCenter}
            onStartPolygon={onStartPolygon}
            onStartCircle={onStartCircle}
            onFinishPolygon={onFinishPolygon}
            onUndoPoint={onUndoPoint}
            onCancelDraw={onCancelDraw}
            onDeleteObstacle={onDeleteObstacle}
          />

          {chambers.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Obat:
              </span>
              {chambers.map((chamber) => (
                <span
                  key={chamber}
                  className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.04em] text-rose-200 ring-1 ring-rose-400/30"
                >
                  {chamber}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onStartFlying}
        disabled={!pathReady || submitting}
        className={`mt-2.5 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl text-[14px] font-black transition-all ${
          pathReady && !submitting
            ? "bg-gradient-to-br from-leaf to-forest text-white shadow-[0_12px_28px_rgba(0,98,65,0.32)] hover:-translate-y-0.5 active:translate-y-0"
            : "cursor-not-allowed bg-gray-100 text-gray-400"
        }`}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Mengirim…
          </>
        ) : (
          <>
            <Rocket className="h-4 w-4" /> Mulai Terbang
          </>
        )}
      </button>
    </div>
  );
}
