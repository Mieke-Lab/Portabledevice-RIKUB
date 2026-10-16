import { Link } from "react-router-dom";

const statusStyles = {
  "in progress": "bg-gcs-secondary-fixed text-gcs-on-secondary-fixed",
  ready: "bg-gcs-primary/15 text-gcs-primary",
  queued: "bg-slate-200 text-slate-600",
  error: "bg-gcs-error/15 text-gcs-error",
};

export function MapCard({ id, title, date, area, status, imageUrl }) {
  return (
    <div className="glass-panel group flex flex-col overflow-hidden rounded-xl transition-all hover:border-gcs-primary">
      <Link to={`/drone-dashboard/mapping/${id}`} className="relative block h-40 overflow-hidden bg-[#1e293b]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-110 group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-white/20">map</span>
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="truncate font-headline text-xl uppercase text-gcs-on-surface">
            {title}
          </h3>
        </div>

        <div className="mb-4 flex items-center gap-2 text-gcs-muted">
          <span className="material-symbols-outlined text-sm">calendar_today</span>
          <span className="font-data text-sm">{date}</span>
        </div>

        <div className="mt-auto">
          <div className="mb-4 flex items-center justify-between">
            <span className={`rounded px-2 py-0.5 font-technical text-[10px] font-bold uppercase shadow-sm ${statusStyles[status]}`}>
              {status}
            </span>
            <div className="text-right">
              <p className="font-technical text-[9px] uppercase leading-none text-gcs-muted">Coverage</p>
              <p className="font-data text-base leading-none text-gcs-on-surface">
                {area} <span className="text-xs font-light text-gcs-muted">Ha</span>
              </p>
            </div>
          </div>

          <div className="flex justify-end border-t border-white/30 pt-3">
            <Link
              to={`/drone-dashboard/mapping/${id}`}
              className="flex items-center gap-2 rounded bg-gcs-primary/5 px-3 py-1.5 font-technical text-[11px] font-bold uppercase tracking-wider text-gcs-primary transition-colors hover:bg-gcs-primary hover:text-white"
            >
              <span>View Job</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
