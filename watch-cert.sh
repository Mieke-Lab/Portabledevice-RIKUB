#!/usr/bin/env bash
# Runs periodically (systemd --user timer). Only restarts the backend when
# ensure-cert.sh actually regenerated the cert (a real IP change) - never on
# every tick - so an in-flight 1.5-3 min chat request is not cut off by a
# routine check.
set -euo pipefail
OUT=$(/home/pi/rikub-project/ensure-cert.sh)
echo "$OUT"
if echo "$OUT" | grep -q "REGENERATED=1"; then
  echo "IP changed, restarting rikub-backend.service to pick up the new cert"
  systemctl --user restart rikub-backend.service
fi
