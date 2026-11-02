#!/usr/bin/env bash
# Morning build of the room Dagen (KC-0003). Run by kontrolcenter-dagen.timer
# at 07:05 Europe/Copenhagen, after Kiras morgenavis (07:00) has written
# today's data file. Waits for the file (max 10 min), then asks the app to
# rebuild the room through Hermes. Idempotent; safe to run by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
port="$(grep -E '^KC_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; port="${port:-8750}"
pattern="$(grep -E '^KC_DAGEN_SOURCE_GLOB=' .env 2>/dev/null | cut -d= -f2- || true)"
default_pattern='/tmp/avis_data_{date}.json'   # braces must not sit inside ${…:-…}
pattern="${pattern:-$default_pattern}"
today="$(TZ=Europe/Copenhagen date +%F)"
file="${pattern//\{date\}/$today}"
for i in $(seq 1 20); do
  [ -s "$file" ] && break
  [ "$i" -eq 20 ] && { echo "dagen-morgen: ingen datafil for $today ($file) efter 10 min; beder Hermes hente selv"; break; }
  sleep 30
done
mode=opdater; [ -s "$file" ] || mode=hent
resp="$(curl -fsS -m 10 -X POST -H 'content-type: application/json' -d "{\"mode\":\"$mode\"}" "http://127.0.0.1:${port}/api/rum/dagen/opdater")"
echo "dagen-morgen: $today mode=$mode startet: $resp"
# Nyheder reads the same file; give Dagen's run a head start so Hermes is not asked twice at once.
sleep 90
resp2="$(curl -fsS -m 10 -X POST -H 'content-type: application/json' -d "{\"mode\":\"$mode\"}" "http://127.0.0.1:${port}/api/rum/nyheder/opdater")"
echo "dagen-morgen: nyheder mode=$mode startet: $resp2"
