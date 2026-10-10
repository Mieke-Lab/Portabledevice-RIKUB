import * as turf from "@turf/turf";

const SCALE = 0.0001;

const toTurf = (p) => [p.x * SCALE, p.y * SCALE];
const fromTurf = (c) => ({ x: c[0] / SCALE, y: c[1] / SCALE });

export function calculateCoverageZone(objects) {
  const closedRing = (points) => [...points, points[0]].map(toTurf);
  const areaPolys = objects
    .filter((obj) => obj.type === "area" && obj.points.length >= 3)
    .map((obj) =>
      // Holes (obj.holes) stay holes: no lanes are laid over them.
      turf.rewind(
        turf.polygon([
          closedRing(obj.points),
          ...(obj.holes || []).filter((h) => h.length >= 3).map(closedRing),
        ]),
      ),
    );

  if (areaPolys.length === 0) return null;

  let coverageZone = areaPolys[0];
  for (let i = 1; i < areaPolys.length; i++) {
    const union = turf.union(turf.featureCollection([coverageZone, areaPolys[i]]));
    if (union) coverageZone = union;
  }

  const obstaclePolys = objects
    .filter((obj) => obj.type === "obstacle")
    .map((obj) => {
      if (obj.shape === "polygon" && obj.points.length >= 3) {
        return turf.rewind(
          turf.polygon([[...obj.points, obj.points[0]].map(toTurf)]),
        );
      } else if (obj.shape === "circle" && obj.radius) {
        const steps = 32;
        const coords = [];
        for (let i = 0; i < steps; i++) {
          const t = (i * 2 * Math.PI) / steps;
          coords.push([
            (obj.points[0].x + obj.radius * Math.cos(t)) * SCALE,
            (obj.points[0].y + obj.radius * Math.sin(t)) * SCALE,
          ]);
        }
        // Close the ring explicitly: relying on cos(2π)/sin(2π) to match i=0
        // leaves a ~1e-16 float gap and turf.polygon rejects the open ring.
        coords.push(coords[0]);
        return turf.polygon([coords]);
      }
      return null;
    })
    .filter((p) => p !== null);

  let finalArea = coverageZone;
  if (obstaclePolys.length > 0) {
    let combinedObs = obstaclePolys[0];
    for (let i = 1; i < obstaclePolys.length; i++) {
      const union = turf.union(turf.featureCollection([combinedObs, obstaclePolys[i]]));
      if (union) combinedObs = union;
    }
    // turf.difference returns null when the obstacles fully cover the area —
    // that means nothing is sprayable, so the coverage becomes empty. Do NOT
    // fall back to the un-subtracted zone (that would plan over the no-fly area).
    finalArea = turf.difference(turf.featureCollection([coverageZone, combinedObs]));
  }

  return finalArea;
}

export function generateFlightPath(objects, config) {
  const finalArea = calculateCoverageZone(objects);
  if (!finalArea) return [];

  const circles = objects.filter(
    (obj) => obj.type === "obstacle" && obj.shape === "circle" && obj.radius,
  );

  try {
    const bbox = turf.bbox(finalArea);
    const center = turf.center(finalArea).geometry.coordinates;
    const diag =
      Math.sqrt(Math.pow(bbox[2] - bbox[0], 2) + Math.pow(bbox[3] - bbox[1], 2)) * 2;
    const gap = config.gap * SCALE;
    const offset = (config.offset % config.gap) * SCALE;
    const numLines = Math.ceil(diag / gap) + 10;

    const segments = [];
    for (let i = -numLines; i <= numLines; i++) {
      const lOffset = i * gap + offset;
      const line = turf.lineString([
        [center[0] - diag, center[1] + lOffset],
        [center[0] + diag, center[1] + lOffset],
      ]);
      const rotated = turf.transformRotate(line, config.angle, { pivot: center });
      const intersected = turf.lineIntersect(rotated, finalArea);

      if (intersected.features.length >= 2) {
        const startPt = rotated.geometry.coordinates[0];
        const pts = intersected.features
          .map((f) => f.geometry.coordinates)
          .sort((a, b) => {
            const d1 = Math.pow(a[0] - startPt[0], 2) + Math.pow(a[1] - startPt[1], 2);
            const d2 = Math.pow(b[0] - startPt[0], 2) + Math.pow(b[1] - startPt[1], 2);
            return d1 - d2;
          });

        for (let j = 0; j < pts.length - 1; j++) {
          const mid = [(pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2];
          if (turf.booleanPointInPolygon(mid, finalArea)) {
            segments.push([fromTurf(pts[j]), fromTurf(pts[j + 1])]);
          }
        }
      }
    }

    if (segments.length === 0) return [];
    const finalPath = [];
    // config.startPoint ({x, y}) lets a caller seed the traversal from an
    // arbitrary location (e.g. the nearest field point to the live drone GPS);
    // the greedy walk below then begins at the lane end closest to it. When
    // absent we fall back to the original two-ended invert behaviour.
    let currentPos = config.startPoint
      ? config.startPoint
      : config.invert
        ? segments[segments.length - 1][1]
        : segments[0][0];
    const remaining = [...segments];

    while (remaining.length > 0) {
      let minDist = Infinity;
      let nextIdx = -1;
      let side = 0;
      for (let i = 0; i < remaining.length; i++) {
        const dS = Math.sqrt(
          Math.pow(currentPos.x - remaining[i][0].x, 2) +
            Math.pow(currentPos.y - remaining[i][0].y, 2),
        );
        const dE = Math.sqrt(
          Math.pow(currentPos.x - remaining[i][1].x, 2) +
            Math.pow(currentPos.y - remaining[i][1].y, 2),
        );
        if (dS < minDist) {
          minDist = dS;
          nextIdx = i;
          side = 0;
        }
        if (dE < minDist) {
          minDist = dE;
          nextIdx = i;
          side = 1;
        }
      }
      const seg = remaining.splice(nextIdx, 1)[0];
      const pStart = side === 0 ? seg[0] : seg[1];
      const pEnd = side === 0 ? seg[1] : seg[0];

      for (const c of circles) {
        const centerCircle = c.points[0];
        const radius = c.radius + 2;
        const dx = pStart.x - currentPos.x;
        const dy = pStart.y - currentPos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((centerCircle.x - currentPos.x) * dx + (centerCircle.y - currentPos.y) * dy) / d2,
          ),
        );
        const closest = { x: currentPos.x + t * dx, y: currentPos.y + t * dy };
        if (
          Math.sqrt(
            Math.pow(closest.x - centerCircle.x, 2) +
              Math.pow(closest.y - centerCircle.y, 2),
          ) < radius
        ) {
          const angle = Math.atan2(
            closest.y - centerCircle.y,
            closest.x - centerCircle.x,
          );
          finalPath.push({
            x: centerCircle.x + radius * Math.cos(angle),
            y: centerCircle.y + radius * Math.sin(angle),
          });
        }
      }
      finalPath.push(pStart);
      finalPath.push(pEnd);
      currentPos = pEnd;
    }
    return finalPath;
  } catch (e) {
    console.error("Path Engine Error:", e);
    return [];
  }
}
