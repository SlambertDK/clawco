#!/usr/bin/env bash
# Deploy Kontrolcenter on kira-home: pull main, install, restart, check health.
# Run on the server (or over ssh): bash ~/kontrolcenter/deploy/deploy.sh
set -euo pipefail
# The whole script is a function so bash parses it fully before `git reset`
# replaces this very file underneath a running copy.
main() {
cd "$(dirname "$0")/.."
git fetch -q origin main
git checkout -q main
git reset -q --hard origin/main
# KC-0276: --ignore-scripts (koffi, the one dependency with an install script, ships prebuilt platform packages;
# the Dockerfile has always installed this way) and a private log file instead of a predictable /tmp name.
log="$(mktemp)"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund >"$log" 2>&1 || { tail -20 "$log"; rm -f "$log"; exit 1; }
rm -f "$log"
test -f .env || { echo "manglende .env (se .env.example)"; exit 1; }
install -m 644 deploy/kontrolcenter.service deploy/kontrolcenter-dagen.service deploy/kontrolcenter-dagen.timer deploy/kontrol-tailscale.service deploy/kontrol-tailscale-opdatering.path deploy/kontrol-tailscale-opdatering.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart kontrolcenter
systemctl --user enable --now kontrolcenter-dagen.timer >/dev/null 2>&1
systemctl --user enable --now kontrol-tailscale >/dev/null 2>&1
systemctl --user enable --now kontrol-tailscale-opdatering.path >/dev/null 2>&1
sleep 2
port="$(grep -E '^KC_PORT=' .env | cut -d= -f2 || true)"
curl -fsS "http://127.0.0.1:${port:-8750}/health"; echo
echo "deployed $(git rev-parse --short HEAD)"
}
main "$@"
