const TILE = 256;

function mercNormY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function fitZoom(bbox, width, height, pad = 0.15) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const normW = Math.max((maxLng - minLng) / 360, 1e-9);
  const normH = Math.max(Math.abs(mercNormY(minLat) - mercNormY(maxLat)), 1e-9);
  const zx = Math.log2((width * (1 - pad)) / (normW * TILE));
  const zy = Math.log2((height * (1 - pad)) / (normH * TILE));
  return Math.min(zx, zy);
}

export function projector(centerLng, centerLat, zoom, width, height) {
  const size = TILE * 2 ** zoom;
  const cx = (centerLng / 360 + 0.5) * size;
  const cy = mercNormY(centerLat) * size;
  return (lng, lat) => ({
    x: (lng / 360 + 0.5) * size - cx + width / 2,
    y: mercNormY(lat) * size - cy + height / 2,
  });
}

export function unprojector(centerLng, centerLat, zoom, width, height) {
  const size = TILE * 2 ** zoom;
  const cx = (centerLng / 360 + 0.5) * size;
  const cy = mercNormY(centerLat) * size;
  return (x, y) => {
    const lng = ((x - width / 2 + cx) / size - 0.5) * 360;
    const ny = (y - height / 2 + cy) / size;
    const lat = (Math.atan(Math.sinh((0.5 - ny) * 2 * Math.PI)) * 180) / Math.PI;
    return { lng, lat };
  };
}
