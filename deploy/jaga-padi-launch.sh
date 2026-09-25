#!/usr/bin/env bash
# App icon entry point. Services normally already run (started at boot by
# rikub.target), so this only opens the window; the start call is a no-op then
# and just covers the case where someone stopped them.
set -uo pipefail
ROOT=/home/pi/rikub-project

# One window only: a second tap while the first is starting/open does nothing.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/jaga-padi-launch.lock"
flock -n 9 || exit 0

systemctl --user start rikub.target
"$ROOT/deploy/wait-healthy.sh" 240 || exit 1

if python3 -c 'import webview' 2>/dev/null; then
  exec python3 "$ROOT/webview_launcher.py" --fullscreen
fi

# Fallback while pywebview isn't installed: Chromium kiosk that trusts only our
# self-signed cert (pinned by its public key), not a blanket TLS bypass.
SPKI=$(openssl x509 -pubkey -noout -in "$ROOT/certs/cert.pem" \
  | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)
exec chromium --kiosk --noerrdialogs --no-first-run --password-store=basic \
  --user-data-dir="$HOME/.config/jaga-padi-kiosk" \
  --ignore-certificate-errors-spki-list="$SPKI" \
  https://127.0.0.1:8000
