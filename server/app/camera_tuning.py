"""Manual camera tuning for the 'Siang Terik Sawah' preset on the UVC webcam.

The webcam is driven through V4L2 controls (`v4l2-ctl`), which can be changed while
the MJPEG preview stream in routes/camera.py holds the device open - so slider moves
show up in the live preview immediately.

The original spec targets Picamera2; this webcam only exposes a subset. What exists is
detected from the driver at runtime (never assumed) and mapped:
    ExposureValue      -> manual exposure_time_absolute (EV emulated, see camera_config.json)
    ColourGains R/B    -> not supported; white_balance_temperature (Kelvin) instead
    LensPosition       -> focus_absolute steps (only if the driver exposes it)
Every range/default comes from server/camera_config.json.
"""

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = SERVER_DIR / "camera_config.json"
DEFAULT_PREVIEW_FPS = 20  # what "Reset kamera" puts preview.fps back to
AUTO_CONTROLS = ("auto_exposure", "white_balance_automatic", "focus_automatic_continuous")

# `v4l2-ctl --list-ctrls` line, e.g.
#   exposure_time_absolute 0x009a0902 (int)    : min=78 max=10000 step=1 default=312 value=312 flags=inactive
_CTRL_LINE = re.compile(r"^\s*(\w+)\s+0x[0-9a-f]+\s+\((\w+)\)\s*:\s*(.*)$")

# Spec controls this webcam cannot provide, reported to the UI instead of silently dropped.
UNSUPPORTED = [
    {"control": "ColourGains R/B", "reason": "Webcam UVC tidak punya gain warna per kanal.",
     "alternative": "White balance manual (Kelvin)"},
    {"control": "LensPosition (dioptri)", "reason": "Fokus webcam dalam langkah 0-15, bukan dioptri.",
     "alternative": "Fokus manual (langkah)"},
]

# Last values set through this module. The driver can report exposure/WB/focus back,
# but not the EV we derived them from, so the slider state is kept here.
_state: dict[str, float | int] = {}


class CameraControlError(RuntimeError):
    """A V4L2 control call failed - surfaced to the UI as-is, never swallowed."""


_config_cache: tuple[float, dict] | None = None


def load_config() -> dict:
    """Parsed camera_config.json, re-read only when the file changes (the preview loop
    calls this every frame; edits still take effect without a restart)."""
    global _config_cache
    try:
        mtime = CONFIG_PATH.stat().st_mtime
        if _config_cache is None or _config_cache[0] != mtime:
            _config_cache = (mtime, json.loads(CONFIG_PATH.read_text()))
        return _config_cache[1]
    except (OSError, json.JSONDecodeError) as exc:
        raise CameraControlError(f"Konfigurasi kamera tidak valid ({CONFIG_PATH.name}): {exc}") from exc


def _v4l2(device: str, *args: str) -> str:
    try:
        proc = subprocess.run(
            ["v4l2-ctl", "-d", device, *args], capture_output=True, text=True, timeout=5
        )
    except FileNotFoundError as exc:
        raise CameraControlError("v4l2-ctl tidak terpasang (paket v4l-utils).") from exc
    except subprocess.TimeoutExpired as exc:
        raise CameraControlError(f"Kamera {device} tidak merespon (timeout).") from exc
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout).strip() or f"exit {proc.returncode}"
        raise CameraControlError(f"Kontrol kamera gagal di {device}: {msg}")
    return proc.stdout


def list_controls(device: str) -> dict[str, dict]:
    """Every control the driver exposes: {name: {type, min, max, step, default, value, flags}}."""
    controls: dict[str, dict] = {}
    for line in _v4l2(device, "--list-ctrls").splitlines():
        match = _CTRL_LINE.match(line)
        if not match:
            continue
        name, ctype, rest = match.groups()
        info: dict = {"type": ctype}
        for key, value in re.findall(r"(\w+)=(\S+)", rest):
            info[key] = int(value) if re.fullmatch(r"-?\d+", value) else value
        controls[name] = info
    return controls


def _set(device: str, values: dict[str, int]) -> None:
    if values:
        _v4l2(device, "-c", ",".join(f"{k}={v}" for k, v in values.items()))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def ev_to_exposure_units(ev: float, cfg: dict, ctrl: dict) -> int:
    units = round(cfg["exposure"]["reference_units"] * 2 ** ev)
    return int(_clamp(units, ctrl.get("min", 1), ctrl.get("max", units)))


def _sliders(cfg: dict, controls: dict) -> dict:
    exp, wb, focus = cfg["exposure"], cfg["white_balance"], cfg["focus"]
    return {
        "ev": {
            "label": "Exposure (EV)",
            "min": exp["ev_min"], "max": exp["ev_max"], "step": exp["ev_step"], "default": exp["ev_default"],
            "supported": "exposure_time_absolute" in controls and "auto_exposure" in controls,
        },
        "wb_temperature": {
            "label": "White balance (K)",
            "min": wb["min"], "max": wb["max"], "step": wb["step"], "default": wb["default"],
            "supported": "white_balance_temperature" in controls and "white_balance_automatic" in controls,
        },
        "focus": {
            "label": "Fokus",
            "min": focus["min"], "max": focus["max"], "step": focus["step"], "default": focus["default"],
            "supported": "focus_absolute" in controls,
        },
    }


def status() -> dict:
    """Slider definitions (with support flags), current values and the driver's read-back."""
    cfg = load_config()
    device = cfg["device"]
    controls = list_controls(device)
    sliders = _sliders(cfg, controls)
    for key, slider in sliders.items():
        slider["value"] = _state.get(key, slider["default"])
    readback_keys = (
        "auto_exposure", "exposure_time_absolute", "white_balance_automatic",
        "white_balance_temperature", "focus_automatic_continuous", "focus_absolute",
    )
    return {
        "device": device,
        "sliders": sliders,
        "manual": bool(_state),
        "unsupported": UNSUPPORTED,
        "driver": {k: controls[k].get("value") for k in readback_keys if k in controls},
    }


def apply(values: dict) -> dict:
    """Apply any subset of {ev, wb_temperature, focus}. Auto modes are switched off first
    (UVC rejects absolute values while its auto mode owns the control)."""
    cfg = load_config()
    device = cfg["device"]
    controls = list_controls(device)
    sliders = _sliders(cfg, controls)

    modes: dict[str, int] = {}
    targets: dict[str, int] = {}
    for key, raw in values.items():
        if raw is None or key not in sliders:
            continue
        slider = sliders[key]
        if not slider["supported"]:
            raise CameraControlError(f"'{slider['label']}' tidak didukung kamera ini.")
        value = round(_clamp(float(raw), slider["min"], slider["max"]), 2)
        if key == "ev":
            modes["auto_exposure"] = 1  # 1 = Manual Mode
            targets["exposure_time_absolute"] = ev_to_exposure_units(
                value, cfg, controls["exposure_time_absolute"])
        elif key == "wb_temperature":
            modes["white_balance_automatic"] = 0
            targets["white_balance_temperature"] = int(value)
        elif key == "focus":
            if "focus_automatic_continuous" in controls:
                modes["focus_automatic_continuous"] = 0
            targets["focus_absolute"] = int(value)
        _state[key] = value

    _set(device, modes)
    _set(device, targets)
    return status()


def reset_auto() -> dict:
    """Hand exposure, white balance and focus back to the camera's automatics."""
    cfg = load_config()
    device = cfg["device"]
    controls = list_controls(device)
    autos = {"auto_exposure": 3, "white_balance_automatic": 1, "focus_automatic_continuous": 1}
    _set(device, {k: v for k, v in autos.items() if k in controls})
    _state.clear()
    return status()


def reset_defaults() -> dict:
    """'Reset kamera': every webcam control back to its driver default, slider state
    cleared, preview back to DEFAULT_PREVIEW_FPS. The automatics go first - while they
    own exposure/WB/focus the matching manual values are inactive and are left alone.
    A saved preset file is kept (it can still be loaded)."""
    cfg = load_config()
    device = cfg["device"]
    controls = list_controls(device)
    _set(device, {k: controls[k]["default"] for k in AUTO_CONTROLS if "default" in controls.get(k, {})})
    controls = list_controls(device)
    _set(device, {
        name: c["default"]
        for name, c in controls.items()
        if name not in AUTO_CONTROLS
        and "default" in c
        and not any(flag in str(c.get("flags", "")) for flag in ("inactive", "read-only"))
    })
    _state.clear()
    if cfg.get("preview", {}).get("fps") != DEFAULT_PREVIEW_FPS:
        # Edit just the number so the hand-formatted file (comments, one-line HSV ranges)
        # stays as it is; refuse to write anything that would not parse back.
        text = CONFIG_PATH.read_text()
        new_text, n = re.subn(r'("fps"\s*:\s*)[0-9.]+', rf"\g<1>{DEFAULT_PREVIEW_FPS}", text, count=1)
        if n != 1 or json.loads(new_text).get("preview", {}).get("fps") != DEFAULT_PREVIEW_FPS:
            raise CameraControlError("Gagal mengembalikan preview.fps di camera_config.json.")
        CONFIG_PATH.write_text(new_text)
    return status()


def _preset_path(cfg: dict) -> Path:
    return SERVER_DIR / cfg["preset_file"]


def save_preset() -> dict:
    cfg = load_config()
    sliders = _sliders(cfg, list_controls(cfg["device"]))
    values = {k: _state.get(k, s["default"]) for k, s in sliders.items() if s["supported"]}
    preset = {"name": "Siang Terik Sawah", "saved_at": datetime.now(timezone.utc).isoformat(), "values": values}
    path = _preset_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(preset, indent=2))
    return preset


def load_preset() -> dict:
    cfg = load_config()
    path = _preset_path(cfg)
    if not path.is_file():
        raise FileNotFoundError("Belum ada preset tersimpan. Tekan 'Simpan preset' dulu.")
    try:
        preset = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise CameraControlError(f"File preset rusak ({path.name}): {exc}") from exc
    result = apply(preset.get("values") or {})
    result["preset"] = preset
    return result
