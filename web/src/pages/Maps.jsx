import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  ArrowLeft,
  MapPinned,
  Search,
  Loader2,
  MapPin,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Rocket,
  LocateFixed,
} from "lucide-react";
import { DroneFloatingButton } from "@/components/maps/drone/DroneFloatingButton";
import { DroneTelemetryBar } from "@/components/maps/drone/DroneTelemetryBar";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";
import { diagnosticsCoords, headingDeg, useDiagnostics } from "@/lib/gcs/diagnostics";
import {
  useDroneOffset,
  applyOffsetToCoords,
  applyOffsetToHeading,
  hasOffset,
  offsetMeters,
} from "@/lib/gcs/drone-offset";
import { LayerPanel } from "@/components/maps/layers/LayerPanel";
import { MapFloatingControls } from "@/components/maps/MapFloatingControls";
import { createLocationMarker } from "@/components/maps/locationPopup";
import { NdviHealthStats } from "@/components/maps/ndvi/NdviHealthStats";
import { NdviZonesPanel } from "@/components/maps/ndvi/NdviZonesPanel";
import { SprayTargetsPanel } from "@/components/maps/spray-targets/SprayTargetsPanel";
import { ManualZoneDrawPanel } from "@/components/maps/spray-targets/ManualZoneDrawPanel";
import { SprayingRoutePanel } from "@/components/maps/spraying-route/SprayingRoutePanel";
import { FlightSettingsWidget } from "@/components/maps/spraying-route/FlightSettingsWidget";
import { computeChamberGroups, defaultLaneSpacing } from "@/lib/gcs/chamber-groups";
import { defaultRateForChamber, chamberDisplayLabel, chamberSideLabel } from "@/lib/gcs/spray-overlay";
import { productById } from "@/lib/gcs/product-doses";
import { setFlightPlanInput } from "@/lib/gcs/flight-plan-input";
import { LoadMissionFileButton } from "@/components/gcs/LoadMissionFileButton";
import {
  BASE_BOUNDS,
  BASE_LAYERS,
  DEFAULT_NDVI_CATEGORIES,
  DEFAULT_NDVI_ZONE_SETTINGS,
} from "@/components/maps/mapConfig";

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

function droneMarkerIcon(rotationDeg) {
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="position:relative;width:44px;height:44px"><span style="position:absolute;left:50%;top:50%;width:40px;height:40px;margin-left:-20px;margin-top:-20px;border-radius:9999px;background:rgba(0,91,179,0.24);animation:ping 2.4s cubic-bezier(0,0,0.2,1) infinite"></span><span style="position:absolute;left:50%;top:50%;width:28px;height:28px;margin-left:-14px;margin-top:-14px;border-radius:9999px;background:rgba(0,91,179,0.20);animation:ping 2.4s cubic-bezier(0,0,0.2,1) infinite;animation-delay:1.2s"></span><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" style="position:absolute;left:50%;top:50%;margin-left:-13px;margin-top:-13px;filter:drop-shadow(0 4px 8px rgba(0,41,82,0.5));transform:rotate(${rotationDeg}deg)"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="#005bb3" stroke="white" stroke-width="1"/></svg></div>`,
  });
}

export function Maps() {
  const navigate = useNavigate();
  const { data: diagnosticsData } = useDiagnostics();
  const droneOffset = useDroneOffset(); // GPS-drift correction (see gps-offset.js)
  const mapDiv = useRef(null);
  const map = useRef(null);
  const baseLayers = useRef({});
  const currentBaseLayer = useRef(null);
  const imageryOverlays = useRef({});
  const ndviZonesLayer = useRef(null);
  const ndviZoneLayerIndex = useRef({});
  const sprayTargetsLayer = useRef(null);
  const sprayTargetLayerIndex = useRef({});
  const selectedSprayTargetLayer = useRef(null);
  // Mirror of the selected field's chamber→product map so the (imperative) spray-
  // target popup HTML builders can read the current per-chamber default dose
  // without being re-created when the loadout changes.
  const chamberProductsRef = useRef({});
  // Latest selectedFieldId, readable inside async callbacks whose closure captured
  // an older value (guards product-update completions against a field switch).
  const selectedFieldIdRef = useRef("");
  // Rebuilds the currently-open spray-target popup's dose rows (set while a popup
  // is open), so a side-panel loadout change refreshes its placeholders/hints.
  const openSprayPopupRefreshRef = useRef(null);
  const imageryCache = useRef({});
  const currentMarker = useRef(null);
  const fieldLocationMarker = useRef(null);
  const userLocationMarker = useRef(null);
  const userLocationCircle = useRef(null);
  const droneLocationMarker = useRef(null);
  const searchTimeout = useRef(null);
  const [baseLayer, setBaseLayerState] = useState("satellite");
  const [active, setActive] = useState(() => new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locating, setLocating] = useState(false);
  const [imageryLoading, setImageryLoading] = useState(false);
  const [imageryError, setImageryError] = useState("");
  const [ndviStats, setNdviStats] = useState(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [selectedImagery, setSelectedImagery] = useState(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [ndviZoneSettings, setNdviZoneSettings] = useState(
    DEFAULT_NDVI_ZONE_SETTINGS,
  );
  const [ndviZonesLoading, setNdviZonesLoading] = useState(false);
  const [approveZonesLoading, setApproveZonesLoading] = useState(false);
  // Dry-run result shown before re-approving zones that already carry HPT or manual
  // chamber settings (see /ndvi-zones/save-impact); null = nothing pending.
  const [approveImpact, setApproveImpact] = useState(null);
  const [ndviZonesError, setNdviZonesError] = useState("");
  const [ndviZonesSummary, setNdviZonesSummary] = useState(null);
  const [ndviZoneFeatures, setNdviZoneFeatures] = useState([]);
  const [sprayTargetsLoading, setSprayTargetsLoading] = useState(false);
  const [sprayTargetsError, setSprayTargetsError] = useState("");
  const [sprayTargetFeatures, setSprayTargetFeatures] = useState([]);
  const [activeAnalysisPanel, setActiveAnalysisPanel] = useState("ndvi-zones");
  // Manual spray zone being drawn or reshaped: {mode: "create" | "edit", polygonId?,
  // zoneCode?, points: [{lat, lng}], preview: {report, geojson, polygonId} | null,
  // previewing, saving, error}. null = not drawing. See app/zones.py for the rules.
  const [manualDraw, setManualDraw] = useState(null);
  const manualDrawRef = useRef(null);
  const manualDraftLayer = useRef(null);
  const manualPreviewLayer = useRef(null);
  const [routeAltitude, setRouteAltitude] = useState(5);
  const [routeLaneSpacing, setRouteLaneSpacing] = useState(() => defaultLaneSpacing(5));
  const [topRightTab, setTopRightTab] = useState("ndvi");
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [telemetryCollapsed, setTelemetryCollapsed] = useState(false);

  function ensureBaseLayer(id) {
    if (baseLayers.current[id]) return baseLayers.current[id];
    const meta = BASE_LAYERS[id];
    const tile = L.tileLayer(meta.url, {
      attribution: meta.attribution,
      maxNativeZoom: meta.maxNativeZoom,
      maxZoom: meta.maxZoom,
      updateWhenIdle: true,
      keepBuffer: 1,
    });
    baseLayers.current[id] = tile;
    return tile;
  }

  function setBaseLayer(id) {
    if (!map.current || id === currentBaseLayer.current) return;
    if (currentBaseLayer.current) {
      map.current.removeLayer(ensureBaseLayer(currentBaseLayer.current));
    }
    ensureBaseLayer(id).addTo(map.current);
    currentBaseLayer.current = id;
    setBaseLayerState(id);
  }

  async function fetchLatestImagery(fieldId = selectedFieldId) {
    if (!fieldId) throw new Error("Pilih lahan dulu");
    if (imageryCache.current[fieldId]) return imageryCache.current[fieldId];
    const imageryRes = await fetch(`/fields/${fieldId}/imagery/latest`);
    if (!imageryRes.ok) throw new Error("Belum ada data imagery");
    const data = await imageryRes.json();
    imageryCache.current[fieldId] = data;
    return data;
  }

  function cornersToLeafletBounds(imagery) {
    const corners = [
      imagery?.top_left,
      imagery?.top_right,
      imagery?.bottom_left,
      imagery?.bottom_right,
    ].filter(Boolean);
    if (corners.length < 2) return null;
    const lats = corners.map((point) => point.lat);
    const lngs = corners.map((point) => point.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }

  function imageryCenter(imagery) {
    const corners = [
      imagery?.top_left,
      imagery?.top_right,
      imagery?.bottom_left,
      imagery?.bottom_right,
    ].filter(Boolean);
    if (!corners.length) return null;
    return {
      lat:
        corners.reduce((sum, point) => sum + Number(point.lat), 0) /
        corners.length,
      lng:
        corners.reduce((sum, point) => sum + Number(point.lng), 0) /
        corners.length,
    };
  }

  function formatCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(5) : "-";
  }

  function formatPopupCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(6) : "-";
  }

  function formatCaptureTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(number);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDisplayLabel(value) {
    return String(value ?? "")
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  function clampNdviValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(-1, number));
  }

  function removeFieldLocationMarker() {
    const marker = fieldLocationMarker.current;
    if (marker && map.current?.hasLayer(marker))
      map.current.removeLayer(marker);
    fieldLocationMarker.current = null;
  }

  function removeImageryOverlay(id) {
    const overlay = imageryOverlays.current[id];
    if (overlay && map.current?.hasLayer(overlay))
      map.current.removeLayer(overlay);
    delete imageryOverlays.current[id];
  }

  function removeNdviZonesPreview() {
    const layer = ndviZonesLayer.current;
    if (layer && map.current?.hasLayer(layer)) map.current.removeLayer(layer);
    ndviZonesLayer.current = null;
    ndviZoneLayerIndex.current = {};
    setNdviZonesSummary(null);
    setNdviZoneFeatures([]);
    setNdviZonesError("");
  }

  function removeSprayTargetsLayer() {
    const layer = sprayTargetsLayer.current;
    if (layer && map.current?.hasLayer(layer)) map.current.removeLayer(layer);
    sprayTargetsLayer.current = null;
    sprayTargetLayerIndex.current = {};
    selectedSprayTargetLayer.current = null;
    setSprayTargetsError("");
  }

  function setSprayTargetHighlight(layer) {
    layer?.setStyle?.({
      color: "#ffffff",
      weight: 4,
      opacity: 1,
      fillColor: "#ffffff",
      fillOpacity: 0.28,
    });
    layer?.bringToFront?.();
  }

  function selectSprayTargetLayer(layer) {
    const previous = selectedSprayTargetLayer.current;
    if (previous && previous !== layer) {
      sprayTargetsLayer.current?.resetStyle?.(previous);
    }
    selectedSprayTargetLayer.current = layer;
    setSprayTargetHighlight(layer);
  }

  function clearSelectedSprayTargetLayer() {
    const selected = selectedSprayTargetLayer.current;
    if (selected) {
      sprayTargetsLayer.current?.resetStyle?.(selected);
      selected.closePopup?.();
    }
    selectedSprayTargetLayer.current = null;
  }

  // Manual (drawn) zones in amber, automatic NDVI zones in rose.
  function sprayTargetStyle(feature) {
    const manual = feature?.properties?.source === "manual";
    return {
      color: manual ? "#d97706" : "#e11d48",
      weight: 2.5,
      opacity: 1,
      fillColor: manual ? "#fbbf24" : "#fb7185",
      fillOpacity: manual ? 0.25 : 0.18,
      lineCap: "round",
      lineJoin: "round",
    };
  }

  function renderSprayTargetsGeoJson(geojson) {
    if (!map.current) return;
    removeSprayTargetsLayer();
    const featureCollection = geojson ?? {
      type: "FeatureCollection",
      features: [],
    };
    sprayTargetLayerIndex.current = {};
    const layer = L.geoJSON(
      featureCollection,
      {
        pane: "sprayTargetsPane",
        style: sprayTargetStyle,
        onEachFeature: (feature, polygonLayer) => {
          const props = feature.properties ?? {};
          const targetKey = props.id ?? props.zone_code;
          if (targetKey != null) {
            sprayTargetLayerIndex.current[String(targetKey)] = polygonLayer;
          }
          polygonLayer.on({
            click: (event) => {
              L.DomEvent.stopPropagation(event);
              if (manualDrawRef.current) {
                addManualPoint(event.latlng); // drawing over an existing zone
                return;
              }
              selectSprayTargetLayer(polygonLayer);
              openSprayTargetPopup(polygonLayer, event.latlng);
            },
            mouseover: (event) => {
              setSprayTargetHighlight(event.target);
            },
            mouseout: (event) => {
              if (selectedSprayTargetLayer.current !== event.target) {
                layer.resetStyle(event.target);
              }
            },
          });
        },
      },
    );
    sprayTargetsLayer.current = layer;
    layer.addTo(map.current);
    layer.bringToFront();
    setSprayTargetFeatures(
      Array.isArray(featureCollection.features) ? featureCollection.features : [],
    );
    // TEMP e2e test hook: open a spray-target popup by zone_code (avoids pixel-clicking).
    if (typeof window !== "undefined") {
      window.__openZone = (zc) => {
        for (const lyr of Object.values(sprayTargetLayerIndex.current)) {
          if (lyr?.feature?.properties?.zone_code === zc) { openSprayTargetPopup(lyr); return true; }
        }
        return false;
      };
    }
  }

  function addImageryOverlay(id, imagery, fit = false) {
    if (!map.current || !imagery) return;
    const bounds = cornersToLeafletBounds(imagery);
    if (!bounds) throw new Error("Koordinat imagery tidak tersedia");
    const urlKey = id === "rgb" ? "rgb_png_path" : "ndvi_png_path";
    const url = imagery[urlKey];
    if (!url) throw new Error("File imagery tidak tersedia");
    removeImageryOverlay(id);
    const overlay = L.imageOverlay(url, bounds, {
      opacity: 0.75,
      interactive: false,
    });
    imageryOverlays.current[id] = overlay;
    overlay.addTo(map.current);
    if (fit)
      map.current.fitBounds(bounds, {
        padding: [40, 40],
        animate: true,
        duration: 0.8,
      });
  }

  async function selectField(fieldId, options = {}) {
    if (!fieldId) return;
    removeFieldLocationMarker();
    removeNdviZonesPreview();
    removeSprayTargetsLayer();
    setSelectedFieldId(fieldId);
    setFieldPickerOpen(false);
    setImageryLoading(true);
    setImageryError("");
    try {
      const imagery = await fetchLatestImagery(fieldId);
      setSelectedImagery(imagery);
      setNdviStats(imagery.ndvi_stats ?? null);
      for (const layerId of ["rgb", "ndvi"]) {
        if (active.has(layerId))
          addImageryOverlay(layerId, imagery, options.fit ?? true);
      }
      if (active.has("spray-targets")) {
        loadSprayTargets(fieldId, imagery);
      } else if (active.has("spraying-route")) {
        loadSprayTargets(fieldId, imagery, { renderLayer: false });
      }
      if (options.fit) zoomToSelectedField(imagery);
    } catch (err) {
      setImageryError(err.message || "Gagal memuat imagery");
      setSelectedImagery(null);
      setNdviStats(null);
    } finally {
      setImageryLoading(false);
    }
  }

  function zoomToSelectedField(imagery = selectedImagery) {
    const bounds = cornersToLeafletBounds(imagery);
    if (!bounds || !map.current) return;
    map.current.fitBounds(bounds, {
      padding: [40, 40],
      animate: true,
      duration: 0.8,
    });
  }

  function showSelectedFieldMarker() {
    if (!map.current || !selectedImagery) return;
    const center = imageryCenter(selectedImagery);
    if (!center) return;

    removeFieldLocationMarker();
    zoomToSelectedField(selectedImagery);

    const marker = createLocationMarker({
      lat: center.lat,
      lng: center.lng,
      title: selectedField?.name ?? "Lahan",
      detectedAt: formatCaptureTime(selectedImagery.capture_at),
      address: `${formatCoordinate(center.lat)}, ${formatCoordinate(center.lng)}`,
      onClose: removeFieldLocationMarker,
    }).addTo(map.current);

    fieldLocationMarker.current = marker;
    marker.openPopup();
  }

  async function toggleImageryLayer(id) {
    if (!map.current) return;
    const existing = imageryOverlays.current[id];
    if (existing) {
      if (map.current.hasLayer(existing)) {
        map.current.removeLayer(existing);
        setActive((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        existing.addTo(map.current);
        setActive((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
      return;
    }

    setImageryLoading(true);
    setImageryError("");
    try {
      const imagery = await fetchLatestImagery();
      setSelectedImagery(imagery);
      addImageryOverlay(id, imagery, true);
      if (id === "ndvi") setNdviStats(imagery.ndvi_stats ?? null);
      setActive((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    } catch (err) {
      setImageryError(err.message || "Gagal memuat imagery");
    } finally {
      setImageryLoading(false);
    }
  }

  function toggleAnalysisLayer(id) {
    const isActive = active.has(id);
    if (id === "ndvi-zones" && active.has(id)) {
      removeNdviZonesPreview();
    }
    if (id === "spray-targets") {
      if (active.has(id)) {
        removeSprayTargetsLayer();
      } else {
        loadSprayTargets();
      }
    }
    if (id === "spraying-route" && !active.has(id)) {
      loadSprayTargets(undefined, undefined, { renderLayer: false });
    }
    if (!isActive) {
      setActiveAnalysisPanel(id);
    } else if (activeAnalysisPanel === id) {
      const fallback = ["ndvi-zones", "spray-targets", "spraying-route"].find(
        (layerId) => layerId !== id && active.has(layerId),
      );
      if (fallback) setActiveAnalysisPanel(fallback);
    }
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateNdviZoneSetting(key, value) {
    setNdviZoneSettings((prev) => {
      const number = Number(value);
      if (key === "ndvi_min") {
        return {
          ...prev,
          ndvi_min: Math.min(clampNdviValue(number), prev.ndvi_max),
        };
      }
      if (key === "ndvi_max") {
        return {
          ...prev,
          ndvi_max: Math.max(clampNdviValue(number), prev.ndvi_min),
        };
      }
      return {
        ...prev,
        [key]: Number.isFinite(number) ? Math.max(0, number) : prev[key],
      };
    });
  }

  function focusNdviZone(zoneId) {
    const zoneLayer = ndviZoneLayerIndex.current[String(zoneId)];
    if (!zoneLayer || !map.current) return;
    if (typeof zoneLayer.getBounds === "function") {
      map.current.fitBounds(zoneLayer.getBounds(), {
        padding: [56, 56],
        animate: true,
        duration: 0.6,
        maxZoom: 20,
      });
    }
    const center = zoneLayer.getBounds?.().getCenter?.();
    if (center) {
      openNdviZonePopupAtCenter(zoneLayer);
    }
    zoneLayer.setStyle?.({
      color: "#ecfeff",
      weight: 4,
      fillOpacity: 0.22,
      lineCap: "round",
      lineJoin: "round",
    });
    setTimeout(() => {
      ndviZonesLayer.current?.resetStyle?.(zoneLayer);
    }, 1400);
  }

  function focusSprayTarget(targetId) {
    const targetLayer = sprayTargetLayerIndex.current[String(targetId)];
    if (!targetLayer || !map.current) return;
    if (typeof targetLayer.getBounds === "function") {
      map.current.fitBounds(targetLayer.getBounds(), {
        padding: [56, 56],
        animate: true,
        duration: 0.6,
        maxZoom: 20,
      });
    }
    openSprayTargetPopup(targetLayer);
    selectSprayTargetLayer(targetLayer);
  }

  function deleteNdviZone(zoneId) {
    const key = String(zoneId);
    const zoneLayer = ndviZoneLayerIndex.current[key];
    if (zoneLayer) {
      zoneLayer.closePopup();
      ndviZonesLayer.current?.removeLayer(zoneLayer);
      delete ndviZoneLayerIndex.current[key];
    }
    setNdviZoneFeatures((prev) =>
      prev.filter((f) => String(f.properties?.id ?? "") !== key),
    );
  }

  function ndviZonePopupLoadingContent(props) {
    const zoneId =
      props?.id != null ? `Z${String(props.id).padStart(2, "0")}` : null;
    return `<div class="min-w-[320px] rounded-2xl bg-white px-5 pb-4 pt-4 font-sans">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#4B7C63] ring-1 ring-emerald-900/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
          </span>
          <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#4B7C63]">NDVI Zone</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          ${zoneId ? `<span class="rounded-full bg-emerald-900 px-3 py-1.5 text-[13px] font-black leading-none text-white shadow-[0_4px_10px_rgba(6,78,59,0.22)]">${zoneId}</span>` : ""}
          <button type="button" class="jp-zone-close flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-emerald-200/55 transition-colors hover:bg-slate-200 hover:text-slate-700" aria-label="Tutup popup">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="flex min-h-[80px] flex-col items-center justify-center gap-2">
        <div class="jp-location-spinner"></div>
        <span class="text-[12px] font-medium text-gray-500">Memuat lokasi...</span>
      </div>
      <div class="border-t border-gray-200 pt-3">
        <button type="button" class="jp-zone-delete flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2 text-[12px] font-bold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Hapus Zone
        </button>
      </div>
    </div>`;
  }

  function ndviZonePopupContent(center, address, props) {
    const zoneId =
      props?.id != null ? `Z${String(props.id).padStart(2, "0")}` : null;
    const areaM2 =
      props?.area_m2 != null ? `${formatNumber(props.area_m2)} m²` : null;
    const meanNdvi =
      props?.mean_ndvi != null ? formatNumber(props.mean_ndvi, 4) : null;
    const hasStats = areaM2 != null || meanNdvi != null;
    return `<div class="min-w-[320px] rounded-2xl bg-white px-5 pb-4 pt-4 font-sans">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#4B7C63] ring-1 ring-emerald-900/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
          </span>
          <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#4B7C63]">NDVI Zone</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          ${zoneId ? `<span class="rounded-full bg-emerald-900 px-3 py-1.5 text-[13px] font-black leading-none text-white shadow-[0_4px_10px_rgba(6,78,59,0.22)]">${zoneId}</span>` : ""}
          <button type="button" class="jp-zone-close flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-emerald-200/55 transition-colors hover:bg-slate-200 hover:text-slate-700" aria-label="Tutup popup">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      ${hasStats ? `<div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="mb-3 grid grid-cols-2 gap-4">
        ${areaM2 != null ? `<div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
            Area
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${areaM2}</p>
        </div>` : ""}
        ${meanNdvi != null ? `<div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Mean NDVI
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${meanNdvi}</p>
        </div>` : ""}
      </div>` : ""}
      <div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="mb-4">
        <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Lokasi
        </div>
        <p class="m-0 text-[12px] font-bold text-gray-900 leading-[1.4]" style="margin-top:3px">${address}</p>
      </div>
      <div class="mb-3 h-[1px] w-full bg-gray-200"></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <div class="flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-current">
              <div class="h-[1.5px] w-2 bg-current"></div>
            </div>
            LAT
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${formatPopupCoordinate(center?.lat)}</p>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
            <div class="flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-current">
              <div class="h-[1.5px] w-2 rotate-90 bg-current"></div>
            </div>
            LONG
          </div>
          <p class="m-0 text-[12px] font-extrabold leading-tight tabular-nums text-gray-900" style="margin-top:1px">${formatPopupCoordinate(center?.lng)}</p>
        </div>
      </div>
      <div class="border-t border-gray-200 pt-3">
        <button type="button" class="jp-zone-delete flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2 text-[12px] font-bold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Hapus Zone
        </button>
      </div>
    </div>`;
  }

  function attachNdviZonePopupClose(polygonLayer) {
    const popup = polygonLayer.getPopup();
    const element = popup?.getElement();
    const closeBtn = element?.querySelector(".jp-zone-close");
    if (closeBtn) {
      closeBtn.onclick = (event) => {
        event.stopPropagation();
        polygonLayer.closePopup();
      };
    }
    const deleteBtn = element?.querySelector(".jp-zone-delete");
    if (deleteBtn) {
      deleteBtn.onclick = (event) => {
        event.stopPropagation();
        const zoneId = polygonLayer.feature?.properties?.id;
        if (zoneId != null) deleteNdviZone(zoneId);
        polygonLayer.closePopup();
      };
    }
  }

  function loadNdviZonePopupAddress(polygonLayer, center, props) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))
      return;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`,
    )
      .then((res) => res.json())
      .then((data) => {
        const address =
          data?.display_name || "Tidak ada data lokasi di titik ini.";
        polygonLayer
          .getPopup()
          ?.setContent(ndviZonePopupContent(center, address, props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachNdviZonePopupClose(polygonLayer);
        });
      })
      .catch(() => {
        polygonLayer
          .getPopup()
          ?.setContent(
            ndviZonePopupContent(center, "Gagal memuat alamat.", props),
          );
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachNdviZonePopupClose(polygonLayer);
        });
      });
  }

  function openNdviZonePopupAtCenter(polygonLayer) {
    const center = polygonLayer.getBounds?.().getCenter?.();
    if (!center) return;
    const props = polygonLayer.feature?.properties ?? {};
    polygonLayer.bindPopup(ndviZonePopupLoadingContent(props), {
      closeButton: false,
      className: "jp-location-popup",
      minWidth: 320,
      maxWidth: 360,
    });
    polygonLayer.once("popupopen", () => attachNdviZonePopupClose(polygonLayer));
    polygonLayer.openPopup(center);
    loadNdviZonePopupAddress(polygonLayer, center, props);
  }

  const S = "font-family:system-ui,-apple-system,sans-serif";
  const DIV = "height:1px;background:#fce7f3;margin-bottom:14px";
  const LBL = "font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#e11d48";
  const VAL = "font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums";

  // Per-chamber dose (application rate, L/ha) input rows for the manual chamber
  // panel. Lists exactly the currently-selected racun; re-rendered live as the
  // user toggles chambers. An empty field means "use the chamber product's default
  // rate" — which is what the placeholder shows (falling back to 50 L/ha when no
  // product is loaded into that chamber).
  function doseRowsHtml(selectedChambers, doses) {
    const selected = Array.isArray(selectedChambers) ? selectedChambers : [];
    const rows = ["fungisida", "insektisida"].filter((chamber) => selected.includes(chamber));
    if (rows.length === 0) {
      return `<div style="font-size:10px;font-weight:700;color:#94a3b8;padding:2px 0">Pilih racun di atas untuk mengatur dosis.</div>`;
    }
    const products = chamberProductsRef.current || {};
    return rows
      .map((chamber) => {
        const value = Number(doses?.[chamber]);
        const valueAttr = Number.isFinite(value) && value > 0 ? String(value) : "";
        const label = escapeHtml(chamberDisplayLabel(chamber, products));
        const product = productById(products[chamber]);
        const defaultRate = defaultRateForChamber(products[chamber]);
        const productHint = product
          ? `<div style="font-size:9px;font-weight:800;color:#94a3b8;margin-top:2px">${escapeHtml(chamberSideLabel(chamber))} · ${escapeHtml(product.activeIngredient)} · default ${defaultRate} L/ha</div>`
          : `<div style="font-size:9px;font-weight:800;color:#cbd5e1;margin-top:2px">Belum ada produk · default ${defaultRate} L/ha</div>`;
        return `<div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:850;color:#0f172a">${label}</div>
            ${productHint}
          </div>
          <div style="position:relative;width:118px;flex:0 0 118px">
            <input type="number" min="0" step="1" inputmode="decimal" class="jp-dose-input" data-chamber="${chamber}" value="${valueAttr}" placeholder="${defaultRate}" aria-label="Dosis ${label} (L/ha)" style="width:100%;height:34px;border:1.5px solid #e2e8f0;border-radius:10px;padding:0 42px 0 11px;font-size:12px;font-weight:800;color:#0f172a;box-sizing:border-box;background:#fff" />
            <span style="position:absolute;right:11px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:800;color:#94a3b8;pointer-events:none">L/ha</span>
          </div>
        </div>`;
      })
      .join("");
  }

  function sprayTargetPopupHeader(zoneCode) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:32px;height:32px;border-radius:10px;background:#fff1f2;display:grid;place-items:center;color:#be123c;box-shadow:inset 0 0 0 1px rgba(190,18,60,.12);flex-shrink:0">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/><path d="m5 7-3 5 3 5"/><path d="m19 7 3 5-3 5"/></svg>
        </span>
        <span style="font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#be123c">Spray Target</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="background:#e11d48;color:#fff;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:900;line-height:1">${zoneCode}</span>
        <button type="button" class="jp-spray-target-close" style="width:32px;height:32px;border-radius:50%;background:#fff1f2;border:none;display:grid;place-items:center;color:#be123c;cursor:pointer;flex-shrink:0" aria-label="Tutup popup">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`;
  }

  function sprayTargetPopupLoadingContent(props) {
    const zoneCode = escapeHtml(props?.zone_code ?? "Target");
    return `<div style="min-width:300px;padding:20px 20px 16px;${S}">
      ${sprayTargetPopupHeader(zoneCode)}
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:80px">
        <div class="jp-location-spinner"></div>
        <span style="font-size:12px;font-weight:500;color:#94a3b8">Memuat lokasi...</span>
      </div>
    </div>`;
  }

  function sprayTargetPopupContent(center, address, props = {}) {
    const zoneCode = escapeHtml(props?.zone_code ?? "Target");
    const selectedChambers = Array.isArray(props?.selected_chambers)
      ? props.selected_chambers
      : [];
    const rawChamberMode = props?.chamber_mode ?? "none";
    const chamberMode = escapeHtml(rawChamberMode);
    const chamberDoses =
      props?.chamber_doses && typeof props.chamber_doses === "object" ? props.chamber_doses : {};
    const detections = Array.isArray(props?.detections) ? props.detections : [];
    const selectedChamberLabel = selectedChambers
      .map((item) => chamberDisplayLabel(item, chamberProductsRef.current))
      .filter(Boolean)
      .join(", ");
    const autoStatus = detections.length === 0
      ? "Menunggu hasil deteksi"
      : selectedChamberLabel
        ? `Rekomendasi: ${selectedChamberLabel}`
        : "Belum ada chamber dari deteksi";
    const areaM2 = props?.area_m2 != null ? `${formatNumber(props.area_m2)} m²` : "-";
    const meanNdvi = props?.mean_ndvi != null ? formatNumber(props.mean_ndvi, 4) : "-";
    const manualActions = props?.source === "manual"
      ? `<div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="${LBL};margin-bottom:8px">Zona Manual</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button type="button" class="jp-manual-edit" style="height:36px;border-radius:11px;border:1.5px solid #fcd34d;background:#fffbeb;color:#b45309;font-size:11px;font-weight:850;cursor:pointer">Ubah bentuk</button>
          <button type="button" class="jp-manual-delete" style="height:36px;border-radius:11px;border:1.5px solid #fecaca;background:#fff;color:#dc2626;font-size:11px;font-weight:850;cursor:pointer">Hapus zona</button>
        </div>
        <div class="jp-manual-delete-info" style="display:none;margin-top:8px;font-size:11px;font-weight:700;color:#92400e;line-height:1.4"></div>
      </div>`
      : "";

    const chamberOpts = ["fungisida", "insektisida"]
      .map((opt) => {
        const active = selectedChambers.includes(opt);
        return `<button type="button" class="jp-chamber-opt" data-value="${opt}" style="height:38px;border-radius:11px;border:1.5px solid ${active ? "#fb7185" : "#e2e8f0"};padding:0 10px;font-size:11px;font-weight:850;color:${active ? "#be123c" : "#334155"};cursor:pointer;background:${active ? "#fff1f2" : "#fff"};box-shadow:${active ? "inset 0 0 0 1px rgba(244,63,94,.08)" : "none"}">${escapeHtml(chamberDisplayLabel(opt, chamberProductsRef.current))}</button>`;
      })
      .join("");

    const navBtns = detections.length > 1
      ? `<div style="display:flex;gap:5px">
          <button class="jp-det-prev" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #fecaca;background:#fff1f2;color:#e11d48;display:grid;place-items:center;cursor:pointer;opacity:.35" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button class="jp-det-next" style="width:26px;height:26px;border-radius:50%;border:1.5px solid #fecaca;background:#fff1f2;color:#e11d48;display:grid;place-items:center;cursor:pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>`
      : "";

    let detBody;
    if (detections.length === 0) {
      detBody = `<div style="border:1.5px dashed #fecaca;border-radius:12px;padding:14px;text-align:center;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:#fca5a5">Belum ada deteksi HPT</div>
      </div>`;
    } else {
      const cards = detections.map((d) => {
        const name = escapeHtml(formatDisplayLabel(d.disease_name) || "-");
        const cat = escapeHtml(chamberDisplayLabel(d.chamber, chamberProductsRef.current) || "-");
        const conf = d.confidence != null ? Math.round(d.confidence * 100) : null;
        const confBar = conf != null
          ? `<div style="display:flex;align-items:center;gap:6px;margin-top:7px">
               <div style="flex:1;height:4px;background:#fecaca;border-radius:999px;overflow:hidden">
                 <div style="width:${conf}%;height:100%;background:#e11d48;border-radius:999px"></div>
               </div>
               <span style="font-size:10px;font-weight:800;color:#be123c">${conf}%</span>
             </div>`
          : "";
        const img = d.image_path
          ? `<div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:#fff1f2;flex:0 0 52px"><img src="${escapeHtml(d.image_path)}" style="display:block;width:52px;height:52px;max-width:52px;max-height:52px;object-fit:cover" /></div>`
          : `<div style="width:52px;height:52px;border-radius:8px;background:#fff1f2;border:1.5px solid #fecaca;flex:0 0 52px;box-sizing:border-box"></div>`;
        return `<div class="jp-det-card" style="scroll-snap-align:start;flex:0 0 100%;display:flex;gap:10px;align-items:center;padding:10px 12px;min-height:72px;box-sizing:border-box">
          ${img}
          <div style="flex:1;min-width:0;overflow:hidden">
            <div style="font-size:12px;font-weight:800;color:#0f172a">${name}</div>
            <div style="font-size:10px;font-weight:600;color:#be123c;margin-top:1px">${cat}</div>
            ${confBar}
          </div>
        </div>`;
      }).join("");

      const dots = detections
        .map((_, i) => `<div class="jp-det-dot" style="height:4px;width:${i === 0 ? "14" : "4"}px;border-radius:999px;background:${i === 0 ? "#e11d48" : "#fecaca"};transition:width .2s,background .2s"></div>`)
        .join("");

      detBody = `<div style="background:#fff1f2;border-radius:12px;overflow:hidden;margin-bottom:12px">
        <div class="jp-det-slider" style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;max-height:76px">
          ${cards}
        </div>
        ${detections.length > 1 ? `<div class="jp-det-dots" style="display:flex;gap:4px;justify-content:center;padding:6px 0 10px">${dots}</div>` : ""}
      </div>`;
    }

    const ctaLabel = detections.length === 0 ? "Deteksi HPT" : "Tambah Deteksi";
    const ctaStyle = detections.length === 0
      ? "background:#e11d48;border:none;color:#fff;box-shadow:0 4px 14px rgba(225,29,72,.35)"
      : "background:#fff;border:1.5px solid #fecaca;color:#be123c";

    return `<div style="min-width:300px;padding:20px 20px 16px;${S}">
      ${sprayTargetPopupHeader(zoneCode)}
      <div style="${DIV}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px">
        <div><div style="${LBL}">Area</div><div style="${VAL}">${areaM2}</div></div>
        <div><div style="${LBL}">Mean NDVI</div><div style="${VAL}">${meanNdvi}</div></div>
      </div>
      ${manualActions}
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="${LBL}">Chamber</div>
          <span class="jp-chamber-mode" style="background:#f8fafc;color:#64748b;border-radius:999px;padding:2px 8px;font-size:9px;font-weight:800;text-transform:uppercase">${chamberMode}</span>
        </div>
        <div class="jp-mode-dd" style="position:relative">
          <button type="button" class="jp-mode-trigger" style="width:100%;height:38px;border:1.5px solid #e2e8f0;border-radius:11px;background:#fff;padding:0 36px 0 12px;font-size:12px;font-weight:850;color:#0f172a;cursor:pointer;text-align:left;box-sizing:border-box;position:relative">
            <span class="jp-mode-label">${rawChamberMode === "manual" ? "Manual" : "Otomatis dari Deteksi"}</span>
            <svg class="jp-mode-arrow" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);transition:transform .18s"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="jp-mode-menu" style="display:none;position:absolute;left:0;right:0;top:40px;z-index:120;background:#fff;border:1.5px solid #e11d48;border-radius:11px;overflow:hidden;box-shadow:0 12px 26px rgba(225,29,72,.14)">
            <button type="button" class="jp-mode-opt" data-mode="auto" style="width:100%;border:none;background:${rawChamberMode === "manual" ? "#fff" : "#fff1f2"};color:${rawChamberMode === "manual" ? "#334155" : "#be123c"};padding:10px 12px;text-align:left;font-size:12px;font-weight:850;cursor:pointer">Otomatis dari Deteksi</button>
            <button type="button" class="jp-mode-opt" data-mode="manual" style="width:100%;border:none;background:${rawChamberMode === "manual" ? "#fff1f2" : "#fff"};color:${rawChamberMode === "manual" ? "#be123c" : "#334155"};padding:10px 12px;text-align:left;font-size:12px;font-weight:850;cursor:pointer">Manual</button>
          </div>
        </div>
        <div class="jp-chamber-auto-panel" style="display:${rawChamberMode === "manual" ? "none" : "block"};margin-top:9px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 12px">
          <div style="font-size:11px;font-weight:850;color:#0f172a">${escapeHtml(autoStatus)}</div>
          <div style="margin-top:3px;font-size:10px;font-weight:700;color:#94a3b8">${detections.length} hasil deteksi</div>
        </div>
        <div class="jp-chamber-manual-panel" style="display:${rawChamberMode === "manual" ? "block" : "none"};margin-top:9px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${chamberOpts}</div>
          <div style="margin-top:12px">
            <div style="${LBL};margin-bottom:8px">Dosis Racun</div>
            <div class="jp-dose-rows" style="display:flex;flex-direction:column;gap:9px">${doseRowsHtml(selectedChambers, chamberDoses)}</div>
          </div>
        </div>
      </div>
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="${LBL}">Deteksi HPT</div>
            <span style="background:#fff1f2;color:#be123c;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800">${detections.length}</span>
          </div>
          ${navBtns}
        </div>
        ${detBody}
        <div style="display:flex;justify-content:center">
          <button class="jp-detect-btn" style="${ctaStyle};border-radius:999px;padding:9px 18px;display:inline-flex;align-items:center;gap:7px;cursor:pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span style="font-size:12px;font-weight:800">${ctaLabel}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>
      </div>
      <div style="${DIV}"></div>
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:5px;${LBL};margin-bottom:5px">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Lokasi
        </div>
        <div style="font-size:12px;font-weight:700;color:#0f172a;line-height:1.4;overflow-wrap:break-word">${escapeHtml(address)}</div>
      </div>
      <div style="${DIV}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><div style="${LBL}">Lat</div><div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums">${formatPopupCoordinate(center?.lat)}</div></div>
        <div><div style="${LBL}">Long</div><div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums">${formatPopupCoordinate(center?.lng)}</div></div>
      </div>
    </div>`;
  }

  function attachSprayTargetPopupInteractions(polygonLayer, props) {
    const popup = polygonLayer.getPopup();
    const el = popup?.getElement();
    if (!el) return;

    el.querySelector(".jp-spray-target-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      polygonLayer.closePopup();
    });

    // Manual zones: reshape, or delete in two taps (the first shows what comes back).
    el.querySelector(".jp-manual-edit")?.addEventListener("click", (e) => {
      e.stopPropagation();
      polygonLayer.closePopup();
      startManualDraw(polygonLayer.feature);
    });
    const deleteBtn = el.querySelector(".jp-manual-delete");
    const deleteInfo = el.querySelector(".jp-manual-delete-info");
    let deleteArmed = false;
    deleteBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      deleteBtn.disabled = true;
      try {
        const data = await deleteManualZoneRequest(props.id, !deleteArmed);
        if (!deleteArmed) {
          deleteInfo.textContent = manualDeleteImpactText(data.report);
          deleteInfo.style.display = "block";
          deleteBtn.textContent = "Yakin hapus?";
          deleteBtn.style.background = "#dc2626";
          deleteBtn.style.color = "#fff";
          deleteArmed = true;
        } else {
          polygonLayer.closePopup();
          renderSprayTargetsGeoJson(data.geojson);
        }
      } catch (err) {
        deleteInfo.textContent = err.message || "Gagal menghapus zona";
        deleteInfo.style.color = "#dc2626";
        deleteInfo.style.display = "block";
      } finally {
        deleteBtn.disabled = false;
      }
    });

    const modeLabel = el.querySelector(".jp-chamber-mode");
    const autoPanel = el.querySelector(".jp-chamber-auto-panel");
    const manualPanel = el.querySelector(".jp-chamber-manual-panel");
    const doseRows = el.querySelector(".jp-dose-rows");
    // Baseline of doses that are safely persisted, for the popupclose safety-net.
    let lastDoseSnapshot = JSON.stringify(props?.chamber_doses ?? {});

    function renderDoseRows() {
      if (!doseRows) return;
      // Don't rebuild while the user is typing in a dose field — replacing the
      // innerHTML would drop focus/caret. The input listener keeps props in sync,
      // so the live DOM is authoritative for the focused row.
      const active = document.activeElement;
      if (active?.classList?.contains("jp-dose-input") && doseRows.contains(active)) return;
      const selected = Array.isArray(props?.selected_chambers) ? props.selected_chambers : [];
      const doses =
        props?.chamber_doses && typeof props.chamber_doses === "object" ? props.chamber_doses : {};
      doseRows.innerHTML = doseRowsHtml(selected, doses);
    }

    // Expose a refresh handle so a side-panel loadout change (updateChamberProduct)
    // can re-render this open popup's dose placeholders/hints; cleared on close.
    if (doseRows) {
      openSprayPopupRefreshRef.current = renderDoseRows;
      polygonLayer.once("popupclose", () => {
        if (openSprayPopupRefreshRef.current === renderDoseRows) {
          openSprayPopupRefreshRef.current = null;
        }
      });
    }

    function paintMode(mode) {
      if (modeLabel) modeLabel.textContent = mode;
      if (autoPanel) autoPanel.style.display = mode === "manual" ? "none" : "block";
      if (manualPanel) manualPanel.style.display = mode === "manual" ? "block" : "none";
      const modeLabelText = mode === "manual" ? "Manual" : "Otomatis dari Deteksi";
      const modeValueLabel = el.querySelector(".jp-mode-label");
      if (modeValueLabel) modeValueLabel.textContent = modeLabelText;
      el.querySelectorAll(".jp-mode-opt").forEach((button) => {
        const active = button.dataset.mode === (mode === "manual" ? "manual" : "auto");
        button.style.background = active ? "#fff1f2" : "#fff";
        button.style.color = active ? "#be123c" : "#334155";
      });
    }

    function setPopupChamberState(next, mode = "manual", doses) {
      props.selected_chambers = next;
      props.chamber_mode = mode;
      if (doses && typeof doses === "object") {
        const merged = { ...doses };
        // A server echo can predate a value the user is still typing (a chamber
        // toggle's PATCH was sent before this keystroke); keep the in-progress
        // local value for the focused chamber so it isn't clobbered.
        const active = document.activeElement;
        if (active?.classList?.contains("jp-dose-input") && doseRows?.contains(active)) {
          const chamber = active.dataset.chamber;
          const localVal = props?.chamber_doses?.[chamber];
          if (chamber && next.includes(chamber) && localVal != null) merged[chamber] = localVal;
        }
        props.chamber_doses = merged;
      } else {
        // No explicit doses given (local toggle): keep only those whose chamber
        // is still selected so a deselected racun drops its dose.
        const existing =
          props?.chamber_doses && typeof props.chamber_doses === "object" ? props.chamber_doses : {};
        const kept = {};
        for (const chamber of next) {
          if (existing[chamber] != null) kept[chamber] = existing[chamber];
        }
        props.chamber_doses = kept;
      }
      paintMode(mode);
      el.querySelectorAll(".jp-chamber-opt").forEach((button) => {
        const active = next.includes(button.dataset.value);
        button.style.borderColor = active ? "#fb7185" : "#e2e8f0";
        button.style.background = active ? "#fff1f2" : "#fff";
        button.style.color = active ? "#be123c" : "#334155";
      });
      renderDoseRows();
    }

    const modeTrigger = el.querySelector(".jp-mode-trigger");
    const modeMenu = el.querySelector(".jp-mode-menu");
    const modeArrow = el.querySelector(".jp-mode-arrow");
    modeTrigger?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!modeMenu) return;
      const open = modeMenu.style.display !== "none";
      modeMenu.style.display = open ? "none" : "block";
      if (modeArrow) modeArrow.style.transform = open ? "translateY(-50%)" : "translateY(-50%) rotate(180deg)";
    });

    el.querySelectorAll(".jp-mode-opt").forEach((option) => {
      option.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (modeMenu) modeMenu.style.display = "none";
        if (modeArrow) modeArrow.style.transform = "translateY(-50%)";
        const mode = option.dataset.mode;
        if (mode === "manual") {
          const current = Array.isArray(props?.selected_chambers) ? props.selected_chambers : [];
          setPopupChamberState(current, "manual");
          if (props?.id && current.length) {
            const updated = await updateSprayTargetChambers(props.id, { mode: "manual", selected_chambers: current, chamber_doses: props.chamber_doses || {} });
            if (updated) setPopupChamberState(updated.selected_chambers || [], updated.chamber_mode || "manual", updated.chamber_doses);
          }
          return;
        }
        if (!props?.id) return;
        setPopupChamberState(Array.isArray(props?.selected_chambers) ? props.selected_chambers : [], "auto");
        const updated = await updateSprayTargetChambers(props.id, { mode: "auto" });
        if (updated) setPopupChamberState(updated.selected_chambers || [], updated.chamber_mode || "auto", updated.chamber_doses);
      });
    });

    el.querySelectorAll(".jp-chamber-opt").forEach((opt) => {
      opt.addEventListener("click", async (event) => {
        event.stopPropagation();
        const value = opt.dataset.value;
        let next = Array.isArray(props?.selected_chambers)
          ? [...props.selected_chambers]
          : [];
        next = next.includes(value)
          ? next.filter((item) => item !== value)
          : [...next, value];
        setPopupChamberState(next, next.length ? "manual" : "none");
        if (props?.id) {
          const updated = await updateSprayTargetChambers(props.id, next.length === 0
            ? { mode: "none" }
            : { mode: "manual", selected_chambers: next, chamber_doses: props.chamber_doses || {} });
          if (updated) setPopupChamberState(updated.selected_chambers || [], updated.chamber_mode || "none", updated.chamber_doses);
        }
      });
    });

    // Dose (L/ha) fields — one per selected racun. Listeners are delegated on the
    // container so they survive renderDoseRows() rebuilding its innerHTML. `input`
    // keeps props fresh for an in-memory hand-off; `change` (blur/Enter) persists.
    function applyDoseInput(target) {
      const chamber = target?.dataset?.chamber;
      if (!chamber) return;
      const raw = target.value;
      const num = Number(raw);
      const doses =
        props?.chamber_doses && typeof props.chamber_doses === "object"
          ? { ...props.chamber_doses }
          : {};
      if (raw === "" || !Number.isFinite(num) || num <= 0) {
        delete doses[chamber];
      } else {
        doses[chamber] = num;
      }
      props.chamber_doses = doses;
    }

    doseRows?.addEventListener("input", (event) => {
      const target = event.target;
      if (!target?.classList?.contains("jp-dose-input")) return;
      applyDoseInput(target);
    });

    doseRows?.addEventListener("change", async (event) => {
      const target = event.target;
      if (!target?.classList?.contains("jp-dose-input")) return;
      applyDoseInput(target);
      const selected = Array.isArray(props?.selected_chambers) ? props.selected_chambers : [];
      if (!props?.id || selected.length === 0) return;
      const updated = await updateSprayTargetChambers(props.id, {
        mode: "manual",
        selected_chambers: selected,
        chamber_doses: props.chamber_doses || {},
      });
      // Sync props to the server-normalised doses, but don't re-render the rows —
      // the user may still be editing an adjacent field.
      if (updated?.chamber_doses && typeof updated.chamber_doses === "object") {
        props.chamber_doses = updated.chamber_doses;
      }
      if (updated) lastDoseSnapshot = JSON.stringify(props?.chamber_doses ?? {});
    });

    // Safety net: a dose typed but never committed via `change` (e.g. the popup
    // dismissed with Escape, which fires no change on a number input) would be
    // lost on reload. Flush it on close if it differs from what was persisted.
    // Gated on doseRows so it registers once (this attach runs again for the
    // loading-spinner content, which has no dose rows).
    if (doseRows) {
      polygonLayer.once("popupclose", () => {
        if (props?.chamber_mode !== "manual" || !props?.id) return;
        const selected = Array.isArray(props?.selected_chambers) ? props.selected_chambers : [];
        if (selected.length === 0) return;
        if (JSON.stringify(props?.chamber_doses ?? {}) === lastDoseSnapshot) return;
        updateSprayTargetChambers(props.id, {
          mode: "manual",
          selected_chambers: selected,
          chamber_doses: props.chamber_doses || {},
        });
      });
    }

    const slider = el.querySelector(".jp-det-slider");
    if (slider) {
      const cards = slider.querySelectorAll(".jp-det-card");
      const total = cards.length;
      const dotsEl = el.querySelector(".jp-det-dots");
      const prevBtn = el.querySelector(".jp-det-prev");
      const nextBtn = el.querySelector(".jp-det-next");

      function syncNav() {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        dotsEl?.querySelectorAll(".jp-det-dot").forEach((d, idx) => {
          d.style.width = idx === i ? "14px" : "4px";
          d.style.background = idx === i ? "#e11d48" : "#fecaca";
        });
        if (prevBtn) prevBtn.style.opacity = i === 0 ? ".35" : "1";
        if (nextBtn) nextBtn.style.opacity = i === total - 1 ? ".35" : "1";
      }

      slider.addEventListener("scroll", syncNav, { passive: true });
      prevBtn?.addEventListener("click", () => {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        slider.scrollTo({ left: Math.max(0, i - 1) * slider.offsetWidth, behavior: "smooth" });
      });
      nextBtn?.addEventListener("click", () => {
        const i = Math.round(slider.scrollLeft / slider.offsetWidth);
        slider.scrollTo({ left: Math.min(total - 1, i + 1) * slider.offsetWidth, behavior: "smooth" });
      });
    }

    el.querySelector(".jp-detect-btn")?.addEventListener("click", () => {
      const pid = encodeURIComponent(props?.id ?? "");
      const zc = encodeURIComponent(props?.zone_code ?? "");
      navigate(`/detection?polygon_id=${pid}&zone_code=${zc}`);
      polygonLayer.closePopup();
    });
  }

  function loadSprayTargetPopupAddress(polygonLayer, center, props) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))
      return;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`,
    )
      .then((res) => res.json())
      .then((data) => {
        const address = data?.display_name || "Tidak ada data lokasi di titik ini.";
        polygonLayer.getPopup()?.setContent(sprayTargetPopupContent(center, address, props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachSprayTargetPopupInteractions(polygonLayer, props);
        });
      })
      .catch(() => {
        polygonLayer.getPopup()?.setContent(sprayTargetPopupContent(center, "Gagal memuat alamat.", props));
        requestAnimationFrame(() => {
          polygonLayer.getPopup()?.update();
          attachSprayTargetPopupInteractions(polygonLayer, props);
        });
      });
  }

  function openSprayTargetPopup(polygonLayer, point = null) {
    const popupPoint = point ?? polygonLayer.getBounds?.().getCenter?.();
    if (!popupPoint) return;
    const props = polygonLayer.feature?.properties ?? {};
    polygonLayer.bindPopup(sprayTargetPopupLoadingContent(props), {
      closeButton: false,
      className: "jp-location-popup",
      minWidth: 320,
      maxWidth: 360,
    });
    polygonLayer.once("popupopen", () => attachSprayTargetPopupInteractions(polygonLayer, props));
    polygonLayer.openPopup(popupPoint);
    loadSprayTargetPopupAddress(polygonLayer, popupPoint, props);
  }

  async function generateNdviZones() {
    if (!map.current) return;
    setNdviZonesLoading(true);
    setNdviZonesError("");
    setApproveImpact(null); // a new preview invalidates any pending confirmation
    try {
      const imagery = selectedImagery ?? (await fetchLatestImagery());
      setSelectedImagery(imagery);
      if (!active.has("ndvi-zones")) {
        setActive((prev) => {
          const next = new Set(prev);
          next.add("ndvi-zones");
          return next;
        });
      }

      const res = await fetch(`/imagery/${imagery.id}/ndvi-zones/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ndviZoneSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal generate NDVI Zones");

      removeNdviZonesPreview();
      const geojson = data.geojson ?? {
        type: "FeatureCollection",
        features: [],
      };
      ndviZoneLayerIndex.current = {};
      const layer = L.geoJSON(geojson, {
        pane: "ndviZonesPane",
        style: {
          color: "#06b6d4",
          weight: 2.5,
          opacity: 1,
          fillColor: "#22d3ee",
          fillOpacity: 0.12,
          lineCap: "round",
          lineJoin: "round",
        },
        onEachFeature: (feature, polygonLayer) => {
          const props = feature.properties ?? {};
          if (props.id != null) {
            ndviZoneLayerIndex.current[String(props.id)] = polygonLayer;
          }
          polygonLayer.on({
            click: (event) => {
              L.DomEvent.stopPropagation(event);
              if (manualDrawRef.current) {
                addManualPoint(event.latlng);
                return;
              }
              openNdviZonePopupAtCenter(polygonLayer);
            },
            mouseover: (event) => {
              event.target.setStyle({
                color: "#ecfeff",
                weight: 3.5,
                fillOpacity: 0.2,
                lineCap: "round",
                lineJoin: "round",
              });
            },
            mouseout: (event) => {
              layer.resetStyle(event.target);
            },
          });
        },
      });
      ndviZonesLayer.current = layer;
      layer.addTo(map.current);
      layer.bringToFront();
      setNdviZonesSummary(data.summary ?? null);
      setNdviZoneFeatures(
        Array.isArray(geojson.features) ? geojson.features : [],
      );
    } catch (err) {
      setNdviZonesError(err.message || "Gagal generate NDVI Zones");
    } finally {
      setNdviZonesLoading(false);
    }
  }

  async function loadSprayTargets(
    fieldId = selectedFieldId,
    imagery = selectedImagery,
    options = {},
  ) {
    if (!fieldId || !imagery) return;
    setSprayTargetsLoading(true);
    setSprayTargetsError("");
    try {
      const params = new URLSearchParams({ imagery_id: imagery.id });
      const res = await fetch(
        `/fields/${fieldId}/spray-targets?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal memuat spray targets");
      if (options.renderLayer === false) {
        const features = Array.isArray(data.geojson?.features)
          ? data.geojson.features
          : [];
        setSprayTargetFeatures(features);
      } else {
        renderSprayTargetsGeoJson(data.geojson);
      }
    } catch (err) {
      setSprayTargetsError(err.message || "Gagal memuat spray targets");
    } finally {
      setSprayTargetsLoading(false);
    }
  }

  function addManualPoint(latlng) {
    setManualDraw((d) =>
      d
        ? { ...d, points: [...d.points, { lat: latlng.lat, lng: latlng.lng }], preview: null, previewing: false, error: "" }
        : d,
    );
  }

  function undoManualPoint() {
    setManualDraw((d) => d && { ...d, points: d.points.slice(0, -1), preview: null, previewing: false, error: "" });
  }

  function manualRingGeometry(points) {
    const coords = points.map((point) => [point.lng, point.lat]);
    return { type: "Polygon", coordinates: [[...coords, coords[0]]] };
  }

  // Start drawing a new manual zone, or reshape an existing one (feature given).
  function startManualDraw(feature = null) {
    if (!selectedImagery) return;
    map.current?.closePopup();
    clearSelectedSprayTargetLayer();
    setActiveAnalysisPanel("spray-targets");
    const base = { preview: null, previewing: false, saving: false, error: "" };
    if (feature) {
      const ring = feature.geometry?.coordinates?.[0] ?? [];
      setManualDraw({
        ...base,
        mode: "edit",
        polygonId: feature.properties?.id,
        zoneCode: feature.properties?.zone_code,
        points: ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng })),
      });
    } else {
      setManualDraw({ ...base, mode: "create", points: [] });
    }
  }

  function manualZoneRequest(draw, dryRun) {
    const qs = dryRun ? "?dry_run=true" : "";
    const init = {
      method: draw.mode === "edit" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: manualRingGeometry(draw.points) }),
    };
    return draw.mode === "edit"
      ? fetch(`/polygons/${draw.polygonId}/geometry${qs}`, init)
      : fetch(`/imagery/${selectedImagery.id}/manual-zones${qs}`, init);
  }

  async function saveManualZone() {
    const draw = manualDrawRef.current;
    if (!draw || draw.points.length < 3) return;
    setManualDraw((d) => d && { ...d, saving: true, error: "" });
    try {
      const res = await manualZoneRequest(draw, false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Gagal menyimpan zona manual");
      setManualDraw(null);
      renderSprayTargetsGeoJson(data.geojson);
      const id = data.polygon?.id ?? draw.polygonId;
      if (id) setTimeout(() => focusSprayTarget(id), 50);
    } catch (err) {
      setManualDraw((d) => d && { ...d, saving: false, error: err.message });
    }
  }

  async function deleteManualZoneRequest(polygonId, dryRun) {
    const res = await fetch(`/polygons/${polygonId}${dryRun ? "?dry_run=true" : ""}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || "Gagal menghapus zona");
    return data;
  }

  function manualDeleteImpactText(report) {
    const parts = [];
    const back = [...(report?.restored ?? []), ...(report?.clipped ?? [])].map((r) => r.origin);
    if (back.length) parts.push(`Area dikembalikan ke ${back.join(", ")}.`);
    if (report?.hpt_moved) parts.push(`${report.hpt_moved} HPT dipindah ke zona otomatis di bawahnya.`);
    if (report?.hpt_unzoned) parts.push(`${report.hpt_unzoned} HPT dilepas dari zona (tetap tersimpan).`);
    return parts.length ? parts.join(" ") : "Tidak ada zona otomatis yang terdampak.";
  }

  async function updateSprayTargetChambers(targetId, payload) {
    if (!targetId) return null;
    setSprayTargetsError("");
    try {
      const res = await fetch(`/polygons/${targetId}/chambers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.detail || "Gagal update chamber");
      const patch = {
        selected_chambers: data.selected_chambers || [],
        chamber_mode: data.chamber_mode || "none",
        chamber_doses: data.chamber_doses || {},
      };
      const targetLayer = sprayTargetLayerIndex.current[String(targetId)];
      if (targetLayer?.feature?.properties) {
        Object.assign(targetLayer.feature.properties, patch);
      }
      setSprayTargetFeatures((features) => features.map((feature) => {
        const id = feature.properties?.id ?? feature.properties?.zone_code;
        if (String(id) !== String(targetId)) return feature;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            ...patch,
          },
        };
      }));
      return data;
    } catch (err) {
      setSprayTargetsError(err.message || "Gagal update chamber");
      return null;
    }
  }

  // Set (or clear, value=null) the product loaded into ONE chamber for the given
  // field. Merges only that chamber's key — never a wholesale map replace — so a
  // concurrent edit to the other chamber (or an out-of-order server echo) can't
  // drop it. Also re-syncs the popup-facing ref + open popup, but only while the
  // field is still selected (a slow request for a field we've left mustn't leak).
  function mergeChamberProduct(fieldId, chamber, value) {
    setFields((list) =>
      list.map((field) => {
        if (field.id !== fieldId) return field;
        const next = { ...(field.chamber_products || {}) };
        if (value) next[chamber] = value;
        else delete next[chamber];
        return { ...field, chamber_products: next };
      }),
    );
    if (selectedFieldIdRef.current === fieldId) {
      const next = { ...(chamberProductsRef.current || {}) };
      if (value) next[chamber] = value;
      else delete next[chamber];
      chamberProductsRef.current = next;
      openSprayPopupRefreshRef.current?.();
    }
  }

  // Optimistic per-chamber update, then persist and reconcile that one chamber to
  // the server's normalised value.
  async function updateChamberProduct(chamber, productId) {
    const fieldId = selectedFieldId;
    if (!fieldId) return;
    setSprayTargetsError("");
    const previous = chamberProductsRef.current?.[chamber] ?? null;
    mergeChamberProduct(fieldId, chamber, productId); // optimistic
    try {
      const res = await fetch(`/fields/${fieldId}/chamber-products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chamber, product_id: productId }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.detail || "Gagal update produk chamber");
      // Reconcile only this chamber to the server's authoritative value.
      mergeChamberProduct(fieldId, chamber, data.chamber_products?.[chamber] ?? null);
    } catch (err) {
      mergeChamberProduct(fieldId, chamber, previous); // roll back this chamber
      if (selectedFieldIdRef.current === fieldId) {
        setSprayTargetsError(err.message || "Gagal update produk chamber");
      }
    }
  }

  // Approving replaces every zone of this imagery. The backend moves existing HPT and
  // manual chamber settings onto the new zones, so first ask it what would move and,
  // if anything would, let the user confirm before saving (confirmed=true).
  async function approveNdviZones(confirmed = false) {
    if (!selectedImagery || ndviZoneFeatures.length === 0) return;
    setApproveZonesLoading(true);
    setNdviZonesError("");
    try {
      const geojson = {
        type: "FeatureCollection",
        features: ndviZoneFeatures,
      };
      if (!confirmed) {
        const impactRes = await fetch(
          `/imagery/${selectedImagery.id}/ndvi-zones/save-impact`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: ndviZoneSettings, geojson }),
          },
        );
        const impact = await impactRes.json();
        if (!impactRes.ok) throw new Error(impact?.detail || "Gagal cek dampak approve");
        if (impact.hpt_total > 0 || impact.manual_total > 0) {
          setApproveImpact(impact);
          return; // wait for the user's confirmation in the panel
        }
      }
      setApproveImpact(null);
      const res = await fetch(
        `/imagery/${selectedImagery.id}/ndvi-zones/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: ndviZoneSettings,
            geojson,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Gagal approve zones");

      removeNdviZonesPreview();
      renderSprayTargetsGeoJson(data.geojson);
      setActiveAnalysisPanel("spray-targets");
      setActive((prev) => {
        const next = new Set(prev);
        next.delete("ndvi-zones");
        next.add("spray-targets");
        return next;
      });
    } catch (err) {
      setNdviZonesError(err.message || "Gagal approve zones");
    } finally {
      setApproveZonesLoading(false);
    }
  }

  function dropMarker(la, ln) {
    if (currentMarker.current) map.current.removeLayer(currentMarker.current);
    let isRemoving = false;
    let m;
    const removeMarker = () => {
      if (isRemoving) return;
      isRemoving = true;
      if (currentMarker.current === m) currentMarker.current = null;
      if (map.current?.hasLayer(m)) map.current.removeLayer(m);
      isRemoving = false;
    };

    m = createLocationMarker({
      lat: la,
      lng: ln,
      onClose: removeMarker,
    }).addTo(map.current);
    m.openPopup();
    m.on("remove", () => {
      currentMarker.current = null;
    });
    currentMarker.current = m;
  }

  function moveToPlace(place) {
    if (!map.current || !place) return;
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    if (place.boundingbox) {
      map.current.fitBounds(
        [
          [parseFloat(place.boundingbox[0]), parseFloat(place.boundingbox[2])],
          [parseFloat(place.boundingbox[1]), parseFloat(place.boundingbox[3])],
        ],
        { animate: true, duration: 1 },
      );
    } else {
      map.current.flyTo([lat, lng], 15, { duration: 1 });
    }
    dropMarker(lat, lng);
  }

  async function fetchSuggestions(searchText) {
    const q = searchText.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=id`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("suggestions:", err);
    }
  }

  function handleSearchInput(e) {
    const value = e.target.value;
    setQuery(value);
    setSearchError("");
    setShowSuggestions(true);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchSuggestions(value), 400);
  }

  function selectSuggestion(place) {
    setQuery(place.display_name);
    setShowSuggestions(false);
    setSuggestions([]);
    moveToPlace(place);
  }

  async function searchLocation(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || !map.current) return;

    if (showSuggestions && suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }

    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setSearchError("Lokasi tidak ditemukan");
        return;
      }

      moveToPlace(data[0]);
      setShowSuggestions(false);
      setSuggestions([]);
    } catch (err) {
      console.error("search:", err);
      setSearchError("Gagal mencari lokasi");
    } finally {
      setSearching(false);
    }
  }

  function zoomIn() {
    map.current?.zoomIn();
  }

  function zoomOut() {
    map.current?.zoomOut();
  }

  function locateDrone() {
    const coords = applyOffsetToCoords(diagnosticsCoords(diagnosticsData), droneOffset);
    if (!map.current || !coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
      alert("Lokasi drone belum tersedia dari telemetry.");
      return;
    }
    map.current.flyTo([coords.lat, coords.lon], 17, { duration: 1 });
  }

  function locateUser() {
    if (!map.current || !navigator.geolocation) {
      alert("Browser tidak mendukung geolocation.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        const accuracy = position.coords.accuracy;

        if (userLocationMarker.current)
          map.current.removeLayer(userLocationMarker.current);
        if (userLocationCircle.current)
          map.current.removeLayer(userLocationCircle.current);

        const icon = L.divIcon({
          className: "",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          html: '<div class="relative flex h-10 w-10 items-center justify-center"><div class="absolute h-10 w-10 animate-ping rounded-full bg-[#4B7C63]/35"></div><div class="absolute h-7 w-7 rounded-full bg-[#4B7C63]/20"></div><div class="relative h-4 w-4 rounded-full border-2 border-white bg-[#4B7C63] shadow-[0_4px_14px_rgba(15,23,42,0.35)]"></div></div>',
        });

        userLocationCircle.current = L.circle(latlng, {
          radius: accuracy,
          color: "#4B7C63",
          fillColor: "#4B7C63",
          fillOpacity: 0.12,
          opacity: 0.35,
          weight: 1,
        }).addTo(map.current);
        userLocationMarker.current = L.marker(latlng, {
          icon,
          interactive: false,
        }).addTo(map.current);
        map.current.flyTo(latlng, 17, { duration: 1 });
        setLocating(false);
      },
      () => {
        setLocating(false);
        alert("Tidak dapat menemukan lokasi. Pastikan izin lokasi aktif.");
      },
      { enableHighAccuracy: true },
    );
  }

  useEffect(() => {
    const m = L.map(mapDiv.current, {
      zoomControl: false,
      maxZoom: 24,
    }).setView([-2.5, 118], 5);
    map.current = m;
    m.createPane("ndviZonesPane");
    m.getPane("ndviZonesPane").style.zIndex = 650;
    m.getPane("ndviZonesPane").style.pointerEvents = "auto";
    m.createPane("sprayTargetsPane");
    m.getPane("sprayTargetsPane").style.zIndex = 660;
    m.getPane("sprayTargetsPane").style.pointerEvents = "auto";
    m.createPane("manualDraftPane"); // manual-zone draft + draggable vertices, above zones
    m.getPane("manualDraftPane").style.zIndex = 670;
    ensureBaseLayer("satellite").addTo(m);
    currentBaseLayer.current = "satellite";
    L.control.scale({ imperial: false }).addTo(m);
    m.on("click", (e) => {
      if (manualDrawRef.current) {
        addManualPoint(e.latlng);
        return;
      }
      clearSelectedSprayTargetLayer();
      dropMarker(e.latlng.lat, e.latlng.lng);
    });

    fetch("/data/photos.json")
      .then((r) => r.json())
      .then((photos) => {
        const group =
          typeof L.markerClusterGroup === "function"
            ? L.markerClusterGroup({ showCoverageOnHover: false })
            : L.layerGroup();
        photos.forEach((p) => {
          const path = "/" + p.file.replace(/^\/?/, "");
          const popup = `<div style="text-align:center"><h4 style="margin:0 0 6px;font-size:13px">${p.title}</h4><img src="${path}" style="width:150px;border-radius:4px;margin-bottom:6px" loading="lazy"/><p style="margin:3px 0;font-size:11px;color:#666">${p.description}</p><p style="margin:3px 0;font-size:10px;color:#999">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p></div>`;
          L.marker([p.lat, p.lng])
            .bindPopup(popup, { maxWidth: 180 })
            .addTo(group);
        });
        group.addTo(m);
      })
      .catch((err) => console.error("photos:", err));

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      m.remove();
      map.current = null;
      imageryOverlays.current = {};
      ndviZonesLayer.current = null;
      sprayTargetsLayer.current = null;
      imageryCache.current = {};
      fieldLocationMarker.current = null;
      droneLocationMarker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    // Drift-correct the live marker so it lands where the drone truly is over
    // the satellite imagery (display = reported + Δ). See lib/gcs/gps-offset.js.
    const coords = applyOffsetToCoords(diagnosticsCoords(diagnosticsData), droneOffset);
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return;

    const heading = applyOffsetToHeading(headingDeg(diagnosticsData), droneOffset);
    // ponytail: lucide's Plane icon points ~45deg (northeast) at rest; this
    // offset aligns it to true heading. Tune visually if it looks off.
    const rotation = heading != null ? heading - 45 : 0;
    const icon = droneMarkerIcon(rotation);
    const latlng = [coords.lat, coords.lon];

    if (droneLocationMarker.current) {
      droneLocationMarker.current.setLatLng(latlng);
      droneLocationMarker.current.setIcon(icon);
    } else {
      droneLocationMarker.current = L.marker(latlng, { icon, interactive: false }).addTo(map.current);
    }
  }, [diagnosticsData, droneOffset]);

  useEffect(() => {
    let cancelled = false;

    async function loadFields() {
      setFieldsLoading(true);
      setFieldError("");
      try {
        const res = await fetch("/fields");
        if (!res.ok) throw new Error("Gagal memuat daftar lahan");
        const data = await res.json();
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).toSorted((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });
        setFields(list);
        if (list.length > 0) {
          await selectField(list[0].id, { fit: false });
        }
      } catch (err) {
        if (!cancelled)
          setFieldError(err.message || "Gagal memuat daftar lahan");
      } finally {
        if (!cancelled) setFieldsLoading(false);
      }
    }

    loadFields();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the popup-facing chamber-product ref in sync with the selected field so
  // dose placeholders reflect the loaded product the moment a target is opened.
  useEffect(() => {
    selectedFieldIdRef.current = selectedFieldId;
    const field = fields.find((item) => item.id === selectedFieldId);
    chamberProductsRef.current = field?.chamber_products ?? {};
  }, [fields, selectedFieldId]);

  const ndviCategories = ndviStats?.categories ?? DEFAULT_NDVI_CATEGORIES;
  const dominantNdvi = ndviCategories.reduce(
    (best, cat) =>
      Number(cat.percentage) > Number(best.percentage) ? cat : best,
    ndviCategories[0],
  );
  const selectedField = fields.find((field) => field.id === selectedFieldId);
  const selectedCenter = imageryCenter(selectedImagery);
  const selectedLocationText = selectedCenter
    ? `${formatCoordinate(selectedCenter.lat)}, ${formatCoordinate(selectedCenter.lng)}`
    : "-";
  const ndviRangeMinPercent = ((ndviZoneSettings.ndvi_min + 1) / 2) * 100;
  const ndviRangeMaxPercent = ((ndviZoneSettings.ndvi_max + 1) / 2) * 100;
  const routeActive = active.has("spraying-route");
  const droneCoords = diagnosticsCoords(diagnosticsData);
  const droneLocationAvailable =
    !!droneCoords && Number.isFinite(droneCoords.lat) && Number.isFinite(droneCoords.lon);
  const sprayTargetAreaM2 = sprayTargetFeatures.reduce(
    (sum, feature) => sum + Number(feature.properties?.area_m2 || 0),
    0,
  );
  const missingSprayTargetZones = sprayTargetFeatures
    .filter((feature) => {
      const selectedChambers = feature.properties?.selected_chambers;
      return !Array.isArray(selectedChambers) || selectedChambers.length === 0;
    })
    .map((feature, index) => feature.properties?.zone_code ?? `Z${String(index + 1).padStart(2, "0")}`);
  const sprayReadyCount = sprayTargetFeatures.length - missingSprayTargetZones.length;
  // Every spray-target polygon has at least one chamber (medicine) assigned,
  // and the user is in the spray-targets workflow (layer on) — this is exactly
  // when the "Start Planning Flight" call-to-action should surface.
  const allChambersAssigned =
    active.has("spray-targets") &&
    sprayTargetFeatures.length > 0 &&
    missingSprayTargetZones.length === 0;
  const routeWaypointCount = sprayTargetFeatures.length > 0 ? sprayTargetFeatures.length * 4 : 0;
  const chamberGroups = computeChamberGroups({
    features: sprayTargetFeatures,
    altitude: routeAltitude,
    laneSpacingInput: routeLaneSpacing,
  });
  const routeReady =
    sprayTargetFeatures.length > 0 &&
    missingSprayTargetZones.length === 0 &&
    !chamberGroups.laneSpacingInvalid;
  const ndviStatsVisible = active.has("ndvi");
  const topRightConflict = ndviStatsVisible && routeActive;
  const showNdviStats = ndviStatsVisible && (!topRightConflict || topRightTab === "ndvi");
  const showFlightSettings = routeActive && (!topRightConflict || topRightTab === "flight");

  // --- Manual zone drawing ------------------------------------------------------
  useEffect(() => {
    manualDrawRef.current = manualDraw;
  }, [manualDraw]);

  // While drawing, the live spray-target layer is hidden (taps must add points, not
  // open popups) and a non-interactive copy - or the dry-run result - is shown instead.
  const isDrawing = manualDraw != null;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const layer = sprayTargetsLayer.current;
    if (isDrawing) {
      if (layer && m.hasLayer(layer)) m.removeLayer(layer);
      m.getContainer().style.cursor = "crosshair";
    } else {
      if (layer && !m.hasLayer(layer)) layer.addTo(m);
      m.getContainer().style.cursor = "";
    }
  }, [isDrawing]);

  // Leaving the field/imagery abandons an unsaved drawing.
  useEffect(() => {
    setManualDraw(null);
  }, [selectedImagery?.id]);

  // Draft polygon + draggable vertices, over the (preview of the) zones.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!manualDraftLayer.current) manualDraftLayer.current = L.layerGroup().addTo(m);
    if (!manualPreviewLayer.current) manualPreviewLayer.current = L.layerGroup().addTo(m);
    const draft = manualDraftLayer.current;
    const preview = manualPreviewLayer.current;
    draft.clearLayers();
    preview.clearLayers();
    if (!manualDraw) return;

    // The zone being drawn is shown by the draft itself, so leave it out of the preview.
    const hideId = manualDraw.mode === "edit" ? manualDraw.polygonId : manualDraw.preview?.polygonId;
    const base = manualDraw.preview?.geojson ?? { type: "FeatureCollection", features: sprayTargetFeatures };
    L.geoJSON(
      { ...base, features: (base.features ?? []).filter((f) => String(f.properties?.id) !== String(hideId)) },
      {
        pane: "sprayTargetsPane",
        interactive: false,
        style: (feature) => ({
          ...sprayTargetStyle(feature),
          // Dashed = current zones; solid = how they will look once this zone is saved.
          dashArray: manualDraw.preview ? null : "5 5",
          fillOpacity: 0.14,
        }),
      },
    ).addTo(preview);

    const latlngs = manualDraw.points.map((point) => [point.lat, point.lng]);
    const color = manualDraw.error ? "#dc2626" : "#d97706";
    if (latlngs.length >= 3) {
      L.polygon(latlngs, {
        pane: "manualDraftPane", interactive: false, color, weight: 3, dashArray: "6 5",
        fillColor: "#fbbf24", fillOpacity: 0.32,
      }).addTo(draft);
    } else if (latlngs.length === 2) {
      L.polyline(latlngs, { pane: "manualDraftPane", interactive: false, color, weight: 3, dashArray: "6 5" }).addTo(draft);
    }
    manualDraw.points.forEach((point, index) => {
      const marker = L.marker([point.lat, point.lng], {
        pane: "manualDraftPane",
        draggable: true,
        icon: L.divIcon({
          className: "",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          html: `<div style="width:22px;height:22px;border-radius:50%;box-sizing:border-box;background:${index === 0 ? color : "#fff"};border:4px solid ${color};box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
        }),
      });
      marker.on("click", (event) => L.DomEvent.stopPropagation(event)); // tapping a vertex adds nothing
      marker.on("dragend", (event) => {
        const ll = event.target.getLatLng();
        setManualDraw((d) =>
          d && {
            ...d,
            points: d.points.map((q, j) => (j === index ? { lat: ll.lat, lng: ll.lng } : q)),
            preview: null,
            previewing: false,
            error: "",
          },
        );
      });
      marker.addTo(draft);
    });
  }, [manualDraw, sprayTargetFeatures]);

  // Ask the backend what saving this shape would do (dry run), shortly after the last edit.
  const manualPointsKey = manualDraw ? JSON.stringify(manualDraw.points) : "";
  useEffect(() => {
    if (!manualDraw || manualDraw.points.length < 3 || !selectedImagery) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setManualDraw((d) => d && { ...d, previewing: true, error: "" });
      try {
        const res = await manualZoneRequest(manualDraw, true);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.detail || "Zona tidak valid");
        setManualDraw((d) =>
          d && {
            ...d,
            previewing: false,
            preview: { report: data.report, geojson: data.geojson, polygonId: data.polygon?.id },
          },
        );
      } catch (err) {
        if (!cancelled) setManualDraw((d) => d && { ...d, previewing: false, preview: null, error: err.message });
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [manualPointsKey]);

  const manualDraftAreaM2 =
    manualDraw && manualDraw.points.length >= 3 ? turf.area(manualRingGeometry(manualDraw.points)) : 0;

  function renderTopRightSwitch() {
    if (!topRightConflict) return null;
    const tabs = [
      { id: "ndvi", label: "NDVI" },
      { id: "flight", label: "Flight" },
    ];
    return (
      <div className="flex shrink-0 rounded-2xl bg-white/95 p-0.5 shadow-[0_8px_20px_rgba(15,23,42,0.16)] ring-1 ring-gray-200 backdrop-blur">
        {tabs.map((tab) => {
          const isActive = topRightTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTopRightTab(tab.id)}
              className={`h-6 rounded-xl px-2.5 text-[9px] font-black uppercase tracking-[0.06em] transition-colors ${
                isActive
                  ? "bg-emerald-900 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }
  function handleRouteAltitudeChange(nextAltitude) {
    setRouteAltitude(nextAltitude);
    setRouteLaneSpacing(defaultLaneSpacing(nextAltitude));
  }
  function startFlightPlanning() {
    // The popup mutates each Leaflet layer's feature.properties in place (chamber
    // toggles, and especially a dose typed but not yet round-tripped to the DB),
    // and those live objects can be fresher than React state — updateSprayTarget-
    // Chambers replaces state elements with new objects, so later in-place edits
    // don't reach `sprayTargetFeatures`. Overlay the live chamber/dose fields so
    // the flown mission always matches what the user sees on the map.
    const features = sprayTargetFeatures.map((feature) => {
      const id = feature.properties?.id ?? feature.properties?.zone_code;
      const liveProps = sprayTargetLayerIndex.current[String(id)]?.feature?.properties;
      if (!liveProps) return feature;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          selected_chambers: liveProps.selected_chambers ?? feature.properties?.selected_chambers,
          chamber_mode: liveProps.chamber_mode ?? feature.properties?.chamber_mode,
          chamber_doses: liveProps.chamber_doses ?? feature.properties?.chamber_doses,
        },
      };
    });
    setFlightPlanInput({
      featureCollection: {
        type: "FeatureCollection",
        features,
      },
      fieldName: selectedField?.name ?? null,
      chamberProducts: selectedField?.chamber_products ?? {},
      createdAt: new Date().toISOString(),
    });
    navigate("/flight-plan");
  }
  const shouldFillFieldPanel = ndviZoneFeatures.length > 0 || routeActive;
  const activeLayerPanels = [
    { id: "ndvi-zones", label: "NDVI Zones" },
    { id: "spray-targets", label: "Spray Targets" },
    { id: "spraying-route", label: "Spraying Route" },
  ].filter((panel) => active.has(panel.id));

  function renderAnalysisPanelSwitch() {
    if (activeLayerPanels.length <= 1) return null;
    return (
      <div className="flex shrink-0 rounded-2xl bg-gray-50 p-0.5 ring-1 ring-gray-200">
        {activeLayerPanels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            onClick={() => setActiveAnalysisPanel(panel.id)}
            className={`h-7 rounded-xl px-2.5 text-[10px] font-black transition-colors ${
              activeAnalysisPanel === panel.id
                ? "bg-white text-emerald-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
            title={panel.label}
          >
            {panel.id === "ndvi-zones" ? "Zones" : panel.id === "spray-targets" ? "Targets" : "Route"}
          </button>
        ))}
      </div>
    );
  }

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
            <MapPinned className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-center sm:text-left">
            <div className="truncate text-[15px] font-black leading-tight text-gray-950">
              SmartGIS
            </div>
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Peta Lahan
            </div>
          </div>
        </div>
        <LoadMissionFileButton
          label="Muat Misi"
          className="flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-emerald-900/15 bg-white px-3 text-[13px] font-extrabold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-900/35 hover:bg-emerald-50 active:translate-y-0 disabled:opacity-60"
        />
      </header>

      <DroneTelemetryProvider />

      <div className="relative min-h-0 flex-1">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* Search */}
        <div className="absolute left-4 top-4 z-[1000] w-[min(320px,calc(100vw-32px))] md:w-[340px]">
          <form
            onSubmit={searchLocation}
            className={`flex h-[52px] items-center bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] focus-within:shadow-[0_8px_30px_rgba(0,0,0,0.16)] ${
              showSuggestions && suggestions.length > 0
                ? "rounded-t-[20px] rounded-b-none border-b border-gray-100"
                : "rounded-[20px]"
            }`}
          >
            <div className="pl-5 pr-3 text-forest">
              <MapPin className="h-[22px] w-[22px]" strokeWidth={1.7} />
            </div>
            <input
              type="text"
              value={query}
              onChange={handleSearchInput}
              onFocus={() => {
                if (query.trim()) setShowSuggestions(true);
              }}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="Cari lokasi lahan..."
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-gray-800 outline-none placeholder:text-gray-400"
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="mr-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-forest text-white transition-colors hover:bg-house disabled:bg-gray-200 disabled:text-gray-400"
              title="Cari lokasi"
            >
              {searching ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <Search className="h-[18px] w-[18px]" />
              )}
            </button>
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-[1001] w-full overflow-hidden rounded-b-[20px] bg-white shadow-[0_16px_30px_rgba(0,0,0,0.12)]">
              {suggestions.map((place, index) => {
                const [title, ...rest] = place.display_name.split(",");
                return (
                  <button
                    key={`${place.place_id ?? index}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(place)}
                    className="flex w-full items-start gap-3 border-t border-gray-100 px-5 py-3 text-left transition-colors hover:bg-emerald-50/60"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-800">
                        {title}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {rest.join(",").trim()}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {searchError && (
            <div className="mt-3 inline-flex rounded-full bg-red-950/80 px-4 py-2 text-xs font-semibold text-red-100 shadow-lg">
              {searchError}
            </div>
          )}
        </div>

        {leftPanelCollapsed && (
          <button
            type="button"
            onClick={() => setLeftPanelCollapsed(false)}
            className="absolute left-4 top-[76px] z-[1000] flex h-11 items-center gap-2 rounded-2xl border border-white/70 bg-white px-3 text-sm font-black text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-colors hover:bg-emerald-50"
            title="Buka panel SmartGIS"
          >
            <ChevronRight className="h-4 w-4" />
            Panel
          </button>
        )}

        {!leftPanelCollapsed && (
          <>
            {/* Field selector */}
            <div
              className="absolute bottom-4 left-4 top-[76px] z-[1000] w-[min(380px,calc(100vw-32px))]"
            >
              <div
                className={`rounded-[18px] border border-white/70 bg-white p-3 shadow-[0_12px_34px_rgba(15,23,42,0.15)] ${
                  shouldFillFieldPanel
                    ? "flex h-full flex-col overflow-hidden"
                    : "max-h-full overflow-y-auto overscroll-contain"
                }`}
              >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Pilih Lahan
                  </div>
                {fieldError && (
                  <div className="mt-0.5 truncate text-[10px] font-semibold text-red-500">
                    {fieldError}
                  </div>
                )}
              </div>
              {fieldsLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-forest" />
              )}
              <button
                type="button"
                onClick={() => setLeftPanelCollapsed(true)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                title="Sembunyikan panel SmartGIS"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setFieldPickerOpen((value) => !value)}
                disabled={fieldsLoading || fields.length === 0}
                className={`flex h-11 w-full items-center justify-between gap-3 rounded-2xl border bg-white px-3 text-left text-[13px] font-extrabold text-gray-800 shadow-sm transition-colors disabled:border-gray-200 disabled:text-gray-400 ${
                  fieldPickerOpen
                    ? "border-emerald-900 ring-2 ring-emerald-900/10"
                    : "border-gray-200 hover:border-emerald-900"
                }`}
              >
                <span className="min-w-0 truncate">
                  {selectedField?.name ??
                    (fieldsLoading ? "Memuat lahan..." : "Belum ada lahan")}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-emerald-700 transition-transform ${fieldPickerOpen ? "rotate-180" : ""}`}
                />
              </button>

              {fieldPickerOpen && fields.length > 0 && (
                <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 shadow-[0_16px_36px_rgba(15,23,42,0.16)]">
                  {fields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => selectField(field.id, { fit: true })}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-bold transition-colors ${
                        selectedFieldId === field.id
                          ? "bg-emerald-50 text-emerald-800"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="min-w-0 truncate">{field.name}</span>
                      {selectedFieldId === field.id && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
                  Lokasi Lahan
                </div>
                <div className="mt-0.5 truncate text-[12px] font-extrabold tabular-nums text-gray-800">
                  {selectedLocationText}
                </div>
              </div>
              <button
                type="button"
                onClick={showSelectedFieldMarker}
                disabled={!selectedImagery}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-900 bg-white text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 disabled:border-gray-200 disabled:text-gray-300"
                title="Tandai lokasi lahan"
              >
                <MapPin className="h-4 w-4" />
              </button>
            </div>

            {active.has("ndvi-zones") &&
              activeAnalysisPanel === "ndvi-zones" && (
              <NdviZonesPanel
                panelSwitch={renderAnalysisPanelSwitch()}
                settings={ndviZoneSettings}
                rangeMinPercent={ndviRangeMinPercent}
                rangeMaxPercent={ndviRangeMaxPercent}
                loading={ndviZonesLoading}
                approveLoading={approveZonesLoading}
                error={ndviZonesError}
                summary={ndviZonesSummary}
                features={ndviZoneFeatures}
                selectedImagery={selectedImagery}
                formatNumber={formatNumber}
                onClose={() => toggleAnalysisLayer("ndvi-zones")}
                onSettingChange={updateNdviZoneSetting}
                onGenerate={generateNdviZones}
                onApprove={() => approveNdviZones(false)}
                approveImpact={approveImpact}
                onConfirmApprove={() => approveNdviZones(true)}
                onCancelApprove={() => setApproveImpact(null)}
                onFocusZone={focusNdviZone}
                onDeleteZone={deleteNdviZone}
              />
            )}

            {active.has("spray-targets") &&
              activeAnalysisPanel === "spray-targets" && (
              manualDraw ? (
                <ManualZoneDrawPanel
                  draw={manualDraw}
                  areaM2={manualDraftAreaM2}
                  formatNumber={formatNumber}
                  onUndo={undoManualPoint}
                  onCancel={() => setManualDraw(null)}
                  onSave={saveManualZone}
                />
              ) : (
              <SprayTargetsPanel
                onStartManualDraw={selectedImagery ? () => startManualDraw() : null}
                panelSwitch={renderAnalysisPanelSwitch()}
                loading={sprayTargetsLoading}
                error={sprayTargetsError}
                features={sprayTargetFeatures}
                totalAreaM2={sprayTargetAreaM2}
                readyCount={sprayReadyCount}
                formatNumber={formatNumber}
                onFocusTarget={focusSprayTarget}
                chamberProducts={selectedField?.chamber_products ?? {}}
                onChamberProductChange={updateChamberProduct}
              />
              )
            )}

            {active.has("spraying-route") &&
              activeAnalysisPanel === "spraying-route" && (
              <SprayingRoutePanel
                panelSwitch={renderAnalysisPanelSwitch()}
                targetCount={sprayTargetFeatures.length}
                waypointCount={routeWaypointCount}
                readyCount={sprayReadyCount}
                missingZones={missingSprayTargetZones}
                groups={chamberGroups.groups}
                laneSpacingInvalid={chamberGroups.laneSpacingInvalid}
                onClose={() => toggleAnalysisLayer("spraying-route")}
                onOpenTargets={() => {
                  if (!active.has("spray-targets")) {
                    toggleAnalysisLayer("spray-targets");
                  } else {
                    setActiveAnalysisPanel("spray-targets");
                  }
                }}
              />
            )}
          </div>
            </div>
          </>
        )}

        {/* NDVI Health Stats */}
        {showNdviStats && (
          <NdviHealthStats
            stats={ndviStats}
            categories={ndviCategories}
            dominant={dominantNdvi}
            panelSwitch={renderTopRightSwitch()}
          />
        )}

        {routeActive && (
          <DroneTelemetryBar
            collapsed={telemetryCollapsed}
            onToggle={() => setTelemetryCollapsed((collapsed) => !collapsed)}
          />
        )}

        {showFlightSettings && (
          <FlightSettingsWidget
            altitude={routeAltitude}
            laneSpacing={routeLaneSpacing}
            sprayWidth={chamberGroups.sprayWidthFull}
            overlapPercent={chamberGroups.overlapPercent}
            onAltitudeChange={handleRouteAltitudeChange}
            onLaneSpacingChange={setRouteLaneSpacing}
            routeReady={routeReady}
            panelSwitch={renderTopRightSwitch()}
          />
        )}

        <MapFloatingControls
          locating={locating}
          droneLocationAvailable={droneLocationAvailable}
          onLocate={locateUser}
          onLocateDrone={locateDrone}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
        />

        {hasOffset(droneOffset) && (
          <div className="pointer-events-none absolute right-4 top-4 z-[1000] flex items-center gap-1.5 rounded-full bg-sky-500/90 px-3 py-1.5 text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(2,6,23,0.28)] backdrop-blur">
            <LocateFixed className="h-3.5 w-3.5" />
            Koreksi GPS {offsetMeters(droneOffset, droneCoords?.lat ?? 0).distance.toFixed(1)} m
          </div>
        )}

        <LayerPanel
          open={panelOpen}
          active={active}
          baseLayer={baseLayer}
          imageryError={imageryError}
          imageryLoading={imageryLoading}
          onToggleOpen={() => setPanelOpen((value) => !value)}
          onClose={() => setPanelOpen(false)}
          onBaseLayer={setBaseLayer}
          onToggleImagery={toggleImageryLayer}
          onToggleAnalysis={toggleAnalysisLayer}
        />

        {allChambersAssigned && (
          <div
            className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2"
            style={{ animation: "fp-pop 360ms ease-out" }}
          >
            <button
              type="button"
              onClick={startFlightPlanning}
              className="flex items-center gap-2.5 rounded-full bg-gradient-to-br from-leaf to-forest px-6 py-3.5 text-[15px] font-black text-white shadow-[0_16px_40px_rgba(0,98,65,0.4)] ring-4 ring-white/40 transition-transform hover:-translate-y-0.5 active:translate-y-0"
              title="Rencanakan rute penerbangan drone"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20">
                <Rocket className="h-4 w-4" />
              </span>
              Start Planning Flight
              <ChevronRight className="h-4 w-4 opacity-80" />
            </button>
          </div>
        )}

        <DroneFloatingButton
          active={routeActive}
          onClick={() => navigate("/drone-dashboard")}
        />

      </div>
    </div>
  );
}
