#!/usr/bin/env bash
# Install/refresh the Jaga Padi user services + app icon. No sudo needed.
# Re-run after editing anything in deploy/. Undo: ./install-user-services.sh --remove
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
UNIT_DIR="$HOME/.config/systemd/user"
UNITS=(rikub.target rikub-db.service rikub-backend.service rikub-cv.service
       rikub-cert-watch.service rikub-cert-watch.timer)

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now rikub.target "${UNITS[@]}" 2>/dev/null || true
  for u in "${UNITS[@]}"; do rm -f "$UNIT_DIR/$u"; done
  rm -f "$HOME/.local/share/applications/jaga-padi.desktop" "$HOME/Desktop/jaga-padi.desktop"
  systemctl --user daemon-reload
  echo "removed"; exit 0
fi

mkdir -p "$UNIT_DIR" "$HOME/.local/share/applications" "$HOME/Desktop"
for u in "${UNITS[@]}"; do install -m 644 "$HERE/systemd/$u" "$UNIT_DIR/$u"; done
chmod +x "$HERE"/*.sh
install -m 755 "$HERE/jaga-padi.desktop" "$HOME/.local/share/applications/jaga-padi.desktop"
install -m 755 "$HERE/jaga-padi.desktop" "$HOME/Desktop/jaga-padi.desktop"

systemctl --user daemon-reload
systemctl --user enable rikub.target rikub-db.service rikub-backend.service \
  rikub-cv.service rikub-cert-watch.timer
# Services must come up at boot without anyone logging in.
loginctl enable-linger "$USER"
echo "installed; start now with: systemctl --user start rikub.target"
