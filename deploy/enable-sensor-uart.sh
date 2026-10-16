#!/usr/bin/env bash
# Enable UART0 on GPIO14 (TXD, pin 8) / GPIO15 (RXD, pin 10) -> /dev/ttyAMA0, the port the
# backend reads the ESP32 soil sensor from (server/app/routes/sensor.py, 115200 baud).
# On a Pi 5 this UART is off by default; serial0 is the separate debug connector
# (ttyAMA10), so the kernel console there does not clash with the sensor.
# Needs root and a reboot:  sudo ./enable-sensor-uart.sh && sudo reboot
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
CFG=/boot/firmware/config.txt
if grep -qE '^\s*dtparam=uart0=on' "$CFG"; then
  echo "already enabled in $CFG"
else
  [ -e "$CFG.rikub-bak" ] || cp -a "$CFG" "$CFG.rikub-bak"
  printf '\n[all]\n# rikub: UART0 on GPIO14/15 for the ESP32 soil sensor (/dev/ttyAMA0)\ndtparam=uart0=on\n' >> "$CFG"
  echo "enabled - reboot to apply"
fi
