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
# Pinned exact (KC-0276, F6): the worker runs with --dangerously-skip-permissions, so its toolchain never floats.
# Bump on purpose, with `claude --version` of a version that has run on the Mac for a while.
CLAUDE_KODE_VERSION=2.1.285
GIT_NAVN="SlambertDK"
# The worker's commit address; GitHub's noreply form keeps a personal address out of the history.
GIT_MAIL="${KC_ARBEJDER_GIT_MAIL:-SlambertDK@users.noreply.github.com}"
som() { sudo -iu "$BRUGER" bash -lc "$1"; }

echo "== Bruger og værktøj"
id "$BRUGER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$BRUGER"
# Explicit 0700 (KC-0276, F6): the worker home is never readable by the household, whatever useradd's UMASK says.
chmod 700 "$HJEM"
[ "$(stat -c %a "$HJEM")" = 700 ] || { echo "FEJL: $HJEM er ikke 0700"; exit 1; }
loginctl enable-linger "$BRUGER"
command -v gh >/dev/null || { apt-get update -qq && apt-get install -y -qq gh; }
som 'grep -q npm-global ~/.profile || echo "export PATH=\$HOME/.npm-global/bin:\$HOME/.local/bin:\$PATH" >> ~/.profile'
som "npm config set prefix ~/.npm-global && npm install -g --no-fund --no-audit @anthropic-ai/claude-code@$CLAUDE_KODE_VERSION >/dev/null && claude --version"
som "git config --global user.name '$GIT_NAVN' && git config --global user.email '$GIT_MAIL'"
som 'mkdir -p ~/.claude && test -f ~/.claude/settings.json || echo "{\"attribution\":{\"commit\":\"\",\"pr\":\"\"}}" > ~/.claude/settings.json'

echo "== 1/2 GitHub: åbn linket, skriv koden og godkend"
som 'gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web'
som 'gh auth setup-git'

echo "== Kloner"
som 'mkdir -p ~/arbejde && cd ~/arbejde && { test -d kontrolcenter || git clone -q https://github.com/SlambertDK/kontrolcenter; } && { test -d claude-metode || git clone -q https://github.com/SlambertDK/claude-metode; }'
som 'ln -sf ~/arbejde/claude-metode/global/CLAUDE.md ~/.claude/CLAUDE.md'
som 'cd ~/arbejde/kontrolcenter && git config core.hooksPath .githooks && npm ci --ignore-scripts --no-audit --no-fund >/dev/null'
# Playwright's browser download is pinned to the version in package-lock (KC-0276, F6), read from the lockfile, not copied here.
PW_VERSION="$(node -p "require('$HJEM/arbejde/kontrolcenter/package-lock.json').packages['node_modules/playwright-core'].version")"
[[ "$PW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "FEJL: playwright-core-versionen i package-lock.json kunne ikke læses"; exit 1; }
som "cd ~/arbejde/kontrolcenter && npx --yes playwright-core@$PW_VERSION install chromium >/dev/null"

echo "== Deploy-nøgle (kan kun deploye det, der er merget på GitHub)"
som 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && { test -f ~/.ssh/deploy || ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/deploy -C claude-arbejder-deploy; }'
pub="$(cat "$HJEM/.ssh/deploy.pub")"
nogler="/home/$EJER/.ssh/authorized_keys"
# KC-0276 (F6): the key only works from this machine (`from=`), and a line made before that is rewritten, not kept.
NOEGLE_LINJE="restrict,from=\"127.0.0.1,::1\",command=\"bash /home/$EJER/kontrolcenter/deploy/arbejder/deploy-fra-github.sh\" $pub"
grep -qxF "$NOEGLE_LINJE" "$nogler" || {
  nogler_ny="$(mktemp)"; grep -vF "$pub" "$nogler" > "$nogler_ny" || true; echo "$NOEGLE_LINJE" >> "$nogler_ny"
  cat "$nogler_ny" > "$nogler"; rm -f "$nogler_ny"   # cat keeps the file's owner and mode
}
som "printf 'Host kira-deploy\n  HostName localhost\n  User $EJER\n  IdentityFile ~/.ssh/deploy\n  IdentitiesOnly yes\n' > ~/.ssh/config && chmod 600 ~/.ssh/config && ssh-keyscan localhost >> ~/.ssh/known_hosts 2>/dev/null"

echo "== 2/2 Claude: åbn linket, log ind og indsæt koden"
som 'claude auth status >/dev/null 2>&1 || claude auth login --claudeai'

echo "== Timer"
install -d -o "$BRUGER" -g "$BRUGER" "$HJEM/.config/systemd/user"
install -m 644 -o "$BRUGER" -g "$BRUGER" "$KILDE/claude-arbejder.service" "$KILDE/claude-arbejder.timer" "$HJEM/.config/systemd/user/"
systemctl --user -M "$BRUGER@" daemon-reload
systemctl --user -M "$BRUGER@" enable --now claude-arbejder.timer
echo "Færdig. Arbejderen kigger efter opgaver hvert andet minut."
