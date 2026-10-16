const TILESERVER = import.meta.env.VITE_TILESERVER_URL?.replace(/\/$/, "");
const STYLE = import.meta.env.VITE_MAP_STYLE;

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=1600";

function parseCenter(value) {
  if (!value) return null;
  const [lng, lat] = value.split(",").map((n) => Number(n.trim()));
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

export const DEFAULT_CENTER =
  parseCenter(import.meta.env.VITE_MAP_CENTER) ?? [112.7938, -7.2755];
export const DEFAULT_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM ?? "16");

export const basemapConfigured = Boolean(TILESERVER && STYLE);

export function basemapUrl(opts) {
  if (!TILESERVER || !STYLE) return FALLBACK_IMAGE;
  const lng = opts?.lng ?? DEFAULT_CENTER[0];
  const lat = opts?.lat ?? DEFAULT_CENTER[1];
  const zoom = opts?.zoom ?? DEFAULT_ZOOM;
  const w = opts?.width ?? 1280;
  const h = opts?.height ?? 800;
  return `${TILESERVER}/styles/${STYLE}/static/${lng},${lat},${zoom}/${w}x${h}.png`;
}
