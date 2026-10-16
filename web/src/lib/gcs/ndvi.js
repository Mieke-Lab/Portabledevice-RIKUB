import { fromArrayBuffer } from "geotiff";

function isLngLatBbox(b) {
  return (
    b.length === 4 &&
    Math.abs(b[0]) <= 180 &&
    Math.abs(b[2]) <= 180 &&
    Math.abs(b[1]) <= 90 &&
    Math.abs(b[3]) <= 90
  );
}

export async function decodeNdvi(data, maxDim = 1024) {
  const tiff = await fromArrayBuffer(data);
  const img = await tiff.getImage();
  const bbox = img.getBoundingBox();
  if (!isLngLatBbox(bbox)) return null;

  const w = img.getWidth();
  const h = img.getHeight();
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const noData = img.getGDALNoData();

  const raster = await img.readRasters({
    width: outW,
    height: outH,
    samples: [0],
    interleave: true,
  });

  const rgba = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    const o = i * 4;
    if ((noData != null && v === noData) || !Number.isFinite(v)) {
      rgba[o + 3] = 0;
      continue;
    }
    const t = Math.max(0, Math.min(1, (v - 0.2) / 0.7));
    if (t < 0.5) {
      rgba[o] = 255;
      rgba[o + 1] = Math.round(510 * t);
    } else {
      rgba[o] = Math.round(255 * (2 - 2 * t));
      rgba[o + 1] = 200;
    }
    rgba[o + 2] = 30;
    rgba[o + 3] = 255;
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba, outW, outH), 0, 0);

  return { dataUrl: canvas.toDataURL("image/png"), bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] };
}
