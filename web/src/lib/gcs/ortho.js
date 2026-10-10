import { fromArrayBuffer } from "geotiff";

// A GeoTIFF bbox is usable directly as Leaflet lat/lng bounds only when it is in
// a geographic CRS (EPSG:4326). ODM usually writes the orthophoto in a projected
// UTM CRS whose bbox is in metres — those coordinates fall far outside ±180/±90.
function isLngLatBbox(b) {
  return (
    Array.isArray(b) && b.length === 4 &&
    Math.abs(b[0]) <= 180 && Math.abs(b[2]) <= 180 &&
    Math.abs(b[1]) <= 90 && Math.abs(b[3]) <= 90
  );
}

// Decode an ODM orthophoto GeoTIFF into a PNG data URL suitable for a Leaflet
// image overlay. Unlike `decodeNdvi` (single-band NDVI ramp), this composites the
// real R/G/B bands for a true-colour preview, honouring an alpha band when present
// so masked areas outside the field stay transparent. Falls back to a single-band
// NDVI-style ramp for 1-band rasters.
//
// Returns `{ geographic, bbox, bands, dataUrl }`. When `geographic` is false the
// raster is in a projected CRS and cannot be placed on the lat/lng basemap without
// reprojection, so `dataUrl` is omitted and the caller should skip the overlay.
export async function decodeOrthoPreview(data, maxDim = 1024) {
  const tiff = await fromArrayBuffer(data);
  const img = await tiff.getImage();
  const bbox = img.getBoundingBox();
  const bands = img.getSamplesPerPixel();
  const geographic = isLngLatBbox(bbox);
  if (!geographic) return { geographic: false, bbox, bands };

  const w = img.getWidth();
  const h = img.getHeight();
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const noData = img.getGDALNoData();
  const rgba = new Uint8ClampedArray(outW * outH * 4);

  if (bands >= 3) {
    const hasAlpha = bands >= 4;
    const samples = hasAlpha ? [0, 1, 2, 3] : [0, 1, 2];
    const stride = samples.length;
    const raster = await img.readRasters({ width: outW, height: outH, samples, interleave: true });

    // ODM orthos are typically 8-bit; if a band is 16-bit, rescale into 0–255.
    let max = 0;
    for (let i = 0; i < outW * outH; i++) {
      for (let s = 0; s < 3; s++) {
        const v = raster[i * stride + s];
        if (Number.isFinite(v) && v > max) max = v;
      }
    }
    const k = max > 255 ? 255 / max : 1;

    for (let i = 0; i < outW * outH; i++) {
      const o = i * 4;
      const r = raster[i * stride];
      const g = raster[i * stride + 1];
      const b = raster[i * stride + 2];
      const a = hasAlpha ? raster[i * stride + 3] : 255;
      const isNoData = noData != null && r === noData && g === noData && b === noData;
      if (a === 0 || isNoData || !Number.isFinite(r)) { rgba[o + 3] = 0; continue; }
      rgba[o] = Math.round(r * k);
      rgba[o + 1] = Math.round(g * k);
      rgba[o + 2] = Math.round(b * k);
      rgba[o + 3] = hasAlpha ? a : 255;
    }
  } else {
    const raster = await img.readRasters({ width: outW, height: outH, samples: [0], interleave: true });
    for (let i = 0; i < raster.length; i++) {
      const v = raster[i];
      const o = i * 4;
      if ((noData != null && v === noData) || !Number.isFinite(v)) { rgba[o + 3] = 0; continue; }
      const t = Math.max(0, Math.min(1, (v - 0.2) / 0.7));
      if (t < 0.5) { rgba[o] = 255; rgba[o + 1] = Math.round(510 * t); }
      else { rgba[o] = Math.round(255 * (2 - 2 * t)); rgba[o + 1] = 200; }
      rgba[o + 2] = 30;
      rgba[o + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { geographic, bbox, bands };
  ctx.putImageData(new ImageData(rgba, outW, outH), 0, 0);
  return { geographic, bbox, bands, dataUrl: canvas.toDataURL("image/png") };
}
