import { CheckCircle2, MapPin, Satellite, TriangleAlert, X } from "lucide-react";

// Where the farmer (carrying the soil sensor with its GPS) is, relative to the spray zones.
export function FarmerLocationCard({ farmer, zone, hasZones, error, onClose }) {
  const stale = farmer && farmer.age > 15;
  let line;
  let tone = "text-slate-600";
  let Icon = MapPin;
  if (error) {
    line = error;
    tone = "text-amber-700";
    Icon = TriangleAlert;
  } else if (!farmer) {
    line = "Menunggu posisi GPS dari sensor tanah…";
  } else if (!hasZones) {
    line = "Tampilkan Zona Semprot (Map Analysis) untuk memeriksa apakah posisi ini di dalam zona.";
  } else if (zone?.inside) {
    line = `Di dalam zona semprot ${zone.code}`;
    tone = "text-emerald-700";
    Icon = CheckCircle2;
  } else if (zone) {
    line = zone.distance <= 5
      ? `Di tepi zona ${zone.code} (±${Math.round(zone.distance)} m, setara akurasi GPS)`
      : `Di luar zona semprot — zona terdekat ${zone.code} ±${Math.round(zone.distance)} m`;
    tone = zone.distance <= 5 ? "text-emerald-700" : "text-amber-700";
    Icon = zone.distance <= 5 ? CheckCircle2 : TriangleAlert;
  }
  return (
    <div className="absolute bottom-6 left-1/2 z-[1000] w-[min(420px,calc(100vw-120px))] -translate-x-1/2 rounded-2xl bg-white/95 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.16)] backdrop-blur">
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-bold leading-snug ${tone}`}>{line}</div>
          {farmer && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>Lokasi sensor tanah: {farmer.lat.toFixed(6)}, {farmer.lon.toFixed(6)}</span>
              <span className="inline-flex items-center gap-1">
                <Satellite className="h-3 w-3" /> {farmer.sat} satelit
              </span>
              {stale && <span className="font-semibold text-amber-700">tidak update {Math.round(farmer.age)} dtk</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Berhenti melacak"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Inside which spray zone the point is, else the nearest zone and its distance (m). */
export function sprayZoneAt(turf, point, features) {
  if (!point || !Array.isArray(features) || features.length === 0) return null;
  const pt = turf.point([point.lon, point.lat]);
  let nearest = null;
  features.forEach((feature, index) => {
    const type = feature?.geometry?.type;
    if (type !== "Polygon" && type !== "MultiPolygon") return;
    const code = feature.properties?.zone_code ?? `Z${String(index + 1).padStart(2, "0")}`;
    if (nearest?.inside) return;
    if (turf.booleanPointInPolygon(pt, feature)) {
      nearest = { inside: true, code, distance: 0 };
      return;
    }
    const outline = turf.polygonToLine(feature);
    const parts = outline.type === "FeatureCollection" ? outline.features : [outline];
    for (const part of parts) {
      const lines = part.geometry.type === "MultiLineString"
        ? part.geometry.coordinates.map((c) => turf.lineString(c))
        : [part];
      for (const line of lines) {
        const d = turf.pointToLineDistance(pt, line, { units: "meters" });
        if (!nearest || d < nearest.distance) nearest = { inside: false, code, distance: d };
      }
    }
  });
  return nearest;
}
