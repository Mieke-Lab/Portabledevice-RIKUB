#!/usr/bin/env bash
# Create /home/pi/venv_yolo for cv_service (rice-disease model). No sudo needed.
# torch/torchvision come from PyTorch's CPU-only index: the default PyPI aarch64 wheels
# now pull ~13 NVIDIA CUDA packages (several GB) that are useless on a Pi.
# Runs capped at 1 core / lowest priority so the install can't trigger undervoltage.
set -euo pipefail
VENV=/home/pi/venv_yolo
ROOT=/home/pi/rikub-project
run() { systemd-run --user --scope --quiet -p CPUQuota=100% -p IOWeight=50 nice -n 19 "$@"; }

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
run "$VENV/bin/pip" install -q --upgrade pip
run "$VENV/bin/pip" install --progress-bar off torch torchvision \
  --index-url https://download.pytorch.org/whl/cpu
run "$VENV/bin/pip" install --progress-bar off \
  -r "$ROOT/cv_model/requirements.txt" -r "$ROOT/cv_service/requirements.txt"
# Fail loudly if anything pulled a CUDA build back in.
"$VENV/bin/python" -c "import torch; assert not torch.version.cuda, torch.version.cuda; print('torch', torch.__version__, 'CPU-only')"
echo INSTALL_OK
