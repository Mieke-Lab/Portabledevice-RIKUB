#!/usr/bin/env bash
# Start Jaga Padi via its systemd user units (they also start by themselves at
# boot - see deploy/). Order: PostgreSQL (:5433) -> backend (HTTPS :8000) -> CV
# (:5001). Blocks until the backend is healthy. Access: https://<pi-ip>:8000
#   ./start.sh          start (no-op if already running)
#   ./start.sh restart  restart everything (e.g. after a backend code change)
#   ./start.sh logs     follow the logs of all services
set -euo pipefail
ROOT=/home/pi/rikub-project
UNITS=(rikub-db rikub-backend rikub-cv)

case "${1:-start}" in
  start)   systemctl --user start rikub.target ;;
  restart) systemctl --user restart "${UNITS[@]}" ;;
  logs)    exec journalctl --user-unit rikub-db --user-unit rikub-backend \
             --user-unit rikub-cv -f -n 50 ;;
  *) echo "usage: $0 [start|restart|logs]"; exit 1 ;;
esac

"$ROOT/deploy/wait-healthy.sh" 240
systemctl --user --no-pager --no-legend list-units 'rikub*'
