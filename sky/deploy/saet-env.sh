#!/usr/bin/env bash
# Replace ONE SKY_* line in /srv/sky/.env (KC-0276). Runs on the Sky host as the service user `sky`, and is
# the only way `henrik` may write that file without a password: the sudoers drop-in that
# sky/deploy/opsaet-root.sh installs names this script by path (with `SKY_*` as the only argument), so the
# grant is no longer "any command as sky". Called by sky/scripts/saet-hemmelighed.sh; the value is stdin,
# never an argument. Atomic: a 0600 temp file next to the target, then mv.
# SKY_ENV_FIL exists for the tests; sudo's env_reset drops it, so it cannot redirect the real run.
set -euo pipefail
f="${SKY_ENV_FIL:-/srv/sky/.env}"
navn="${1:-}"
[[ "$navn" =~ ^SKY_[A-Z0-9_]+$ ]] || { echo "ugyldigt navn" >&2; exit 2; }
v="$(cat)"
[ -n "$v" ] || { echo "tom værdi" >&2; exit 2; }
umask 077
touch "$f"
tmp="$(mktemp "$f.XXXXXX")"
grep -v "^$navn=" "$f" > "$tmp" || true
printf '%s=%s\n' "$navn" "$v" >> "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$f"
