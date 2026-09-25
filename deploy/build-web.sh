#!/usr/bin/env bash
# Build the SPA (web/dist) without a current spike: the whole build runs in its
# own cgroup capped at 1 core, lowest priority. Slower, but safe on a weak supply.
# The backend serves web/dist directly - no restart needed after a build.
set -euo pipefail
cd /home/pi/rikub-project/web
exec systemd-run --user --scope --quiet -p CPUQuota=100% -p IOWeight=50 \
  nice -n 19 "$HOME/.bun/bin/bun" run build
