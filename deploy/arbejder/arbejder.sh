#!/usr/bin/env bash
# One cycle of the Claude Code worker on kira-home (KC-0047), run by
# claude-arbejder.timer as user claude-arbejder. Per repo: update the clone,
# let the metode plugin fetch opgaver from Kontrolcenter, and run Claude Code
# headless only when something arrived (or the last run was cut off).
# Contract: docs/superpowers/specs/2026-10-29-udviklingspipeline-fase3-design.md.
set -uo pipefail
ARBEJDE="${ARBEJDE:-$HOME/arbejde}"
METODE="$ARBEJDE/claude-metode"
PLUGIN="$METODE/plugins/metode"
SYNC="$PLUGIN/scripts/kontrolcenter/sync.mjs"
PROMPT="$ARBEJDE/kontrolcenter/deploy/arbejder/prompt.ts"
export KONTROLCENTER_URL="${KONTROLCENTER_URL:-http://127.0.0.1:8750}"

git -C "$METODE" pull -q --ff-only || echo "claude-metode: pull fejlede, kører med den version, der ligger"

# An entry is "repo" or "repo:branch" — the branch work lands on (KC-0055: ShelfAtlas:staging); default main.
for post in ${ARBEJDER_REPOS:-kontrolcenter}; do
  navn="${post%%:*}"; gren=main; [ "$post" != "$navn" ] && gren="${post#*:}"
  dir="$ARBEJDE/$navn"
  git -C "$dir" fetch -q origin "$gren" || { echo "$navn: fetch fejlede"; continue; }
  flag=
  if [ -z "$(git -C "$dir" status --porcelain)" ]; then
    git -C "$dir" checkout -q -B "$gren" "origin/$gren"
  else
    flag=--afbrudt
  fi
  ud="$(cd "$dir" && node "$SYNC" --hent --status </dev/null)"
  [ -n "$ud" ] && echo "$ud"
  prompt="$(printf '%s\n' "$ud" | node "$PROMPT" $flag)"
  [ -z "$prompt" ] && continue

  echo "$navn: starter Claude Code (${ARBEJDER_MODEL:-sonnet}, højst ${ARBEJDER_FRIST:-90m})"
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    # turbo looks for a `pnpm` binary on PATH; corepack's shim in ~/.local/bin is that binary (no sudo).
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    command -v pnpm >/dev/null || { mkdir -p "$HOME/.local/bin" && corepack enable --install-directory "$HOME/.local/bin"; }
    (cd "$dir" && pnpm install --frozen-lockfile >/dev/null 2>&1) || echo "$navn: pnpm install fejlede"
  else
    (cd "$dir" && npm ci --no-audit --no-fund >/dev/null 2>&1) || echo "$navn: npm ci fejlede"
    # KC-0176: Clawco Sky is its own package; the root test/typecheck (and pre-push) cover it.
    if [ -f "$dir/sky/package-lock.json" ]; then
      (cd "$dir/sky" && npm ci --no-audit --no-fund >/dev/null 2>&1) || echo "$navn: npm ci i sky/ fejlede"
    fi
  fi
  # Henrik's design: no permission prompts. KC-0269 is the gate (what the worker may be asked to do), not this flag.
  (cd "$dir" && timeout "${ARBEJDER_FRIST:-90m}" claude -p "$prompt" \
    --model "${ARBEJDER_MODEL:-sonnet}" --dangerously-skip-permissions --plugin-dir "$PLUGIN" </dev/null)
  echo "$navn: Claude Code sluttede (kode $?)"
  # The Stop hook reports too; this covers a run the time limit killed.
  (cd "$dir" && node "$SYNC" --status </dev/null)
done
