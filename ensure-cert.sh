#!/usr/bin/env bash
# Regenerate the self-signed HTTPS cert if it doesn't cover the Pi's CURRENT
# IP addresses (LAN IP changes across WiFi networks; the Tailscale IP is
# stable but is still included for completeness). Idempotent: no-op if the
# existing cert already covers every current address. Prints REGENERATED=1
# or REGENERATED=0 as the last line so callers (e.g. the cert-watch timer)
# can decide whether a service restart is warranted.
set -euo pipefail
ROOT=/home/pi/rikub-project
CERT="$ROOT/certs/cert.pem"
KEY="$ROOT/certs/key.pem"
HN=$(hostname)

LAN_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
TS_IP=$(tailscale ip -4 2>/dev/null || true)
ALL_IPS=$(printf '%s\n%s\n' "$LAN_IPS" "$TS_IP" | grep -v '^$' | sort -u)

EXISTING_SAN=""
if [ -f "$CERT" ]; then
  EXISTING_SAN=$(openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null \
    | grep -oE 'IP Address:[0-9.]+' | cut -d: -f2 || true)
fi

MISSING=0
for ip in $ALL_IPS; do
  echo "$EXISTING_SAN" | grep -qx "$ip" || MISSING=1
done

if [ "$MISSING" = "1" ] || [ ! -f "$CERT" ]; then
  SAN="IP:127.0.0.1,DNS:localhost,DNS:${HN},DNS:${HN}.local"
  for ip in $ALL_IPS; do
    SAN="${SAN},IP:${ip}"
  done
  mkdir -p "$ROOT/certs"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$KEY" -out "$CERT" -days 3650 \
    -subj "/CN=jaga-padi" \
    -addext "subjectAltName=${SAN}" >/dev/null 2>&1
  chmod 600 "$KEY"
  echo "cert regenerated for: $(echo "$ALL_IPS" | tr '\n' ' ')"
  echo "REGENERATED=1"
else
  echo "cert already covers current IPs, no change needed"
  echo "REGENERATED=0"
fi
