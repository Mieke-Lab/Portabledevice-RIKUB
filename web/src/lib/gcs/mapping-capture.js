// Helpers for the `capture` block of a drone-flown mapping session
// (docs/mapping.md → "`capture` block — flight state of a mapping mission").
//
// A mapping session's `status` tracks the ODM pipeline only (unstitched →
// stitching → clustering → ready) and sits at `unstitched` for the whole flight;
// where the *flight* has got to is `capture.state`. Client-created sessions have
// no capture block (absent or `{}`), so every helper here is null-safe and treats
// those as "not a drone session".
//
// Pure module — no React, no Leaflet — so the list, detail and planner pages (and
// tests) share one vocabulary for labels, resumability and progress.

import { applyOffsetToCoords } from "@/lib/gcs/gps-offset";

/** capture.state → UI meta. `busy` = the aircraft / backend is still working on
 *  this leg; `resumable` = ResumeMappingMission will fly the remaining points. */
export const CAPTURE_STATE_META = {
  armed: { label: "Siap Terbang", tone: "bg-harvest/15 text-harvest", dot: "bg-harvest", busy: true, resumable: true },
  flying: { label: "Sedang Terbang", tone: "bg-sky-500/15 text-sky-700", dot: "bg-sky-500", busy: true, resumable: false },
  returning: { label: "Kembali & Mendarat", tone: "bg-sky-500/15 text-sky-700", dot: "bg-sky-500", busy: true, resumable: false },
  processing: { label: "Mengamankan Foto", tone: "bg-harvest/15 text-harvest", dot: "bg-harvest", busy: true, resumable: false },
  paused: { label: "Dijeda", tone: "bg-amber-500/15 text-amber-700", dot: "bg-amber-500", busy: false, resumable: true },
  done: { label: "Foto Lengkap", tone: "bg-leaf/15 text-forest", dot: "bg-emerald-500", busy: false, resumable: false },
  failed: { label: "Leg Gagal", tone: "bg-destructive/10 text-destructive", dot: "bg-red-500", busy: false, resumable: true },
  canceled: { label: "Misi Dibatalkan", tone: "bg-muted text-muted-foreground", dot: "bg-slate-400", busy: false, resumable: false },
  interrupted: { label: "Terputus", tone: "bg-amber-500/15 text-amber-700", dot: "bg-amber-500", busy: false, resumable: true },
};

/** States from which `ResumeMappingMission` starts a new leg (docs/mapping.md). */
export const RESUMABLE_STATES = new Set(["paused", "interrupted", "armed", "failed"]);
/** States where the aircraft is (or is about to be) in the air, or the backend is
 *  still draining the camera — nothing about the session may be touched yet. */
export const IN_FLIGHT_STATES = new Set(["armed", "flying", "returning", "processing"]);
/** States where `PauseMappingMission` makes sense (a leg can be cut short). */
export const PAUSABLE_STATES = new Set(["armed", "flying"]);

/** `MappingMissionStatus.phase` (per-leg live view). Both vocabularies are
 *  accepted: the pre-pause one (idle/arming/capturing/complete) and the
 *  capture.state one the backend reports since pause/resume landed. */
export const MISSION_PHASE_LABEL = {
  idle: "Menunggu",
  arming: "Mempersiapkan",
  armed: "Siap Terbang",
  capturing: "Memotret",
  flying: "Memotret",
  returning: "Kembali & Mendarat",
  processing: "Mengamankan Foto",
  paused: "Dijeda",
  complete: "Selesai",
  done: "Selesai",
  failed: "Gagal",
  canceled: "Dibatalkan",
  interrupted: "Terputus",
};
/** Phases after which the per-leg poll can stop. `idle`/`arming` are NOT here —
 *  they show up before the mission spins up. */
export const MISSION_TERMINAL_PHASES = new Set(["complete", "done", "failed", "canceled", "paused", "interrupted"]);

export function captureStateMeta(state) {
  return CAPTURE_STATE_META[state] ?? { label: state || "—", tone: "bg-muted text-muted-foreground", dot: "bg-slate-400", busy: false, resumable: false };
}

export function missionPhaseLabel(phase) {
  return MISSION_PHASE_LABEL[phase] ?? (phase || "—");
}

/** The session's capture block, or null for a client-created session (absent,
 *  `{}`, or no `points`). */
export function captureOf(job) {
  const c = job?.capture;
  if (!c || typeof c !== "object") return null;
  if (!Array.isArray(c.points) || c.points.length === 0) return null;
  return c;
}

export function isCaptureSession(job) {
  return captureOf(job) !== null;
}

/** `capture.active`: the mapping monitor owns this folder right now. While true
 *  the backend refuses StartStitching / CancelJob / RemoveJob (409). */
export function isCaptureActive(job) {
  return captureOf(job)?.active === true;
}

/** The flight is still going (or the backend is still securing its frames). */
export function isCaptureInFlight(job) {
  const c = captureOf(job);
  if (!c) return false;
  return c.active === true || IN_FLIGHT_STATES.has(c.state);
}

/** ResumeMappingMission will fly the remaining points. */
export function isCaptureResumable(job) {
  const c = captureOf(job);
  return !!c && RESUMABLE_STATES.has(c.state) && progressOf(c).remaining > 0;
}

/** PauseMappingMission would end this leg early. */
export function isCapturePausable(job) {
  const c = captureOf(job);
  return !!c && c.active === true && PAUSABLE_STATES.has(c.state);
}

/** A session the operator still has to do something about — shown in the
 *  "ongoing missions" tray so a half-flown survey can't get lost. */
export function needsAttention(job) {
  return isCaptureInFlight(job) || isCaptureResumable(job);
}

function indexSet(list) {
  const out = new Set();
  if (!Array.isArray(list)) return out;
  for (const i of list) if (Number.isInteger(i) && i >= 0) out.add(i);
  return out;
}

function progressOf(c) {
  const total = c.points.length;
  const capturedSet = indexSet(c.captured);
  const pendingSet = indexSet(c.pending);
  for (const i of capturedSet) pendingSet.delete(i); // a point is never both
  let captured = 0;
  let pending = 0;
  const remainingIndices = [];
  for (let i = 0; i < total; i++) {
    if (capturedSet.has(i)) captured++;
    else if (pendingSet.has(i)) pending++;
    else remainingIndices.push(i);
  }
  // `remaining` is what a resume flies: everything not yet *secured*. Pending
  // points are re-flown too if their leg fails, so count them as not-done.
  const remaining = total - captured;
  const photographed = captured + pending;
  return {
    total,
    captured,
    pending,
    photographed,
    remaining,
    remainingIndices,
    pct: total > 0 ? Math.min(100, Math.round((photographed / total) * 100)) : 0,
    securedPct: total > 0 ? Math.min(100, Math.round((captured / total) * 100)) : 0,
  };
}

/**
 * Progress counters for a capture session.
 *  - captured:     indices secured on disk + geotagged + converted (done for good)
 *  - pending:      photographed this leg, not yet secured (promoted on landing)
 *  - photographed: captured + pending — what to show as "N/M foto" during a flight
 *  - remaining:    total − captured — what a resume would fly
 * Returns zeros for a non-capture session.
 */
export function captureProgress(job) {
  const c = captureOf(job);
  if (!c) return { total: 0, captured: 0, pending: 0, photographed: 0, remaining: 0, remainingIndices: [], pct: 0, securedPct: 0 };
  return progressOf(c);
}

/** "captured" | "pending" | "remaining" for point index `i`. */
export function capturePointStatus(job, i) {
  const c = captureOf(job);
  if (!c) return "remaining";
  if (indexSet(c.captured).has(i)) return "captured";
  if (indexSet(c.pending).has(i)) return "pending";
  return "remaining";
}

/**
 * The plan's points for display on the map, each tagged with its status and
 * original index. `capture.points` were pushed in the drone's (drifted) GPS
 * frame (command = planned − Δ, see gps-offset.js), so they go back through
 * +Δ to sit where they belong on the imagery. Pass the current offset (or
 * nothing / ZERO_OFFSET to skip).
 * @returns {Array<{lat:number,lng:number,index:number,status:"captured"|"pending"|"remaining"}>}
 */
export function capturePointsForDisplay(job, offset) {
  const c = captureOf(job);
  if (!c) return [];
  const capturedSet = indexSet(c.captured);
  const pendingSet = indexSet(c.pending);
  return c.points.map((raw, index) => {
    const p = (offset ? applyOffsetToCoords(raw, offset) : raw) || {};
    return {
      lat: Number(p.lat),
      lng: Number(Number.isFinite(p.lng) ? p.lng : p.lon),
      index,
      status: capturedSet.has(index) ? "captured" : pendingSet.has(index) ? "pending" : "remaining",
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** The points a resume will fly (not secured), in plan order, display frame. */
export function remainingCapturePointsForDisplay(job, offset) {
  return capturePointsForDisplay(job, offset).filter((p) => p.status !== "captured");
}

/** Short human line for a card / tray row, e.g. "Leg 2 · 8/20 foto". */
export function captureSummary(job) {
  const c = captureOf(job);
  if (!c) return "";
  const p = progressOf(c);
  const leg = Number.isInteger(c.leg) && c.leg > 0 ? `Leg ${c.leg} · ` : "";
  return `${leg}${p.photographed}/${p.total} foto`;
}
