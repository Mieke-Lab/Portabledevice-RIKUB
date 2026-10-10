export async function fetchBlobWithProgress(url, onProgress, signal) {
  onProgress(0, 0);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);

  const total = Number(res.headers.get("Content-Length")) || 0;
  const type = res.headers.get("Content-Type") || "application/octet-stream";

  if (!res.body) {
    const blob = await res.blob();
    onProgress(blob.size, blob.size);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type });
}
