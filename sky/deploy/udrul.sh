#!/usr/bin/env bash
# Roll a tenant image out (KC-0279): the fixed wrapper around sky/scripts/udrul.ts, run as the service user `sky`
# through sudo by path (the sudoers drop-in opsaet-root.sh installs lets `henrik` run exactly this script as `sky`;
# the wildcard there is acceptable only because THIS script validates every argument before anything runs):
#   ssh kira-home 'sudo -n -u sky /usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/udrul.sh <kommando> …'
# Grammar (anything else: exit 2, node never runs):
#   status | fortsaet | tilbage                 no further arguments
#   hold <slug> intern|kanari|alle              <slug> = hus- plus eight base32 characters (src/delt/slug.ts)
#   start clawco:<7-40 lowercase hex>           a local release tag, as sky/deploy/README.md, Udrulning
# The checkout is this script's own (/srv/sky is 0750, so the cd must happen as `sky`, which is why this is a script
# and not a bare `node` in sudoers). Runs in the foreground through every soak, like udrul.ts itself.
# SKY_ENV_FIL exists for the tests; sudo's env_reset drops it, so it cannot redirect the real run.
set -euo pipefail
f="${SKY_ENV_FIL:-/srv/sky/.env}"
brug() { echo "brug: udrul.sh status | hold <slug> intern|kanari|alle | start clawco:<sha> | fortsaet | tilbage" >&2; exit 2; }
[ "$#" -ge 1 ] || brug
kommando="$1"
case "$kommando" in
  status|fortsaet|tilbage) [ "$#" -eq 1 ] || brug ;;
  hold)
    [ "$#" -eq 3 ] || brug
    [[ "$2" =~ ^hus-[a-z2-7]{8}$ ]] || brug
    case "$3" in intern|kanari|alle) ;; *) brug ;; esac ;;
  start)
    [ "$#" -eq 2 ] || brug
    [[ "$2" =~ ^clawco:[0-9a-f]{7,40}$ ]] || brug ;;
  *) brug ;;
esac
cd "$(dirname "$0")/../.."
exec node --env-file="$f" sky/scripts/udrul.ts "$@"
