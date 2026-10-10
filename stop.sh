#!/usr/bin/env bash
# Stop Jaga Padi: CV service, backend and the project PostgreSQL cluster.
# They come back on the next boot (or ./start.sh / the app icon).
set -euo pipefail
systemctl --user stop rikub.target rikub-cv rikub-backend rikub-db
