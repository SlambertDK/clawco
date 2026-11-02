#!/usr/bin/env bash
# Deploy Clawco Sky on the control server: pull main, install, restart (migrations run at start,
# under an advisory lock), then check that /health answers with the new sha.
# Run as user `sky` (on kira-home, KC-0212: ssh kira-home 'sudo -u sky bash /srv/sky/kontrolcenter/sky/deploy/deploy.sh').
# Sky deploys separately from the tenant app (deploy/deploy.sh); origin is the bare repo the Mac pushes to.
set -euo pipefail
# The whole script is a function so bash parses it fully before `git reset`
# replaces this very file underneath a running copy.
main() {
cd "$(dirname "$0")/../.."
git fetch -q origin main
git checkout -q main
git reset -q --hard origin/main
cd sky
npm ci --omit=dev --no-audit --no-fund >/tmp/sky-npm.log 2>&1 || { tail -20 /tmp/sky-npm.log; exit 1; }
test -f /srv/sky/.env || { echo "manglende /srv/sky/.env (se sky/.env.example)"; exit 1; }
# The only root-level step `sky` may run (sudoers line in sky/deploy/README.md).
sudo -n /usr/bin/systemctl restart sky
want="$(git rev-parse --short HEAD)"
port="$(grep -E '^SKY_PORT=' /srv/sky/.env | cut -d= -f2 || true)"
for _ in $(seq 1 15); do
  if svar="$(curl -fsS "http://127.0.0.1:${port:-8781}/health" 2>/dev/null)"; then break; fi
  sleep 1
done
echo "${svar:-ingen /health}"
case "${svar:-}" in
  *"\"sha\":\"$want\""*) echo "deployed $want" ;;
  *) echo "FEJL: /health svarer ikke med $want — se: journalctl -u sky -n 100"; exit 1 ;;
esac
}
main "$@"
