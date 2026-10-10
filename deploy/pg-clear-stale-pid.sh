#!/usr/bin/env bash
# ExecStartPre for rikub-db: remove a stale postmaster.pid left by a power cut.
# After a reboot the old PID gets reused by some other process of the same user
# (seen: gvfsd-dnssd), and postgres then refuses to start ("lock file already
# exists") - forever. Only deletes the file when that PID is NOT a postgres process,
# so a genuinely running server is never touched.
PIDFILE=/home/pi/rikub-project/pgdata/postmaster.pid
[ -f "$PIDFILE" ] || exit 0
PID=$(head -1 "$PIDFILE")
if [ -n "$PID" ] && [ "$(cat /proc/"$PID"/comm 2>/dev/null)" = "postgres" ]; then
  echo "postmaster.pid: PID $PID is a live postgres, leaving it"
  exit 0
fi
echo "postmaster.pid: PID $PID is not postgres ($(cat /proc/"$PID"/comm 2>/dev/null || echo gone)), removing stale lock"
rm -f "$PIDFILE"
