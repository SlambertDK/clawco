#!/usr/bin/env bash
# Move one secret into Sky's /srv/sky/.env on the Sky host without it ever touching the transcript:
# prints the key NAME and LENGTH only. Same pattern as scripts/set-secret.sh (the tenant's), but for
# Sky: SKY_* names, written as the service user sky (KC-0212: kira-home, through the sudoers grant
# sky/deploy/opsaet-root.sh installs). The value travels on ssh's stdin, never on a command line.
#
#   sky/scripts/saet-hemmelighed.sh SKY_PUBLIC_URL                                  # pasted, hidden prompt
#   BW_SESSION=… sky/scripts/saet-hemmelighed.sh SKY_DATABASE_URL "Clawco Sky db"   # from bw (npx @bitwarden/cli)
#   sky/scripts/saet-hemmelighed.sh --fra-bws DEV__STRIPE_SECRET_KEY                # → SKY_STRIPE_SECRET_KEY
#   sky/scripts/saet-hemmelighed.sh --fra-bws R2_ACCESS_KEY_ID --som SKY_R2_ACCESS_KEY_ID
#
# --fra-bws reads Bitwarden Secrets Manager (project `shelfatlas`, KC-0190) through ShelfAtlas'
# scripts/secrets/runtime.mjs, which loads its own machine token; this script never sees the token.
# Without --som the name is SKY_ + the key without its DEV__/PROD__/STAGING__ prefix.
# Host: SKY_SSH_HOST (default henrik@kira-home), key SKY_SSH_KEY (default ~/.ssh/kira-home).
# Then restart the unit that reads it: ssh kira-home 'sudo systemctl restart sky' (or clawco-sky-tunnel).
set -euo pipefail
host="${SKY_SSH_HOST:-henrik@kira-home}"
keyfile="${SKY_SSH_KEY:-$HOME/.ssh/kira-home}"
ssh_cmd="${SKY_SSH_CMD:-ssh}"
bws_dir="${SKY_BWS_DIR:-$HOME/projects/ShelfAtlas/scripts/secrets}"
node_cmd="${SKY_NODE:-node}"

name=""; item=""; bws_key=""
if [ "${1:-}" = "--fra-bws" ]; then
  bws_key="${2:?brug: saet-hemmelighed.sh --fra-bws <NØGLE> [--som SKY_NAVN]}"
  [[ "$bws_key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ugyldig Bitwarden-nøgle: $bws_key"; exit 1; }
  if [ "${3:-}" = "--som" ]; then name="${4:?--som kræver et SKY_NAVN}"; else
    base="$bws_key"
    for p in DEV__ PROD__ STAGING__; do base="${base#"$p"}"; done
    name="SKY_${base#SKY_}"
  fi
else
  name="${1:?brug: saet-hemmelighed.sh SKY_NAVN [bitwarden-item] | --fra-bws <NØGLE> [--som SKY_NAVN]}"
  item="${2:-}"
fi
[[ "$name" =~ ^SKY_[A-Z0-9_]+$ ]] || { echo "ugyldigt navn: $name"; exit 1; }

if [ -n "$bws_key" ]; then
  [ -f "$bws_dir/runtime.mjs" ] || { echo "finder ikke $bws_dir/runtime.mjs (SKY_BWS_DIR)"; exit 1; }
  # Errors from runtime.mjs/lib.mjs name keys only, never values.
  value="$("$node_cmd" --input-type=module -e '
    const [dir, noegle] = process.argv.slice(1);
    const { pathToFileURL } = await import("node:url");
    const { resolveProject, listSecrets } = await import(pathToFileURL(dir + "/runtime.mjs").href);
    const { pickSecret } = await import(pathToFileURL(dir + "/lib.mjs").href);
    const projekt = resolveProject("shelfatlas");
    process.stdout.write(String(pickSecret(listSecrets(projekt.id), noegle).value ?? ""));
  ' "$bws_dir" "$bws_key")"
elif [ -n "$item" ]; then
  [ -n "${BW_SESSION:-}" ] || { echo "BW_SESSION mangler (kør: export BW_SESSION=\$(npx @bitwarden/cli unlock --raw))"; exit 1; }
  value="$(npx --yes @bitwarden/cli get password "$item" --session "$BW_SESSION")"
else
  read -r -s -p "Indsæt værdien for $name (vises ikke): " value; echo
fi
value="${value//$'\n'/}"
[ -n "$value" ] || { echo "tom værdi, intet ændret"; exit 1; }

# Runs on the host as sky: replace the line atomically in a 0600 file. No single quotes inside (it is
# wrapped in them); $1 is the validated name, the value is stdin.
remote='f=/srv/sky/.env; v="$(cat)"; umask 077; touch "$f"; tmp="$(mktemp "$f.XXXXXX")"; grep -v "^$1=" "$f" > "$tmp" || true; printf "%s=%s\n" "$1" "$v" >> "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$f"'
printf '%s\n' "$value" | "$ssh_cmd" -i "$keyfile" "$host" "sudo -n -u sky bash -c '$remote' _ $name"
echo "$name sat i /srv/sky/.env på $host (længde ${#value})"
