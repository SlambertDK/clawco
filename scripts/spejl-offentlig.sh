#!/usr/bin/env bash
# KC-0228: one-way sync of this private record's code into the public repository SlambertDK/clawco.
#   scripts/spejl-offentlig.sh --besked "Short summary of what changed"           # dry run: builds and checks the commit
#   scripts/spejl-offentlig.sh --besked "Short summary of what changed" --push    # also pushes it to the public main
# Publishes the files scripts/offentlig.txt lists, from HEAD of a clean checkout, as ONE new commit per sync, by
# "Henrik Lambert <SlambertDK@users.noreply.github.com>". The history here never travels: no private commit, author
# address or ticket text reaches the mirror. Stops before committing if the private guard test or gitleaks finds
# anything. Env: CLAWCO_SPEJL_REMOTE (default https://github.com/SlambertDK/clawco.git).
set -euo pipefail

ROD="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${CLAWCO_SPEJL_REMOTE:-https://github.com/SlambertDK/clawco.git}"
NAVN="Henrik Lambert"
MAIL="SlambertDK@users.noreply.github.com"
BESKED="" PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --besked) BESKED="${2:-}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    *) echo "ukendt argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BESKED" ] || { echo "--besked \"kort sammenfatning\" mangler" >&2; exit 2; }
printf '%s' "$BESKED" | grep -qiE 'co-authored-by|KC-[0-9]{4}' && { echo "beskeden må hverken have ticket-id eller bot-linjer" >&2; exit 2; }
command -v gitleaks >/dev/null || { echo "gitleaks mangler (brew install gitleaks)" >&2; exit 1; }
cd "$ROD"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "arbejdstræet er ikke rent; commit først" >&2; exit 1; }
KILDE=$(git rev-parse --short=12 HEAD)

echo "== Privat vagt (navne og adresser)"
node --test test/privat/offentlig.test.ts >/dev/null || { echo "vagten fandt noget: node --test test/privat/offentlig.test.ts" >&2; exit 1; }

ARB=$(mktemp -d); trap 'rm -rf "$ARB"' EXIT
UD="$ARB/ud"; mkdir "$UD"
LISTE=(); while IFS= read -r l; do LISTE+=("$l"); done < <(grep -vE '^[[:space:]]*(#|$)' scripts/offentlig.txt)
git ls-files -z -- "${LISTE[@]}" | tar --null -T - -cf - | tar -xf - -C "$UD"
echo "== Træet: $(find "$UD" -type f | wc -l | tr -d ' ') filer fra $KILDE"

echo "== gitleaks på træet"
# Run from inside the tree: .gitleaksignore fingerprints are paths relative to it.
(cd "$UD" && gitleaks dir . --redact --no-banner --exit-code 1) >/dev/null 2>"$ARB/gitleaks.log" || {
  echo "gitleaks fandt noget (rapport uden værdier):" >&2; grep -E 'leaks found|WRN' "$ARB/gitleaks.log" >&2; exit 1; }

SPEJL="$ARB/spejl"
if git ls-remote --exit-code --heads "$REMOTE" main >/dev/null 2>&1; then
  git clone -q --depth 1 "$REMOTE" "$SPEJL"
else
  git init -q -b main "$SPEJL" && git -C "$SPEJL" remote add origin "$REMOTE"
fi
git -C "$SPEJL" rm -rq --ignore-unmatch . >/dev/null
cp -R "$UD/." "$SPEJL/"
git -C "$SPEJL" add -A
if git -C "$SPEJL" diff --cached --quiet && git -C "$SPEJL" rev-parse -q --verify HEAD >/dev/null; then
  echo "== Intet nyt at spejle"; exit 0
fi
GIT_AUTHOR_NAME="$NAVN" GIT_AUTHOR_EMAIL="$MAIL" GIT_COMMITTER_NAME="$NAVN" GIT_COMMITTER_EMAIL="$MAIL" \
  git -C "$SPEJL" -c commit.gpgsign=false commit -q --no-verify -m "$BESKED" -m "Private-record: $KILDE"
echo "== Commit $(git -C "$SPEJL" rev-parse --short=12 HEAD): $(git -C "$SPEJL" log -1 --format='%an <%ae>')"
if [ "$PUSH" = 1 ]; then
  git -C "$SPEJL" push -q origin main
  echo "== Skubbet til $REMOTE"
else
  echo "== Tørkørsel: intet skubbet (tilføj --push)"
fi
