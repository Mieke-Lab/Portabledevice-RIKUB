import { Link } from "react-router-dom";

const STATUS_META = {
  uploading: { label: "Uploading", icon: "☁️", tone: "primary" },
  unstitched: { label: "Unstitched", icon: "🖼️", tone: "muted" },
  stitching: { label: "Stitching", icon: "⚙️", tone: "primary" },
  clustering: { label: "Clustering", icon: "🔬", tone: "primary" },
  ready: { label: "Ready", icon: "✅", tone: "green" },
  failed: { label: "Failed", icon: "❌", tone: "error" },
  canceled: { label: "Canceled", icon: "🚫", tone: "muted" },
};

const BADGE_TONE = {
  primary: "bg-gcs-primary/20 text-gcs-primary",
  green: "bg-green-100 text-green-700",
  error: "bg-gcs-error/20 text-gcs-error",
  muted: "bg-gcs-bg text-gcs-muted/70",
};

const PROCESSING_STATUSES = ["uploading", "stitching", "clustering"];

function IdleCard({ fallbackName }) {
  return (
    <div className="glass-panel flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center">
      <span className="material-symbols-outlined text-5xl text-gcs-muted/60">
        do_not_disturb_on
      </span>
      <h2 className="font-data text-xl font-bold uppercase tracking-wide text-gcs-muted">
        {fallbackName ?? "No Active Mission"}
      </h2>
      <p className="font-technical text-sm text-gcs-muted/75">
        Drone is idle — no mapping mission running.
      </p>
    </div>
  );
}

export function ActiveMissionCard({ jobId, job, loading, error, fallbackName }) {
  if (!jobId) return <IdleCard fallbackName={fallbackName} />;

  if (loading) {
    return (
      <div className="glass-panel flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gcs-primary/30 border-t-gcs-primary" />
        <p className="font-technical text-sm text-gcs-muted">Loading mission…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center">
        <p className="text-2xl">⚠️</p>
        <p className="font-technical text-sm text-gcs-error">{error}</p>
        <IdleCard fallbackName={fallbackName} />
      </div>
    );
  }

  if (!job) return <IdleCard fallbackName={fallbackName} />;

  const meta = STATUS_META[job.status] ?? { label: job.status, icon: "•", tone: "muted" };
  const badgeCls = BADGE_TONE[meta.tone] ?? BADGE_TONE.muted;
  const isProcessing = PROCESSING_STATUSES.includes(job.status);
  const pct = isProcessing ? Math.round((job.progress ?? 0) * 100) : 0;

  return (
    <div className="glass-panel flex min-h-48 flex-col gap-4 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-technical text-xs uppercase tracking-wide text-gcs-muted">
            Active Job
          </p>
          <h2
            className="truncate font-data text-xl font-bold text-gcs-on-surface"
            title={job.name || job.id}
          >
            {job.name || job.id}
          </h2>
          {job.area_name && (
            <p className="mt-0.5 truncate text-xs text-gcs-muted">{job.area_name}</p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 font-technical text-xs font-bold uppercase ${badgeCls}`}
        >
          <span>{meta.icon}</span>
          {meta.label}
        </span>
      </div>

      {isProcessing && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-gcs-muted">
            <span>
              {meta.label === "Stitching" ? "Stitching orthophoto…" : "Processing…"}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gcs-bg">
            <div
              className="h-full rounded-full bg-gcs-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2 text-xs">
        {job.area_m2 != null && (
          <div className="rounded-lg bg-white/20 p-2">
            <p className="text-gcs-muted">Area</p>
            <p className="font-semibold text-gcs-on-surface">
              {(job.area_m2 / 10_000).toFixed(2)} ha
            </p>
          </div>
        )}
        {job.image_count > 0 && (
          <div className="rounded-lg bg-white/20 p-2">
            <p className="text-gcs-muted">Images</p>
            <p className="font-semibold text-gcs-on-surface">{job.image_count}</p>
          </div>
        )}
      </div>

      {job.status === "ready" && (
        <Link
          to={`/drone-dashboard/mapping/${job.id}`}
          className="block w-full rounded-xl bg-gcs-primary py-2 text-center text-sm font-semibold text-white transition hover:bg-gcs-primary/80"
        >
          View Results →
        </Link>
      )}
    </div>
  );
}
