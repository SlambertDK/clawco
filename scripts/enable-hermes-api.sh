#!/usr/bin/env bash
# Enable Hermes' API server on this host and share its key with Kontrolcenter.
# Prints key NAMES and LENGTHS only; never the values.
set -euo pipefail
# KC-0276 (F6): everything this script creates is private (a copy of .env.example must not end up 0644 with a key in it).
umask 077
HERMES_ENV="${HERMES_HOME:-$HOME/.hermes}/.env"
KC_ENV="$(cd "$(dirname "$0")/.." && pwd)/.env"
[ -f "$HERMES_ENV" ] || { echo "findes ikke: $HERMES_ENV"; exit 1; }
if grep -q '^API_SERVER_KEY=' "$HERMES_ENV"; then
  key="$(grep '^API_SERVER_KEY=' "$HERMES_ENV" | tail -1 | cut -d= -f2-)"
  echo "API_SERVER_KEY findes allerede i Hermes (længde ${#key})"
else
  key="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  { echo; echo "# Kontrolcenter (deploy/hermes-api-server.md)"; echo "API_SERVER_ENABLED=true"; echo "API_SERVER_HOST=127.0.0.1"; echo "API_SERVER_PORT=8642"; echo "API_SERVER_KEY=$key"; } >> "$HERMES_ENV"
  echo "API_SERVER_* tilføjet til Hermes (nøgle-længde ${#key})"
fi
[ -f "$KC_ENV" ] || cp "$(dirname "$KC_ENV")/.env.example" "$KC_ENV"
if grep -q '^KC_HERMES_API_KEY=' "$KC_ENV"; then
  sed -i.bak "s|^KC_HERMES_API_KEY=.*|KC_HERMES_API_KEY=$key|" "$KC_ENV" && rm -f "$KC_ENV.bak"
else
  echo "KC_HERMES_API_KEY=$key" >> "$KC_ENV"
fi
chmod 600 "$KC_ENV"
echo "KC_HERMES_API_KEY sat i $KC_ENV (længde ${#key})"
