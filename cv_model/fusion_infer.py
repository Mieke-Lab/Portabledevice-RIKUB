"""
UT-DCR multimodal rice-disease inference for deployment (Raspberry Pi 5, CPU).

Pipeline:  image --> MobileNetV2 classifier (P_img, 7-d)      \
           image --> YOLO11s-seg detector (dpres, max conf/class) --> UT-DCR --> calibrated P_final (7-d)
           soil  --> SoilMLP (inside UT-DCR)                    /

UT-DCR:  z = logit(P_img) + ( softplus(w_d)*logit(dpres) + softplus(w_s)*SoilMLP(soil_scaled) ) * (1 - |2*P_img - 1|)
         P_final = sigmoid(z);   gate g = 1 - |2*P_img - 1|  (0=confident, 1=uncertain)

The fusion only revises where the classifier is UNCERTAIN (open gate); confident calls pass through.

Usage (UI / FastAPI), load once at startup, call per request:
    from fusion_infer import DiseaseModel
    model = DiseaseModel("/home/pi/rikub-project/cv_model")   # loads all 3 nets once
    out = model.predict("leaf.jpg", soil=[27.5, 45.0, 1.2, 6.3, 1.2, 1.2, 1.2, 1.2])  # soil optional
    # out -> dict: see predict() docstring

Soil vector (deployment JXCT probe, 7-d): [Temp, Moisture, Conductivity, pH, N, P, K].
The model's 8th feature (Fertility) is imputed internally from these seven (validated harmless).
An 8-d vector including Fertility is also accepted. Pass soil=None to skip the soil term.
"""
import os, json, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
import torchvision.models as M
import cv2

NC = 7
EPS = 1e-4


def _logit(p):
    p = torch.clamp(torch.as_tensor(p, dtype=torch.float32), EPS, 1 - EPS)
    return torch.log(p) - torch.log1p(-p)


class _UT(nn.Module):
    """UT-DCR fusion head (345 params). Matches the trained checkpoint exactly."""
    def __init__(self):
        super().__init__()
        self.soil = nn.Sequential(nn.Linear(8, 16), nn.ReLU(), nn.Linear(16, 8), nn.ReLU(), nn.Linear(8, NC))
        self.wd = nn.Parameter(torch.tensor(-4.))
        self.ws = nn.Parameter(torch.tensor(-4.))

    def forward(self, p_cls, dpres, soil, use_soil=True):
        p = torch.as_tensor(p_cls, dtype=torch.float32)
        h = _logit(p)
        det_term = F.softplus(self.wd) * _logit(dpres)
        soil_term = F.softplus(self.ws) * self.soil(torch.as_tensor(soil, dtype=torch.float32)) if use_soil else 0.0
        gate = 1 - torch.abs(2 * p - 1)
        return h + (det_term + soil_term) * gate


class DiseaseModel:
    """Loads classifier + detector + UT-DCR once; predict() runs the full multimodal cascade on CPU."""

    def __init__(self, model_dir, device="cpu"):
        self.dir = model_dir
        self.device = device
        cfg = json.load(open(os.path.join(model_dir, "labels.json")))
        self.names = cfg["names"]
        self.tau = cfg.get("tau", 0.5)
        self.res = cfg.get("classifier_res", 512)
        self.mean = np.array(cfg.get("norm_mean", [0.485, 0.456, 0.406]), np.float32)
        self.std = np.array(cfg.get("norm_std", [0.229, 0.224, 0.225]), np.float32)
        self.yolo_conf = cfg.get("yolo_conf", 0.25)
        self.yolo_imgsz = cfg.get("yolo_imgsz", 640)
        sc = json.load(open(os.path.join(model_dir, "soil_scaler.json")))
        self.soil_feats = sc["feats"]
        self.soil_lo = np.array(sc["lo"], np.float32)
        self.soil_rr = np.array(sc["rr2"], np.float32)
        # deployment probe senses 7 channels; the 8th (Fertility) is imputed from them
        fi = sc.get("fertility_impute")
        self.fert_intercept = float(fi["intercept"]) if fi else None
        self.fert_coef = np.array(fi["coef"], np.float32) if fi else None

        # classifier: MobileNetV2, 7-way multi-label head
        self.clf = M.mobilenet_v2(weights=None)
        self.clf.classifier[1] = nn.Linear(1280, NC)
        self.clf.load_state_dict(torch.load(os.path.join(model_dir, "classifier_mobilenetv2_presence.pt"), map_location=device))
        self.clf.eval().to(device)

        # detector: YOLO11s-seg (ultralytics)
        from ultralytics import YOLO
        self.det = YOLO(os.path.join(model_dir, "detector_yolo11s_seg.pt"))

        # fusion: UT-DCR
        self.fusion = _UT()
        self.fusion.load_state_dict(torch.load(os.path.join(model_dir, "fusion_utdcr.pt"), map_location=device))
        self.fusion.eval().to(device)

    def _preprocess(self, img_bgr):
        im = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        im = cv2.resize(im, (self.res, self.res))
        t = torch.from_numpy(im).permute(2, 0, 1).float() / 255.
        t = (t - torch.tensor(self.mean).view(3, 1, 1)) / torch.tensor(self.std).view(3, 1, 1)
        return t.unsqueeze(0).to(self.device)

    def _classify(self, img_bgr):
        with torch.no_grad():
            return torch.sigmoid(self.clf(self._preprocess(img_bgr))).cpu().numpy()[0]  # (7,)

    def _detect_presence(self, img_path_or_bgr):
        r = self.det.predict(img_path_or_bgr, imgsz=self.yolo_imgsz, conf=self.yolo_conf, device=self.device, verbose=False)[0]
        dpres = np.zeros(NC, np.float32)
        if r.boxes is not None and len(r.boxes):
            cls = r.boxes.cls.cpu().numpy().astype(int)
            conf = r.boxes.conf.cpu().numpy()
            for k in range(len(cls)):
                c = cls[k]
                if 0 <= c < NC:
                    dpres[c] = max(dpres[c], float(conf[k]))
        return dpres

    def _to8(self, soil):
        """Accept the 7-channel deployment reading [Temp,Moisture,Conductivity,pH,N,P,K] and
        impute the 8th feature (Fertility) from it; an already-8-d vector is returned as-is."""
        s = np.asarray(soil, np.float32).ravel()
        if s.size == 8:
            return s
        if s.size == 7:
            if self.fert_coef is None:
                raise ValueError("7-channel soil given but no fertility_impute in soil_scaler.json")
            fert = self.fert_intercept + float(self.fert_coef @ s)
            return np.concatenate([s, [fert]]).astype(np.float32)
        raise ValueError(f"soil must be 7 or 8 values, got {s.size}")

    def _scale_soil(self, soil):
        s = (self._to8(soil) - self.soil_lo) / self.soil_rr
        return np.clip(s, 0.0, 1.0)  # clamp out-of-train-range readings

    def predict(self, image_path, soil=None, timing=False):
        """
        image_path : path to a leaf image (or a BGR numpy array).
        soil       : 7-d list [Temp,Moisture,Conductivity,pH,N,P,K] (deployment probe;
                     Fertility imputed internally), or an 8-d list incl. Fertility, or None.
        returns dict:
          { "classes":[{"name","p_img","p_final","gate","present"}...],   # per-class, ordered
            "present":[names above tau in fused output],
            "top":{"name","p_final"},
            "used_soil":bool, ["timing_ms":{...}] }
        """
        t = {}
        img = cv2.imread(image_path) if isinstance(image_path, str) else image_path
        if img is None:
            raise FileNotFoundError(f"cannot read image: {image_path}")
        t0 = time.perf_counter()
        p_img = self._classify(img); t["classifier"] = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        dpres = self._detect_presence(image_path); t["detector"] = (time.perf_counter() - t0) * 1000
        use_soil = soil is not None
        soil_s = self._scale_soil(soil) if use_soil else np.zeros(8, np.float32)
        t0 = time.perf_counter()
        with torch.no_grad():
            z = self.fusion(p_img[None, :], dpres[None, :], soil_s[None, :], use_soil=use_soil)
            p_final = torch.sigmoid(z).cpu().numpy()[0]
        t["fusion"] = (time.perf_counter() - t0) * 1000
        gate = 1 - np.abs(2 * p_img - 1)
        classes = [{"name": self.names[c], "p_img": round(float(p_img[c]), 4),
                    "p_final": round(float(p_final[c]), 4), "gate": round(float(gate[c]), 4),
                    "present": bool(p_final[c] >= self.tau)} for c in range(NC)]
        present = [c["name"] for c in classes if c["present"]]
        top = max(classes, key=lambda c: c["p_final"])
        out = {"classes": classes, "present": present,
               "top": {"name": top["name"], "p_final": top["p_final"]}, "used_soil": use_soil}
        if timing:
            t["total"] = sum(t.values())
            out["timing_ms"] = {k: round(v, 1) for k, v in t.items()}
        return out


if __name__ == "__main__":
    import sys, glob
    d = os.path.dirname(os.path.abspath(__file__))
    m = DiseaseModel(d)
    imgs = sys.argv[1:] or sorted(glob.glob(os.path.join(d, "samples", "*.jpg")))[:1]
    demo_soil = [27.5, 45.0, 1.2, 6.3, 1.2, 1.2, 1.2]  # 7-channel deployment reading
    for ip in imgs:
        # warmup once for fair timing
        m.predict(ip, soil=demo_soil)
        out = m.predict(ip, soil=demo_soil, timing=True)
        print(ip, "->", json.dumps(out, indent=2))
