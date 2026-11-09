#!/usr/bin/env bash
# Put the tenant pool's host-side filter back after a reboot (KC-0279). Run as root by
# clawco-sky-netfilter.service (a boot-time oneshot, before sky.service). After a reboot the iptables rules and
# /run/sky/netfilter.ok (tmpfs) are gone while Docker restarts the tenant containers unfiltered, and Sky refuses
# every tenant start until netfilter.sh has run again (KC-0273); this is that run, without waiting for a deploy.
# Reads ONE line of /srv/sky/.env (SKY_TENANT_POOL, default 10.200.0.0/16; the same lookup deploy.sh does), never
# prints or sources the rest of the file, and hands the pool to netfilter.sh, which validates it fully itself.
# SKY_ENV_FIL exists for the tests (the unit never sets it).
set -euo pipefail
f="${SKY_ENV_FIL:-/srv/sky/.env}"
pool=""
if [ -r "$f" ]; then pool="$(grep -E '^SKY_TENANT_POOL=' "$f" | head -1 | cut -d= -f2- || true)"; fi
pool="${pool:-10.200.0.0/16}"
[[ "$pool" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.0\.0/16$ ]] || { echo "ugyldig SKY_TENANT_POOL (et privat /16, fx 10.200.0.0/16)" >&2; exit 2; }
exec "$BASH" "$(cd "$(dirname "$0")" && pwd)/netfilter.sh" "$pool"
