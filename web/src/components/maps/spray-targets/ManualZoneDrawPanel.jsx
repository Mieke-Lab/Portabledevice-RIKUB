import { AlertTriangle, Loader2, PenLine, Undo2, X } from "lucide-react";

// Human-readable lines for the backend's clip report (app/zones.py reclip_auto_zones).
function reportLines(report, formatNumber) {
  if (!report) return [];
  const lines = [];
  for (const c of report.clipped ?? []) {
    lines.push(
      `${c.origin} terpotong: ${formatNumber(c.before_m2, 0)} → ${formatNumber(c.after_m2, 0)} m²` +
        (c.pieces > 1 ? ` (terbelah jadi ${c.pieces})` : ""),
    );
  }
  for (const r of report.removed ?? []) {
    lines.push(`${r.origin} tertutup seluruhnya (kembali lagi kalau zona manual ini dihapus)`);
  }
  for (const r of report.restored ?? []) {
    lines.push(`${r.origin} kembali: ${formatNumber(r.before_m2, 0)} → ${formatNumber(r.after_m2, 0)} m²`);
  }
  if (report.hpt_moved) lines.push(`${report.hpt_moved} HPT dipindah ke zona yang menutupinya`);
  if (report.hpt_unzoned) lines.push(`${report.hpt_unzoned} HPT dilepas dari zona (data tetap tersimpan)`);
  return lines;
}

// Side panel shown while a manual spray zone is being drawn or reshaped on the map.
// Map taps add points, dragging a point moves it; the shape is previewed server-side
// (dry run) so the operator sees which automatic zones get clipped before saving.
export function ManualZoneDrawPanel({ draw, areaM2, formatNumber, onUndo, onCancel, onSave }) {
  const editing = draw.mode === "edit";
  const enough = draw.points.length >= 3;
  const lines = reportLines(draw.preview?.report, formatNumber);
  const canSave = enough && !draw.previewing && !draw.saving && !draw.error && draw.preview;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-900/10">
          <PenLine className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-tight text-gray-950">
            {editing ? `Ubah bentuk ${draw.zoneCode}` : "Gambar Zona Manual"}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
            Ketuk peta untuk menambah titik · seret titik untuk menggeser
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-amber-950/10 bg-amber-50 px-2 py-1.5">
          <div className="text-[8px] font-black uppercase tracking-[0.1em] text-amber-700">Titik</div>
          <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">{draw.points.length}</div>
        </div>
        <div className="rounded-xl border border-amber-950/10 bg-amber-50 px-2 py-1.5">
          <div className="text-[8px] font-black uppercase tracking-[0.1em] text-amber-700">Luas</div>
          <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
            {enough ? `${formatNumber(areaM2, 1)} m²` : "-"}
          </div>
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-700">
        {!enough ? (
          <span className="text-gray-500">Minimal 3 titik untuk membentuk zona.</span>
        ) : draw.previewing ? (
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menghitung dampak ke zona otomatis…
          </span>
        ) : draw.error ? (
          <span className="inline-flex items-start gap-1.5 text-red-600">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {draw.error}
          </span>
        ) : lines.length ? (
          <>
            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.1em] text-amber-700">
              Dampak saat disimpan
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </>
        ) : draw.preview ? (
          <span className="text-emerald-700">Tidak memotong zona otomatis.</span>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-[auto_auto_1fr] gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={draw.saving}
          className="flex h-9 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-black text-gray-700 hover:bg-gray-50"
        >
          <X className="h-3.5 w-3.5" /> Batal
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={draw.saving || draw.points.length === 0}
          className="flex h-9 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-black text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
          title="Hapus titik terakhir"
        >
          <Undo2 className="h-3.5 w-3.5" /> Titik
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3 text-[11px] font-black text-white shadow-sm hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-500"
        >
          {draw.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {editing ? "Simpan bentuk" : "Simpan zona"}
        </button>
      </div>
    </div>
  );
}
