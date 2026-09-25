import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Route as RouteIcon, MapPinned } from "lucide-react";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { diagnosticsCoords, headingDeg, useDiagnostics } from "@/lib/gcs/diagnostics";
import { PreFlightAuditModal } from "@/components/gcs/PreFlightAuditModal";
import { FlightControlsPanel } from "@/components/maps/flight-plan/FlightControlsPanel";
import { setMissionPlan } from "@/lib/gcs/mission-plan";
import { pushSprayMission, executeMission, cancelSprayMission } from "@/lib/gcs/api";
import { ratesFromChambers } from "@/lib/gcs/spray-overlay";
import { readFlightPlanInput } from "@/lib/gcs/flight-plan-input";
import { LoadMissionFileButton } from "@/components/gcs/LoadMissionFileButton";
import {
  useDroneOffset,
  setDroneOffset,
  clearDroneOffset,
  computeDroneOffset,
  applyOffsetToCoords,
  applyOffsetToHeading,
  correctGeoWaypointsForCommand,
  correctPolygonForCommand,
  bearingDeg,
  hasOffset,
  offsetMeters,
  offsetBearingDeg,
} from "@/lib/gcs/drone-offset";
import {
  featuresToTargets,
  missionZonesFromTargets,
  defaultAngleDeg,
  planFlightPath,
  pathLengthMeters,
  targetsBounds,
  haversineMeters,
} from "@/lib/gcs/flight-geo";

const DEFAULT_LANE_SPACING = 2; // metres (line width / nozzle swath)
const DEFAULT_ALTITUDE = 5; // metres
const DEFAULT_SPEED = 3; // m/s
const MIN_CIRCLE_RADIUS_M = 0.5;

// No-fly obstacle rendering (dark "blocked" look, distinct from rose targets
// and the emerald path). interactive:false so taps pass through while drawing.
const OBSTACLE_STYLE = {
  color: "#1e293b",
  weight: 2,
  fillColor: "#334155",
  fillOpacity: 0.35,
  dashArray: "5 4",
  interactive: false,
};

// Redraw the in-progress obstacle draft (polygon vertices/edges or a circle
// centre) into the given layer group. Pure — no React — safe to call anywhere.
function drawDraft(map, groupRef, pts, center) {
  const group = groupRef.current;
  if (!map || !group) return;
  group.clearLayers();
  const dot = { color: "#1e293b", fillColor: "#ffffff", fillOpacity: 1, weight: 2, interactive: false };
  if (center) {
    L.circleMarker([center.lat, center.lng], { ...dot, radius: 5, fillColor: "#1e293b" }).addTo(group);
  }
  if (pts.length >= 2) {
    L.polyline(
      pts.map((p) => [p.lat, p.lng]),
      { color: "#1e293b", weight: 2, dashArray: "5 4", interactive: false },
    ).addTo(group);
  }
  for (const p of pts) {
    L.circleMarker([p.lat, p.lng], { ...dot, radius: 4 }).addTo(group);
  }
}

function flagIcon(kind) {
  const color = kind === "start" ? "#16a34a" : "#dc2626";
  const label = kind === "start" ? "S" : "E";
  return L.divIcon({
    className: "",
    iconSize: [30, 38],
    iconAnchor: [4, 36],
    html: `<div style="position:relative;width:30px;height:38px">
      <div style="position:absolute;left:3px;top:0;width:2px;height:36px;background:#0f172a;border-radius:1px"></div>
      <div style="position:absolute;left:5px;top:1px;width:18px;height:14px;background:${color};border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900;font-family:sans-serif">${label}</div>
    </div>`,
  });
}

function droneIcon(rotationDeg) {
  // The lucide "Plane" glyph points ~45° NE at rest, so subtract 45 to make the
  // nose sit at the true compass heading (matches Maps.jsx droneMarkerIcon).
  const deg = Number.isFinite(rotationDeg) ? rotationDeg - 45 : 0;
  return L.divIcon({
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div style="position:relative;width:40px;height:40px">
      <span style="position:absolute;left:50%;top:50%;width:36px;height:36px;margin-left:-18px;margin-top:-18px;border-radius:9999px;background:rgba(0,91,179,0.22);animation:fp-ping 2.4s cubic-bezier(0,0,0.2,1) infinite"></span>
      <svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;margin-left:-12px;margin-top:-12px;filter:drop-shadow(0 4px 8px rgba(0,41,82,0.5));transform:rotate(${deg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#005bb3" stroke="white" stroke-width="1"/></svg>
    </div>`,
  });
}

// Faded "where the GPS thinks the drone is" reference, shown during pose
// calibration so the user can see the raw fix they are correcting away from.
function poseGhostIcon(rotationDeg) {
  // Same ~45° NE rest orientation as droneIcon — align the nose to true heading.
  const deg = Number.isFinite(rotationDeg) ? rotationDeg - 45 : 0;
  return L.divIcon({
    className: "",
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `<div style="position:relative;width:46px;height:46px;opacity:0.55">
      <svg width="20" height="20" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;margin-left:-10px;margin-top:-10px;transform:rotate(${deg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#64748b" stroke="white" stroke-width="1"/></svg>
      <span style="position:absolute;left:50%;bottom:-2px;transform:translateX(-50%);font:700 8px sans-serif;color:#fff;background:#64748b;border-radius:4px;padding:0 3px;white-space:nowrap">GPS</span>
    </div>`,
  });
}

export function FlightPlan() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: diagnosticsData } = useDiagnostics();
  const offset = useDroneOffset();
  const drone = diagnosticsCoords(diagnosticsData); // RAW reported {lat, lon}
  const rawHeading = headingDeg(diagnosticsData); // RAW reported heading (deg)
  const droneAvailable =
    drone != null && Number.isFinite(drone.lat) && Number.isFinite(drone.lon);
  // Everything the user SEES is shifted by the calibrated GPS drift, so the
  // marker sits where the drone truly is over the field (display = reported + Δ).
  const displayDrone = applyOffsetToCoords(drone, offset);
  const displayLat = displayDrone?.lat ?? null;
  const displayLon = displayDrone?.lng ?? null;
  const displayHeading = applyOffsetToHeading(rawHeading, offset);

  const [input, setInput] = useState(() => readFlightPlanInput());
  const targets = useMemo(
    () => featuresToTargets(input?.featureCollection?.features),
    [input],
  );

  const [laneSpacing, setLaneSpacing] = useState(DEFAULT_LANE_SPACING);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [angleDeg, setAngleDeg] = useState(() => defaultAngleDeg(targets));
  const [startLngLat, setStartLngLat] = useState(null);
  const [plan, setPlan] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [obstacles, setObstacles] = useState([]);
  const [drawMode, setDrawMode] = useState("none"); // "none" | "polygon" | "circle"
  const [draftPointCount, setDraftPointCount] = useState(0);
  const [draftHasCenter, setDraftHasCenter] = useState(false);
  const [poseMode, setPoseMode] = useState(false); // drone-pose calibration active
  const [poseHasAnchor, setPoseHasAnchor] = useState(false); // 1st tap placed

  const mapDiv = useRef(null);
  const map = useRef(null);
  const pathLayer = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const droneMarker = useRef(null);
  const startSeeded = useRef(false);
  const startFromDrone = useRef(true); // start still anchored to the drone (auto)?
  const seededOffsetRef = useRef(null); // offset the start was last seeded with
  const draftLayer = useRef(null);
  const obstacleLayer = useRef(null);
  const draftPts = useRef([]);
  const draftCenter = useRef(null);
  const obstacleId = useRef(0);
  const onMapClick = useRef(null);
  const onMapMove = useRef(null);
  const poseLayer = useRef(null);
  const poseAnchor = useRef(null); // committed 1st-tap "true" position

  const hasTargets = targets.length > 0;

  // Derived summary
  const geoPath = plan?.geoPath ?? [];
  const pathReady = geoPath.length >= 2;
  const waypointCount = geoPath.length;
  const distanceMeters = pathReady ? pathLengthMeters(geoPath) : 0;
  const areaHa = targets.reduce((sum, t) => sum + t.areaM2, 0) / 10000;
  const chambers = useMemo(() => {
    const set = new Set();
    for (const target of targets) for (const c of target.chambers) set.add(c);
    return [...set];
  }, [targets]);
  // Field-wide product loaded into each chamber (from the Maps hand-off); drives
  // each chamber's default dose when a zone has no explicit override.
  const chamberProducts = useMemo(
    () =>
      input?.chamberProducts && typeof input.chamberProducts === "object"
        ? input.chamberProducts
        : {},
    [input],
  );

  // Human-readable summary of the active GPS drift for the calibration panel.
  const offsetAtLat = displayLat ?? targetsBounds(targets)?.cLat ?? 0;
  const offsetInfo = hasOffset(offset)
    ? {
        meters: offsetMeters(offset, offsetAtLat).distance,
        bearing: offsetBearingDeg(offset, offsetAtLat),
        headingDelta: offset.dHeading,
        calibratedAt: offset.calibratedAt,
      }
    : null;

  // The empty-state "Muat Misi" loader calls navigate("/flight-plan") while the
  // user is ALREADY on this route. A same-path history push does NOT remount the
  // component (the app keys its route wrapper on pathname, not key), so the lazy
  // useState above would never see the fresh hand-off. `location.key` changes on
  // every push, so re-read the input whenever a *new* navigation lands here.
  const initialLocationKey = useRef(location.key);
  useEffect(() => {
    if (location.key === initialLocationKey.current) return;
    const next = readFlightPlanInput();
    if (!next) return;
    setInput(next);
    setAngleDeg(defaultAngleDeg(featuresToTargets(next.featureCollection?.features)));
    // Re-anchor the start flag to the drone for the freshly loaded field.
    startFromDrone.current = true;
    startSeeded.current = false;
    seededOffsetRef.current = null;
  }, [location.key]);

  // Create the interactive map once, draw the target polygons, fit the view.
  useEffect(() => {
    if (!hasTargets || !mapDiv.current || map.current) return;
    // Seed an initial view up-front. In the WebKitGTK kiosk the container can be
    // 0-size at effect time; adding vector layers (the target polygon, the source
    // waypoint track) to a view-less map then crashes Leaflet's _clipPoints on an
    // undefined renderer bounds. A center/zoom in the options avoids that; the
    // fitBounds below still refines the framing.
    const initBounds = targetsBounds(targets);
    const m = L.map(mapDiv.current, {
      zoomControl: true,
      maxZoom: 24,
      center: initBounds ? [initBounds.cLat, initBounds.cLng] : [0, 0],
      zoom: 18,
    });
    map.current = m;

    const sat = BASE_LAYERS.satellite;
    L.tileLayer(sat.url, {
      attribution: sat.attribution,
      maxNativeZoom: sat.maxNativeZoom,
      maxZoom: sat.maxZoom,
    }).addTo(m);

    L.geoJSON(input.featureCollection, {
      interactive: false, // let map clicks pass through for obstacle drawing
      style: {
        color: "#e11d48",
        weight: 2.5,
        opacity: 1,
        fillColor: "#fb7185",
        fillOpacity: 0.18,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(m);

    // When the plan was loaded from a .waypoints file, draw the original
    // imported waypoints as a faint reference track under the (re-planned)
    // coverage path — so the user sees the source points the polygon was
    // generated from. Static (part of `input`), so drawn once here.
    const sourceWps = Array.isArray(input.sourceWaypoints) ? input.sourceWaypoints : [];
    if (sourceWps.length >= 2) {
      L.polyline(
        sourceWps.map((w) => [w.lat, w.lng]),
        { color: "#475569", weight: 1.5, opacity: 0.55, dashArray: "3 5", interactive: false },
      ).addTo(m);
      for (const w of sourceWps) {
        L.circleMarker([w.lat, w.lng], {
          radius: 2.5,
          color: "#475569",
          weight: 1,
          opacity: 0.6,
          fillColor: "#cbd5e1",
          fillOpacity: 0.9,
          interactive: false,
        }).addTo(m);
      }
    }

    // Obstacles below, active draft above, pose-calibration overlay on top
    // (all above tiles, below path/markers).
    obstacleLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    poseLayer.current = L.layerGroup().addTo(m);

    // Attach the listeners here (in lock-step with the map's lifecycle) and
    // delegate to the latest handler refs so they always see current state.
    m.on("click", (event) => onMapClick.current?.(event));
    m.on("mousemove", (event) => onMapMove.current?.(event));

    const bounds = targetsBounds(targets);
    if (bounds) {
      m.fitBounds(
        [
          [bounds.minLat, bounds.minLng],
          [bounds.maxLat, bounds.maxLng],
        ],
        { padding: [60, 60], maxZoom: 21 },
      );
    }

    return () => {
      m.remove();
      map.current = null;
      pathLayer.current = null;
      startMarker.current = null;
      endMarker.current = null;
      droneMarker.current = null;
      draftLayer.current = null;
      obstacleLayer.current = null;
      poseLayer.current = null;
    };
  }, [hasTargets, targets, input]);

  // Seed the start point from the drone's (drift-corrected) position. We do NOT
  // re-seed on ordinary GPS jitter — that would reshuffle the coverage path every
  // poll — but we DO re-seed when the calibration (offset identity) changes, so a
  // fresh calibration re-anchors the start to where the drone truly is instead of
  // stranding the flag at the pre-calibration spot. Once the user drags the flag
  // (startFromDrone=false) neither jitter nor calibration moves it.
  useEffect(() => {
    if (displayLat == null || displayLon == null) return;
    if (!startFromDrone.current) return;
    if (startSeeded.current && seededOffsetRef.current === offset) return;
    setStartLngLat({ lat: displayLat, lng: displayLon });
    startSeeded.current = true;
    seededOffsetRef.current = offset;
  }, [displayLat, displayLon, offset]);

  // Re-plan whenever inputs (including obstacles) change.
  useEffect(() => {
    if (!hasTargets) return;
    setPlan(planFlightPath({ targets, obstacles, laneSpacing, angleDeg, startLngLat }));
  }, [hasTargets, targets, obstacles, laneSpacing, angleDeg, startLngLat]);

  // Render committed obstacles into their layer group.
  useEffect(() => {
    const group = obstacleLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const obstacle of obstacles) {
      if (obstacle.kind === "polygon" && obstacle.ring.length >= 3) {
        L.polygon(obstacle.ring.map((p) => [p.lat, p.lng]), OBSTACLE_STYLE).addTo(group);
      } else if (obstacle.kind === "circle" && obstacle.radiusM > 0) {
        L.circle([obstacle.center.lat, obstacle.center.lng], {
          radius: obstacle.radiusM,
          ...OBSTACLE_STYLE,
        }).addTo(group);
      }
    }
  }, [obstacles]);

  // Draw / refresh the path polyline + start (draggable) & end flags.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    if (!pathReady) {
      for (const ref of [pathLayer, startMarker, endMarker]) {
        if (ref.current) {
          m.removeLayer(ref.current);
          ref.current = null;
        }
      }
      return;
    }

    const latlngs = geoPath.map((p) => [p.lat, p.lng]);
    const start = latlngs[0];
    const end = latlngs[latlngs.length - 1];

    if (pathLayer.current) pathLayer.current.setLatLngs(latlngs);
    else
      pathLayer.current = L.polyline(latlngs, {
        color: "#059669",
        weight: 3,
        opacity: 0.95,
        interactive: false,
      }).addTo(m);

    if (startMarker.current) {
      startMarker.current.setLatLng(start);
    } else {
      startMarker.current = L.marker(start, {
        icon: flagIcon("start"),
        draggable: true,
        zIndexOffset: 1000,
      }).addTo(m);
      startMarker.current.on("dragend", (event) => {
        const ll = event.target.getLatLng();
        startSeeded.current = true;
        startFromDrone.current = false; // user took manual control of the start
        setStartLngLat({ lat: ll.lat, lng: ll.lng });
      });
    }

    if (endMarker.current) endMarker.current.setLatLng(end);
    else
      endMarker.current = L.marker(end, {
        icon: flagIcon("end"),
        zIndexOffset: 900,
        interactive: false,
      }).addTo(m);
  }, [plan, pathReady, geoPath]);

  // Live drone marker — drift-corrected for display, and hidden during pose
  // calibration (the ghost/placement markers take over then).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (poseMode || displayLat == null || displayLon == null) {
      if (droneMarker.current) {
        m.removeLayer(droneMarker.current);
        droneMarker.current = null;
      }
      return;
    }
    const pos = [displayLat, displayLon];
    if (droneMarker.current) {
      droneMarker.current.setLatLng(pos);
      droneMarker.current.setIcon(droneIcon(displayHeading));
    } else {
      droneMarker.current = L.marker(pos, {
        icon: droneIcon(displayHeading),
        zIndexOffset: 1200,
        interactive: false,
      }).addTo(m);
    }
  }, [poseMode, displayLat, displayLon, displayHeading]);

  // Keep the latest map-click handler in a ref so a single stable listener can
  // delegate to it while always seeing current drawMode / draft state.
  useEffect(() => {
    onMapClick.current = (event) => {
      if (poseMode) {
        handlePoseClick(event);
        return;
      }
      if (drawMode === "none") return;
      const { lat, lng } = event.latlng;
      if (drawMode === "polygon") {
        draftPts.current = [...draftPts.current, { lat, lng }];
        setDraftPointCount(draftPts.current.length);
        drawDraft(map.current, draftLayer, draftPts.current, draftCenter.current);
        return;
      }
      // circle: first tap sets the centre, second tap sets the radius.
      if (!draftCenter.current) {
        draftCenter.current = { lat, lng };
        setDraftHasCenter(true);
        drawDraft(map.current, draftLayer, [], draftCenter.current);
        return;
      }
      const radiusM = haversineMeters(draftCenter.current, { lat, lng });
      if (radiusM < MIN_CIRCLE_RADIUS_M) return; // ignore near-zero mis-tap
      const center = draftCenter.current;
      obstacleId.current += 1;
      setObstacles((prev) => [...prev, { id: obstacleId.current, kind: "circle", center, radiusM }]);
      draftCenter.current = null;
      setDraftHasCenter(false);
      setDrawMode("none");
      drawDraft(map.current, draftLayer, [], null);
    };
  });

  // Live rubber-band arrow that tracks the cursor between the two calibration
  // taps (mouse only — a touch tap has no hover, so the preview just updates on
  // the next tap). Kept in a ref so the stable map listener sees current state.
  useEffect(() => {
    onMapMove.current = (event) => {
      if (!poseMode || !poseAnchor.current) return;
      drawPosePreview(poseAnchor.current, { lat: event.latlng.lat, lng: event.latlng.lng });
    };
  });

  function resetDraft() {
    draftPts.current = [];
    draftCenter.current = null;
    setDraftPointCount(0);
    setDraftHasCenter(false);
    drawDraft(map.current, draftLayer, [], null);
  }
  function startDraw(mode) {
    resetDraft();
    setDrawMode(mode);
  }
  function cancelDraw() {
    resetDraft();
    setDrawMode("none");
  }
  function undoDraftPoint() {
    draftPts.current = draftPts.current.slice(0, -1);
    setDraftPointCount(draftPts.current.length);
    drawDraft(map.current, draftLayer, draftPts.current, draftCenter.current);
  }
  function finishPolygon() {
    if (draftPts.current.length < 3) return;
    const ring = draftPts.current;
    obstacleId.current += 1;
    setObstacles((prev) => [...prev, { id: obstacleId.current, kind: "polygon", ring }]);
    resetDraft();
    setDrawMode("none");
  }
  function deleteObstacle(id) {
    setObstacles((prev) => prev.filter((o) => o.id !== id));
  }

  // --- Drone pose calibration ("tell me where the drone really is", RViz-style) ---
  // Renders the faded RAW-GPS reference plus the placed "true" pose and its
  // heading arrow. `cursor` (live mouse hover) makes the arrow track before the
  // 2nd tap; on touch it simply reflects the two committed taps.
  function drawPosePreview(anchor, cursor) {
    const group = poseLayer.current;
    if (!group) return;
    group.clearLayers();
    if (drone && Number.isFinite(drone.lat)) {
      L.marker([drone.lat, drone.lon], {
        icon: poseGhostIcon(rawHeading),
        interactive: false,
        zIndexOffset: 1100,
      }).addTo(group);
    }
    if (!anchor) return;
    const bearing = cursor ? bearingDeg(anchor, cursor) : null;
    if (cursor) {
      L.polyline(
        [
          [anchor.lat, anchor.lng],
          [cursor.lat, cursor.lng],
        ],
        { color: "#2563eb", weight: 2.5, dashArray: "6 5", interactive: false },
      ).addTo(group);
    }
    L.marker([anchor.lat, anchor.lng], {
      icon: droneIcon(bearing ?? displayHeading ?? 0),
      interactive: false,
      zIndexOffset: 1300,
    }).addTo(group);
  }

  function enterPoseMode() {
    if (!droneAvailable) {
      setError("GPS drone belum tersedia — tidak dapat mengkalibrasi drift.");
      return;
    }
    setError(null);
    if (drawMode !== "none") cancelDraw();
    poseAnchor.current = null;
    setPoseHasAnchor(false);
    setPoseMode(true);
    drawPosePreview(null, null); // show the raw-GPS ghost reference
  }

  function exitPoseMode() {
    poseAnchor.current = null;
    setPoseHasAnchor(false);
    setPoseMode(false);
    poseLayer.current?.clearLayers();
  }

  // Commit: Δ = true_pose − reported_pose, using the RAW fix at THIS instant as
  // the baseline (never the already-corrected display value). trueBearing null
  // = "position only" — keeps the previous heading correction.
  function commitPose(anchor, trueBearing) {
    const reported = diagnosticsCoords(diagnosticsData);
    const reportedHeading = headingDeg(diagnosticsData);
    const delta = computeDroneOffset({
      reported,
      reportedHeading,
      truePos: anchor,
      trueBearing,
      previous: offset,
    });
    if (!delta) {
      setError("GPS drone belum lengkap — tidak dapat mengkalibrasi drift.");
      exitPoseMode();
      return;
    }
    setDroneOffset(delta);
    // The heading half needs a reported-heading baseline to form a delta. If the
    // user pointed a direction but telemetry has no heading yet, the position was
    // still saved — say so rather than silently dropping the facing tap.
    if (Number.isFinite(trueBearing) && !Number.isFinite(reportedHeading)) {
      setError("Posisi disimpan. Arah belum bisa dikalibrasi — drone belum melaporkan heading.");
    } else {
      setError(null);
    }
    exitPoseMode();
  }

  function handlePoseClick(event) {
    const latlng = { lat: event.latlng.lat, lng: event.latlng.lng };
    if (!poseAnchor.current) {
      // First tap: where the drone actually is.
      poseAnchor.current = latlng;
      setPoseHasAnchor(true);
      drawPosePreview(latlng, null);
      return;
    }
    // Second tap: the direction it faces → commit the full pose.
    commitPose(poseAnchor.current, bearingDeg(poseAnchor.current, latlng));
  }

  function savePositionOnly() {
    if (!poseAnchor.current) return;
    commitPose(poseAnchor.current, null);
  }

  function resetOffset() {
    clearDroneOffset();
    setError(null);
  }

  async function handleStartFlying() {
    if (!pathReady) return;
    setSubmitting(true);
    setError(null);
    try {
      const geoWaypoints = geoPath.map((p) => ({ lat: p.lat, lng: p.lng }));
      // Each spray target polygon becomes a spray zone; its selected chambers
      // (drugs) map to per-pump application rates. See lib/gcs/spray-overlay.js.
      // Holed / multi-part zones are split into hole-free rings first: the drone only
      // understands single rings and would otherwise spray inside the holes.
      const zones = missionZonesFromTargets(targets).map((zone) => ({
        id: zone.id,
        zoneCode: zone.zoneCode,
        polygon: zone.polygon,
        chambers: zone.chambers,
        rates: ratesFromChambers(zone.chambers, zone.chamberDoses, chamberProducts),
      }));
      const sessionId = `spray-${Date.now().toString(36)}`;
      // The path/zones above are in the MAP frame (satellite imagery) — stored
      // as-is so the monitoring overlay lines up with what the user drew. Before
      // sending to the drone we shift them into its (drifted) GPS frame so it
      // physically flies the intended ground track: command = planned − Δ.
      const commandWaypoints = correctGeoWaypointsForCommand(geoWaypoints, offset);
      const commandZones = zones.map((zone) => ({
        id: zone.id,
        polygon: correctPolygonForCommand(zone.polygon, offset),
        rates: zone.rates,
      }));
      setMissionPlan({
        source: "flight-plan",
        mode: "spraying",
        sessionId,
        fieldName: input?.fieldName ?? null,
        geoWaypoints,
        zones,
        chambers,
        chamberProducts,
        swathWidthM: laneSpacing,
        altitude,
        laneSpacing,
        angleDeg,
        gpsOffset: offset,
        createdAt: new Date().toISOString(),
      });
      // Release any previously-armed spray session so a re-plan isn't refused
      // with FAILED_PRECONDITION ("a spray session is already active").
      await cancelSprayMission().catch(() => {});
      await pushSprayMission({
        sessionId,
        geoWaypoints: commandWaypoints,
        zones: commandZones,
        swathWidthM: laneSpacing,
        altitude,
        speed: DEFAULT_SPEED,
      });
      await executeMission({ mode: "spraying", jobId: sessionId });
      setShowAudit(false);
      navigate("/monitoring");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai misi");
      setSubmitting(false);
      setShowAudit(false);
    }
  }

  if (!hasTargets) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-emerald-100 text-forest">
          <MapPinned className="h-8 w-8" />
        </span>
        <div>
          <div className="text-xl font-black text-gray-950">Belum ada target semprot</div>
          <p className="mx-auto mt-1 max-w-sm text-sm font-semibold text-gray-500">
            Tetapkan obat untuk semua polygon di halaman Peta terlebih dahulu, lalu tekan
            &ldquo;Mulai Perencanaan Terbang&rdquo; &mdash; atau muat langsung dari file
            misi <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">.waypoints</code>.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate("/maps")}
            className="flex h-11 items-center gap-2 rounded-2xl bg-forest px-5 text-sm font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.2)] transition-colors hover:bg-house"
          >
            <ArrowLeft className="h-4 w-4" /> Kembali ke Peta
          </button>
          <LoadMissionFileButton
            label="Muat Misi dari File"
            className="flex h-11 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-5 text-sm font-black text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0 disabled:opacity-60"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-16 items-center justify-between gap-3 border-b border-emerald-950/10 bg-white/92 px-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <button
          type="button"
          onClick={() => navigate("/maps")}
          className="group flex h-10 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-3 text-[13px] font-extrabold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0"
          title="Kembali ke Peta"
        >
          <span className="grid h-6 w-6 place-items-center rounded-xl bg-emerald-900 text-white transition-colors group-hover:bg-emerald-800">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
          <span>Peta</span>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-900 text-white shadow-[0_8px_18px_rgba(6,78,59,0.22)]">
            <RouteIcon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <div className="truncate text-[15px] font-black leading-tight text-gray-950">
              Perencanaan Terbang
            </div>
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Rute Penyemprotan Otonom
            </div>
          </div>
        </div>
        <div className="w-[86px]" />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Full-height wrapper gives the panel a definite max-height so it can
            scroll internally; pointer-events-none lets map taps (obstacle
            drawing) pass through the empty area below the panel. */}
        <div className="pointer-events-none absolute right-4 top-4 bottom-4 z-[1000] flex items-start">
          <FlightControlsPanel
            fieldName={input?.fieldName}
            laneSpacing={laneSpacing}
            altitude={altitude}
            angleDeg={angleDeg}
            onLaneSpacingChange={setLaneSpacing}
            onAltitudeChange={setAltitude}
            onAngleChange={setAngleDeg}
            onAngleAuto={() => setAngleDeg(defaultAngleDeg(targets))}
            droneAvailable={droneAvailable}
            onResetStartToDrone={() => {
              if (displayLat == null || displayLon == null) return;
              startSeeded.current = true;
              startFromDrone.current = true; // re-anchor to the drone (auto again)
              seededOffsetRef.current = offset;
              setStartLngLat({ lat: displayLat, lng: displayLon });
            }}
            offsetInfo={offsetInfo}
            poseMode={poseMode}
            poseHasAnchor={poseHasAnchor}
            onStartPose={enterPoseMode}
            onSavePositionOnly={savePositionOnly}
            onCancelPose={exitPoseMode}
            onResetOffset={resetOffset}
            waypointCount={waypointCount}
            distanceMeters={distanceMeters}
            areaHa={areaHa}
            chambers={chambers}
            obstacles={obstacles}
            drawMode={drawMode}
            draftPointCount={draftPointCount}
            draftHasCenter={draftHasCenter}
            onStartPolygon={() => startDraw("polygon")}
            onStartCircle={() => startDraw("circle")}
            onFinishPolygon={finishPolygon}
            onUndoPoint={undoDraftPoint}
            onCancelDraw={cancelDraw}
            onDeleteObstacle={deleteObstacle}
            pathReady={pathReady}
            submitting={submitting}
            error={error}
            onStartFlying={() => setShowAudit(true)}
          />
        </div>
      </div>

      {/* .gcs-app scopes the glass-panel styling so the reused BAYUCARAKA
          pre-flight modal renders exactly like the drone-dashboard one; the
          relative z-[2000] wrapper lifts the modal above the header/panel. */}
      <div className="relative z-[2000] gcs-app">
        <PreFlightAuditModal
          isOpen={showAudit}
          onClose={() => setShowAudit(false)}
          onExecute={handleStartFlying}
        />
      </div>
    </div>
  );
}
