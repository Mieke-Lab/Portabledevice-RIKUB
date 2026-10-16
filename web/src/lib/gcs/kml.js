import * as turf from "@turf/turf";

function textOf(el, tag) {
  const node = el?.getElementsByTagName(tag)[0];
  return node?.textContent?.trim() ?? "";
}

function parseCoordinateString(raw) {
  const coords = raw
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lng, lat] = tuple.split(",").map(Number);
      return { lng, lat };
    })
    .filter((c) => Number.isFinite(c.lng) && Number.isFinite(c.lat));

  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    const EPS = 1e-9;
    if (Math.abs(first.lng - last.lng) < EPS && Math.abs(first.lat - last.lat) < EPS)
      coords.pop();
  }
  return coords;
}

export function parseKml(text, fallback) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parseerror").length > 0) {
    throw new Error("Invalid KML: the file could not be parsed.");
  }

  const documentName = textOf(doc.documentElement, "name") || fallback.name;
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const polygons = [];

  placemarks.forEach((pm, idx) => {
    const ring =
      pm.getElementsByTagName("outerBoundaryIs")[0] ??
      pm.getElementsByTagName("Polygon")[0];
    const coordText = textOf(ring ?? pm, "coordinates");
    if (!coordText) return;
    const coords = parseCoordinateString(coordText);
    const distinct = new Set(coords.map((c) => `${c.lng},${c.lat}`));
    if (coords.length < 3 || distinct.size < 3) return;
    polygons.push({
      id: `${fallback.id}-z${idx}`,
      name: textOf(pm, "name") || `Field ${polygons.length + 1}`,
      coords,
    });
  });

  if (polygons.length === 0) {
    throw new Error("No polygon fields found in this KML.");
  }

  return { id: fallback.id, name: documentName, polygons };
}

function toTurfRing(coords) {
  const ring = coords.map((c) => [c.lng, c.lat]);
  ring.push(ring[0]);
  return turf.polygon([ring]);
}

export function projectMaps(maps, width, height, padding = 48) {
  const all = maps.flatMap((m) => m.polygons.flatMap((p) => p.coords));
  if (all.length === 0 || width <= 0 || height <= 0) return [];

  const lngs = all.map((c) => c.lng);
  const lats = all.map((c) => c.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180) || 1;

  const geoW = (maxLng - minLng) * cosLat || 1e-9;
  const geoH = maxLat - minLat || 1e-9;
  const usableW = Math.max(width - 2 * padding, 1);
  const usableH = Math.max(height - 2 * padding, 1);
  const scale = Math.min(usableW / geoW, usableH / geoH);

  const offsetX = padding + (usableW - geoW * scale) / 2;
  const offsetY = padding + (usableH - geoH * scale) / 2;

  const toPoint = (c) => ({
    x: offsetX + (c.lng - minLng) * cosLat * scale,
    y: offsetY + (maxLat - c.lat) * scale,
  });

  return maps.flatMap((m) =>
    m.polygons.map((p) => {
      let areaHa = 0;
      try {
        areaHa = turf.area(toTurfRing(p.coords)) / 10_000;
      } catch {
        areaHa = 0;
      }
      return {
        id: p.id,
        name: p.name,
        sourceMap: m.name,
        points: p.coords.map(toPoint),
        areaHa,
      };
    }),
  );
}
