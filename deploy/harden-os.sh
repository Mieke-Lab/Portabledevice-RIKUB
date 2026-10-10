#!/usr/bin/env bash
# Make the OS survive power dips/brownouts better and lower peak CPU current.
# Needs root:  sudo ./harden-os.sh [--disable-system-pg]
# Idempotent; every touched file is backed up as <file>.rikub-bak once.
# Most changes take effect after a reboot.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

backup() { [ -e "$1" ] && [ ! -e "$1.rikub-bak" ] && cp -a "$1" "$1.rikub-bak" || true; }

# 1. Hardware watchdog: if a brownout hangs the kernel, the Pi reboots itself
#    within ~15 s instead of sitting frozen until someone pulls the plug.
#    Named 50-* so it sorts after Raspberry Pi OS's own 40-rpi-enable-watchdog.conf
#    (1 min), otherwise that file silently wins.
mkdir -p /etc/systemd/system.conf.d
rm -f /etc/systemd/system.conf.d/10-rikub-watchdog.conf
cat > /etc/systemd/system.conf.d/50-rikub-watchdog.conf <<'CONF'
[Manager]
RuntimeWatchdogSec=15s
RebootWatchdogSec=2min
CONF

# 2. Cap CPU clock 2.4 -> 2.0 GHz. At the lower clock the SoC also runs at a lower
#    core voltage, so peak current (the thing that trips undervoltage) drops a lot;
#    the app stays responsive. Revert: delete the arm_freq line in config.txt.
CFG=/boot/firmware/config.txt
if ! grep -qE '^\s*arm_freq=' "$CFG"; then
  backup "$CFG"
  printf '\n[all]\n# rikub: lower peak current on a weak supply\narm_freq=2000\n' >> "$CFG"
fi

# 3. Swap in RAM only (zram). The default "auto" also writes zram pages back to
#    /var/swap on the SD card - SD writes are what get corrupted on power loss.
SWAP=/etc/rpi/swap.conf
if [ -f "$SWAP" ] && ! grep -qE '^\s*Mechanism=zram\s*$' "$SWAP"; then
  backup "$SWAP"
  sed -i -E 's/^\s*#?\s*Mechanism=.*/Mechanism=zram/' "$SWAP"
fi

# 4. Flush dirty pages sooner (default 30 s) so less data is in flight at a power cut.
cat > /etc/sysctl.d/90-rikub-writeback.conf <<'CONF'
vm.dirty_expire_centisecs=1000
vm.dirty_writeback_centisecs=500
CONF
sysctl -q --system

# 5. Keep the journal small (fewer, shorter SD writes). Stays persistent so
#    undervoltage events are still readable after a crash.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/90-rikub.conf <<'CONF'
[Journal]
SystemMaxUse=64M
CONF

# 6. Services this device doesn't use: less idle power, fewer wakeups and writes.
systemctl disable --now bluetooth.service nfs-blkmap.service \
  rpcbind.service rpcbind.socket 2>/dev/null || true

# 7. Optional: the stock Postgres cluster on :5432. The app uses its own cluster
#    (pgdata/, :5433), so this one only costs RAM/writes - but check it holds no
#    data you need before passing the flag.
if [ "${1:-}" = "--disable-system-pg" ]; then
  systemctl disable --now postgresql.service postgresql@15-main.service
fi

# 8. Boot-time auto-repair of the root fs is already on (fsck.repair=yes in cmdline.txt).
grep -q 'fsck.repair=yes' /boot/firmware/cmdline.txt || echo "WARN: add fsck.repair=yes to cmdline.txt"

systemctl daemon-reload
echo "done - reboot to apply watchdog, CPU cap and swap changes"
