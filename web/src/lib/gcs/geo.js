export function flightPathToLocalNED(points, metersPerPixel) {
  if (points.length === 0) return [];
  const origin = points[0];
  return points.map((p) => {
    const east = (p.x - origin.x) * metersPerPixel;
    const north = -(p.y - origin.y) * metersPerPixel;
    return [north, east];
  });
}

export function geoToWaypoints(coords) {
  return coords.map((c) => [c.lat, c.lng]);
}
