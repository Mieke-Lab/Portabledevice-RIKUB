import { Link, useLocation } from "react-router-dom";

const NAV = [
  ["/drone-dashboard", "analytics", "Dashboard"],
  ["/drone-dashboard/mapping", "map", "Mapping"],
  ["/drone-dashboard/spraying", "water_drops", "Spraying"],
  ["/drone-dashboard/flight-test", "science", "Flight Test"],
  ["/drone-dashboard/copilot", "chat", "Copilot"],
  ["/drone-dashboard/drone-settings", "drone_2", "Drone Settings"],
];

const FOOTER = [
  ["/drone-dashboard/logs", "terminal", "System Logs"],
  ["/drone-dashboard/settings", "settings", "Settings"],
];

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-64 shrink-0 flex-col border-r border-gcs-outline/20 bg-white/70 p-6 backdrop-blur-xl md:flex">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-gcs-primary text-white">
            <span className="material-symbols-outlined text-2xl">flight_takeoff</span>
          </div>
          <div>
            <h2 className="font-headline text-2xl leading-none text-gcs-primary">GCS Console</h2>
            <p className="font-technical text-[12px] font-medium text-gcs-muted">
              Bayucaraka Systems
            </p>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {NAV.map(([to, icon, label]) => (
          <NavItem key={to} to={to} icon={icon} label={label} active={isActive(pathname, to)} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-gcs-outline/30 pt-4">
        {FOOTER.map(([to, icon, label]) => (
          <NavItem key={to} to={to} icon={icon} label={label} active={isActive(pathname, to)} />
        ))}
        <button className="mt-4 w-full rounded-xl bg-gcs-error py-4 font-headline text-xl uppercase text-white shadow-lg transition-all hover:shadow-red-900/20 active:scale-[0.98]">
          EMERGENCY STOP
        </button>
      </div>
    </aside>
  );
}

function isActive(pathname, to) {
  return to === "/drone-dashboard" ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}

function NavItem({ to, icon, label, active }) {
  return (
    <Link
      to={to}
      className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-all ${
        active
          ? "border-l-4 border-gcs-primary bg-gcs-primary/10 font-bold text-gcs-primary"
          : "text-gcs-muted hover:bg-gcs-primary/5 hover:text-gcs-primary"
      }`}
    >
      <span className="material-symbols-outlined" style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}>
        {icon}
      </span>
      <span className="font-body text-base">{label}</span>
    </Link>
  );
}
