#!/usr/bin/env bash
# Block until the backend's /health reports ok (DB reachable), or fail after N seconds.
# Usage: wait-healthy.sh [timeout_seconds]
TIMEOUT=${1:-120}
for _ in $(seq "$TIMEOUT"); do
  curl -sk --max-time 2 https://127.0.0.1:8000/health | grep -q '"ok":true' && exit 0
  sleep 1
done
echo "backend not healthy after ${TIMEOUT}s" >&2
exit 1
