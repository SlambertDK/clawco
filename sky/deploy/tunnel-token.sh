#!/usr/bin/env bash
# Writes the Cloudflare Tunnel token from Sky's .env into a 0600 file for `cloudflared tunnel run
# --token-file` (KC-0212). Run by clawco-sky-tunnel.service as ExecStartPre, as user sky, into the
# unit's private runtime directory — so the token is never on a command line, never in the unit's
# environment, and gone when the unit stops. Prints the length only, never the value.
#   tunnel-token.sh <env-file> <token-file>
set -euo pipefail
envfil="${1:?brug: tunnel-token.sh <env-fil> <token-fil>}"
ud="${2:?brug: tunnel-token.sh <env-fil> <token-fil>}"
umask 077
v="$(grep -E '^SKY_CLOUDFLARE_TUNNEL_TOKEN=' "$envfil" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
v="${v%$'\r'}"
v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
[ -n "$v" ] || { echo "SKY_CLOUDFLARE_TUNNEL_TOKEN mangler i $envfil (sæt den med sky/scripts/saet-hemmelighed.sh)" >&2; exit 1; }
printf '%s' "$v" > "$ud.tmp"
mv -f "$ud.tmp" "$ud"
echo "tunnel-token skrevet til $ud (længde ${#v})"
