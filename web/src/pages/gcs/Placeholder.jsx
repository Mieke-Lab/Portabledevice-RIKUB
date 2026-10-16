export function GcsModePage({ title, subtitle, icon = "construction" }) {
  return (
    <div>
      <h1 className="mb-4 font-headline text-4xl uppercase text-gcs-primary">{title}</h1>
      <p className="font-data text-xl text-gcs-muted">{subtitle}</p>
    </div>
  );
}

export function GcsPlannerShell({ title, phases, activePhase = 1, icon = "route" }) {
  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[640px] flex-col gap-4">
      <div className="glass-panel flex items-center justify-between rounded-2xl px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button className="grid h-10 w-10 place-items-center rounded-lg bg-white/60 text-gcs-muted">
            <span className="material-symbols-outlined">close</span>
          </button>
          <div>
            <h1 className="font-headline text-2xl uppercase tracking-tight text-gcs-primary">{title}</h1>
            <p className="font-technical text-xs uppercase tracking-wide text-gcs-muted">
              Phase {activePhase} of {phases.length}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {phases.map((phase) => (
            <div
              key={phase.id}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 font-technical text-xs font-bold uppercase tracking-wide ${
                phase.id === activePhase
                  ? "bg-gcs-primary text-white"
                  : "bg-white/50 text-gcs-muted"
              }`}
            >
              <span className="material-symbols-outlined text-base">{phase.icon}</span>
              {phase.label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="glass-panel relative overflow-hidden rounded-2xl border-2 border-white/50">
          <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(0,91,179,0.14)_1px,_transparent_1px)] [background-size:24px_24px]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gcs-muted">
            <span className="material-symbols-outlined text-6xl text-gcs-primary/40">{icon}</span>
            <p className="font-technical text-sm uppercase tracking-wide">Workspace ready</p>
          </div>
        </div>
        <aside className="glass-panel flex flex-col rounded-2xl p-5">
          <h3 className="border-b border-white/30 pb-2 font-headline text-xl uppercase tracking-tight text-gcs-primary">
            Configuration
          </h3>
          <div className="mt-4 grid gap-3">
            {phases.map((phase) => (
              <div key={phase.id} className="rounded-xl bg-white/50 p-3">
                <div className="flex items-center gap-2 font-headline text-sm uppercase tracking-tight text-gcs-on-surface">
                  <span className="material-symbols-outlined text-gcs-primary">{phase.icon}</span>
                  {phase.label}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
