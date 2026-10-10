#!/usr/bin/env bash
# Install Tailscale and join this Pi to the tailnet. Idempotent - safe to re-run.
#   sudo ./setup-tailscale.sh                   # prints a login URL to open in a browser
#   sudo TS_AUTHKEY=tskey-auth-... ./setup-tailscale.sh   # unattended join
#   sudo TS_HOSTNAME=jaga-padi ./setup-tailscale.sh       # custom machine name
# Must join the SAME tailnet as the Jetson (chatbot upstream 100.116.176.70, see
# server/.env), otherwise the chatbot proxy can't reach it.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
APP_USER=pi
ROOT=/home/pi/rikub-project
TS_HOSTNAME=${TS_HOSTNAME:-$(hostname)}

# 1. Official package repo (signed) + install.
. /etc/os-release
KEYRING=/usr/share/keyrings/tailscale-archive-keyring.gpg
if ! command -v tailscale >/dev/null; then
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${VERSION_CODENAME}.noarmor.gpg" -o "$KEYRING"
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${VERSION_CODENAME}.tailscale-keyring.list" \
    -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -qq
  apt-get install -y tailscale
fi
systemctl enable --now tailscaled

# 2. Join. --operator lets the app user run `tailscale ip/status` without sudo
#    (ensure-cert.sh needs the Tailscale IP). Blocks until login completes.
UP_ARGS=(--operator="$APP_USER" --hostname="$TS_HOSTNAME")
[ -n "${TS_AUTHKEY:-}" ] && UP_ARGS+=(--auth-key="$TS_AUTHKEY")
tailscale up "${UP_ARGS[@]}"

# 3. New IP -> the self-signed HTTPS cert must cover it. Run as the app user so
#    certs/ stays owned by pi, then restart the backend to load the new cert.
TS_IP=$(tailscale ip -4)
runuser -u "$APP_USER" -- "$ROOT/ensure-cert.sh"
runuser -u "$APP_USER" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$APP_USER")" \
  systemctl --user restart rikub-backend.service

echo
echo "Tailscale IP : $TS_IP"
echo "App URL      : https://$TS_IP:8000"
tailscale status | head -10
