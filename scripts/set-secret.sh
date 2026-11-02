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
host="${KC_SSH_HOST:-henrik@kira-home}"
keyfile="${KC_SSH_KEY:-$HOME/.ssh/kira-home}"
[[ "$name" =~ ^KC_[A-Z0-9_]+$ ]] || { echo "ugyldigt navn: $name"; exit 1; }
if [ -n "$item" ]; then
  [ -n "${BW_SESSION:-}" ] || { echo "BW_SESSION mangler (kør: export BW_SESSION=\$(npx @bitwarden/cli unlock --raw))"; exit 1; }
  value="$(npx --yes @bitwarden/cli get password "$item" --session "$BW_SESSION")"
else
  read -r -s -p "Indsæt værdien for $name (vises ikke): " value; echo
fi
value="${value//$'\n'/}"
[ -n "$value" ] || { echo "tom værdi, intet ændret"; exit 1; }
printf '%s\n' "$value" | ssh -i "$keyfile" "$host" "name='$name'; f=\$HOME/kontrolcenter/.env; v=\$(cat); touch \"\$f\"; chmod 600 \"\$f\";
  if grep -q \"^\$name=\" \"\$f\"; then tmp=\$(mktemp); grep -v \"^\$name=\" \"\$f\" > \"\$tmp\"; printf '%s=%s\n' \"\$name\" \"\$v\" >> \"\$tmp\"; cat \"\$tmp\" > \"\$f\"; rm -f \"\$tmp\"; else printf '%s=%s\n' \"\$name\" \"\$v\" >> \"\$f\"; fi;
  echo \"\$name sat i \$f (længde \${#v})\""
