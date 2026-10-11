export const BASE_BOUNDS = [
  [-8.23324, 113.68652],
  [-8.05923, 113.90625],
];

// Base maps come through the Pi (server/app/routes/tiles.py): every tile shown is kept
// on disk, so a map viewed or downloaded once still loads without internet.
export const BASE_LAYERS = {
  default: {
    label: "Default",
    preview: "/api/tiles/default/5/26/16?v=esri",
    attribution: "Tiles &copy; Esri",
    url: "/api/tiles/default/{z}/{x}/{y}?v=esri", // ?v: the browser cached OSM "blocked" tiles for 7 days
    maxNativeZoom: 19,
    maxZoom: 24,
  },
  satellite: {
    label: "Satelit",
    preview: "/api/tiles/satellite/5/26/16",
    attribution: "Tiles &copy; Esri",
    url: "/api/tiles/satellite/{z}/{x}/{y}",
    maxNativeZoom: 18,
    maxZoom: 24,
  },
  terrain: {
    label: "Terrain",
    preview: "/api/tiles/terrain/5/26/16",
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    url: "/api/tiles/terrain/{z}/{x}/{y}",
    maxNativeZoom: 17,
    maxZoom: 24,
  },
};

export const MAP_IMAGERY_LAYERS = [
  {
    id: "rgb",
    label: "RGB",
    preview: "/data/layer/RGB_layer_thumb.png",
    className: "bg-gradient-to-br from-sky-100 to-cyan-100 text-blue-700",
  },
  {
    id: "ndvi",
    label: "NDVI",
    preview: "/data/layer/NDVI_layer_thumb.png",
    className:
      "bg-gradient-to-br from-emerald-100 to-lime-100 text-emerald-700",
  },
];

export const MAP_ANALYSIS_LAYERS = [
  {
    id: "ndvi-zones",
    label: "NDVI Zones",
    shortLabel: "Zones",
    preview: "/data/layer/NDVI_zones_layer_thumb.png",
    className: "bg-gradient-to-br from-amber-100 to-red-100 text-amber-800",
  },
  {
    id: "spray-targets",
    label: "Spray Targets",
    shortLabel: "Target",
    preview: "/data/layer/spray_targets_layer_thumb.png",
    className: "bg-gradient-to-br from-rose-100 to-pink-100 text-rose-700",
  },
  {
    id: "spraying-route",
    label: "Spraying Route",
    shortLabel: "Route",
    preview: "/data/layer/spraying_route_layer_thumb.png",
    className: "bg-gradient-to-br from-indigo-100 to-sky-100 text-indigo-700",
  },
];

export const DEFAULT_NDVI_CATEGORIES = [
  {
    name: "Sangat Sehat",
    range: "0.8-1.0",
    color: "#0f7a3f",
    percentage: 35,
    area_ha: 0.82,
  },
  {
    name: "Sehat",
    range: "0.6-0.8",
    color: "#1fbf63",
    percentage: 26,
    area_ha: 0.61,
  },
  {
    name: "Cukup Sehat",
    range: "0.4-0.6",
    color: "#7bd85a",
    percentage: 18,
    area_ha: 0.43,
  },
  {
    name: "Kurang Sehat",
    range: "0.21-0.4",
    color: "#f59e0b",
    percentage: 12,
    area_ha: 0.28,
  },
  {
    name: "Tidak Sehat",
    range: "0-0.21",
    color: "#ef233c",
    percentage: 6,
    area_ha: 0.14,
  },
  {
    name: "Non-Vegetasi",
    range: "< 0",
    color: "#27272a",
    percentage: 3,
    area_ha: 0.06,
  },
];

export const DEFAULT_NDVI_ZONE_SETTINGS = {
  ndvi_min: 0,
  ndvi_max: 0.6,
  min_area_m2: 2,
  merge_distance_m: 0.5,
};
