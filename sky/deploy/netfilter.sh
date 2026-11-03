#!/usr/bin/env bash
# KC-0273 (C2, Sky half): keep tenant containers off the host's networks. Tenants need the internet (the model proxy
# through Sky's public address, RSS, IMAP), so their networks cannot be --internal; instead, every tenant network is a
# /24 from one fixed pool (SKY_TENANT_POOL, default 10.200.0.0/16) and traffic from the WHOLE pool is dropped
#   - when forwarded (DOCKER-USER) to 10/8, 172.16/12, 192.168/16, 100.64/10 (the tailnet), 169.254/16, 127/8;
#   - when it is a NEW connection to the host itself (INPUT): every bridge gateway and every other host address, i.e.
#     anything listening on 0.0.0.0. Local delivery never passes DOCKER-USER, so the INPUT rule is what stops that.
# Answers to connections already allowed (ESTABLISHED,RELATED: Sky's own calls to a tenant, a tenant's outbound
# traffic) pass. Tenant networks have no IPv6 (fleet/lokal.ts refuses one that has), so fc00::/7 is unreachable
# from them without an ip6tables rule.
# Run as root by deploy.sh (user `sky`, through the sudoers entry opsaet-root.sh installs: this script by path,
# nothing else) right after the restart, with the pool as the ONE argument; idempotent (the two chains are refilled,
# each jump is added once). Last, it writes the marker /run/sky/netfilter.ok (the pool and the time, readable by sky):
# Sky reads it, shows it on /health and starts no tenant container unless its pool is the configured one.
# `--vis <pool>` prints the commands without running anything (no root; the tests use it).
# Bash 3.2-compatible (the tests run it on the Mac).
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin

VIS=0
if [ "${1:-}" = "--vis" ]; then VIS=1; shift; fi
fejl() { echo "brug: netfilter.sh [--vis] <pulje: et privat /16, fx 10.200.0.0/16>" >&2; exit 2; }
[ "$#" -eq 1 ] || fejl
NET="$1"
[[ "$NET" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.0\.0/16$ ]] || fejl
A="${BASH_REMATCH[1]}"
B="${BASH_REMATCH[2]}"
for o in "$A" "$B"; do
  if [ "${#o}" -gt 1 ] && [ "${o:0:1}" = 0 ]; then fejl; fi
  [ "$o" -le 255 ] || fejl
done
case "$A" in
  10) ;;
  172) { [ "$B" -ge 16 ] && [ "$B" -le 31 ]; } || fejl ;;
  192) [ "$B" = 168 ] || fejl ;;
  *) fejl ;;
esac
MARKOER_DIR=/run/sky
MARKOER="$MARKOER_DIR/netfilter.ok"

PRIVAT="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 127.0.0.0/8"
UD=CLAWCO-LEJER-UD
IND=CLAWCO-LEJER-IND

ipt() { if [ "$VIS" = 1 ]; then echo "iptables -w $*"; else iptables -w "$@"; fi; }
# A chain that may already exist, refilled from empty.
kaede() { if [ "$VIS" = 1 ] || ! iptables -w -n -L "$1" >/dev/null 2>&1; then ipt -N "$1"; fi; ipt -F "$1"; }
# A jump added once, first in its chain.
hop() { if [ "$VIS" = 1 ] || ! iptables -w -C "$1" -s "$NET" -j "$2" 2>/dev/null; then ipt -I "$1" 1 -s "$NET" -j "$2"; fi; }

kaede "$UD"
ipt -A "$UD" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for r in $PRIVAT; do ipt -A "$UD" -d "$r" -j DROP; done
hop DOCKER-USER "$UD"

kaede "$IND"
ipt -A "$IND" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
ipt -A "$IND" -j DROP
hop INPUT "$IND"

# The marker last: it says the rules above are in place for this pool.
if [ "$VIS" = 1 ]; then
  echo "markør $MARKOER pool=$NET"
else
  install -d -m 0755 "$MARKOER_DIR"
  tmp="$(mktemp "$MARKOER_DIR/.netfilter.XXXXXX")"
  printf 'pool=%s\ntid=%s\n' "$NET" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$MARKOER"
fi
