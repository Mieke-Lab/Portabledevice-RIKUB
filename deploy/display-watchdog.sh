#!/usr/bin/env bash
# Keeps the touchscreen alive. On a weak supply a current dip can drop the screen's
# HDMI link; labwc then sometimes never re-enables the output (black until reboot).
# Every few seconds: log undervoltage + HDMI changes, and if the desktop stays
# unhealthy (no compositor, output off, no mode) restart lightdm, which brings it back.
set -uo pipefail
USER_NAME=pi
UID_NUM=$(id -u "$USER_NAME")
RUNTIME=/run/user/$UID_NUM
INTERVAL=5
BAD_LIMIT=4          # ~20 s unhealthy before acting
COOLDOWN=180         # at most one restart per 3 min
BOOT_GRACE=90        # labwc may still be starting

log() { echo "$*"; }

hdmi_status() {
  local c s=""
  for c in /sys/class/drm/card*-HDMI-A-*; do
    [ "$(cat "$c/status" 2>/dev/null)" = connected ] && s="$s ${c##*-HDMI-A-}:$(cat "$c/enabled")"
  done
  echo "${s:- none}"
}

# 0 = labwc answers and has an enabled output with a current mode.
desktop_ok() {
  local sock
  sock=$(ls "$RUNTIME" 2>/dev/null | grep -m1 -E '^wayland-[0-9]+$') || return 1
  timeout 5 runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="$RUNTIME" WAYLAND_DISPLAY="$sock" \
    wlr-randr --json 2>/dev/null | python3 -c '
import json, sys
outs = json.load(sys.stdin)
sys.exit(0 if any(o["enabled"] and any(m.get("current") for m in o["modes"]) for o in outs) else 1)'
}

bad=0
last_restart=0
last_hdmi=""
last_thr=""
started=$(date +%s)
while sleep "$INTERVAL"; do
  now=$(date +%s)
  thr=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
  if [ -n "$thr" ] && [ "$thr" != "$last_thr" ]; then
    log "throttled=$thr (bit0 undervoltage now, bit16 undervoltage since boot)"
    last_thr=$thr
  fi
  hdmi=$(hdmi_status)
  if [ "$hdmi" != "$last_hdmi" ]; then
    log "HDMI connected:$hdmi"
    last_hdmi=$hdmi
  fi

  [ "$hdmi" = " none" ] && { bad=0; continue; }        # screen unplugged/unpowered: nothing to fix
  systemctl is-active -q lightdm || { bad=0; continue; }
  [ $((now - started)) -lt $BOOT_GRACE ] && continue

  if desktop_ok; then
    [ $bad -gt 0 ] && log "desktop recovered by itself"
    bad=0
    continue
  fi
  bad=$((bad + 1))
  log "desktop unhealthy ($bad/$BAD_LIMIT): no compositor reply or no active output mode"
  if [ $bad -ge $BAD_LIMIT ] && [ $((now - last_restart)) -ge $COOLDOWN ]; then
    log "restarting lightdm to bring the screen back"
    systemctl restart lightdm
    last_restart=$now
    started=$now   # give labwc the boot grace again
    bad=0
  fi
done
