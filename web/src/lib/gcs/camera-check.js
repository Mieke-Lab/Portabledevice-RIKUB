// Camera pre-flight for the mapping planner (CameraPreflight / TriggerCamera —
// docs/drone_api.md → "Camera interface").
//
// The drone takes every mapping photo over the FIRST path that works, and there are
// up to five: each PC Wi-Fi adapter (`wifi:<iface>`), the ESP32's own Wi-Fi
// (`esp_wifi`) and, as the last resort, the PWM wire (`wire`). The Wi-Fi paths can
// PROVE a photo was taken (they check the camera's photo list); the wire fires
// blind — the only evidence a wire shot ever gets is the camera's own beep. So the
// pre-flight can end in four very different places:
//
//   verified   a Wi-Fi path works                  → every photo is confirmed
//   wire only  every wireless path is down         → photos are NOT confirmed (operator decides)
//   not ok     no path, or no SD card / card full  → the backend refuses the mission
//   unknown    nobody has looked yet
//
// This module turns the backend's report into what the operator sees and decides.
// Pure — no React, no fetch — so the planner, its dialog and the audit modal share
// one vocabulary.

/** A pre-flight older than this is "old": links drop, so it is re-offered. */
export const CHECK_FRESH_MS = 5 * 60 * 1000;
/** How long a hand test of the wire (beep heard) keeps counting. */
export const WIRE_TEST_FRESH_MS = 60 * 60 * 1000;

/** Severity, mildest first. The UI colours by level; `requireAck` is separate. */
export const LEVELS = ["ok", "unknown", "caution", "warn", "danger", "blocked"];

// --- paths ---------------------------------------------------------------------

export function isWirePath(path) {
  return path?.kind === "wire" || path?.name === "wire";
}

/** `wifi:wlo1` → "Wi-Fi PC (wlo1)"; `esp_wifi` → "Wi-Fi ESP32"; `wire` → "Kabel PWM". */
export function pathLabel(path) {
  const name = path?.name || "";
  if (isWirePath(path)) return "Kabel PWM";
  if (path?.kind === "esp_wifi" || name === "esp_wifi") return "Wi-Fi ESP32";
  const iface = path?.iface || name.replace(/^wifi:/, "");
  return iface ? `Wi-Fi PC (${iface})` : "Wi-Fi PC";
}

/** Label for a bare method name (`wifi:wlo1`, `wire`, `esp_wifi`, `esp`). */
export function methodLabel(method) {
  if (!method) return "—";
  if (method === "esp") return "Kabel PWM (mode lama)";
  return pathLabel({ name: method });
}

/** Per-state wording + tone (`ok` | `warn` | `bad` | `muted`). */
export const PATH_STATE = {
  ready: { label: "Siap", tone: "ok" },
  degraded: { label: "Lambat", tone: "warn" },
  down: { label: "Mati", tone: "bad" },
  blocked: { label: "Dipakai jaringan lain", tone: "muted" },
  missing: { label: "Tidak terpasang", tone: "bad" },
  unsupported: { label: "Tidak didukung", tone: "bad" },
  unverifiable: { label: "Tanpa verifikasi", tone: "warn" },
  unknown: { label: "Belum dicek", tone: "muted" },
};

export function pathStateMeta(state) {
  return PATH_STATE[state] ?? { label: state || "—", tone: "muted" };
}

/** What a path's state means and what to do about it — one or two sentences. */
export function pathAdvice(path) {
  const ms = Number.isFinite(path?.latency_ms) ? path.latency_ms : null;
  const serial = /serial/i.test(String(path?.error || ""));
  switch (path?.state) {
    case "ready":
      return ms != null ? `Menjawab dalam ${ms} ms.` : "Menjawab.";
    case "degraded":
      return `Menjawab tapi lambat${ms != null ? ` (${ms} ms)` : ""} — dipakai paling akhir. "Cek Ulang" menyambungkannya kembali.`;
    case "blocked":
      return path.blocked_by
        ? `Adaptor ini sedang tersambung ke jaringan lain ("${path.blocked_by}") dan sengaja tidak diambil alih. Putuskan jaringan itu atau pakai adaptor lain agar jalur ini aktif.`
        : "Adaptor ini sedang tersambung ke jaringan lain dan sengaja tidak diambil alih.";
    case "missing":
      return "Adaptor tidak terdeteksi — dongle tercabut? Colok ulang, lalu Cek Ulang.";
    case "unsupported":
      return "Firmware ESP32 belum mendukung Wi-Fi kamera — flash ulang dengan firmware terbaru.";
    case "unverifiable":
      return "Hanya mengirim pulsa ke kamera — tidak ada cara memastikan foto benar-benar terambil. Uji dengan telinga: kamera harus berbunyi \"bip\" dan live view membeku sekejap.";
    case "unknown":
      return "Belum diperiksa.";
    case "down":
    default:
      if (isWirePath(path) || path?.kind === "esp_wifi") {
        return serial
          ? "ESP32 tidak terhubung ke komputer drone (USB/serial) — cek kabel USB-nya."
          : isWirePath(path)
            ? "ESP32 tidak bisa memicu kamera lewat kabel — cek sambungan ESP32 dan kabel PWM ke kamera."
            : "ESP32 tidak tersambung ke Wi-Fi kamera atau tidak melihat kamera. Pastikan kamera menyala dan Wi-Fi-nya aktif.";
      }
      return "Tidak tersambung ke Wi-Fi kamera atau kamera tidak menjawab. Pastikan kamera menyala dan Wi-Fi-nya aktif.";
  }
}

/** Display order: the path the next photo uses, its verified backups, the wire, then whatever cannot be used. */
export function orderPaths(paths, method) {
  const rank = (p) => (p.name === method ? 0 : p.usable && p.verified ? 1 : p.usable ? 2 : 3);
  return [...(paths || [])]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/** Role of a path in the next shot: `next` | `backup` | null (cannot be used). */
export function pathRole(path, method) {
  if (path.name === method) return "next";
  return path.usable ? "backup" : null;
}

// --- backend text → Indonesian -----------------------------------------------------

/** The backend's `error` (English, technical) in words an operator can act on. */
export function explainCameraError(error) {
  const e = String(error || "");
  if (!e) return "";
  if (/NO SD CARD/i.test(e)) return "Kamera tidak mendeteksi kartu SD.";
  if (/write-locked/i.test(e)) return "Kartu SD di kamera terkunci (write-protect).";
  if (/no free space|SD card full/i.test(e)) return "Kartu SD di kamera penuh.";
  if (/SD card error/i.test(e)) return "Kartu SD di kamera bermasalah — coba format atau ganti kartunya.";
  if (/photo listing .*takes/i.test(e)) {
    return "Daftar foto di kartu terlalu lambat dibaca (terlalu banyak file) — kosongkan kartu SD dulu.";
  }
  if (/no way to reach the camera/i.test(e)) {
    return "Tidak ada jalur ke kamera: semua Wi-Fi dan kabel tidak bisa dipakai. Pastikan kamera menyala, Wi-Fi kamera aktif dan ESP32 terhubung.";
  }
  return e;
}

/** A backend warning, translated when it is a known one; `null` = covered elsewhere (don't repeat it). */
export function explainCameraWarning(warning) {
  const w = String(warning || "");
  if (!w) return null;
  if (/only the WIRE is available/i.test(w)) return null; // the wire-only banner says it better
  if (/files on the card/i.test(w)) {
    return "Kartu SD berisi banyak file lama — konfirmasi tiap foto jadi makin lambat. Kosongkan kartu SD dulu (foto lama ikut terunduh setelah mendarat).";
  }
  return w;
}

/** The headline version of a warning for the one-line summary ("ada catatan" when it is not a known one). */
function shortWarning(warning) {
  if (/files on the card/i.test(String(warning || ""))) return "kartu SD berisi banyak file lama";
  return "ada catatan";
}

/** Card line for the dialog: `{status: ok|warn|bad, label, detail}` or null when the camera was not asked. */
export function cardInfo(camera) {
  if (!camera || typeof camera !== "object") return null;
  const card = camera.card;
  let status = "ok";
  let label = "Kartu SD OK";
  if (card === 0) { status = "bad"; label = "Tidak ada kartu SD"; }
  else if (card === 2) { status = "bad"; label = "Kartu SD terkunci"; }
  else if (typeof card === "number" && card >= 3024) { status = "bad"; label = "Kartu SD error"; }
  else if (card == null) { status = "warn"; label = "Status kartu tidak dilaporkan"; }
  if (status === "ok" && camera.free_pics === 0) { status = "bad"; label = "Kartu SD penuh"; }
  const bits = [];
  if (Number.isFinite(camera.free_pics)) bits.push(`sisa ± ${camera.free_pics} foto`);
  if (Number.isFinite(camera.photo_count)) bits.push(`${camera.photo_count} file di kartu`);
  if (Number.isFinite(camera.listing_s)) bits.push(`daftar foto ${camera.listing_s.toFixed(1)} dtk`);
  return { status, label, detail: bits.join(" · ") };
}

// --- the live view (Diagnostics.camera) as a pseudo report ----------------------------

/**
 * `Diagnostics.camera` (what the backend's own path monitor knows, refreshed every few
 * seconds) in the shape of a pre-flight report — enough to warn BEFORE anybody pressed
 * "Cek Kamera". It cannot know the SD card, so it never says "ready" on its own.
 * Null while the monitor has not finished its first pass.
 */
export function liveAsReport(live) {
  if (!live || typeof live !== "object") return null;
  if (live.mode === "esp") {
    return { ok: true, mode: "esp", method: "esp", verified: false, wire_only: true, degraded: false, warnings: [], paths: [], live: true };
  }
  const paths = Array.isArray(live.paths) ? live.paths : [];
  if (paths.length === 0) return null;
  if (!live.method && paths.some((p) => p.state === "unknown")) return null;
  const method = live.method || null;
  const wireless = paths.filter((p) => !isWirePath(p));
  return {
    ok: method != null,
    mode: live.mode ?? "wifi",
    method,
    verified: method != null && method !== "wire",
    wire_only: method === "wire",
    degraded: wireless.some((p) => ["down", "missing", "unsupported", "degraded"].includes(p.state)),
    warnings: [],
    error: method ? null : "no way to reach the camera",
    paths,
    camera: null,
    live: true,
  };
}

/**
 * `Diagnostics.camera` at a glance, for the Monitoring panel while a mapping survey flies: the way the next photo takes,
 * whether it will be confirmed and every path's state. Only what the backend's own path monitor knows right now — no SD
 * card (that needs a pre-flight) and no photo counts (the mapping status has those, per mission; `totals` here run for the
 * life of the backend). Null until a camera section exists.
 *
 * Returns `{tone: ok|warn|bad|muted, headline, detail, method, verified, paths[]}`; each path is
 * `{name, label, state, stateLabel, tone, role: next|backup|null, latencyMs}`.
 */
export function liveCameraSummary(live) {
  if (!live || typeof live !== "object") return null;
  if (live.mode === "esp") {
    return { tone: "warn", headline: "Kabel PWM (mode lama)", detail: "Foto tidak terverifikasi — hanya pulsa ke kamera.", method: "esp", verified: false, paths: [] };
  }
  const method = live.method || null;
  const raw = Array.isArray(live.paths) ? live.paths : [];
  const paths = orderPaths(raw, method).map((path) => {
    const meta = pathStateMeta(path.state);
    return {
      name: path.name,
      label: pathLabel(path),
      state: path.state,
      stateLabel: meta.label,
      tone: meta.tone,
      role: pathRole(path, method),
      latencyMs: Number.isFinite(path.latency_ms) ? path.latency_ms : null,
    };
  });
  const base = { method, paths };
  if (!method) {
    if (raw.length === 0 || raw.every((path) => !path.state || path.state === "unknown")) {
      return { ...base, tone: "muted", headline: "Belum dipantau", detail: "Pemantau jalur kamera belum selesai memeriksa.", verified: false };
    }
    return { ...base, tone: "bad", headline: "Kamera tidak terjangkau", detail: "Semua jalur mati — foto tidak bisa dipicu.", verified: false };
  }
  if (method === "wire") {
    return { ...base, tone: "warn", headline: methodLabel(method), detail: "Foto tidak terverifikasi — hanya kabel yang menjangkau kamera.", verified: false };
  }
  const problems = problemPaths(raw).length;
  return {
    ...base,
    tone: problems ? "warn" : "ok",
    headline: methodLabel(method),
    detail: problems ? `Foto terverifikasi · ${problems} jalur bermasalah` : "Foto terverifikasi",
    verified: true,
  };
}

/** How bad the way to the camera is: 0 a Wi-Fi path (or the legacy interface), 1 only the wire, 2 nothing. */
function pathRank(report) {
  if (report.mode === "esp") return 0;
  if (report.ok === false || !report.method) return 2;
  return report.wire_only || report.method === "wire" ? 1 : 0;
}

// --- the assessment -------------------------------------------------------------------

const WIRE_RISK_LINES = [
  "Tidak ada jalur Wi-Fi yang menjangkau kamera — foto dikirim lewat kabel PWM tanpa konfirmasi, jadi foto yang gagal tidak akan ketahuan dan hasil peta bisa berlubang.",
  "Kartu SD dan sisa ruangnya tidak bisa dicek — kartu kosong atau penuh baru ketahuan setelah mendarat.",
];
const ACK_LABEL = "Saya paham: foto hanya lewat kabel dan tidak terverifikasi — titik yang gagal terfoto tidak akan ketahuan.";

function problemPaths(paths) {
  return (paths || []).filter((p) => !isWirePath(p) && ["down", "missing", "unsupported", "degraded"].includes(p.state));
}

function stateWord(state) {
  return { down: "mati", missing: "tidak terpasang", unsupported: "tidak didukung", degraded: "lambat" }[state] ?? state;
}

/**
 * What the operator should see and decide about the camera.
 *
 *   report     the last CameraPreflight response (or the push's `camera_check`), with
 *   checkedAt  when it arrived (ms)
 *   live       Diagnostics.camera and liveAt (ms) when it was fetched — used when there
 *              is no fresh check, and to notice that things changed since the check
 *   wireTest   {at, result: "ok" | "fail" | "error"} — the hand test of the wire
 *
 * Returns {level, source, title, summary, lines[], requireAck, ackLabel, wireOnly, ok,
 * method, report, stale, changed, checkedAt, wireTested}. `level` colours the UI:
 * ok · caution (works, less redundancy) · warn (wire only, hand-tested) · danger (wire
 * only, blind) · blocked (the backend will refuse) · unknown (nobody looked).
 */
export function assessCamera({ report = null, checkedAt = null, live = null, liveAt = null, wireTest = null, now = Date.now() } = {}) {
  const liveReport = liveAsReport(live);
  const age = report && checkedAt != null ? now - checkedAt : null;
  let source = "none";
  let r = null;
  let stale = false;
  let changed = false;

  let improved = false;
  if (report && age != null && age <= CHECK_FRESH_MS) {
    source = "check";
    r = report;
    // The path monitor is newer than the check. If it sees the way to the camera got WORSE, trust it over the
    // check; if better, keep the check's caution and just say so. (A check that failed on the camera itself —
    // no SD card, card full — is not about paths, so the monitor, which cannot see the card, never overrides it.)
    const cameraFault = report.ok === false && report.camera && report.camera.ok === false;
    if (liveReport && liveAt != null && liveAt > checkedAt && !cameraFault) {
      const worse = pathRank(liveReport) > pathRank(report);
      const better = pathRank(liveReport) < pathRank(report);
      if (worse) {
        source = "live";
        r = liveReport;
        changed = true;
      } else if (better) {
        improved = true;
      }
    }
  } else if (liveReport) {
    source = "live";
    r = liveReport;
    stale = !!report; // there was a check, but it is old
  } else if (report) {
    // Old check and nothing fresher to go on.
    return {
      level: "unknown", source: "check", title: "Hasil pemeriksaan sudah lama",
      summary: "Hasil pemeriksaan sudah lama — cek ulang", lines: ["Pemeriksaan kamera terakhir sudah lebih dari 5 menit; link Wi-Fi bisa berubah. Cek ulang sebelum terbang."],
      requireAck: false, ackLabel: "", wireOnly: false, ok: null, method: null, report, stale: true, changed: false, checkedAt, wireTested: null,
    };
  }

  if (!r) {
    return {
      level: "unknown", source: "none", title: "Kamera belum dicek",
      summary: "Belum dicek — tekan \"Cek Kamera\"", lines: [],
      requireAck: false, ackLabel: "", wireOnly: false, ok: null, method: null, report: null, stale: false, changed: false, checkedAt: null, wireTested: null,
    };
  }

  const tested = wireTest && Number.isFinite(wireTest.at) && now - wireTest.at < WIRE_TEST_FRESH_MS ? wireTest.result : null;
  const head = []; // what changed since the check: leads
  const tail = []; // context: trails the real findings (the audit banner only has room for the first two lines)
  const prefix = source === "live" ? "Live: " : "";
  const base = { source, report: r, stale, changed, checkedAt, wireTested: tested, method: r.method ?? null, ok: r.ok !== false };
  if (changed) head.push("Kondisi kamera memburuk sejak pemeriksaan terakhir — tekan \"Cek Kamera\" untuk memeriksa ulang.");
  if (improved) head.push("Pemantauan langsung melihat jalur ke kamera membaik sejak pemeriksaan ini — tekan \"Cek Kamera\" untuk memastikan.");
  if (stale) tail.push("Pemeriksaan kamera terakhir sudah lama — angka di atas dari pemantauan langsung, belum termasuk cek kartu SD.");
  if (r.cached) tail.push("Drone sedang ARMED — ini hasil terakhir, bukan pemeriksaan baru.");

  // The legacy blind-pulse interface: nothing is ever verified.
  if (r.mode === "esp") {
    return {
      ...base, level: "danger", title: "Mode kamera lama — foto tidak terverifikasi",
      summary: `${prefix}Mode kamera lama: foto tidak terverifikasi`,
      lines: [...head, "Backend memakai antarmuka kamera lama: setiap foto hanya pulsa ke kamera tanpa verifikasi dan tanpa cek kartu SD.", "Pakai SOEROGIS_CAMERA_INTERFACE_MODE=wifi di backend agar foto dikonfirmasi.", ...tail],
      requireAck: true, ackLabel: ACK_LABEL, wireOnly: true,
    };
  }

  // Nothing works, or the camera cannot shoot: the backend refuses the mission.
  if (r.ok === false || !r.method) {
    const why = explainCameraError(r.error) || "Tidak ada jalur ke kamera.";
    return {
      ...base, level: "blocked", ok: false, title: "Kamera TIDAK siap",
      summary: `${prefix}Kamera tidak siap — ${why}`,
      lines: [...head, why, "Server akan menolak misi sampai masalah ini beres.", ...tail],
      requireAck: false, wireOnly: false,
    };
  }

  // Only the wire is left.
  if (r.wire_only || r.method === "wire") {
    if (tested === "ok") {
      return {
        ...base, level: "warn", wireOnly: true, title: "Hanya lewat kabel — kabel sudah diuji",
        summary: `${prefix}Hanya kabel (sudah diuji bip) — foto tidak terverifikasi`,
        lines: [...head, "Kabel sudah kamu uji dengan telinga: kamera berbunyi dan membeku.", ...WIRE_RISK_LINES, ...tail],
        requireAck: false, ackLabel: "",
      };
    }
    const failed = tested === "fail" || tested === "error";
    return {
      ...base, level: "danger", wireOnly: true,
      title: failed ? "Kabel TIDAK terbukti bekerja" : "HANYA KABEL — foto tidak terverifikasi",
      summary: failed
        ? `${prefix}Hanya kabel, dan kabel gagal diuji — kamera tidak berbunyi`
        : `${prefix}HANYA KABEL — foto tidak terverifikasi!`,
      lines: [
        ...head,
        ...(failed
          ? ["Pada uji terakhir kamera tidak berbunyi / tidak membeku. Periksa sambungan kabel PWM dari ESP32 ke kamera dan pastikan kamera dalam mode foto."]
          : []),
        ...WIRE_RISK_LINES,
        ...tail,
      ],
      requireAck: true, ackLabel: ACK_LABEL,
    };
  }

  // A Wi-Fi path works: every photo will be confirmed.
  const problems = problemPaths(r.paths);
  const rawWarnings = (r.warnings || []).concat((r.camera && r.camera.warnings) || []).filter((w) => explainCameraWarning(w));
  const warnings = rawWarnings.map(explainCameraWarning);
  const backups = Array.isArray(r.fallbacks) ? r.fallbacks.length : (r.paths || []).filter((p) => p.usable && p.name !== r.method).length;
  const label = methodLabel(r.method);
  const uniqueWarnings = [...new Set(warnings)];
  if (problems.length === 0 && uniqueWarnings.length === 0 && !r.degraded) {
    // The path monitor alone cannot see the SD card, so without a real check "all paths up" is a hint, not a green light.
    if (source === "live") {
      return {
        ...base, level: "unknown", wireOnly: false, title: "Kamera belum dicek",
        summary: `Belum dicek — terpantau siap lewat ${label}`,
        lines: [...head, "Pemantauan langsung melihat jalur ke kamera siap, tapi kartu SD belum diperiksa. Tekan \"Cek Kamera\".", ...tail],
        requireAck: false,
      };
    }
    return {
      ...base, level: "ok", wireOnly: false, title: "Kamera siap",
      summary: `${prefix}Foto terverifikasi lewat ${label}${backups > 0 ? ` · ${backups} jalur cadangan` : ""}`,
      lines: [...head, `Setiap foto dicek langsung ke daftar foto kamera lewat ${label}. Jika jalurnya putus di tengah misi, drone otomatis pindah ke ${backups > 0 ? "jalur cadangan" : "jalur lain"}.`, ...tail],
      requireAck: false,
    };
  }
  return {
    ...base, level: "caution", wireOnly: false, title: "Kamera siap, tapi ada yang perlu diperhatikan",
    summary: problems.length
      ? `${prefix}Foto lewat ${label}, tapi ${problems.length} jalur bermasalah`
      : `${prefix}Foto lewat ${label} — ${shortWarning(warnings.length ? rawWarnings[0] : "")}`,
    lines: [
      ...head,
      ...problems.map((p) => `${pathLabel(p)} ${stateWord(p.state)} — cadangan berkurang.`),
      ...uniqueWarnings,
      ...tail,
    ],
    requireAck: false,
  };
}

// --- small formatting helpers ---------------------------------------------------------

export function formatClock(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(/\./g, ":");
}

export function ageLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "baru saja";
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  return `${Math.round(s / 3600)} jam lalu`;
}
