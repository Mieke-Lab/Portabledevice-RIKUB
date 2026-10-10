import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, LocateFixed, Radar } from "lucide-react";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { MonitoringPanel } from "@/components/maps/monitoring/MonitoringPanel";
import { diagnosticsCoords, headingDeg, isStale, useDiagnostics } from "@/lib/gcs/diagnostics";
import { useDroneSettings } from "@/lib/gcs/drone-settings";
import { useMissionPlan } from "@/lib/gcs/mission-plan";
import { useSprayStatus } from "@/lib/gcs/spray-status";
import { cancelSprayMission } from "@/lib/gcs/api";
import {
  useDroneOffset,
  applyOffsetToCoords,
  applyOffsetToHeading,
  hasOffset,
  offsetMeters,
  ZERO_OFFSET,
} from "@/lib/gcs/drone-offset";
import { haversineMeters } from "@/lib/gcs/flight-geo";
import { DEFAULT_SWATH_M, classifySample, sampleLeafletStyle } from "@/lib/gcs/spray-overlay";

const DEFAULT_CENTER = [-7.2756, 112.7946];
const DEFAULT_ZOOM = 16;
const MAX_TRAIL_POINTS = 4000;
const TRAIL_MIN_MOVE_M = 0.6; // ignore GPS jitter below this when extending the trail
// Sprayed coverage is meant to accumulate for the whole mission, so it is only
// cleared when a new session starts. This is a safety ceiling for a pathological
// single session (~1.5 h of continuous in-zone spraying at 2 Hz) that keeps the
// canvas redraw bounded on the Pi kiosk; real battery-bound missions stay well under it.
const MAX_SPRAY_CIRCLES = 12000;

// Neutral (non-drug) colours so the sprayed overlay's cyan/amber/violet stays legible.
const PLANNED_PATH_STYLE = { color: "rgba(255,255,255,0.85)", weight: 2, opacity: 0.9, dashArray: "3 7", interactive: false };
const TRAIL_STYLE = { color: "#34d399", weight: 3, opacity: 0.9, interactive: false };
const ZONE_STYLE = { color: "rgba(255,255,255,0.72)", weight: 1.5, fillColor: "#ffffff", fillOpacity: 0.06, interactive: false };

function droneIcon(rotationDeg) {
  // The lucide "Plane" glyph points ~45° NE at rest, so subtract 45 to align the
  // nose with the true compass heading (matches Maps.jsx droneMarkerIcon).
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

function planPathLatLngs(plan) {
  const waypoints = plan?.geoWaypoints;
  if (!Array.isArray(waypoints)) return [];
  return waypoints
    .map((point) => (Array.isArray(point) ? point : [point?.lat, point?.lng]))
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
}

export function Monitoring() {
  const navigate = useNavigate();
  const { data: diagnosticsData, error: diagError, updatedAt } = useDiagnostics();
  const [{ pollIntervalMs }] = useDroneSettings();
  const plan = useMissionPlan();
  const { status: sprayStatus, samples: spraySamples } = useSprayStatus();

  // The live marker/trail are shifted by the GPS drift so they sit where the
  // drone truly is over the field (display = reported + Δ); the planned path/zones
  // stay in the map frame. Crucially we use the offset the mission was COMMANDED
  // with (frozen into the plan at launch) — not the live calibration — so the
  // display stays registered with the ground track the drone is actually flying
  // even if the operator recalibrates/resets afterwards. Only when no mission is
  // loaded (just watching telemetry) do we fall back to the live calibration.
  const liveOffset = useDroneOffset();
  const offset = plan ? plan.gpsOffset ?? ZERO_OFFSET : liveOffset;
  const displayDrone = applyOffsetToCoords(diagnosticsCoords(diagnosticsData), offset);
  const droneLat = displayDrone?.lat ?? null;
  const droneLon = displayDrone?.lng ?? null;
  const heading = applyOffsetToHeading(headingDeg(diagnosticsData), offset);

  const staleThreshold = Math.max(10000, pollIntervalMs * 3);
  const stale = !diagError && isStale(updatedAt, staleThreshold);
  const online = !diagError && !!diagnosticsData && diagnosticsData.available === true;

  const [cancelling, setCancelling] = useState(false);

  const mapDiv = useRef(null);
  const map = useRef(null);
  const zonesLayer = useRef(null);
  const pathLayer = useRef(null);
  const trailLayer = useRef(null);
  const sprayGroup = useRef(null);
  const sprayLayers = useRef([]); // drawn circles, oldest-first, for the safety cap
  const droneMarker = useRef(null);
  const trailPts = useRef([]);
  const lastDrawnSeq = useRef(-Infinity);
  const renderedSession = useRef(undefined);
  const fitDone = useRef(false);

  // Create the map + layer stack once. Order: zones (bottom) → sprayed overlay
  // → planned path → trail; the drone marker sits above everything.
  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = L.map(mapDiv.current, { zoomControl: true, maxZoom: 24, preferCanvas: true });
    map.current = m;
    m.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    const sat = BASE_LAYERS.satellite;
    L.tileLayer(sat.url, { attribution: sat.attribution, maxNativeZoom: sat.maxNativeZoom, maxZoom: sat.maxZoom }).addTo(m);

    zonesLayer.current = L.layerGroup().addTo(m);
    sprayGroup.current = L.layerGroup().addTo(m);
    pathLayer.current = L.polyline([], PLANNED_PATH_STYLE).addTo(m);
    trailLayer.current = L.polyline([], TRAIL_STYLE).addTo(m);

    return () => {
      m.remove();
      map.current = null;
      zonesLayer.current = null;
      sprayGroup.current = null;
      sprayLayers.current = [];
      pathLayer.current = null;
      trailLayer.current = null;
      droneMarker.current = null;
    };
  }, []);

  // Auto-fit the view once, as soon as we have something to frame: the planned
  // mission first, otherwise the live drone. Never re-fit — it would fight the
  // user's own panning while they watch the flight.
  function tryFit() {
    const m = map.current;
    if (!m || fitDone.current) return;
    const pts = planPathLatLngs(plan);
    for (const zone of Array.isArray(plan?.zones) ? plan.zones : []) {
      for (const point of Array.isArray(zone?.polygon) ? zone.polygon : []) {
        if (Number.isFinite(point[0]) && Number.isFinite(point[1])) pts.push(point);
      }
    }
    if (pts.length >= 2) {
      m.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 21 });
      fitDone.current = true;
      return;
    }
    if (droneLat != null && droneLon != null) {
      m.setView([droneLat, droneLon], 18);
      fitDone.current = true;
    }
  }

  // Render the planned mission (target zones + intended flight path).
  useEffect(() => {
    if (!map.current || !zonesLayer.current || !pathLayer.current) return;
    zonesLayer.current.clearLayers();
    for (const zone of Array.isArray(plan?.zones) ? plan.zones : []) {
      const ring = Array.isArray(zone?.polygon) ? zone.polygon : [];
      if (ring.length >= 3) L.polygon(ring, ZONE_STYLE).addTo(zonesLayer.current);
    }
    pathLayer.current.setLatLngs(planPathLatLngs(plan));
    tryFit();
  }, [plan]);

  // Live drone marker + accumulated flight trail.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (droneLat == null || droneLon == null) {
      if (droneMarker.current) {
        m.removeLayer(droneMarker.current);
        droneMarker.current = null;
      }
      return;
    }
    const pos = [droneLat, droneLon];
    if (droneMarker.current) {
      droneMarker.current.setLatLng(pos);
      droneMarker.current.setIcon(droneIcon(heading));
    } else {
      droneMarker.current = L.marker(pos, { icon: droneIcon(heading), zIndexOffset: 1200, interactive: false }).addTo(m);
    }

    const pts = trailPts.current;
    const last = pts[pts.length - 1];
    if (!last || haversineMeters({ lat: last[0], lng: last[1] }, { lat: droneLat, lng: droneLon }) >= TRAIL_MIN_MOVE_M) {
      pts.push(pos);
      if (pts.length > MAX_TRAIL_POINTS) pts.shift();
      trailLayer.current?.setLatLngs(pts);
    }
    tryFit();
  }, [droneLat, droneLon, heading]);

  // Reset the trail when a new spray session begins.
  useEffect(() => {
    trailPts.current = [];
    trailLayer.current?.setLatLngs([]);
  }, [sprayStatus?.session_id]);

  // Paint the realtime sprayed-area overlay. New samples only (tracked by their
  // monotonic `seq`), so panning/zooming never re-draws the whole track.
  useEffect(() => {
    const group = sprayGroup.current;
    const m = map.current;
    if (!group || !m) return;

    const sessionId = sprayStatus?.session_id ?? null;
    if (sessionId !== renderedSession.current) {
      renderedSession.current = sessionId;
      group.clearLayers();
      sprayLayers.current = [];
      lastDrawnSeq.current = -Infinity;
    }

    const swath = Number(sprayStatus?.swath_width_m) || Number(plan?.swathWidthM) || DEFAULT_SWATH_M;
    const radius = Math.max(0.5, swath / 2);

    let maxSeq = lastDrawnSeq.current;
    for (const sample of Array.isArray(spraySamples) ? spraySamples : []) {
      const seq = sample?.seq;
      if (!Number.isFinite(seq) || seq <= lastDrawnSeq.current) continue;
      if (seq > maxSeq) maxSeq = seq;
      if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) continue;
      const cls = classifySample(sample);
      if (!cls.paint) continue;
      // Samples are the drone's own (drifted) GPS fixes, so drift-correct them
      // too — otherwise the painted coverage sits shifted from the corrected
      // drone marker and the map-frame zones.
      const p = applyOffsetToCoords({ lat: sample.lat, lng: sample.lng }, offset);
      const circle = L.circle([p.lat, p.lng], { radius, ...sampleLeafletStyle(cls.color) }).addTo(group);
      sprayLayers.current.push(circle);
    }
    lastDrawnSeq.current = maxSeq;

    // Safety ceiling: drop the oldest painted circles only past a pathological count.
    const overflow = sprayLayers.current.length - MAX_SPRAY_CIRCLES;
    if (overflow > 0) {
      for (const old of sprayLayers.current.splice(0, overflow)) group.removeLayer(old);
    }
  }, [spraySamples, sprayStatus, plan, offset]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelSprayMission();
    } catch {
      // The poller will keep reporting the true phase; nothing to surface here.
    } finally {
      setCancelling(false);
    }
  }

  const hasMission =
    sprayStatus?.running === true ||
    ["armed", "standby", "spraying"].includes(sprayStatus?.phase) ||
    planPathLatLngs(plan).length >= 2;

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1001] flex h-16 items-center justify-between gap-3 border-b border-emerald-950/10 bg-white/92 px-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <button
          type="button"
          onClick={() => navigate("/menu")}
          className="group flex h-10 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-3 text-[13px] font-extrabold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0"
          title="Kembali ke menu"
        >
          <span className="grid h-6 w-6 place-items-center rounded-xl bg-emerald-900 text-white transition-colors group-hover:bg-emerald-800">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
          <span>Menu</span>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-900 text-white shadow-[0_8px_18px_rgba(6,78,59,0.22)]">
            <Radar className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <div className="truncate text-[15px] font-black leading-tight text-gray-950">Monitoring Drone</div>
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Pemantauan Misi Realtime
            </div>
          </div>
        </div>
        <div className="w-[86px]" />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {!hasMission && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-house/90 px-4 py-1.5 text-[11px] font-bold text-slate-100 shadow-[0_10px_24px_rgba(2,6,23,0.35)] backdrop-blur">
            Belum ada misi penyemprotan aktif
          </div>
        )}

        {hasOffset(offset) && (
          <div className="pointer-events-none absolute left-4 top-4 z-[1000] flex items-center gap-1.5 rounded-full bg-sky-500/90 px-3 py-1.5 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(2,6,23,0.35)] backdrop-blur">
            <LocateFixed className="h-3.5 w-3.5" />
            Koreksi GPS {offsetMeters(offset, droneLat ?? DEFAULT_CENTER[0]).distance.toFixed(1)} m
          </div>
        )}

        <div className="pointer-events-none absolute right-4 top-4 bottom-4 z-[1000] flex items-start">
          <MonitoringPanel
            fieldName={plan?.fieldName}
            diagnostics={diagnosticsData}
            online={online}
            stale={stale}
            spray={sprayStatus}
            chambers={plan?.chambers ?? null}
            chamberProducts={plan?.chamberProducts ?? null}
            onCancel={handleCancel}
            cancelling={cancelling}
          />
        </div>
      </div>
    </div>
  );
}
