#!/usr/bin/env bash
# Update an installed Clawco with one command (KC-0158):
#   bash ~/.clawco/app/deploy/opdater.sh        (install.sh calls it when it finds an install)
# What it does, in order: refuses if the user folder or the notes folder and the code folder
# overlap; fetches and fast-forwards the code to origin/main; keeps a private safety copy of
# .env and the settings file in $CLAWCO_HOME/backup-before-update/ (overwritten each time);
# npm ci --omit=dev; restarts the service the way install.sh does (it sources install.sh for
# that, one way to do it); waits for /health to answer with the new git sha. If it does not,
# the old sha is checked out again, restarted and confirmed, and the exit code is non-zero.
# Invariant: nothing here ever writes inside KC_DATA_DIR or the notes folder, and .env is
# only read and copied, never rewritten. Variables: CLAWCO_HOME (default ~/.clawco),
# CLAWCO_GREN (release ref, default main); test hooks as in install.sh.
# Must stay bash 3.2 compatible (macOS /bin/bash).
set -euo pipefail

# Existing path, symlinks resolved as far as it exists (the rest appended as written).
virkelig() {
  local p=$1 rest=''
  while [ ! -d "$p" ] && [ "$p" != / ]; do rest="/$(basename "$p")$rest"; p=$(dirname "$p"); done
  p=$(cd "$p" && pwd -P)
  [ "$p" != / ] || p=''
  printf '%s' "$p$rest"
}

# Inside (or equal to) a folder?
indeni() { case "$1/" in "$2/"*) return 0;; esac; return 1; }

# A folder named in .env, as the service sees it: relative paths start in the code folder.
sti_fra_env() {
  local v=$1
  case "$v" in *..*) fejl "$2 ($v) indeholder '..'. Skriv hele stien i $ENV_FIL og kør opdateringen igen.";; esac
  case "$v" in /*) ;; *) v="$APP/$v";; esac
  v=$(printf '%s' "$v" | sed -e 's#/\./#/#g' -e 's#/\.$##' -e 's#//*#/#g')
  while [ "${#v}" -gt 1 ] && [ "${v%/}" != "$v" ]; do v=${v%/}; done
  virkelig "$v"
}

# Code folder and a folder of the user's own must not overlap: the code is replaced, the data never.
tjek_adskilt() {
  if indeni "$2" "$APPR"; then
    fejl "$1 ($2) må ikke ligge i kodemappen ($APPR): koden udskiftes ved opdatering, dine data må ikke." "Intet er ændret. Flyt mappen, ret $ENV_FIL, og prøv igen."
  fi
  if indeni "$APPR" "$2"; then
    fejl "$1 ($2) må ikke indeholde kodemappen ($APPR): en opdatering ville så skrive i dine data." "Intet er ændret. Flyt mappen, ret $ENV_FIL, og prøv igen."
  fi
}

# The last 20 log lines; a line that looks like a key, token or password is hidden, never printed.
log_hale() {
  { if [ -f "$LOGMAPPE/clawco.log" ]; then tail -n 20 "$LOGMAPPE/clawco.log"
    elif [ "$OS" = Linux ] && command -v journalctl >/dev/null 2>&1; then journalctl --user -u "$LABEL" -n 20 --no-pager 2>/dev/null || true
    fi; } | node -e '
      const bad = /key|token|secret|passw|bearer|authorization|credential|nøgle|[A-Za-z0-9_-]{32,}|\b(sk|ghp|gho|xox[abp])[-_][A-Za-z0-9]{8,}/i;
      const l = require("fs").readFileSync(0, "utf8").split("\n");
      if (l[l.length - 1] === "") l.pop();
      for (const x of l) console.log(bad.test(x) ? "[linje skjult: ligner en nøgle]" : x);'
}

opdater() {
  case "${1:-}" in
    '') ;;
    -h|--help) echo "Brug: opdater.sh   (henter den nyeste udgave af Clawco; dine data og indstillinger røres ikke)"; return 0;;
    *) printf 'Ukendt valg: %s\n' "$1" >&2; return 1;;
  esac
  local HER
  HER=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  # The functions are loaded now, before any git command can replace this file or install.sh:
  # a roll back to an older sha still runs the code that was here when the update began.
  export CLAWCO_FUNKTIONER=1
  # shellcheck source=install.sh
  . "$HER/install.sh"
  unset CLAWCO_FUNKTIONER

  local OS NODE_VERSION='' NODE HJEM APP APPR ENV_FIL LOGMAPPE LABEL SERVICE_FIL GREN
  OS=$(uname -s)
  case "$OS" in Darwin|Linux) ;; *) fejl "Clawco kan kun opdateres på Mac og Linux (denne maskine er: $OS).";; esac
  tjek_node
  NODE=$(command -v node)
  HJEM=$(absolut "${CLAWCO_HOME:-$HOME/.clawco}")
  APP="$HJEM/app"
  ENV_FIL="$HJEM/.env"
  LOGMAPPE="$HJEM/log"
  GREN=${CLAWCO_GREN:-main}
  tjeneste_find
  [ -d "$APP/.git" ] && [ -f "$ENV_FIL" ] || fejl "Clawco er ikke installeret i $HJEM, så der er intet at opdatere." "Installer først med install.sh."
  APPR=$(virkelig "$APP")

  # 1. Refuse before anything changes: the user folder and the notes folder are never touched.
  local DATA VAULT_DIR INBOX VAULT PORT VAERT URL
  DATA=$(sti_fra_env "$(vaerdi_i KC_DATA_DIR "$ENV_FIL")" "KC_DATA_DIR")
  tjek_adskilt "Brugermappen" "$DATA"
  VAULT_DIR=$(vaerdi_i KC_VAULT_DIR "$ENV_FIL")
  INBOX=$(vaerdi_i KC_VAULT_INBOX "$ENV_FIL")
  if [ -n "$INBOX" ]; then
    INBOX=$(sti_fra_env "$INBOX" "KC_VAULT_INBOX")
    tjek_adskilt "Indbakken til dine noter" "$INBOX"
  fi
  if [ -n "$VAULT_DIR" ]; then VAULT=$(sti_fra_env "$VAULT_DIR" "KC_VAULT_DIR")
  elif [ -n "$INBOX" ]; then VAULT=$(dirname "$INBOX")
  else VAULT=''; fi
  [ -z "$VAULT" ] || tjek_adskilt "Mappen med dine noter" "$VAULT"

  # 2. Fetch and see whether there is anything new.
  local GAMMEL_FULD GAMMEL NY_FULD NY
  GAMMEL_FULD=$(git -C "$APP" rev-parse HEAD)
  GAMMEL=$(git -C "$APP" rev-parse --short HEAD)
  git -C "$APP" fetch -q origin || fejl "Kunne ikke hente nyt fra origin. Tjek netforbindelsen; intet er ændret."
  NY_FULD=$(git -C "$APP" rev-parse -q --verify "origin/$GREN^{commit}") || fejl "origin har ingen gren der hedder $GREN. Intet er ændret."
  NY=$(git -C "$APP" rev-parse --short "$NY_FULD")
  if [ "$GAMMEL_FULD" = "$NY_FULD" ]; then
    info "Clawco er allerede ajour (version $GAMMEL). Intet er ændret."
    return 0
  fi
  git -C "$APP" merge-base --is-ancestor "$GAMMEL_FULD" "$NY_FULD" \
    || fejl "Koden i $APP ($GAMMEL) er ikke en ældre udgave af $GREN, så den kan ikke opdateres uden at miste noget." "Intet er ændret. Se i mappen, eller installer forfra i en ny mappe."
  info "Opdaterer Clawco: $GAMMEL → $NY"

  # 3. A private safety copy of the two settings files (the data folder itself is KC-0159's backup).
  local SIKKER="$HJEM/backup-before-update" f
  (umask 077; mkdir -p "$SIKKER") && chmod 700 "$SIKKER"
  rm -f "$SIKKER/.env" "$SIKKER/indstillinger.json"
  for f in "$ENV_FIL" "$DATA/indstillinger.json"; do
    [ -f "$f" ] || continue
    (umask 077; cp "$f" "$SIKKER/.ny.$$" && mv -f "$SIKKER/.ny.$$" "$SIKKER/$(basename "$f")") || fejl "Kunne ikke tage en sikkerhedskopi af $f; intet er ændret."
  done
  info "Sikkerhedskopi af indstillingerne: $SIKKER"

  # Where /health answers (the new code's .env.example only if .env has no port).
  PORT=$(vaerdi_i KC_PORT "$ENV_FIL")
  VAERT=$(vaerdi_i KC_HOST "$ENV_FIL")
  case "$VAERT" in ''|0.0.0.0|::) VAERT=127.0.0.1;; esac

  local HAR_TJENESTE=0 AARSAG='' RESULTAT=''
  if [ -n "${CLAWCO_GENSTART:-}" ] || [ -f "$SERVICE_FIL" ]; then HAR_TJENESTE=1; fi
  mkdir -p "$LOGMAPPE"

  # Restart from the code now in place and wait for the expected sha. 0 = it answers; AARSAG says why not.
  start_og_tjek() {
    if ! ( genstart_tjeneste ) >>"$LOGMAPPE/opdater.log" 2>&1; then
      AARSAG="tjenesten kunne ikke genstartes, se $LOGMAPPE/opdater.log"; return 1
    fi
    if RESULTAT=$(vent_paa_health "$URL/health" "$1" 2>"$LOGMAPPE/.aarsag"); then return 0; fi
    AARSAG=$(cat "$LOGMAPPE/.aarsag" 2>/dev/null || echo "intet svar")
    return 1
  }
  installer_afhaengigheder() {
    (cd "$APP" && npm ci --omit=dev --no-audit --no-fund) >"$LOGMAPPE/npm.log" 2>&1
  }

  # 4. The new code, its dependencies, the restart.
  local OK=1
  git -C "$APP" checkout -q -f -B "$GREN" "$NY_FULD" 2>>"$LOGMAPPE/opdater.log" || { AARSAG="koden kunne ikke flyttes til $NY"; OK=0; }
  git -C "$APP" branch -q --set-upstream-to="origin/$GREN" "$GREN" >/dev/null 2>&1 || true
  if [ "$OK" = 1 ]; then
    if installer_afhaengigheder; then info "Afhængigheder: i orden (npm ci --omit=dev)"
    else AARSAG="npm ci fejlede, se $LOGMAPPE/npm.log"; OK=0; fi
  fi
  if [ "$OK" = 1 ] && [ "$HAR_TJENESTE" = 0 ]; then
    info "Koden er nu version $NY. Der er ingen baggrundstjeneste (installeret med --no-service), så stop Clawco, og start den igen selv, for at køre den nye version."
    return 0
  fi
  if [ "$OK" = 1 ]; then
    [ -n "$PORT" ] || PORT=$(vaerdi_i KC_PORT "$APP/.env.example")
    [ -n "$PORT" ] || { AARSAG="ingen port i .env"; OK=0; }
    URL="http://$VAERT:$PORT"
  fi
  if [ "$OK" = 1 ]; then
    info "Genstarter Clawco og venter på version $NY ..."
    start_og_tjek "$NY" || OK=0
  fi
  if [ "$OK" = 1 ]; then
    info "Clawco er opdateret."
    info "  Før:  version $GAMMEL"
    info "  Nu:   version $NY"
    info "  Har kørt i ${RESULTAT#* } sekunder."
    return 0
  fi

  # 5. It did not come up: the log first (it describes the new version), then back to the old sha.
  local LOG
  LOG=$(log_hale 2>/dev/null || true)
  {
    printf '\nOpdateringen til version %s lykkedes ikke (%s).\n' "$NY" "$AARSAG"
    printf 'Clawco går tilbage til version %s ...\n' "$GAMMEL"
  } >&2
  if git -C "$APP" checkout -q -f -B "$GREN" "$GAMMEL_FULD" 2>>"$LOGMAPPE/opdater.log" && installer_afhaengigheder; then
    if [ "$HAR_TJENESTE" = 0 ] || start_og_tjek "$GAMMEL"; then
      printf 'Clawco er rullet tilbage til version %s, og den kører igen. Dine data og indstillinger er ikke rørt.\n' "$GAMMEL" >&2
    else
      printf 'Koden er tilbage på version %s, men Clawco svarer heller ikke nu (%s).\nDine data og indstillinger er ikke rørt. Se loggen, og kør opdater.sh igen, når det er løst.\n' "$GAMMEL" "$AARSAG" >&2
    fi
  else
    printf 'Det lykkedes ikke at sætte version %s tilbage (se %s og %s). Dine data og indstillinger er ikke rørt.\n' "$GAMMEL" "$LOGMAPPE/npm.log" "$LOGMAPPE/opdater.log" >&2
  fi
  if [ -n "$LOG" ]; then
    printf '\nSidste linjer fra loggen (linjer der ligner en nøgle er skjult):\n%s\n' "$LOG" >&2
  fi
  return 1
}

opdater "$@"
