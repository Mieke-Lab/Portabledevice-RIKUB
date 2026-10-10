const CHANNELS = [
  { key: "temperature_c", label: "Temperature", unit: "°C", icon: "🌡️" },
  { key: "moisture_pct", label: "Moisture", unit: "%", icon: "💧" },
  { key: "ph", label: "pH", unit: "", icon: "⚗️" },
  { key: "ec_us_cm", label: "EC", unit: "µS/cm", icon: "⚡" },
  { key: "nitrogen_mg_kg", label: "Nitrogen", unit: "mg/kg", icon: "🟢" },
  { key: "phosphorus_mg_kg", label: "Phosphorus", unit: "mg/kg", icon: "🟡" },
  { key: "potassium_mg_kg", label: "Potassium", unit: "mg/kg", icon: "🟠" },
];

export function SensorReadingCard({ payload, variant = "compact", onRemove }) {
  const r = payload?.readings ?? {};

  if (variant === "compact") {
    return (
      <div className="glass-panel-active flex items-center gap-3 rounded-xl border border-gcs-outline/50 p-3">
        <span className="text-2xl">🌱</span>
        <div className="flex flex-1 flex-wrap gap-x-3 gap-y-0.5">
          {CHANNELS.slice(0, 4).map((ch) => (
            <span key={ch.key} className="text-xs text-gcs-muted">
              {ch.label}:{" "}
              <span className="font-medium text-gcs-on-surface">
                {r[ch.key] ?? "—"}
                {ch.unit}
              </span>
            </span>
          ))}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="shrink-0 rounded-full p-1 text-gcs-muted transition hover:bg-gcs-error/20 hover:text-gcs-error"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel-active rounded-xl border border-gcs-outline/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-gcs-on-surface">
          <span>🌱</span> Soil Sensor Reading
        </span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="rounded-full p-1 text-gcs-muted transition hover:bg-gcs-error/20 hover:text-gcs-error"
          >
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHANNELS.map((ch) => (
          <div key={ch.key} className="rounded-lg bg-white/20 p-2 text-center">
            <p className="text-lg">{ch.icon}</p>
            <p className="text-xs text-gcs-muted">{ch.label}</p>
            <p className="text-sm font-bold text-gcs-on-surface">
              {r[ch.key] ?? "—"}
              <span className="ml-0.5 text-xs font-normal text-gcs-muted">{ch.unit}</span>
            </p>
          </div>
        ))}
        <div className="rounded-lg bg-white/20 p-2 text-center">
          <p className="text-lg">📏</p>
          <p className="text-xs text-gcs-muted">Depth</p>
          <p className="text-sm font-bold text-gcs-on-surface">
            {payload?.probe_depth_cm ?? "—"}
            <span className="ml-0.5 text-xs font-normal text-gcs-muted">cm</span>
          </p>
        </div>
      </div>

      {payload?.timestamp && (
        <p className="mt-2 text-right text-xs text-gcs-muted">
          {new Date(payload.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
