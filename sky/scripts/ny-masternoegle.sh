#!/usr/bin/env bash
# Makes Sky's master key (KC-0181) ON the Sky host, as the service user sky, straight into
# /srv/sky/.env: 32 random bytes from the host's /dev/urandom, base64. The key never travels, is never
# on a command line and is never printed — only its name, length and version (AGENTS §9).
#
#   sky/scripts/ny-masternoegle.sh             # first time: SKY_MASTERNOEGLE + _VERSION=1 (refuses if one exists)
#   sky/scripts/ny-masternoegle.sh --roter     # rotation 1/3: current key → SKY_MASTERNOEGLE_FORRIGE, a new one, version + 1
#   sky/scripts/ny-masternoegle.sh --afslut    # rotation 3/3: removes SKY_MASTERNOEGLE_FORRIGE
#
# Rotation 2/3 is `node --env-file=/srv/sky/.env sky/scripts/roter-masternoegle.ts` on the host after a
# restart; restart again after --afslut. Overwriting the key without --roter would make every tenant's
# data key and backup unreadable, so the first form refuses when a key exists. Escrow: sky/deploy/NOEGLE.md.
# Host: SKY_SSH_HOST (default henrik@kira-home), key SKY_SSH_KEY (default ~/.ssh/kira-home).
set -euo pipefail
host="${SKY_SSH_HOST:-henrik@kira-home}"
keyfile="${SKY_SSH_KEY:-$HOME/.ssh/kira-home}"
ssh_cmd="${SKY_SSH_CMD:-ssh}"

mode="${1:-ny}"
case "$mode" in
  ny|--roter|--afslut) ;;
  *) echo "brug: ny-masternoegle.sh [--roter | --afslut]"; exit 2 ;;
esac

# Runs on the host as sky. No single quotes inside (it is wrapped in them); $1 is the validated mode.
remote='set -eu; f=/srv/sky/.env; umask 077; touch "$f"
laes() { grep -E "^$1=" "$f" | tail -1 | cut -d= -f2- || true; }
nu="$(laes SKY_MASTERNOEGLE)"; ver="$(laes SKY_MASTERNOEGLE_VERSION)"; ver="${ver:-1}"; forrige="$(laes SKY_MASTERNOEGLE_FORRIGE)"
case "$1" in
  ny) [ -z "$nu" ] || { echo "SKY_MASTERNOEGLE findes allerede i $f — intet ændret (en ny nøgle ville gøre alle kunders nøgler ulæselige; skift den med --roter)" >&2; exit 3; }
      ny="$(head -c 32 /dev/urandom | base64 | tr -d "\n")"; nyver=1; nyforrige="" ;;
  --roter) [ -n "$nu" ] || { echo "der er ingen SKY_MASTERNOEGLE at rotere" >&2; exit 3; }
      [ -z "$forrige" ] || { echo "en rotation er ikke afsluttet (SKY_MASTERNOEGLE_FORRIGE findes): kør roter-masternoegle.ts, derefter --afslut" >&2; exit 3; }
      ny="$(head -c 32 /dev/urandom | base64 | tr -d "\n")"; nyver=$((ver + 1)); nyforrige="$nu" ;;
  --afslut) [ -n "$forrige" ] || { echo "ingen rotation i gang (SKY_MASTERNOEGLE_FORRIGE findes ikke)" >&2; exit 3; }
      ny="$nu"; nyver="$ver"; nyforrige="" ;;
esac
tmp="$(mktemp "$f.XXXXXX")"
grep -vE "^SKY_MASTERNOEGLE(_VERSION|_FORRIGE)?=" "$f" > "$tmp" || true
printf "SKY_MASTERNOEGLE=%s\nSKY_MASTERNOEGLE_VERSION=%s\n" "$ny" "$nyver" >> "$tmp"
[ -z "$nyforrige" ] || printf "SKY_MASTERNOEGLE_FORRIGE=%s\n" "$nyforrige" >> "$tmp"
chmod 600 "$tmp"; mv -f "$tmp" "$f"
echo "SKY_MASTERNOEGLE sat i $f (længde ${#ny}, version $nyver)${nyforrige:+; SKY_MASTERNOEGLE_FORRIGE beholdt (længde ${#nyforrige})}"'
"$ssh_cmd" -i "$keyfile" "$host" "sudo -n -u sky bash -c '$remote' _ $mode" < /dev/null
echo "Genstart Sky for at bruge den: ssh kira-home 'sudo systemctl restart sky'"
