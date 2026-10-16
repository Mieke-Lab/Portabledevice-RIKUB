import L from "leaflet";

// Shared look for a *planned* coverage path so both planners read the same at a
// glance: the spray route on /flight-plan and the survey route on /mapping/plan
// are one emerald line with an "S" flag planted on the first waypoint and an
// "E" flag on the last. interactive:false so map taps (drawing) pass through.
export const COVERAGE_PATH_STYLE = {
  color: "#059669",
  weight: 3,
  opacity: 0.95,
  interactive: false,
};

/**
 * Start / end waypoint flag.
 * @param {"start"|"end"} kind green "S" for the first waypoint, red "E" for the last
 */
export function flagIcon(kind) {
  const color = kind === "start" ? "#16a34a" : "#dc2626";
  const label = kind === "start" ? "S" : "E";
  return L.divIcon({
    className: "",
    iconSize: [30, 38],
    iconAnchor: [4, 36], // bottom of the pole, so the flag "plants" on the waypoint
    html: `<div style="position:relative;width:30px;height:38px">
      <div style="position:absolute;left:3px;top:0;width:2px;height:36px;background:#0f172a;border-radius:1px"></div>
      <div style="position:absolute;left:5px;top:1px;width:18px;height:14px;background:${color};border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900;font-family:sans-serif">${label}</div>
    </div>`,
  });
}
