# cv_model — UT-DCR multimodal rice-disease inference

Drop-in computer-vision module for the Jaga Padi UI. Takes a **leaf image** (+ optional
**8-d soil vector**) and returns **calibrated per-class disease probabilities** for 7 rice
diseases. Runs on the Raspberry Pi 5 CPU (no accelerator required).

## What it does

```
image --> MobileNetV2 classifier  --> P_img (7-d)      \
image --> YOLO11s-seg detector     --> dpres (7-d)       --> UT-DCR --> P_final (7-d, calibrated)
soil  --> SoilMLP (inside UT-DCR)  ------------------->  /
```

**UT-DCR** (Uncertainty-Targeted Detector-Classifier Reconciliation) only revises the classifier
where it is **uncertain** (gate open); confident predictions pass through unchanged. This buys
better-calibrated confidence at no accuracy cost. Math:

```
z       = logit(P_img) + ( softplus(w_d)*logit(dpres) + softplus(w_s)*SoilMLP(soil) ) * gate
gate    = 1 - |2*P_img - 1|            # 0 = confident, 1 = uncertain
P_final = sigmoid(z)
```

## Files

| file | what |
|---|---|
| `fusion_infer.py` | inference module — `DiseaseModel` class (load once, `predict()` per request) |
| `classifier_mobilenetv2_presence.pt` | MobileNetV2 multi-label classifier weights (7 classes) |
| `detector_yolo11s_seg.pt` | YOLO11s-seg detector weights (ultralytics) |
| `fusion_utdcr.pt` | UT-DCR fusion head weights (345 params) |
| `soil_scaler.json` | soil min-max scaler (`lo`, `rr2`) + feature order |
| `labels.json` | 7 class names, threshold, preprocessing config |
| `requirements.txt` | Python deps |

## 7 classes (fixed order)

`Bercak-Cokelat-Sempit, Blast, Busuk-Bulir, Busuk-Pelepah, Gosong-Palsu, Hawar-Daun, bercak-Cokelat`

## Soil vector (7-d, deployment JXCT probe)

`[Temp, Moisture, Conductivity, pH, N, P, K]` — the model's 8th feature (a fertility index) is
**imputed internally** from these seven (linear fit, R2~0.84; validated harmless: max P_final
change <1e-3, no decision flips). An 8-d vector including Fertility is also accepted. Pass
`soil=None` to skip the soil term. Out-of-range readings are clamped to the training range.

## Install (on the Pi)

A working venv already exists at `/home/pi/venv_yolo` (ultralytics + torch + opencv). Or:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## Use from the UI (FastAPI)

Load the model **once** at app startup, then call `predict()` per request:

```python
from cv_model.fusion_infer import DiseaseModel

MODEL = DiseaseModel("/home/pi/rikub-project/cv_model")   # ~one-time load

@app.post("/api/detect")
async def detect(image_path: str, soil: list[float] | None = None):
    return MODEL.predict(image_path, soil=soil, timing=True)
```

### Output shape

```json
{
  "classes": [
    {"name": "Hawar-Daun", "p_img": 0.98, "p_final": 0.98, "gate": 0.04, "present": true},
    {"name": "Blast",      "p_img": 0.11, "p_final": 0.13, "gate": 0.78, "present": false}
    // ... 7 entries, fixed order
  ],
  "present": ["Hawar-Daun"],           // classes with p_final >= 0.5
  "top": {"name": "Hawar-Daun", "p_final": 0.98},
  "used_soil": true,
  "timing_ms": {"classifier": 6.5, "detector": 780.0, "fusion": 0.4, "total": 786.9}
}
```

- `p_img` = raw classifier probability; `p_final` = UT-DCR calibrated probability (use this for the UI).
- `gate` near 0 = classifier was confident (fusion left it alone); near 1 = uncertain (fusion revised it).
- `present` = multi-label decision at threshold 0.5.

## CLI smoke test

```bash
/home/pi/venv_yolo/bin/python fusion_infer.py /path/to/leaf.jpg
```

## Notes

- CPU-only by default (`device="cpu"`); the fusion head is sub-millisecond, the classifier ~6 ms,
  the detector dominates latency.
- The classifier expects 512x512 RGB, ImageNet-normalized (handled internally).
- Preprocessing, thresholds, and the soil scaler are all read from `labels.json` / `soil_scaler.json`
  — do not hard-code them in the UI.
