import L from "leaflet";
import { BASE_LAYERS } from "@/components/maps/mapConfig";
import { prefetchTiles } from "@/api";

// Leaflet never re-requests a tile that failed, so one dropped request on a weak
// hotspot left a blank square until the map was moved.
const RETRY_DELAYS_MS = [3000, 10000, 30000];
const PREFETCH_PAD_M = 500;

export function createBaseTileLayer(id, options = {}) {
  const meta = BASE_LAYERS[id];
  const layer = L.tileLayer(meta.url, {
    attribution: meta.attribution,
    maxNativeZoom: meta.maxNativeZoom,
    maxZoom: meta.maxZoom,
    ...options,
  });
  layer.on("tileerror", ({ tile }) => {
    const attempt = Number(tile.dataset.retry || 0);
    if (attempt >= RETRY_DELAYS_MS.length) return;
    tile.dataset.retry = String(attempt + 1);
    setTimeout(() => {
      if (!tile.isConnected) return;
      const url = new URL(tile.src);
      url.searchParams.set("retry", String(attempt + 1));
      tile.src = url.href;
    }, RETRY_DELAYS_MS[attempt]);
  });
  return layer;
}

// Ask the Pi to store the base map around an area (a field, a mission, the drone),
// so the same view still loads at full detail later without internet.
// Satellite only: OSM and OpenTopoMap forbid bulk downloads.
export function prefetchMapArea(bounds) {
  const b = L.latLngBounds(bounds);
  if (!b.isValid()) return;
  const padLat = PREFETCH_PAD_M / 111320;
  const padLng = padLat / Math.max(Math.cos((b.getCenter().lat * Math.PI) / 180), 0.2);
  prefetchTiles({
    layers: ["satellite"],
    south: b.getSouth() - padLat,
    north: b.getNorth() + padLat,
    west: b.getWest() - padLng,
    east: b.getEast() + padLng,
    min_zoom: 10,
    max_zoom: 19,
  }).catch(() => {});
}

