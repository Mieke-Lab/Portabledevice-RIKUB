export function DroneMap({ coords, headingDeg, active, label }) {
  const hasGps = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);

  return (
    <div className="glass-panel relative overflow-hidden rounded-2xl border-2 border-white/50 bg-slate-200">
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/35 to-transparent px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <span className="material-symbols-outlined">my_location</span>
          <h2 className="font-data text-lg font-bold uppercase tracking-wide">Live Location</h2>
        </div>
        <span className="rounded-full bg-white/85 px-3 py-1 font-technical text-xs font-bold uppercase text-gcs-muted">
          {active ? label || "Mission active" : "Idle"}
        </span>
      </div>

      <div className="relative aspect-video bg-[radial-gradient(circle,_rgba(0,91,179,0.16)_1px,_transparent_1px)] [background-size:24px_24px]">
        {hasGps ? (
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-gcs-primary/30" />
            <svg
              width="38"
              height="38"
              viewBox="-19 -19 38 38"
              className="relative drop-shadow"
              style={{ transform: `rotate(${headingDeg ?? 0}deg)` }}
            >
              <path
                d="M0,-14 L10,12 L0,6 L-10,12 Z"
                fill="#005bb3"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gcs-muted">
            <span className="material-symbols-outlined animate-pulse text-5xl">gps_off</span>
            <span className="font-data text-sm uppercase tracking-wide">Awaiting GPS fix</span>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/40 to-transparent px-4 py-3 font-technical text-xs text-white">
        <span>
          <span className="opacity-70">LAT/LON </span>
          <span className="font-bold">
            {hasGps ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "-"}
          </span>
        </span>
        <span>
          <span className="opacity-70">HDG </span>
          <span className="font-bold">{headingDeg == null ? "-" : `${headingDeg.toFixed(0)} deg`}</span>
        </span>
      </div>
    </div>
  );
}
