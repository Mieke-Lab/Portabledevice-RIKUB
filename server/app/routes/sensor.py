"""Real-time soil-sensor telemetry.

An ESP32 (ESP-NOW gateway) streams one `<PKT>...<END>` line every ~3 s over the
Pi's GPIO UART (`/dev/ttyAMA0`, 115200 8N1). Example:

    <PKT>TYPE:SOIL|SEQ:692|TIME:2077990|SOIL[HUM:0.0|TEMP:32.0|COND: 0|PH:7.0|
    N: 0|P: 0|K: 0]|GPS[LAT:0.000000|LON:0.000000|ALT:0.0|SAT:0]|ADC[2188]|<END>

A background thread owns the port and keeps only the latest parsed reading in
memory; the HTTP endpoint just serves that snapshot, so the frontend can poll
once per second without ever touching the serial device. Thresholds
(LOW/SAFE/HIGH per parameter) are literature-based for lowland rice — see
THRESHOLDS below for the sources.
"""
import os
import re
import threading
import time
from datetime import datetime, timezone

import serial
from fastapi import APIRouter

router = APIRouter(prefix="/api/sensor", tags=["sensor"])

SERIAL_PORT = os.getenv("SENSOR_SERIAL_PORT", "/dev/ttyAMA0")
SERIAL_BAUD = int(os.getenv("SENSOR_SERIAL_BAUD", "115200"))
# No packet within this window => treat the sensor as disconnected. The ESP
# emits every ~3 s, so 10 s tolerates a couple of dropped frames.
STALE_AFTER_SECONDS = 10.0

# Per-parameter classification bands for LOWLAND RICE (padi sawah).
# value < safe_min -> "low" | value > safe_max -> "high" | else "ok".
# Literature-based (lowland rice), sources per parameter:
#  - moisture: IRRI safe-AWD (drought risk < ~40% VWC). HIGH is NOT flagged
#    (safe_max=100): standing water is normal for a flooded paddy, not damage —
#    only LOW (drying out) is actionable.
#  - temp: Arai-Sanoh et al. 2010 (Plant Prod. Sci. 13:235); optimum 22-32°C,
#    harmful >35°C.
#  - ec (bulk µS/cm): FAO Irr.&Drain. 29 / Maas-Hoffman — rice ECe threshold
#    3.0 dS/m, -12%/dS/m. 2000 µS/cm is a CONSERVATIVE warning (bulk EC reads
#    below saturated-paste ECe; true damage line ~3000 µS/cm).
#  - ph: IRRI / Herath et al. 2025 — 5.5-7.0. NOTE: submerged paddy self-
#    neutralizes toward ~6.5-7.0, so low pH on DRAINED soil overstates acidity.
#  - N/P/K (mg/kg, lab soil-test basis): ICAR/Subbiah-Asija & Olsen/NH4OAc
#    rating cutoffs. CAVEAT: this JXCT-class probe infers N/P/K from EC, not
#    chemistry — a 2024 Frontiers in Agronomy eval found it cannot distinguish
#    N or P rates (P worst) and only tracks K with some reliability. Treat raw
#    N/P especially as DIRECTIONAL; calibrate against one lab test per field.
THRESHOLDS = {
    "moisture": {"label": "Kelembapan", "unit": "%", "safe_min": 40.0, "safe_max": 100.0},
    "temp": {"label": "Suhu Tanah", "unit": "°C", "safe_min": 22.0, "safe_max": 32.0},
    "ec": {"label": "Konduktivitas (EC)", "unit": "µS/cm", "safe_min": 200.0, "safe_max": 2000.0},
    "ph": {"label": "pH Tanah", "unit": "", "safe_min": 5.5, "safe_max": 7.0},
    "n": {"label": "Nitrogen (N)", "unit": "mg/kg", "safe_min": 125.0, "safe_max": 250.0},
    "p": {"label": "Fosfor (P)", "unit": "mg/kg", "safe_min": 10.0, "safe_max": 25.0},
    "k": {"label": "Kalium (K)", "unit": "mg/kg", "safe_min": 50.0, "safe_max": 125.0},
}
# Raw packet key -> our canonical key.
_SOIL_KEY_MAP = {"HUM": "moisture", "TEMP": "temp", "COND": "ec", "PH": "ph", "N": "n", "P": "p", "K": "k"}

_SOIL_RE = re.compile(r"SOIL\[([^\]]*)\]")
_GPS_RE = re.compile(r"GPS\[([^\]]*)\]")
_ADC_RE = re.compile(r"ADC\[\s*([-\d.]+)\s*\]")
_SEQ_RE = re.compile(r"SEQ:\s*(\d+)")

_lock = threading.Lock()
_latest: dict | None = None
_latest_monotonic: float | None = None
_reader_started = False


def _parse_kv(block: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in block.split("|"):
        if ":" in part:
            key, value = part.split(":", 1)
            out[key.strip()] = value.strip()
    return out


def _to_float(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _parse_packet(line: str) -> dict | None:
    if "TYPE:SOIL" not in line:
        return None
    soil_match = _SOIL_RE.search(line)
    if not soil_match:
        return None
    soil = _parse_kv(soil_match.group(1))

    readings = {}
    for raw_key, value in soil.items():
        canonical = _SOIL_KEY_MAP.get(raw_key)
        if canonical:
            readings[canonical] = _to_float(value)

    gps = {}
    gps_match = _GPS_RE.search(line)
    if gps_match:
        raw = _parse_kv(gps_match.group(1))
        gps = {
            "lat": _to_float(raw.get("LAT", "")),
            "lon": _to_float(raw.get("LON", "")),
            "alt": _to_float(raw.get("ALT", "")),
            "sat": int(_to_float(raw.get("SAT", "")) or 0),
        }
        gps["fix"] = bool(gps["sat"]) and (gps["lat"] or gps["lon"])

    seq_match = _SEQ_RE.search(line)
    adc_match = _ADC_RE.search(line)
    return {
        "seq": int(seq_match.group(1)) if seq_match else None,
        "adc": int(_to_float(adc_match.group(1))) if adc_match else None,
        "readings": readings,
        "gps": gps,
    }


def _reader_loop() -> None:
    global _latest, _latest_monotonic
    while True:
        try:
            ser = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=2)
        except Exception:
            time.sleep(3)  # port missing / busy — keep retrying so a re-plug recovers
            continue
        try:
            while True:
                line = ser.readline().decode("ascii", "replace").strip()
                if not line.startswith("<PKT>"):
                    continue
                parsed = _parse_packet(line)
                if parsed is None:
                    continue
                with _lock:
                    _latest = parsed
                    _latest_monotonic = time.monotonic()
        except Exception:
            try:
                ser.close()
            except Exception:
                pass
            time.sleep(2)


def start_reader() -> None:
    """Start the serial reader once, on app startup (not at import time, so a
    bare `import main` for an import-check doesn't grab the serial port)."""
    global _reader_started
    if _reader_started:
        return
    _reader_started = True
    threading.Thread(target=_reader_loop, name="soil-sensor-reader", daemon=True).start()


def _classify(value: float | None, cfg: dict) -> str:
    if value is None:
        return "na"
    if value < cfg["safe_min"]:
        return "low"
    if value > cfg["safe_max"]:
        return "high"
    return "ok"


@router.get("/latest")
def latest_reading() -> dict:
    with _lock:
        snapshot = _latest
        age = None if _latest_monotonic is None else time.monotonic() - _latest_monotonic

    connected = snapshot is not None and age is not None and age <= STALE_AFTER_SECONDS
    values = snapshot["readings"] if snapshot else {}

    readings = []
    for key, cfg in THRESHOLDS.items():
        value = values.get(key)
        readings.append({
            "key": key,
            "label": cfg["label"],
            "unit": cfg["unit"],
            "value": value,
            "status": _classify(value, cfg) if connected else "na",
            "safe_min": cfg["safe_min"],
            "safe_max": cfg["safe_max"],
        })

    return {
        "connected": connected,
        "age_seconds": round(age, 1) if age is not None else None,
        "seq": snapshot["seq"] if snapshot else None,
        "adc": snapshot["adc"] if snapshot else None,
        "gps": snapshot["gps"] if snapshot else {},
        "readings": readings,
    }
