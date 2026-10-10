import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import {
  ArrowLeft, MapPinned, Pencil, Ban, Undo2, Check, Trash2, Plane, Loader2,
  AlertTriangle, Camera, Compass, Layers, Image as ImageIcon, Ruler, Timer,
  Crosshair, Grid3x3, CircleDashed, X, CheckCircle2, Pause, Play, PlaneLanding,
  Unplug, XCircle, PauseCircle, FolderOpen, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { COVERAGE_PATH_STYLE, flagIcon } from "@/components/maps/flightPath";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/gcs/basemap";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";
import { diagnosticsCoords, headingDeg, useDiagnostics } from "@/lib/gcs/diagnostics";
import {
  pushCaptureMission, executeMission, fetchMappingMissionStatus, fetchJob,
  pauseMappingMission, resumeMappingMission, cancelMappingMission,
} from "@/lib/gcs/api";
import {
  captureOf, captureStateMeta, captureProgress, capturePointsForDisplay,
  remainingCapturePointsForDisplay, isCaptureResumable, isCapturePausable,
  missionPhaseLabel, MISSION_TERMINAL_PHASES,
} from "@/lib/gcs/mapping-capture";
import { pathLengthMeters, haversineMeters, defaultAngleDeg } from "@/lib/gcs/flight-geo";
import {
  CAMERA_PRESETS, DEFAULT_CAMERA, cameraById, surveySpacing, planSurvey,
} from "@/lib/gcs/survey-grid";
import {
  useDroneOffset, hasOffset, applyOffsetToCoords, correctGeoWaypointsForCommand,
} from "@/lib/gcs/drone-offset";

const NOMINAL_SPEED_MPS = 5; // display-only estimate for flight-time (WPNAV cruise)
const MIN_CIRCLE_RADIUS_M = 1;

// capture.state values that mean "this leg is over and the monitor has let go,
// but the session is still ours to deal with" — the poll stops here and hands
// over to the leg-ended panel (resume / open / list). `done` is NOT one of them:
// the backend starts the stitch by itself, so we go straight to the detail page.
// NB: only paused/interrupted/failed imply the aircraft is down; a `canceled` leg
// may still be airborne (CancelMappingMission does not RTL — docs/drone_api.md).
const LEG_ENDED_STATES = new Set(["paused", "interrupted", "failed", "canceled"]);
// States in which a cancel leaves the drone hanging in the air. Both vocabularies:
// capture.state (flying/returning) and the pre-pause live-view phase (capturing),
// since the no-session fallback path only has MappingMissionStatus to go on.
const AIRBORNE_STATES = ["flying", "capturing", "returning"];
const LEG_ENDED_META = {
  paused: { title: "Misi dijeda", icon: PauseCircle, tone: "text-amber-600" },
  interrupted: { title: "Misi terputus", icon: Unplug, tone: "text-amber-600" },
  failed: { title: "Leg gagal", icon: AlertTriangle, tone: "text-destructive" },
  canceled: { title: "Misi dibatalkan", icon: XCircle, tone: "text-muted-foreground" },
};
// What the aircraft is doing between "pause pressed" and "paused" — landing comes
// first, the frames are only pulled off the camera after touchdown.
const PHASE_HINT = {
  returning: "Drone kembali & mendarat — foto diamankan setelah mendarat…",
  processing: "Drone sudah mendarat — mengamankan foto dari kamera…",
};

const AREA_STYLE = { color: "#006241", weight: 2.5, fillColor: "#00754A", fillOpacity: 0.14, lineJoin: "round" };
const OBSTACLE_STYLE = { color: "#1e293b", weight: 2, fillColor: "#334155", fillOpacity: 0.35, dashArray: "5 4", interactive: false };

// Survey-station dot style — hundreds can render at once for a dense grid, so use
// lightweight canvas circleMarkers (not divIcon markers) to keep the map smooth.
const CAPTURE_DOT = { radius: 3.5, color: "#ffffff", weight: 1.5, fillColor: "#f59e0b", fillOpacity: 1, interactive: false };
// Stations already secured on disk (resume mode): smaller green dots, so what is
// done reads apart from the amber stations the next leg will fly.
const CAPTURED_DOT = { radius: 3, color: "#ffffff", weight: 1, fillColor: "#16a34a", fillOpacity: 0.9, interactive: false };

function jobIdOf(job) {
  return job?.id || job?.job_id || "";
}

function droneIcon(rotationDeg) {
  const deg = Number.isFinite(rotationDeg) ? rotationDeg - 45 : 0;
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative;width:34px;height:34px">
      <svg width="22" height="22" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;margin-left:-11px;margin-top:-11px;filter:drop-shadow(0 3px 6px rgba(0,41,82,0.5));transform:rotate(${deg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#005bb3" stroke="white" stroke-width="1"/></svg>
    </div>`,
  });
}

// In-progress polygon draft (vertices + edges), drawn into a layer group.
function drawDraft(group, pts, center) {
  if (!group) return;
  group.clearLayers();
  const dot = { color: "#0f172a", fillColor: "#ffffff", fillOpacity: 1, weight: 2, interactive: false };
  if (center) L.circleMarker([center.lat, center.lng], { ...dot, radius: 5, fillColor: "#0f172a" }).addTo(group);
  if (pts.length >= 2) {
    L.polyline(pts.map((p) => [p.lat, p.lng]), { color: "#0f172a", weight: 2, dashArray: "5 4", interactive: false }).addTo(group);
  }
  for (const p of pts) L.circleMarker([p.lat, p.lng], { ...dot, radius: 4 }).addTo(group);
}

function ringAreaHa(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  try {
    const coords = ring.map((c) => [c.lng, c.lat]);
    coords.push(coords[0]);
    return turf.area(turf.polygon([coords])) / 10_000;
  } catch {
    return 0;
  }
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-leaf/10 text-leaf"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

// A slider whose value can also be typed directly and pushed BEYOND the slider's
// [min,max] — the slider covers the common range, the number input is the escape
// hatch. Only a sane positive hard bound [hardMin,hardMax] is enforced so the
// GSD/spacing math stays finite; the slider thumb clamps into range when the
// value is outside it. Optional `icon` (lucide) + `action` (e.g. an "Auto"
// button) render in the header.
function SliderInputRow({ label, value, suffix, min, max, step, onChange, hardMin = 1, hardMax = 999, icon: Icon, action }) {
  const commit = (raw) => {
    if (raw === "" || raw == null) return; // let the field clear while typing
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(hardMin, Math.min(hardMax, n)));
  };
  const outOfSliderRange = value < min || value > max;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" />}{label}
        </label>
        <div className="flex items-center gap-1.5">
          {action}
          <input
            type="number" inputMode="decimal" min={hardMin} max={hardMax} step={step} value={value}
            onChange={(e) => commit(e.target.value)}
            className="w-14 rounded-lg border border-border bg-card px-2 py-1 text-right text-sm font-bold tabular-nums text-forest outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
          />
          <span className="text-sm font-bold text-forest">{suffix.trim()}</span>
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-leaf"
      />
      {outOfSliderRange && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">Di luar rentang umum ({min}–{max}{suffix}) — nilai manual dipakai.</p>
      )}
    </div>
  );
}

export function MappingPlan() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeParam = searchParams.get("resume"); // /mapping/plan?resume=<sessionId>
  const { data: diag } = useDiagnostics();
  const offset = useDroneOffset();
  const drone = diagnosticsCoords(diag); // raw {lat, lon}
  const displayDrone = applyOffsetToCoords(drone, offset); // {lat, lng} drift-corrected
  const displayLat = displayDrone?.lat ?? null;
  const displayLng = displayDrone?.lng ?? null;
  const displayHeading = headingDeg(diag);
  // FCU armed flag straight from Diagnostics. A resume is only sane with the
  // aircraft down and disarmed; after an `interrupted` leg the backend no longer
  // knows, so this live bit is the only thing standing between the operator and
  // a ResumeMappingMission on a drone that is still loitering at its last station.
  const droneArmed = diag?.state?.armed === true;
  const droneAvailable = displayLat != null && displayLng != null;

  // --- Geometry (real lat/lng) ---
  const [areas, setAreas] = useState([]); // [{ id, ring: [{lat,lng}] }]
  const [obstacles, setObstacles] = useState([]); // planFlightPath shape
  const [drawMode, setDrawMode] = useState("none"); // none | area | obstacle | circle
  const [draftCount, setDraftCount] = useState(0);
  const [draftHasCenter, setDraftHasCenter] = useState(false);

  // --- Coverage / camera settings ---
  const [cameraId, setCameraId] = useState(DEFAULT_CAMERA.id);
  const [altitude, setAltitude] = useState(40);
  const [frontOverlap, setFrontOverlap] = useState(75);
  const [sideOverlap, setSideOverlap] = useState(65);
  const [angleDeg, setAngleDeg] = useState(0);
  const [angleTouched, setAngleTouched] = useState(false);
  const [holdTime, setHoldTime] = useState(2);
  const [startFromDrone, setStartFromDrone] = useState(true);

  // --- Launch / mission state ---
  const [showAudit, setShowAudit] = useState(false);
  const [launching, setLaunching] = useState(false);
  // The session id is the mission id: PushCaptureMission creates the mapping
  // session under the id we pass, and every later call (ExecuteMission, GetJob,
  // ResumeMappingMission) addresses the same id.
  const [sessionId, setSessionId] = useState(null);
  const [mission, setMission] = useState(null); // MappingMissionStatus (live per-leg view) once flying
  const [session, setSession] = useState(null); // latest GetJob — the persisted `capture` block is the source of truth
  const [polling, setPolling] = useState(false); // drives the status poll loop
  // Snapshot of the exact path/stations pushed to the drone. Set at launch, it
  // freezes the drawing for the rest of the flight — see the `geoPath` note below.
  const [lockedPlan, setLockedPlan] = useState(null); // { geoPath, captures } | null
  const [error, setError] = useState(null);
  // In-flight controls. `confirm` is the two-step inline confirm ("pause" |
  // "cancel" | null); `acting` while that request is out; `pausing` from the
  // moment the pause is accepted until the poll sees the leg settle — the aircraft
  // still has to fly home, land and drain the camera before capture.state reaches
  // `paused`, and a second tap in that window must not send another command.
  const [confirm, setConfirm] = useState(null);
  const [acting, setActing] = useState(false);
  const [pausing, setPausing] = useState(false);
  // Whether the last cancel was sent while the aircraft was in the air. The
  // capture block cannot tell us: CancelMappingMission sets `canceled` either way,
  // but only an airborne cancel leaves the drone hanging (it does NOT RTL by
  // itself — docs/drone_api.md), which the leg-ended panel must say.
  const [canceledAirborne, setCanceledAirborne] = useState(false);
  // The "uploaded but takeoff failed" launch message. Kept apart from `error` so
  // (a) the poll can drop it idempotently once capture.state leaves `armed` (the
  // command did reach the drone after all, or the operator dealt with it) without
  // clobbering a later pause/cancel error, and (b) the flight UI knows the armed
  // session is waiting on a re-Execute and can offer it as one tap.
  const [launchError, setLaunchError] = useState(null);

  // --- Resume mode (next leg of a half-flown session) ---
  const [resumeJob, setResumeJob] = useState(null); // the session being continued
  // Result of looking up `?resume=`: { id, ok } | { id, blockedState } | { id, error }.
  const [resumeLookup, setResumeLookup] = useState(null);

  const mapDiv = useRef(null);
  const map = useRef(null);
  const areasLayer = useRef(null);
  const obstaclesLayer = useRef(null);
  const draftLayer = useRef(null);
  const pathLayer = useRef(null);
  const capturesLayer = useRef(null);
  const capturedLayer = useRef(null); // resume mode: stations already secured
  const fittedResumeId = useRef(null); // session the view was last fitted to
  const startFlag = useRef(null);
  const endFlag = useRef(null);
  const droneMarker = useRef(null);
  const draftPts = useRef([]);
  const draftCenter = useRef(null);
  const geomId = useRef(0);
  const onMapClick = useRef(null);
  const seededView = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const cam = useMemo(() => cameraById(cameraId), [cameraId]);
  const spacing = useMemo(
    () => surveySpacing(cam, { altitudeM: altitude, frontOverlap, sideOverlap }),
    [cam, altitude, frontOverlap, sideOverlap],
  );

  // "Mulai dari drone" anchors the traversal at the drone, but the anchor is
  // seeded ONCE. Deriving it from live telemetry re-ran planSurvey on every GPS
  // tick, which reshuffled the lane order and made the drawn path visibly jump —
  // most confusingly while the drone was already flying it. A fresh drift
  // calibration re-anchors it (the drone's true position really did move); plain
  // GPS jitter does not.
  const [startLngLat, setStartLngLat] = useState(null);
  const startSeeded = useRef(false);
  const seededOffset = useRef(null); // offset the anchor was last seeded with

  const hasAreas = areas.some((a) => a.ring.length >= 3);

  const survey = useMemo(() => {
    if (!hasAreas) return { geoPath: [], captures: [], plan: null };
    return planSurvey({
      areas: areas.filter((a) => a.ring.length >= 3),
      obstacles,
      laneSpacing: spacing.laneSpacing,
      photoSpacing: spacing.photoSpacing,
      angleDeg,
      startLngLat,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, obstacles, spacing.laneSpacing, spacing.photoSpacing, angleDeg, startLngLat?.lat, startLngLat?.lng, hasAreas]);

  // Resume mode: the route is the session's remaining stations, not a drawing.
  // capture.points were pushed in the drone's GPS frame (command = planned − Δ),
  // so they come back through +Δ for display; keyed on `offset` so a fresh drift
  // calibration while the operator waits on the ground moves them with it.
  const resumePlan = useMemo(() => {
    if (!resumeJob) return null;
    const pts = remainingCapturePointsForDisplay(resumeJob, offset);
    return { geoPath: pts, captures: pts };
  }, [resumeJob, offset]);

  // While a mission is in the air the plan is LOCKED to the track that was
  // actually pushed, so nothing (telemetry, a recalibration, a stray tap) can
  // redraw the route the drone is currently flying. Lock wins over resume so a
  // recalibration mid-leg cannot shift the remaining route either.
  const activePlan = lockedPlan ?? resumePlan;
  const captures = activePlan ? activePlan.captures : survey.captures;
  const geoPath = activePlan ? activePlan.geoPath : survey.geoPath;
  const photoCount = captures.length;
  const distanceM = geoPath.length >= 2 ? pathLengthMeters(geoPath) : 0;
  const areaHa = useMemo(() => areas.reduce((s, a) => s + ringAreaHa(a.ring), 0), [areas]);
  const estSeconds = distanceM / NOMINAL_SPEED_MPS + photoCount * holdTime;

  // --- Leaflet init (once) ---------------------------------------------------
  useEffect(() => {
    const container = mapDiv.current;
    if (!container) return;
    const m = L.map(container, { zoomControl: true, maxZoom: 24, center: [DEFAULT_CENTER[1], DEFAULT_CENTER[0]], zoom: DEFAULT_ZOOM });
    const sat = BASE_LAYERS.satellite;
    L.tileLayer(sat.url, { attribution: sat.attribution, maxNativeZoom: sat.maxNativeZoom, maxZoom: sat.maxZoom }).addTo(m);
    areasLayer.current = L.featureGroup().addTo(m);
    obstaclesLayer.current = L.layerGroup().addTo(m);
    capturedLayer.current = L.layerGroup().addTo(m); // under the path + live stations
    pathLayer.current = L.layerGroup().addTo(m);
    capturesLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e) => onMapClick.current?.(e));
    map.current = m;
    setMapReady(true);
    return () => {
      m.remove();
      map.current = null;
      areasLayer.current = obstaclesLayer.current = pathLayer.current = null;
      capturesLayer.current = capturedLayer.current = draftLayer.current = droneMarker.current = null;
      startFlag.current = endFlag.current = null;
      setMapReady(false);
    };
  }, []);

  // Seed the traversal anchor from the drone's (drift-corrected) fix. Deliberately
  // NOT re-seeded on ordinary GPS jitter, and never while a mission is locked — see
  // the `startLngLat` note above.
  useEffect(() => {
    if (lockedPlan) return;
    if (!startFromDrone || !droneAvailable) return;
    if (startSeeded.current && seededOffset.current === offset) return;
    setStartLngLat({ lat: displayLat, lng: displayLng });
    startSeeded.current = true;
    seededOffset.current = offset;
  }, [lockedPlan, startFromDrone, droneAvailable, displayLat, displayLng, offset]);

  // Center on the drone the first time a fix arrives while the canvas is empty.
  useEffect(() => {
    if (!mapReady || seededView.current || !droneAvailable) return;
    if (areas.length || obstacles.length) return;
    seededView.current = true;
    map.current?.setView([displayLat, displayLng], 18);
  }, [mapReady, droneAvailable, displayLat, displayLng, areas.length, obstacles.length]);

  // --- Resume mode: secured stations + fit --------------------------------------
  // Green dots for what is already on disk, so the operator sees done vs. what the
  // next leg flies (the amber stations come from the shared render effect below).
  useEffect(() => {
    const g = capturedLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!resumeJob) return;
    for (const p of capturePointsForDisplay(resumeJob, offset)) {
      if (p.status === "captured") L.circleMarker([p.lat, p.lng], CAPTURED_DOT).addTo(g);
    }
  }, [resumeJob, offset, mapReady]);

  // Fit the whole survey (done + remaining) once per session entered — not on every
  // offset change, and not fighting the operator's own panning afterwards. Drift is
  // metres, irrelevant for a fit, so the raw points do.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || !resumeJob) return;
    const id = jobIdOf(resumeJob);
    if (fittedResumeId.current === id) return;
    const pts = capturePointsForDisplay(resumeJob).map((p) => [p.lat, p.lng]);
    if (pts.length === 0) return;
    fittedResumeId.current = id;
    seededView.current = true; // the survey, not a later drone fix, owns the view now
    m.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 20 });
  }, [resumeJob, mapReady]);

  // --- Map click delegation (append vertices / place circle) ------------------
  useEffect(() => {
    onMapClick.current = (e) => {
      const { lat, lng } = e.latlng;
      if (drawMode === "area" || drawMode === "obstacle") {
        draftPts.current = [...draftPts.current, { lat, lng }];
        setDraftCount(draftPts.current.length);
        drawDraft(draftLayer.current, draftPts.current, draftCenter.current);
      } else if (drawMode === "circle") {
        if (!draftCenter.current) {
          draftCenter.current = { lat, lng };
          setDraftHasCenter(true);
          drawDraft(draftLayer.current, [], draftCenter.current);
        } else {
          const radiusM = haversineMeters(draftCenter.current, { lat, lng });
          if (radiusM < MIN_CIRCLE_RADIUS_M) return;
          geomId.current += 1;
          setObstacles((prev) => [...prev, { id: geomId.current, kind: "circle", center: { ...draftCenter.current }, radiusM }]);
          draftCenter.current = null;
          setDraftHasCenter(false);
          setDrawMode("none");
          drawDraft(draftLayer.current, [], null);
        }
      }
    };
  });

  // --- Render survey areas ---------------------------------------------------
  useEffect(() => {
    const group = areasLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const a of areas) {
      if (a.ring.length < 3) continue;
      L.polygon(a.ring.map((p) => [p.lat, p.lng]), { ...AREA_STYLE, interactive: false }).addTo(group);
    }
  }, [areas]);

  // --- Render obstacles ------------------------------------------------------
  useEffect(() => {
    const group = obstaclesLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const o of obstacles) {
      if (o.kind === "polygon" && o.ring?.length >= 3) L.polygon(o.ring.map((p) => [p.lat, p.lng]), OBSTACLE_STYLE).addTo(group);
      else if (o.kind === "circle" && o.radiusM > 0) L.circle([o.center.lat, o.center.lng], { radius: o.radiusM, ...OBSTACLE_STYLE }).addTo(group);
    }
  }, [obstacles]);

  // --- Render coverage path + capture stations -------------------------------
  // Same look as the spray planner (shared COVERAGE_PATH_STYLE + S/E flags), with
  // this page's amber capture dots on top. Flags go straight on the map so they
  // land in the marker pane, above the path and the dots.
  useEffect(() => {
    const m = map.current;
    const pg = pathLayer.current;
    const cg = capturesLayer.current;
    if (!m || !pg || !cg) return;
    pg.clearLayers();
    cg.clearLayers();
    for (const ref of [startFlag, endFlag]) {
      if (ref.current) { m.removeLayer(ref.current); ref.current = null; }
    }
    if (geoPath.length >= 2) {
      const latlngs = geoPath.map((p) => [p.lat, p.lng]);
      L.polyline(latlngs, COVERAGE_PATH_STYLE).addTo(pg);
      startFlag.current = L.marker(latlngs[0], { icon: flagIcon("start"), zIndexOffset: 1000, interactive: false }).addTo(m);
      endFlag.current = L.marker(latlngs[latlngs.length - 1], { icon: flagIcon("end"), zIndexOffset: 900, interactive: false }).addTo(m);
    }
    for (const c of captures) L.circleMarker([c.lat, c.lng], CAPTURE_DOT).addTo(cg);
  }, [geoPath, captures]);

  // --- Live drone marker -----------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!droneAvailable) {
      if (droneMarker.current) { m.removeLayer(droneMarker.current); droneMarker.current = null; }
      return;
    }
    const pos = [displayLat, displayLng];
    if (droneMarker.current) {
      droneMarker.current.setLatLng(pos);
      droneMarker.current.setIcon(droneIcon(displayHeading));
    } else {
      droneMarker.current = L.marker(pos, { icon: droneIcon(displayHeading), zIndexOffset: 1200, interactive: false }).addTo(m);
    }
  }, [droneAvailable, displayLat, displayLng, displayHeading]);

  // --- Poll the capture mission once it's flying -----------------------------
  // Gated on `polling` (a stable flag), NOT on `mission`/`session` — the loop
  // calls their setters on every tick, so depending on them would restart the
  // effect each response and fire back-to-back polls with no delay.
  //
  // Each tick reads both views. The session (GetJob) is the source of truth: its
  // `capture` block is persisted, restart-proof and carries the per-point
  // captured/pending lists. MappingMissionStatus is the live per-leg view and only
  // steers the loop when GetJob is unavailable (404 on an older backend that
  // creates the session at mission end, 503 while the jobs service is down).
  useEffect(() => {
    if (!polling || !sessionId) return;
    let alive = true;
    let timer;
    const detailUrl = (id) => `/mapping/${encodeURIComponent(id)}`;
    async function tick() {
      const [jobRes, statusRes] = await Promise.allSettled([fetchJob(sessionId), fetchMappingMissionStatus()]);
      if (!alive) return;
      const job = jobRes.status === "fulfilled" ? jobRes.value : null;
      const status = statusRes.status === "fulfilled" ? statusRes.value : null;
      if (status) setMission(status);
      if (job) {
        setSession(job);
        const c = captureOf(job);
        // The stitch has started (status left `unstitched`) or is about to start by
        // itself (last point captured → `done`): the detail page takes it from here.
        if (job.status !== "unstitched" || c?.state === "done") {
          setPolling(false);
          navigate(detailUrl(sessionId));
          return;
        }
        if (c) {
          // The "uploaded but takeoff failed" note only describes an `armed`
          // session; once the state moves on it is stale. Idempotent (null → null
          // bails out of the render), so the loop needs no dep on it.
          if (c.state !== "armed") setLaunchError(null);
          // Aircraft down, monitor released, points still owed (or dropped): stop
          // polling and hand over to the leg-ended panel. `returning`/`processing`
          // are NOT the end — the frames are only secured after touchdown.
          if (!c.active && LEG_ENDED_STATES.has(c.state)) { setPolling(false); return; }
          timer = setTimeout(tick, 3000);
          return;
        }
        // A session with no capture block cannot tell us about the flight — let
        // the live view decide below.
      }
      if (status) {
        // Fallback on the live view alone. `odm_job_id` equals the session id from
        // the push on current backends, so it is only a destination once the leg is
        // complete — jumping on its mere presence would leave a flight mid-air.
        const settled = !status.running && MISSION_TERMINAL_PHASES.has(status.phase);
        if (settled && (status.phase === "complete" || status.phase === "done")) {
          setPolling(false);
          navigate(detailUrl(status.odm_job_id || sessionId));
          return;
        }
        // Real terminal (failed/canceled/paused…) with no session to show: stop and
        // let the operator open the repository. `idle`/`arming` are NOT terminal —
        // they can appear before the mission spins up, so keep going.
        if (settled) { setPolling(false); return; }
        timer = setTimeout(tick, 3000);
        return;
      }
      timer = setTimeout(tick, job ? 3000 : 5000); // nothing usable — back off
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [polling, sessionId, navigate]);

  // --- Resume mode entry / exit ---------------------------------------------
  // Swap the planner for the session's remaining route. Drawing tools go away
  // (the route is the backend's, not ours), any previous flight UI is dropped, and
  // altitude / hold time show the session's own values — ResumeMappingMission
  // reuses them server-side, we never send overrides. Stable (setters only) so the
  // URL-entry effect can depend on it.
  const enterResumeMode = useCallback((job) => {
    const c = captureOf(job);
    setPolling(false);
    setMission(null);
    setSession(null);
    setLockedPlan(null); // the fresh-launch lock, if any — resumePlan takes over
    setConfirm(null);
    setPausing(false);
    setCanceledAirborne(false);
    setLaunchError(null);
    setError(null);
    setDrawMode("none");
    setSessionId(jobIdOf(job));
    setResumeJob(job);
    if (Number.isFinite(c?.altitude) && c.altitude > 0) setAltitude(c.altitude);
    if (Number.isFinite(c?.hold_time) && c.hold_time >= 0) setHoldTime(c.hold_time);
  }, []);

  function leaveResumeMode() {
    if (polling || launching) return; // never while a leg is in the air
    setResumeJob(null);
    setLockedPlan(null);
    setMission(null);
    setSession(null);
    setSessionId(null);
    setConfirm(null);
    setPausing(false);
    setCanceledAirborne(false);
    setLaunchError(null);
    setError(null);
    setResumeLookup(null); // so the same id can be looked up afresh next time
    fittedResumeId.current = null;
    // Drop `?resume=` so a reload lands on a clean planner, not back in resume mode.
    if (searchParams.has("resume")) setSearchParams({}, { replace: true });
  }

  // --- URL entry: /mapping/plan?resume=<sessionId> --------------------------
  // Look the session up once per id; a session that is not resumable (still in
  // the air, done, canceled) gets an explanation and a link to its detail page
  // instead of a resume button that the backend would refuse anyway.
  useEffect(() => {
    if (!resumeParam) return;
    let alive = true;
    fetchJob(resumeParam)
      .then((job) => {
        if (!alive) return;
        if (isCaptureResumable(job)) {
          enterResumeMode(job);
          setResumeLookup({ id: resumeParam, ok: true });
        } else {
          setResumeLookup({ id: resumeParam, blockedState: captureOf(job)?.state || job?.status || "—" });
        }
      })
      .catch((e) => {
        if (alive) setResumeLookup({ id: resumeParam, error: e instanceof Error ? e.message : "Gagal memuat sesi" });
      });
    return () => { alive = false; };
  }, [resumeParam, enterResumeMode]);

  // --- Drawing controls ------------------------------------------------------
  function startDraw(mode) {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftCount(0);
    setDraftHasCenter(false);
    drawDraft(draftLayer.current, [], null);
    setDrawMode(mode);
  }
  function cancelDraw() {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftCount(0);
    setDraftHasCenter(false);
    drawDraft(draftLayer.current, [], null);
    setDrawMode("none");
  }
  function undoPoint() {
    draftPts.current = draftPts.current.slice(0, -1);
    setDraftCount(draftPts.current.length);
    drawDraft(draftLayer.current, draftPts.current, draftCenter.current);
  }
  function finishPolygon() {
    if (draftPts.current.length < 3) return;
    const ring = draftPts.current;
    geomId.current += 1;
    if (drawMode === "area") {
      const id = geomId.current;
      setAreas((prev) => [...prev, { id, ring }]);
      if (!angleTouched) setAngleDeg(defaultAngleDeg([{ ring }]));
    } else {
      setObstacles((prev) => [...prev, { id: geomId.current, kind: "polygon", ring }]);
    }
    cancelDraw();
  }
  function clearAll() {
    setAreas([]);
    setObstacles([]);
    cancelDraw();
  }

  // --- Launch ----------------------------------------------------------------
  async function handleLaunch() {
    if (launching) return; // one upload at a time — see the modal note below
    if (photoCount === 0) { setError("Belum ada titik foto — gambar area pemetaan dulu."); setShowAudit(false); return; }
    setLaunching(true);
    setError(null);
    setLaunchError(null);
    // Close the audit modal NOW, before the first await, not once the calls are
    // back: PushCaptureMission is a blocking upload (up to 70 s at the BFF) and the
    // modal resets its checklist on Execute, so left open it invites a second
    // Execute mid-upload — a second push under a fresh id is refused with 409 and
    // its catch would unlock the plan while the first push is still succeeding.
    // Closed, the only entry points left are the panel buttons, which `launching`
    // already disables (and shows "Mengirim…" on).
    setShowAudit(false);
    // Freeze the drawing on exactly what we are about to push, before the first
    // await — past this point the operator is watching a flight, not editing a plan.
    setLockedPlan({ geoPath, captures });
    const id = `map-${Date.now().toString(36)}`;
    // Capture points are planned in the MAP frame; shift into the drone's
    // (drifted) GPS frame before sending so it flies the intended ground track.
    const commandPoints = correctGeoWaypointsForCommand(captures, offset);
    try {
      // PushCaptureMission creates the mapping session under this id — it is in
      // GET /api/jobs (capture.state "armed") before the aircraft even arms.
      await pushCaptureMission({ capturePoints: commandPoints, altitude, holdTime, sessionId: id });
    } catch (e) {
      setLockedPlan(null); // nothing exists on the backend — the plan is editable again
      setError(e instanceof Error ? e.message : "Gagal mengunggah misi pemetaan");
      setLaunching(false);
      return;
    }
    // From here the session EXISTS (capture.state "armed", active:true) and blocks
    // every further PushCaptureMission with 409 until it is executed, paused or
    // cancelled (docs/drone_api.md) — so this page must keep addressing it even if
    // takeoff fails below. Pushing a fresh id on retry would only 409 forever.
    setSessionId(id);
    setSession(null); // first poll fills it in
    setConfirm(null);
    setPausing(false);
    setCanceledAirborne(false);
    // Optimistic live view for an armed session (the contract's own vocabulary):
    // the first poll replaces it with MappingMissionStatus + GetJob.
    setMission({ running: true, session_id: id, phase: "armed", captures_done: 0, total_captures: photoCount, odm_job_id: id, last_error: "" });
    try {
      await executeMission({ mode: "mapping", altitude, jobId: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal memulai misi pemetaan";
      // Do NOT auto-cancel: a 504 or a dropped connection can occur after the
      // command reached the drone, and CancelMappingMission leaves an airborne
      // aircraft where it is. Show the real state and let the operator decide —
      // the poll + MissionProgress controls (Coba terbangkan lagi / Jeda & Pulang
      // / Batalkan Misi) already target `sessionId`.
      setLaunchError(`Misi ${id} sudah terunggah tetapi gagal diterbangkan: ${msg}. Sesi masih berstatus Siap Terbang (armed) di backend — pantau statusnya di panel ini; Coba terbangkan lagi, Batalkan Misi untuk merencanakan ulang, atau Jeda & Pulang untuk melanjutkannya nanti dari Daftar Pemetaan.`);
    } finally {
      setPolling(true);
      setLaunching(false);
    }
  }

  // --- Resume (next leg) -----------------------------------------------------
  // Same gate (pre-flight audit) and same flight UI as a fresh launch; the only
  // difference is who owns the route: ResumeMappingMission uploads a plan for the
  // points not yet in capture.captured, so nothing is sent but the session id.
  async function handleResume() {
    if (launching) return; // one upload at a time — same reason as handleLaunch
    if (!resumeJob || !resumePlan) return;
    const id = jobIdOf(resumeJob);
    const c = captureOf(resumeJob);
    const prog = captureProgress(resumeJob);
    if (prog.remaining === 0) { setError("Semua titik sudah difoto — tidak ada yang perlu dilanjutkan."); setShowAudit(false); return; }
    setLaunching(true);
    setError(null);
    setLaunchError(null);
    // Close the modal before the blocking ResumeMappingMission upload, so a second
    // Execute cannot be armed while the first is still in flight (see handleLaunch).
    setShowAudit(false);
    // Freeze the remaining route before the first await, exactly like a launch —
    // a drift recalibration mid-leg must not move the stations being flown.
    setLockedPlan(resumePlan);
    try {
      await resumeMappingMission({ sessionId: id });
      // Takeoff altitude is the leg's own (the session's) — the same value the
      // plan was just uploaded with.
      await executeMission({ mode: "mapping", altitude: c?.altitude ?? altitude, jobId: id });
      setSessionId(id);
      setConfirm(null);
      setPausing(false);
      setCanceledAirborne(false);
      // Optimistic views until the first poll lands: the per-leg counter covers
      // only this leg's stations; the session is re-armed under the monitor.
      setMission({ running: true, session_id: id, phase: "armed", captures_done: 0, total_captures: prog.remaining, odm_job_id: id, last_error: "" });
      setSession({ ...resumeJob, capture: { ...c, state: "armed", active: true, last_error: "" } });
      setPolling(true);
    } catch (e) {
      // Safe to retry from here: `armed` is resumable, so re-tapping Lanjutkan
      // re-arms the SAME id (docs/mapping.md) — no orphaned session, unlike a
      // fresh push under a new id.
      setLockedPlan(null); // stay in resume mode, route live again
      setError(e instanceof Error ? e.message : "Gagal melanjutkan misi pemetaan");
    } finally {
      setLaunching(false);
    }
  }

  // Re-Execute the SAME armed session after a failed takeoff. A fresh
  // PushCaptureMission would be refused with 409 while it exists, and `armed`
  // means exactly "plan uploaded, ExecuteMission not yet (successfully) called"
  // (docs/mapping.md), so ExecuteMission on the same job_id is the expected next
  // call. If the earlier call did reach the drone after all, the backend refuses
  // this one (mission already executing) and the poll shows `flying` — harmless.
  async function handleRetryExecute() {
    if (!sessionId || acting) return;
    setActing(true);
    setError(null);
    try {
      await executeMission({ mode: "mapping", altitude: captureOf(session)?.altitude ?? altitude, jobId: sessionId });
      setLaunchError(null); // the poll takes it from here (armed → flying)
    } catch (e) {
      setError(`Gagal menerbangkan ulang: ${e instanceof Error ? e.message : "Gagal memulai misi pemetaan"}`);
    } finally {
      setActing(false);
    }
  }

  // --- In-flight controls ----------------------------------------------------
  // PauseMappingMission takes {} — it always targets the mission in the air. It
  // returns at once; the aircraft finishes the current capture, flies home, lands,
  // and only THEN are the frames secured (returning → processing → paused), so the
  // poll keeps running and `pausing` holds the buttons until it sees the leg settle.
  async function handlePause() {
    setActing(true);
    setLaunchError(null);
    setError(null);
    try {
      await pauseMappingMission();
      setPausing(true);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menjeda misi");
    } finally {
      setActing(false);
    }
  }

  // CancelMappingMission drops the mission and releases the monitor; frames and
  // capture.captured survive on disk. The poll then sees capture.state "canceled"
  // with active:false and stops on the leg-ended panel (canceled is not resumable).
  // It does NOT bring the aircraft home: an airborne cancel leaves the drone where
  // it is, so remember whether it was in the air — `canceled` alone cannot tell,
  // and the leg-ended panel has to point the operator at Monitoring Drone (RTL).
  async function handleCancelMission() {
    setActing(true);
    setLaunchError(null);
    setError(null);
    // Read the state now, not after the await — by then it is already `canceled`.
    // `capturing` is the pre-pause live-view name for `flying` (no-session fallback).
    const airborne = AIRBORNE_STATES.includes(captureOf(session)?.state ?? mission?.phase);
    try {
      await cancelMappingMission(sessionId);
      setCanceledAirborne(airborne);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan misi");
    } finally {
      setActing(false);
    }
  }

  function openSession() {
    if (sessionId) navigate(`/mapping/${encodeURIComponent(sessionId)}`);
  }

  const drawing = drawMode !== "none";
  const gsdCm = spacing.gsd > 0 ? (spacing.gsd * 100).toFixed(2) : "—";

  // --- Which panel is showing ---
  // The poll stopped on a settled leg (monitor released; aircraft down unless it
  // was an airborne cancel): swap the live progress for the leg-ended panel.
  // Derived from the same `session` the poll wrote, so there is no second flag to
  // keep in step with it.
  const sessionCapture = captureOf(session);
  const legEndedState = mission && !polling && sessionCapture && !sessionCapture.active && LEG_ENDED_STATES.has(sessionCapture.state)
    ? sessionCapture.state
    : null;
  const resumeLoading = !!resumeParam && resumeLookup?.id !== resumeParam;
  const resumeBlocked = !resumeJob && resumeLookup && resumeLookup.id === resumeParam && !resumeLookup.ok ? resumeLookup : null;
  const resumePanel = !!resumeJob && !mission; // waiting on the ground, next leg not sent yet
  const resumeLeg = captureOf(resumeJob)?.leg; // capture.leg = the flight that is NEXT
  const resumeProgress = resumeJob ? captureProgress(resumeJob) : null;
  const flightUiBusy = !!mission || resumePanel || resumeBlocked || resumeLoading;

  const inputCls = "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20";

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 shadow-sm backdrop-blur">
        <Button variant="outline" size="sm" onClick={() => navigate("/mapping")}><ArrowLeft className="h-4 w-4" /> Pemetaan</Button>
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-5 w-5 shrink-0 text-harvest" strokeWidth={1.9} />
          <div className="min-w-0 text-center">
            <div className="truncate text-sm font-bold leading-tight text-forest">Rencana Misi Pemetaan</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-leaf">
              {resumeJob ? `Lanjutkan Survey · Leg ${Number.isInteger(resumeLeg) && resumeLeg > 0 ? resumeLeg : "—"}` : "Survey Fotogrametri Otonom"}
            </div>
          </div>
        </div>
        <div className="w-[92px]" aria-hidden />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0 bg-[#dfe8e2]" />

        {/* Draw hint banner */}
        {drawing && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur">
            {drawMode === "circle"
              ? draftHasCenter ? "Ketuk lagi untuk menetapkan radius rintangan" : "Ketuk untuk menetapkan pusat rintangan lingkaran"
              : drawMode === "obstacle" ? "Ketuk untuk menambah titik rintangan" : "Ketuk untuk menambah titik area pemetaan"}
          </div>
        )}

        {/* Control panel */}
        <div className="pointer-events-none absolute right-3 top-3 bottom-3 z-[1000] flex w-[300px] max-w-[calc(100vw-24px)] items-start">
          <Card className="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-bold text-forest">{resumePanel ? "Lanjutkan Misi" : mission ? "Misi Pemetaan" : "Perencanaan"}</h2>
              {resumePanel && (
                <button onClick={leaveResumeMode} disabled={launching} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:underline disabled:opacity-50">
                  <X className="h-3.5 w-3.5" /> Batal
                </button>
              )}
              {(areas.length > 0 || obstacles.length > 0) && !drawing && !flightUiBusy && (
                <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-semibold text-destructive hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Bersihkan
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {drawing ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    {drawMode === "circle"
                      ? "Ketuk pusat lalu radius rintangan lingkaran."
                      : `${draftCount} titik — minimal 3 untuk menyelesaikan.`}
                  </p>
                  {drawMode !== "circle" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={undoPoint} disabled={draftCount === 0}><Undo2 className="h-4 w-4" /> Undo</Button>
                      <Button variant="accent" size="sm" onClick={finishPolygon} disabled={draftCount < 3}><Check className="h-4 w-4" /> Selesai</Button>
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={cancelDraw}><Ban className="h-4 w-4" /> Batal</Button>
                </div>
              ) : resumeLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat sesi…</p>
              ) : resumeBlocked ? (
                <ResumeBlockedPanel
                  lookup={resumeBlocked}
                  onOpenSession={() => navigate(`/mapping/${encodeURIComponent(resumeBlocked.id)}`)}
                  onOpenList={() => navigate("/mapping")}
                  onNewPlan={leaveResumeMode}
                />
              ) : mission ? (
                legEndedState ? (
                  <LegEndedPanel
                    state={legEndedState}
                    session={session}
                    canceledAirborne={legEndedState === "canceled" && canceledAirborne}
                    onResume={() => enterResumeMode(session)}
                    onOpenMonitoring={() => navigate("/monitoring")}
                    onOpenSession={openSession}
                    onOpenList={() => navigate("/mapping")}
                    onNewPlan={leaveResumeMode}
                  />
                ) : (
                  <MissionProgress
                    mission={mission}
                    session={session}
                    pausing={pausing}
                    confirm={confirm}
                    acting={acting}
                    launchError={launchError}
                    onConfirm={setConfirm}
                    onPause={handlePause}
                    onCancel={handleCancelMission}
                    onRetryExecute={handleRetryExecute}
                    onOpenSession={openSession}
                    onOpenList={() => navigate("/mapping")}
                  />
                )
              ) : resumeJob ? (
                <ResumePanel job={resumeJob} offset={offset} droneArmed={droneArmed} />
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Geometry */}
                  <div className="flex flex-col gap-2">
                    <Button variant="accent" onClick={() => startDraw("area")}><Pencil className="h-4 w-4" /> Gambar Area Pemetaan</Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => startDraw("obstacle")} disabled={!hasAreas} title={hasAreas ? "" : "Gambar area dulu"}><Grid3x3 className="h-4 w-4" /> Rintangan</Button>
                      <Button variant="outline" size="sm" onClick={() => startDraw("circle")} disabled={!hasAreas} title={hasAreas ? "" : "Gambar area dulu"}><CircleDashed className="h-4 w-4" /> Lingkaran</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {areas.length} area · {obstacles.length} rintangan{obstacles.length === 1 ? "" : ""}
                    </p>
                  </div>

                  {hasAreas && (
                    <>
                      {/* Camera + coverage */}
                      <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
                        <div>
                          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Camera className="h-3.5 w-3.5" /> Kamera</label>
                          <select className={inputCls} value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                            {CAMERA_PRESETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </div>
                        <SliderInputRow label="Ketinggian" value={altitude} suffix=" m" min={5} max={40} step={1} onChange={setAltitude} hardMin={1} hardMax={400} />
                        <SliderInputRow label="Tumpang Tindih Depan" value={frontOverlap} suffix="%" min={40} max={90} step={5} onChange={setFrontOverlap} hardMin={0} hardMax={95} />
                        <SliderInputRow label="Tumpang Tindih Samping" value={sideOverlap} suffix="%" min={40} max={90} step={5} onChange={setSideOverlap} hardMin={0} hardMax={95} />
                        <SliderInputRow
                          label="Sudut Jalur" icon={Compass} value={angleDeg} suffix="°"
                          min={0} max={180} step={5} hardMin={0} hardMax={360}
                          onChange={(v) => { setAngleTouched(true); setAngleDeg(v); }}
                          action={<button onClick={() => { setAngleTouched(false); setAngleDeg(defaultAngleDeg(areas.filter((a) => a.ring.length >= 3))); }} className="text-[11px] font-semibold text-leaf hover:underline">Auto</button>}
                        />
                        <SliderInputRow label="Jeda / Foto" value={holdTime} suffix=" s" min={0} max={6} step={0.5} onChange={setHoldTime} hardMin={0} hardMax={60} />
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Crosshair className="h-3.5 w-3.5" /> Mulai dari drone</span>
                          <input
                            type="checkbox" checked={startFromDrone} disabled={!droneAvailable}
                            onChange={(e) => {
                              const on = e.target.checked;
                              startSeeded.current = false; // re-anchor to the live fix when switched back on
                              setStartFromDrone(on);
                              if (!on) setStartLngLat(null);
                            }}
                            className="h-4 w-4 accent-leaf"
                          />
                        </label>
                      </div>

                      {/* Derived stats */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border/70 pt-3">
                        <Stat icon={ImageIcon} label="Titik Foto" value={String(photoCount)} />
                        <Stat icon={Grid3x3} label="GSD" value={`≈ ${gsdCm} cm/px`} />
                        <Stat icon={Layers} label="Cakupan" value={`${areaHa.toFixed(2)} ha`} />
                        <Stat icon={Ruler} label="Jarak" value={distanceM > 0 ? `${(distanceM / 1000).toFixed(2)} km` : "—"} />
                        <Stat icon={Timer} label="Estimasi" value={fmtDuration(estSeconds)} />
                        <Stat icon={Grid3x3} label="Jarak Jalur" value={`${spacing.laneSpacing.toFixed(1)} m`} />
                      </div>

                      {hasOffset(offset) && (
                        <p className="rounded-lg bg-leaf/10 px-2.5 py-1.5 text-[10px] text-forest">
                          Kalibrasi drift GPS aktif — titik foto dikoreksi ke frame drone saat dikirim.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {error && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>

            {!drawing && resumePanel && (
              <div className="border-t border-border p-3">
                <Button variant="accent" className="w-full" disabled={!resumeProgress?.remaining || launching || droneArmed} onClick={() => setShowAudit(true)}>
                  {launching ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</> : <><Play className="h-4 w-4" /> Lanjutkan Misi ({resumeProgress?.remaining ?? 0} foto)</>}
                </Button>
                {droneArmed && <p className="mt-1.5 text-center text-[11px] font-semibold text-destructive">Drone masih ARMED — daratkan & disarm dulu.</p>}
              </div>
            )}
            {!drawing && !flightUiBusy && (
              <div className="border-t border-border p-3">
                <Button variant="accent" className="w-full" disabled={photoCount === 0 || launching} onClick={() => setShowAudit(true)}>
                  {launching ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</> : <><Plane className="h-4 w-4" /> Terbangkan Misi ({photoCount} foto)</>}
                </Button>
                {photoCount === 0 && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Gambar area pemetaan untuk membuat titik foto.</p>}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* BAYUCARAKA pre-flight audit (same gate as the spray planner) — gates a
          resumed leg exactly like a first launch. */}
      <div className="relative z-[2000] gcs-app">
        <PreFlightAuditModal isOpen={showAudit} onClose={() => setShowAudit(false)} onExecute={resumePanel ? handleResume : handleLaunch} />
      </div>
    </div>
  );
}

// Pill for a capture.state (same look as the mapping list's mission rows).
function StateBadge({ state }) {
  const meta = captureStateMeta(state);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.tone}`}>
      {meta.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.label}
    </span>
  );
}

function ErrorNote({ children }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {children}
    </p>
  );
}

// Two-step inline confirm for the in-flight controls (no window.confirm on the
// kiosk). `destructive` colours the "yes" button; an optional `note` renders as an
// amber warning under the text (same look as the detail page's cancel modal).
function InlineConfirm({ text, note, yesLabel, yesIcon: YesIcon, destructive, busy, onYes, onNo }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
      <p className="text-xs text-foreground">{text}</p>
      {note && (
        <p className="flex items-start gap-1.5 text-xs text-harvest">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm" variant={destructive ? "default" : "accent"} onClick={onYes} disabled={busy}
          className={destructive ? "border-destructive bg-destructive hover:bg-destructive/90" : undefined}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <YesIcon className="h-4 w-4" />} {yesLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onNo} disabled={busy}>Batal</Button>
      </div>
    </div>
  );
}

// Live flight view. `session` (GetJob) is preferred: its `capture` block is the
// persisted truth and counts across legs. `captured` only advances when a leg is
// processed on landing, so during the flight the bar shows photographed
// (captured + pending) — what the operator sees the drone doing. `mission`
// (MappingMissionStatus) is the per-leg live view and the fallback when the
// session poll fails.
function MissionProgress({ mission, session, pausing, confirm, acting, launchError, onConfirm, onPause, onCancel, onRetryExecute, onOpenSession, onOpenList }) {
  const c = captureOf(session);
  const prog = c ? captureProgress(session) : null;
  const total = prog ? prog.total : mission.total_captures || 0;
  const done = prog ? prog.photographed : mission.captures_done || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const state = c?.state ?? mission.phase;
  const lastError = c?.last_error || mission.last_error;
  const failed = state === "failed" || (!c && !!mission.last_error);
  // A cancel while `armed` just drops a plan on the ground; a cancel in the air
  // strands the drone (CancelMappingMission does not RTL) — say so before "Ya".
  const cancelAirborne = AIRBORNE_STATES.includes(state);
  // With a session in hand the leg-ended panel takes over once it settles, so a
  // non-running view only exists on the fallback path.
  const running = c ? true : !!mission.running;
  // Pausable = the aircraft can still be told to come home early: armed/flying
  // with the monitor active. Without a session, trust the live view but never
  // offer it while the aircraft is already landing / draining the camera.
  const pausable = c
    ? isCapturePausable(session)
    : running && !["returning", "processing"].includes(mission.phase);
  const showControls = running && pausable && !pausing;
  const hint = pausing && !PHASE_HINT[state]
    ? "Menjeda — drone kembali & mendarat, foto diamankan setelah mendarat…"
    : PHASE_HINT[state];
  const leg = Number.isInteger(c?.leg) && c.leg > 0 ? c.leg : null;
  // Settled on the fallback path (paused/interrupted/canceled with no session to
  // resume from): name the state rather than calling it "selesai".
  const ended = !running && !failed ? LEG_ENDED_META[state] : null;
  const EndedIcon = ended?.icon;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {failed
          ? <AlertTriangle className="h-5 w-5 text-destructive" />
          : running
            ? <Loader2 className="h-5 w-5 animate-spin text-harvest" />
            : ended
              ? <EndedIcon className={`h-5 w-5 ${ended.tone}`} />
              : <CheckCircle2 className="h-5 w-5 text-leaf" />}
        <div className="min-w-0">
          <p className="text-sm font-bold text-forest">
            {failed ? "Misi gagal" : running ? (pausing ? "Menjeda misi…" : "Menerbangkan misi…") : ended ? ended.title : "Misi selesai"}
          </p>
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {/* Same vocabulary as the list / detail pages (captureStateMeta) whenever
                the session is in hand; the MappingMissionStatus phase labels only
                cover the no-session fallback. */}
            {leg ? `Leg ${leg} · ` : ""}Fase: {c ? captureStateMeta(c.state).label : missionPhaseLabel(mission.phase)}
          </p>
        </div>
      </div>

      {total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Foto terambil</span>
            <span className="tabular-nums">{done}/{total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-harvest transition-all duration-300" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          {prog && prog.pending > 0 && (
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">{prog.captured} aman · {prog.pending} diamankan saat mendarat</p>
          )}
        </div>
      )}

      {hint && (
        <p className="flex items-start gap-2 rounded-xl bg-harvest/10 px-3 py-2 text-xs text-forest">
          <PlaneLanding className="mt-0.5 h-4 w-4 shrink-0 text-harvest" /> {hint}
        </p>
      )}

      {lastError && <ErrorNote>{lastError}</ErrorNote>}

      {/* Uploaded but never took off: the session is still `armed` under this id,
          so the one-tap way out is to re-Execute it (a fresh push would 409).
          Only while it really is still armed — once the poll sees flying the
          earlier call did go through, and after a pause the leg is ending. */}
      {launchError && (
        <>
          <ErrorNote>{launchError}</ErrorNote>
          {state === "armed" && !pausing && !confirm && (
            <Button size="sm" variant="accent" onClick={onRetryExecute} disabled={acting}>
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plane className="h-4 w-4" />} Coba terbangkan lagi
            </Button>
          )}
        </>
      )}

      {showControls && (
        confirm === "pause" ? (
          <InlineConfirm
            text="Drone akan menyelesaikan foto saat ini, pulang & mendarat. Foto yang sudah diambil disimpan."
            yesLabel="Ya, jeda" yesIcon={Pause} busy={acting} onYes={onPause} onNo={() => onConfirm(null)}
          />
        ) : confirm === "cancel" ? (
          <InlineConfirm
            text="Rencana terbang dibuang dan misi tidak bisa dilanjutkan — titik tersisa perlu rencana baru. Foto yang sudah aman tetap tersimpan di sesi."
            note={cancelAirborne
              ? "Drone TIDAK otomatis pulang — setelah dibatalkan, pulangkan (RTL) atau daratkan dari halaman Monitoring Drone. Untuk pulang sambil menjaga misi tetap bisa dilanjutkan, pilih Jeda & Pulang."
              : null}
            destructive
            yesLabel="Ya, batalkan" yesIcon={Ban} busy={acting} onYes={onCancel} onNo={() => onConfirm(null)}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => onConfirm("pause")} disabled={acting}>
              <Pause className="h-4 w-4" /> Jeda &amp; Pulang
            </Button>
            <Button size="sm" variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => onConfirm("cancel")} disabled={acting}>
              <Ban className="h-4 w-4" /> Batalkan Misi
            </Button>
          </div>
        )
      )}

      <p className="text-[11px] text-muted-foreground">
        Saat semua titik terfoto, hasil pemetaan (orthophoto & zona) otomatis diproses dan halaman ini membuka detailnya.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={onOpenSession}><FolderOpen className="h-4 w-4" /> Buka Sesi</Button>
        <Button variant="outline" size="sm" onClick={onOpenList}><List className="h-4 w-4" /> Daftar Pemetaan</Button>
      </div>
    </div>
  );
}

// The leg is over: what got secured, and what next. The aircraft is down for
// paused / interrupted / failed, but a `canceled` leg may still be airborne —
// CancelMappingMission leaves the drone where it is (`canceledAirborne` says so,
// the capture block cannot). `canceled` is also the one settled state that cannot
// be resumed — the points still owed need a fresh plan (`onNewPlan`).
function LegEndedPanel({ state, session, canceledAirborne, onResume, onOpenMonitoring, onOpenSession, onOpenList, onNewPlan }) {
  const meta = LEG_ENDED_META[state] ?? LEG_ENDED_META.failed;
  const Icon = meta.icon;
  const c = captureOf(session);
  const prog = captureProgress(session);
  const resumable = isCaptureResumable(session);
  const canceled = state === "canceled";
  const airborne = canceled && !!canceledAirborne;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 shrink-0 ${meta.tone}`} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-forest">{meta.title}</p>
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{jobIdOf(session)}</p>
        </div>
      </div>

      <p className="text-xs text-foreground tabular-nums">
        <span className="font-bold">{prog.captured}</span> dari {prog.total} foto sudah aman · <span className="font-bold">{prog.remaining}</span> titik tersisa
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-leaf transition-all duration-300" style={{ width: `${prog.securedPct}%` }} />
      </div>

      {c?.last_error && <ErrorNote>{c.last_error}</ErrorNote>}

      {airborne && (
        <p className="flex items-start gap-2 rounded-xl bg-harvest/10 px-3 py-2 text-xs text-forest">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-harvest" />
          Drone masih di udara dan tidak otomatis pulang — pulangkan (RTL) atau daratkan dari halaman Monitoring Drone.
        </p>
      )}

      {/* Always shown for a cancel: it is the reason there is no Lanjutkan button. */}
      {canceled && (
        <p className="text-[11px] text-muted-foreground">
          Misi yang dibatalkan tidak bisa dilanjutkan{prog.remaining > 0 ? " — titik tersisa perlu rencana baru." : "."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {airborne && (
          <Button variant="accent" onClick={onOpenMonitoring}><Plane className="h-4 w-4" /> Monitoring Drone</Button>
        )}
        {resumable && (
          <Button variant="accent" onClick={onResume}><Play className="h-4 w-4" /> Lanjutkan Misi ({prog.remaining} foto)</Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onOpenSession}><FolderOpen className="h-4 w-4" /> Buka Sesi</Button>
          <Button variant="outline" size="sm" onClick={onOpenList}><List className="h-4 w-4" /> Daftar Pemetaan</Button>
        </div>
        {/* Back to the planner for the points still owed (canceled is not
            resumable). Withheld while the drone is airborne: the one thing to do
            then is land it, not push a new mission under it. */}
        {canceled && !airborne && (
          <Button variant="outline" size="sm" onClick={onNewPlan}><Pencil className="h-4 w-4" /> Rencana Baru</Button>
        )}
      </div>
    </div>
  );
}

// Pre-flight view of the next leg. Altitude / hold time are the session's own
// and read-only here: ResumeMappingMission reuses them server-side.
function ResumePanel({ job, offset, droneArmed }) {
  const c = captureOf(job);
  const prog = captureProgress(job);
  const leg = Number.isInteger(c?.leg) && c.leg > 0 ? c.leg : "—";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={jobIdOf(job)}>{jobIdOf(job)}</p>
        <StateBadge state={c?.state} />
      </div>

      <p className="text-sm text-foreground tabular-nums">
        <span className="font-bold text-forest">Leg {leg}:</span> {prog.remaining} titik tersisa dari {prog.total}
      </p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border/70 pt-3">
        <Stat icon={CheckCircle2} label="Sudah Aman" value={`${prog.captured} foto`} />
        <Stat icon={ImageIcon} label="Titik Foto" value={String(prog.total)} />
        <Stat icon={Ruler} label="Ketinggian" value={Number.isFinite(c?.altitude) ? `${c.altitude} m` : "—"} />
        <Stat icon={Timer} label="Jeda / Foto" value={Number.isFinite(c?.hold_time) ? `${c.hold_time} s` : "—"} />
      </div>

      {c?.last_error && <ErrorNote>{c.last_error}</ErrorNote>}

      {/* `interrupted` = the backend restarted mid-mission and merely stopped
          watching; the uploaded AUTO plan may still be running on the FCU, so
          the aircraft is NOT known to be down (docs/mapping.md capture.state). */}
      {c?.state === "interrupted" && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Backend dimulai ulang saat misi berjalan — penerbangan tidak lagi dipantau dan drone tidak otomatis pulang. Pastikan drone sudah mendarat & disarm (cek Monitoring Drone) sebelum melanjutkan.
        </p>
      )}
      {droneArmed && (
        <ErrorNote>Drone masih ARMED menurut telemetri — pulangkan (RTL) / daratkan dan disarm dulu sebelum leg berikutnya.</ErrorNote>
      )}

      <p className="text-[11px] text-muted-foreground">
        Drone lepas landas dari posisinya sekarang, memotret titik tersisa (amber), lalu kembali ke titik lepas landas leg ini. Titik hijau sudah aman di sesi.
      </p>

      {hasOffset(offset) && (
        <p className="rounded-lg bg-leaf/10 px-2.5 py-1.5 text-[10px] text-forest">
          Titik tersimpan dalam frame GPS drone — ditampilkan dengan koreksi drift aktif.
        </p>
      )}
    </div>
  );
}

// `?resume=` pointed at a session that cannot be continued (or could not be
// loaded): explain, and offer the detail page instead of a resume the backend
// would refuse.
function ResumeBlockedPanel({ lookup, onOpenSession, onOpenList, onNewPlan }) {
  const blocked = !!lookup.blockedState;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-forest">{blocked ? "Sesi tidak bisa dilanjutkan" : "Gagal memuat sesi"}</p>
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{lookup.id}</p>
        </div>
      </div>
      <ErrorNote>
        {blocked
          ? `Sesi ini tidak bisa dilanjutkan (status: ${captureStateMeta(lookup.blockedState).label}).`
          : lookup.error}
      </ErrorNote>
      <div className="flex flex-col gap-2">
        {blocked && <Button variant="accent" onClick={onOpenSession}><FolderOpen className="h-4 w-4" /> Buka Sesi</Button>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onOpenList}><List className="h-4 w-4" /> Daftar Pemetaan</Button>
          <Button variant="outline" size="sm" onClick={onNewPlan}><Pencil className="h-4 w-4" /> Rencana Baru</Button>
        </div>
      </div>
    </div>
  );
}
