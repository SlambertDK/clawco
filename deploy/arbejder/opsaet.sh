#!/usr/bin/env bash
# One-time setup of the Claude Code worker on kira-home (KC-0047). Henrik runs:
#   sudo bash ~/kontrolcenter/deploy/arbejder/opsaet.sh
# Creates user claude-arbejder (no access to /home/henrik), installs gh and
# Claude Code for it, clones, adds the deploy-only SSH key, then the two
# logins (GitHub and Claude: open a link, type a code). Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Kør med sudo: sudo bash $0"; exit 1; }
BRUGER=claude-arbejder
EJER="${SUDO_USER:-henrik}"
HJEM="/home/$BRUGER"
KILDE="$(cd "$(dirname "$0")" && pwd)"
GIT_NAVN="SlambertDK"
# The worker's commit address; GitHub's noreply form keeps a personal address out of the history.
GIT_MAIL="${KC_ARBEJDER_GIT_MAIL:-SlambertDK@users.noreply.github.com}"
som() { sudo -iu "$BRUGER" bash -lc "$1"; }

echo "== Bruger og værktøj"
id "$BRUGER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$BRUGER"
chmod 700 "$HJEM"
loginctl enable-linger "$BRUGER"
command -v gh >/dev/null || { apt-get update -qq && apt-get install -y -qq gh; }
som 'grep -q npm-global ~/.profile || echo "export PATH=\$HOME/.npm-global/bin:\$HOME/.local/bin:\$PATH" >> ~/.profile'
som 'npm config set prefix ~/.npm-global && npm install -g --no-fund --no-audit @anthropic-ai/claude-code >/dev/null && claude --version'
som "git config --global user.name '$GIT_NAVN' && git config --global user.email '$GIT_MAIL'"
som 'mkdir -p ~/.claude && test -f ~/.claude/settings.json || echo "{\"attribution\":{\"commit\":\"\",\"pr\":\"\"}}" > ~/.claude/settings.json'

echo "== 1/2 GitHub: åbn linket, skriv koden og godkend"
som 'gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web'
som 'gh auth setup-git'

echo "== Kloner"
som 'mkdir -p ~/arbejde && cd ~/arbejde && { test -d kontrolcenter || git clone -q https://github.com/SlambertDK/kontrolcenter; } && { test -d claude-metode || git clone -q https://github.com/SlambertDK/claude-metode; }'
som 'ln -sf ~/arbejde/claude-metode/global/CLAUDE.md ~/.claude/CLAUDE.md'
som 'cd ~/arbejde/kontrolcenter && git config core.hooksPath .githooks && npm ci --no-audit --no-fund >/dev/null && npx playwright-core install chromium >/dev/null'

echo "== Deploy-nøgle (kan kun deploye det, der er merget på GitHub)"
som 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && { test -f ~/.ssh/deploy || ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/deploy -C claude-arbejder-deploy; }'
pub="$(cat "$HJEM/.ssh/deploy.pub")"
nogler="/home/$EJER/.ssh/authorized_keys"
grep -qF "$pub" "$nogler" || echo "restrict,command=\"bash /home/$EJER/kontrolcenter/deploy/arbejder/deploy-fra-github.sh\" $pub" >> "$nogler"
som "printf 'Host kira-deploy\n  HostName localhost\n  User $EJER\n  IdentityFile ~/.ssh/deploy\n  IdentitiesOnly yes\n' > ~/.ssh/config && chmod 600 ~/.ssh/config && ssh-keyscan localhost >> ~/.ssh/known_hosts 2>/dev/null"

echo "== 2/2 Claude: åbn linket, log ind og indsæt koden"
som 'claude auth status >/dev/null 2>&1 || claude auth login --claudeai'

echo "== Timer"
install -d -o "$BRUGER" -g "$BRUGER" "$HJEM/.config/systemd/user"
install -m 644 -o "$BRUGER" -g "$BRUGER" "$KILDE/claude-arbejder.service" "$KILDE/claude-arbejder.timer" "$HJEM/.config/systemd/user/"
systemctl --user -M "$BRUGER@" daemon-reload
systemctl --user -M "$BRUGER@" enable --now claude-arbejder.timer
echo "Færdig. Arbejderen kigger efter opgaver hvert andet minut."
