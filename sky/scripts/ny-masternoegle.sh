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

# Runs on the host as sky: the fixed script from the checkout (KC-0276; the sudoers drop-in names exactly
# this path and these three modes, not `bash -c`). The script is in sky/deploy/masternoegle.sh.
"$ssh_cmd" -i "$keyfile" "$host" "sudo -n -u sky /usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/masternoegle.sh $mode" < /dev/null
echo "Genstart Sky for at bruge den: ssh kira-home 'sudo systemctl restart sky'"
