#!/usr/bin/env bash
# Make or rotate Sky's master key ON the Sky host (KC-0181), as the service user `sky`, straight into
# /srv/sky/.env (KC-0276: a fixed script instead of `bash -c <text>`, so the sudoers drop-in can name it).
# Called by sky/scripts/ny-masternoegle.sh with exactly one argument: ny | --roter | --afslut.
# The key never travels, is never on a command line and is never printed: only its name, length and version.
# SKY_ENV_FIL exists for the tests; sudo's env_reset drops it, so it cannot redirect the real run.
set -eu
f="${SKY_ENV_FIL:-/srv/sky/.env}"
mode="${1:-}"
case "$mode" in ny|--roter|--afslut) ;; *) echo "ugyldig tilstand" >&2; exit 2 ;; esac
umask 077; touch "$f"
laes() { grep -E "^$1=" "$f" | tail -1 | cut -d= -f2- || true; }
nu="$(laes SKY_MASTERNOEGLE)"; ver="$(laes SKY_MASTERNOEGLE_VERSION)"; ver="${ver:-1}"; forrige="$(laes SKY_MASTERNOEGLE_FORRIGE)"
case "$mode" in
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
echo "SKY_MASTERNOEGLE sat i $f (længde ${#ny}, version $nyver)${nyforrige:+; SKY_MASTERNOEGLE_FORRIGE beholdt (længde ${#nyforrige})}"
