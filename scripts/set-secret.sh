#!/usr/bin/env bash
# Move one secret from the store (Bitwarden) to kira-home's ~/kontrolcenter/.env
# without it ever touching the transcript: prints the key NAME and LENGTH only.
#
#   scripts/set-secret.sh KC_ELEVENLABS_API_KEY            # pasted, hidden prompt
#   BW_SESSION=… scripts/set-secret.sh KC_ELEVENLABS_API_KEY "ElevenLabs"   # from bw (npx @bitwarden/cli)
#
# Then: ssh kira-home 'systemctl --user restart kontrolcenter'.
set -euo pipefail
name="${1:?brug: set-secret.sh KC_NAVN [bitwarden-item]}"
item="${2:-}"
# KC-0276 (F6): the Bitwarden CLI is pinned exactly, never "whatever npx finds"; bump it on purpose.
BW_CLI_VERSION=2026.10.1
host="${KC_SSH_HOST:-henrik@kira-home}"
keyfile="${KC_SSH_KEY:-$HOME/.ssh/kira-home}"
[[ "$name" =~ ^KC_[A-Z0-9_]+$ ]] || { echo "ugyldigt navn: $name"; exit 1; }
if [ -n "$item" ]; then
  [ -n "${BW_SESSION:-}" ] || { echo "BW_SESSION mangler (kør: export BW_SESSION=\$(npx @bitwarden/cli@$BW_CLI_VERSION unlock --raw))"; exit 1; }
  value="$(npx --yes @bitwarden/cli@"$BW_CLI_VERSION" get password "$item" --session "$BW_SESSION")"
else
  read -r -s -p "Indsæt værdien for $name (vises ikke): " value; echo
fi
value="${value//$'\n'/}"
[ -n "$value" ] || { echo "tom værdi, intet ændret"; exit 1; }
# Runs on the host: replace (or add) the line atomically in a 0600 file: a temp file next to the target, then mv
# (KC-0276, F6: the old `cat "$tmp" > "$f"` left a half-written .env if the connection dropped). No single quotes
# inside (it is wrapped in them); $1 is the validated name, the value is stdin.
remote='f=$HOME/kontrolcenter/.env; v="$(cat)"; umask 077; touch "$f"; tmp="$(mktemp "$f.XXXXXX")"; grep -v "^$1=" "$f" > "$tmp" || true; printf "%s=%s\n" "$1" "$v" >> "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$f"; echo "$1 sat i $f (længde ${#v})"'
printf '%s\n' "$value" | ssh -i "$keyfile" "$host" "bash -c '$remote' _ $name"
