#!/usr/bin/env bash
# Install Clawco on a Mac or Linux box with one command (KC-0156):
#   curl -fsSL https://clawco.work/install.sh | bash
#   bash deploy/install.sh [--yes] [--dry-run] [--no-service] [--laptop]
#                          [--port N] [--data-dir DIR] [--agent-url URL] [--fra-ai]
# KC-0245: a new install runs Clawco's built-in agent (KC_AGENT=direkte): the only thing it needs is a model key,
# pasted in Start. The installer makes the key file that encrypts those keys at rest ($CLAWCO_HOME/hemmeligheder.key,
# mode 600, outside the user folder, never overwritten; KC_HEMMELIGHEDER_FIL). --agent-url keeps the Hermes install.
# An existing install's .env is never touched, so its agent never changes. --fra-ai lets an AI run the install:
# no questions, and the last stdout line is one JSON object (no secrets) the AI reads back.
# Layout under $CLAWCO_HOME (default ~/.clawco): app/ = the code (git clone),
# data/ = the user folder (KC_DATA_DIR, D7), .env = settings (mode 600),
# log/ = service and npm logs. Code and user folder are never the same place.
# Re-running is an update: an existing install hands over to deploy/opdater.sh
# (KC-0158; installs from before it fast-forward here, once); .env and data/ are
# never overwritten. Installer-only variables: CLAWCO_HOME, CLAWCO_REPO,
# CLAWCO_LABEL. opdater.sh sources this file with CLAWCO_FUNKTIONER=1 (main then
# returns at once) so the service handling exists in one place. Test hooks only:
# CLAWCO_GENSTART (a command that replaces the service restart),
# CLAWCO_HEALTH_KOMMANDO (replaces the /health probe), CLAWCO_VENTETID (s), CLAWCO_VENTEPAUSE (s),
# CLAWCO_TAILSCALE (ingen|findes: replaces the Tailscale lookup) and CLAWCO_BAERBAR_SVAR (j|n: answers the
# laptop-mode question without a terminal; never read together with --yes).
# Must stay bash 3.2 compatible (macOS /bin/bash): no associative arrays.
set -euo pipefail

FRA_AI=0
# One JSON string (no node needed, so it also works when node is what is missing).
json_streng() {
  local t=$1
  t=${t//\\/\\\\}; t=${t//\"/\\\"}; t=${t//$'\n'/ }; t=${t//$'\t'/ }; t=${t//$'\r'/ }
  printf '"%s"' "$t"
}
# --fra-ai: the plain text goes to stderr as ever; the last stdout line says what went wrong and the one thing to do.
fejl() {
  printf '%s\n' "$@" >&2
  if [ "$FRA_AI" = 1 ]; then
    local fix a sidste=''
    for a in "$@"; do sidste=$a; done
    fix="Read the message above, fix what it names, and run the installer again."
    if [ "$#" -gt 1 ]; then fix=${sidste#"${sidste%%[![:space:]]*}"}; fix=${fix%%$'\n'*}; fi
    printf '{"ok":false,"error":%s,"fix":%s}\n' "$(json_streng "$1")" "$(json_streng "$fix")"
  fi
  exit 1
}
info() { printf '%s\n' "$*"; }
trin() { printf '\n[%s/6] %s\n' "$1" "$2"; }

brug() {
  cat <<'TEKST'
Brug: install.sh [valg]
  --yes            ingen spørgsmål; standardværdier
  --dry-run        vis planen, ændr intet
  --no-service     installer ikke baggrundstjenesten
  --laptop         bærbar-tilstand: kun denne maskine, én bruger, ingen Tailscale nødvendig
  --port N         porten Clawco lytter på
  --data-dir DIR   brugermappen (dine data)
  --agent-url URL  (avanceret) brug din egen Hermes-agent i stedet for Clawcos indbyggede; nøglen læses skjult
  --fra-ai         lad en AI (Claude Code, Codex …) køre installationen: ingen spørgsmål (--yes),
                   og sidste linje på stdout er ét JSON-objekt: {"ok":true,"address":…,"port":…,
                   "dataDir":…,"agent":…,"service":…,"missing":[…],"next":…} eller
                   {"ok":false,"error":…,"fix":…} med en fejlkode. Aldrig en nøgle i linjen.
TEKST
}

# The one command that installs what is missing, per platform.
node_kommando() {
  if [ "$OS" = Darwin ]; then
    if command -v brew >/dev/null 2>&1; then echo "brew install node"
    else echo "Installer Homebrew fra https://brew.sh og kør derefter: brew install node"; fi
  elif command -v apt-get >/dev/null 2>&1; then
    echo "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  elif command -v dnf >/dev/null 2>&1; then echo "sudo dnf install -y nodejs"
  else echo "Hent Node 22.6 eller nyere fra https://nodejs.org/"; fi
}
git_kommando() {
  if [ "$OS" = Darwin ]; then echo "xcode-select --install"
  elif command -v apt-get >/dev/null 2>&1; then echo "sudo apt-get install -y git"
  elif command -v dnf >/dev/null 2>&1; then echo "sudo dnf install -y git"
  else echo "Installer git med din pakkehåndtering"; fi
}

# Node >= 22.6 (AGENTS.md §2: type stripping).
tjek_node() {
  command -v node >/dev/null 2>&1 || fejl "Clawco skal bruge Node 22.6 eller nyere, og Node er ikke installeret." "Kør denne ene kommando og prøv igen:" "  $(node_kommando)"
  NODE_VERSION=$(node --version 2>/dev/null || true)
  local v=${NODE_VERSION#v} major minor
  major=${v%%.*}; v=${v#*.}; minor=${v%%.*}
  case "$major$minor" in ''|*[!0-9]*) major=0; minor=0;; esac
  if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 6 ]; }; then
    fejl "Clawco skal bruge Node 22.6 eller nyere; denne maskine har ${NODE_VERSION:-en ukendt version}." "Kør denne ene kommando og prøv igen:" "  $(node_kommando)"
  fi
  command -v npm >/dev/null 2>&1 || fejl "npm mangler (det følger normalt med Node)." "Kør denne ene kommando og prøv igen:" "  $(node_kommando)"
  command -v git >/dev/null 2>&1 || fejl "Clawco hentes med git, og git er ikke installeret." "Kør denne ene kommando og prøv igen:" "  $(git_kommando)"
}

# Absolute path without trailing slashes; ~ means $HOME.
absolut() {
  local p=$1
  case "$p" in "~") p=$HOME;; "~/"*) p="$HOME/${p#"~/"}";; esac
  case "$p" in /*) ;; *) p="$PWD/$p";; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  printf '%s' "$p"
}

# The value of KEY in an env file (non-secret keys only; empty when unset).
# KC-0276 (F6): an address as it may be printed: any user:pass@ part is cut off first (the full value still goes to .env).
uden_brugerinfo() { printf '%s' "$1" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)?[^/@]*@#\1#'; }
vaerdi_i() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Ask on the terminal (works under `curl | bash`, where stdin is the script).
spoerg() {
  local svar=''
  printf '%s [%s]: ' "$1" "$2" >/dev/tty
  IFS= read -r svar </dev/tty || svar=''
  printf '%s' "${svar:-$2}"
}

# Whether Tailscale is on this machine: the CLI on PATH, or the Mac app that bundles it (CLAWCO_TAILSCALE replaces this in tests).
har_tailscale() {
  case "${CLAWCO_TAILSCALE:-}" in findes) return 0;; ingen) return 1;; esac
  command -v tailscale >/dev/null 2>&1 || [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]
}

# The value the installer sets for KEY (in VAERDI), or return 1 to leave it out.
vaerdi_for() {
  case "$1" in
    KC_PORT) VAERDI=$PORT;;
    KC_DATA_DIR) VAERDI=$DATA;;
    KC_ENV_FILE) VAERDI=$ENV_FIL;;
    KC_LAPTOP) [ "$BAERBAR" = 1 ] || return 1; VAERDI=ja;;
    KC_HOST) [ "$BAERBAR" = 1 ] || return 1; VAERDI=127.0.0.1;;
    KC_AGENT) if [ -n "$AGENT_URL" ]; then VAERDI=hermes-http; else VAERDI=direkte; fi;; # KC-0245: the built-in agent is the default
    KC_HEMMELIGHEDER_FIL) [ -z "$AGENT_URL" ] || return 1; VAERDI=$NOEGLEFIL;;
    KC_HERMES_URL) [ -n "$AGENT_URL" ] || return 1; VAERDI=$AGENT_URL;;
    KC_HERMES_API_KEY) [ -n "$AGENT_URL" ] || return 1; VAERDI=$NOEGLE;;
    *) return 1;;
  esac
}

# .env from the app's .env.example (the one list of keys): keys the installer
# sets get a value, every other key is left commented so the code's default
# applies. Builtins only, so the key never reaches a command line. Atomic.
skriv_env() {
  local eksempel="$APP/.env.example" tmp="$ENV_FIL.tmp.$$" linje noegle saet=' '
  [ -f "$eksempel" ] || fejl "Koden mangler .env.example ($eksempel)."
  (umask 077; : >"$tmp")
  {
    printf '# Clawco: skrevet af install.sh %s. Hver nøgle er forklaret i %s.\n' "$(date +%Y-%m-%d)" "$eksempel"
    while IFS= read -r linje || [ -n "$linje" ]; do
      case "$linje" in
        [A-Z]*=*)
          noegle=${linje%%=*}
          if vaerdi_for "$noegle"; then printf '%s=%s\n' "$noegle" "$VAERDI"; saet="$saet$noegle "
          else printf '# %s=\n' "$noegle"; fi;;
        *) printf '%s\n' "$linje";;
      esac
    done <"$eksempel"
  } >>"$tmp"
  for noegle in KC_PORT KC_DATA_DIR KC_ENV_FILE KC_LAPTOP KC_HOST KC_AGENT KC_HEMMELIGHEDER_FIL KC_HERMES_URL KC_HERMES_API_KEY; do
    vaerdi_for "$noegle" || continue
    case "$saet" in *" $noegle "*) ;; *) rm -f "$tmp"; fejl "Installeren og .env.example er uenige: $noegle findes ikke i $eksempel.";; esac
  done
  mv "$tmp" "$ENV_FIL"
}

# KC-0245: the key that encrypts the model keys Start saves (src/hemmeligheder/lager-fil.ts: 32 random bytes, base64).
# Made once, mode 600, outside the user folder so a backup of the data folder never carries it; never overwritten.
lav_noeglefil() {
  [ ! -e "$NOEGLEFIL" ] || { info "Nøglefil beholdt: $NOEGLEFIL (findes allerede)"; return 0; }
  local tmp="$NOEGLEFIL.tmp.$$"
  (umask 077; mkdir -p "$(dirname "$NOEGLEFIL")"; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64") + "\n")' >"$tmp") \
    || { rm -f "$tmp"; fejl "Kunne ikke lave nøglefilen ($NOEGLEFIL)."; }
  chmod 600 "$tmp"
  mv "$tmp" "$NOEGLEFIL"
  info "Nøglefil lavet: $NOEGLEFIL (krypterer dine modelnøgler; kun læsbar for dig; tag den med i en kopi med: npm run backup -- --med-noegler)"
}

# The agent this install runs: an existing .env decides (no KC_AGENT = the server's own fallback, Hermes); a new one gets the built-in agent unless --agent-url.
agent_navn() {
  local a
  if [ -f "$ENV_FIL" ]; then a=$(vaerdi_i KC_AGENT "$ENV_FIL"); printf '%s' "${a:-hermes-http}"
  elif [ -n "$AGENT_URL" ]; then printf 'hermes-http'
  else printf 'direkte'; fi
}

# --fra-ai: the one JSON line the run ends with. $1 = 1 when the service runs, $2 = "dry" for --dry-run.
# Only the address, port, folder, agent name and what is missing: never a key.
slut_fra_ai() {
  local vaert agent port mangler next adr tilfoej=''
  agent=$(agent_navn)
  port=$PORT
  if [ -z "$port" ] && [ -f "$APP/.env.example" ]; then port=$(vaerdi_i KC_PORT "$APP/.env.example"); fi
  vaert=127.0.0.1
  if [ -f "$ENV_FIL" ]; then
    vaert=$(vaerdi_i KC_HOST "$ENV_FIL")
    case "$vaert" in ''|0.0.0.0|::) vaert=127.0.0.1;; esac
  fi
  adr=null; [ -z "$port" ] || adr=$(json_streng "http://$vaert:$port")
  [ -n "$port" ] || port=null
  mangler='[]'; next='Open the address and follow the Start room.'
  if [ "$agent" = direkte ]; then
    next='Open the address and follow the Start room; the only thing it needs is a key from a model provider (or a local model).'
    if [ ! -e "$DATA/hemmeligheder.enc" ]; then mangler='["model-key"]'; fi
  fi
  [ "${2:-}" != dry ] || tilfoej=',"dryRun":true'
  local tjeneste=false
  if [ "$1" = 1 ]; then tjeneste=true; fi
  printf '{"ok":true,"address":%s,"port":%s,"dataDir":%s,"agent":%s,"service":%s,"missing":%s,"next":%s%s}\n' \
    "$adr" "$port" "$(json_streng "$DATA")" "$(json_streng "$agent")" "$tjeneste" "$mangler" "$(json_streng "$next")" "$tilfoej"
}

# LABEL and SERVICE_FIL for this platform (caller declares both, and OS).
tjeneste_find() {
  if [ "$OS" = Darwin ]; then
    LABEL=${CLAWCO_LABEL:-work.clawco}
    SERVICE_FIL="$HOME/Library/LaunchAgents/$LABEL.plist"
  else
    LABEL=${CLAWCO_LABEL:-clawco}
    SERVICE_FIL="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$LABEL.service"
  fi
}

# Fill a service template (@LABEL@ @APP@ @NODE@ @ENV@ @LOG@ @PATH@); xml escapes for the plist.
render() {
  CLAWCO_R_LABEL=$LABEL CLAWCO_R_APP=$APP CLAWCO_R_NODE=$NODE CLAWCO_R_ENV=$ENV_FIL \
  CLAWCO_R_LOG="$LOGMAPPE/clawco.log" CLAWCO_R_PATH=$PATH CLAWCO_R_XML=$2 node -e '
    const fs = require("fs");
    let t = fs.readFileSync(process.argv[1], "utf8");
    const xml = process.env.CLAWCO_R_XML === "xml";
    const esc = (s) => xml ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : s;
    for (const k of ["LABEL", "APP", "NODE", "ENV", "LOG", "PATH"]) t = t.split("@" + k + "@").join(esc(process.env["CLAWCO_R_" + k] || ""));
    const rest = /@[A-Z]+@/.exec(t);
    if (rest) { console.error("ukendt pladsholder " + rest[0]); process.exit(1); }
    process.stdout.write(t);' "$1"
}

installer_launchd() {
  local uid n=0
  uid=$(id -u)
  mkdir -p "$(dirname "$SERVICE_FIL")"
  render "$APP/deploy/work.clawco.plist.template" xml >"$SERVICE_FIL.tmp" || fejl "Kunne ikke lave launchd-filen."
  mv "$SERVICE_FIL.tmp" "$SERVICE_FIL"
  if launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true
    while launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1 && [ "$n" -lt 50 ]; do sleep 0.2; n=$((n + 1)); done
  fi
  launchctl bootstrap "gui/$uid" "$SERVICE_FIL" || fejl "launchd ville ikke starte Clawco ($SERVICE_FIL)."
  info "launchd-agent $LABEL kører og starter igen, når du logger ind. Log: $LOGMAPPE/clawco.log"
}

installer_systemd() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1 \
    || fejl "systemd for din bruger svarer ikke (fx i en container)." "Kør installeren igen med --no-service og start Clawco selv."
  mkdir -p "$(dirname "$SERVICE_FIL")"
  render "$APP/deploy/clawco.service" tekst >"$SERVICE_FIL.tmp" || fejl "Kunne ikke lave systemd-filen."
  mv "$SERVICE_FIL.tmp" "$SERVICE_FIL"
  systemctl --user daemon-reload
  systemctl --user enable -q "$LABEL.service"
  systemctl --user restart "$LABEL.service"
  info "systemd-tjenesten $LABEL kører. Log: journalctl --user -u $LABEL"
  local bruger linger
  bruger=${USER:-$(id -un)}
  linger=$(loginctl show-user "$bruger" -p Linger --value 2>/dev/null || true)
  if [ "$linger" != yes ]; then
    info "Så Clawco også starter, når maskinen genstarter, og du ikke er logget ind, skal du selv køre denne ene kommando én gang:"
    info "  sudo loginctl enable-linger $bruger"
  fi
}

# (Re)start the service from the code in $APP: write the unit/agent from its template and start it.
genstart_tjeneste() {
  if [ -n "${CLAWCO_GENSTART:-}" ]; then "$CLAWCO_GENSTART"
  elif [ "$OS" = Darwin ]; then installer_launchd
  else installer_systemd; fi
}

# One /health probe: prints {"sha":"…","uptimeSec":N} or fails (CLAWCO_HEALTH_KOMMANDO replaces it in tests).
hent_health() {
  if [ -n "${CLAWCO_HEALTH_KOMMANDO:-}" ]; then "$CLAWCO_HEALTH_KOMMANDO" "$1"; return; fi
  node -e '
    fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then((r) => r.json())
      .then((j) => { console.log(JSON.stringify({ sha: j.sha, uptimeSec: j.uptimeSec })); })
      .catch(() => process.exit(1));' "$1"
}

# Bounded wait (default 30 s) for /health to answer with git sha $2 (another program on the
# port, or the old version, does not count). Prints "<sha> <uptime seconds>"; the reason goes to stderr.
vent_paa_health() {
  local url=$1 forventet=$2 svar sha slut andet='' op
  slut=$(( $(date +%s) + ${CLAWCO_VENTETID:-30} ))
  while :; do
    if svar=$(hent_health "$url" 2>/dev/null); then
      sha=$(printf '%s' "$svar" | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p')
      if [ "$sha" = "$forventet" ]; then
        op=$(printf '%s' "$svar" | sed -n 's/.*"uptimeSec":\([0-9]*\).*/\1/p')
        printf '%s %s\n' "$sha" "${op:-0}"
        return 0
      fi
      andet=$sha
    fi
    [ "$(date +%s)" -lt "$slut" ] || break
    sleep "${CLAWCO_VENTEPAUSE:-0.5}"
  done
  if [ -n "$andet" ]; then echo "porten svarer, men med version $andet (forventet $forventet)" >&2; else echo "intet svar" >&2; fi
  return 1
}

# What laptop mode means for the phone, in plain words (printed when the install is done, with or without the service).
baerbar_besked() {
  info "Bærbar-tilstand: Clawco lytter kun på denne maskine (127.0.0.1), som én bruger. Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen. Start-rummet viser, hvordan."
  info "Vil du holde den bærbare vågen, er det dit eget valg (fx med caffeinate på en Mac); Clawco gør det aldrig i det skjulte."
}

main() {
  [ -z "${CLAWCO_FUNKTIONER:-}" ] || return 0 # sourced by opdater.sh: only the functions are wanted
  local a
  for a in "$@"; do case "$a" in --fra-ai) FRA_AI=1;; esac; done # before the flags are read, so even a bad flag answers in JSON
  local JA=0 TOER=0 UDEN_SERVICE=0 BAERBAR=0 PORT='' DATA='' AGENT_URL='' NOEGLE='' VAERDI='' NODE_VERSION='' ENV_BAERBAR='' SVAR=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --yes|-y) JA=1;;
      --dry-run) TOER=1;;
      --no-service) UDEN_SERVICE=1;;
      --laptop) BAERBAR=1;;
      --fra-ai) JA=1; FRA_AI=1;;
      --port|--data-dir|--agent-url)
        [ $# -ge 2 ] || fejl "$1 skal have en værdi." "$(brug)"
        case "$1" in --port) PORT=$2;; --data-dir) DATA=$2;; --agent-url) AGENT_URL=$2;; esac
        shift;;
      -h|--help) brug; exit 0;;
      *) fejl "Ukendt valg: $1" "$(brug)";;
    esac
    shift
  done

  # 1. The system.
  local OS
  OS=$(uname -s)
  case "$OS" in Darwin|Linux) ;; *) fejl "Clawco kan kun installeres på Mac og Linux (denne maskine er: $OS).";; esac
  tjek_node
  local NODE HJEM APP ENV_FIL LOGMAPPE REPO LABEL SERVICE_FIL NOEGLEFIL
  NODE=$(command -v node)
  HJEM=$(absolut "${CLAWCO_HOME:-$HOME/.clawco}")
  APP="$HJEM/app"
  ENV_FIL="$HJEM/.env"
  NOEGLEFIL="$HJEM/hemmeligheder.key"
  LOGMAPPE="$HJEM/log"
  REPO=${CLAWCO_REPO:-https://github.com/SlambertDK/clawco.git}
  tjeneste_find

  # Settings: an existing .env decides; otherwise flags, then questions, then defaults.
  local INTERAKTIV=0
  if [ "$JA" = 0 ] && [ "$TOER" = 0 ] && (exec </dev/tty) 2>/dev/null; then INTERAKTIV=1; fi
  if [ -f "$ENV_FIL" ]; then
    ENV_BAERBAR=$(vaerdi_i KC_LAPTOP "$ENV_FIL")
    if [ -n "$PORT$DATA$AGENT_URL" ] || { [ "$BAERBAR" = 1 ] && [ "$ENV_BAERBAR" != ja ]; }; then
      info "Bemærk: $ENV_FIL findes og bestemmer port, brugermappe, agent og bærbar-tilstand; dine valg på kommandolinjen bruges ikke."
    fi
    PORT=$(vaerdi_i KC_PORT "$ENV_FIL"); DATA=$(vaerdi_i KC_DATA_DIR "$ENV_FIL"); AGENT_URL=''
    BAERBAR=0; [ "$ENV_BAERBAR" != ja ] || BAERBAR=1
  elif [ "$INTERAKTIV" = 1 ]; then
    [ -n "$PORT" ] || PORT=$(spoerg "Hvilken port skal Clawco lytte på? (Enter = standard)" "")
    [ -n "$DATA" ] || DATA=$(spoerg "Hvor skal dine data ligge (brugermappen)?" "$HJEM/data")
  fi
  # KC-0160: no Tailscale here: suggest laptop mode. Only the user's own yes turns it on (never --yes alone).
  if [ ! -f "$ENV_FIL" ] && [ "$BAERBAR" = 0 ] && [ "$TOER" = 0 ] && [ "$JA" = 0 ] && { [ "$INTERAKTIV" = 1 ] || [ -n "${CLAWCO_BAERBAR_SVAR:-}" ]; } && ! har_tailscale; then
    info "Tailscale er ikke fundet på denne maskine."
    info "Bærbar-tilstand installerer Clawco kun til denne maskine og til én bruger. Uden Tailscale kan telefonen ikke nå Clawco; med Tailscale kan den, men kun når den bærbare er vågen."
    if [ -n "${CLAWCO_BAERBAR_SVAR:-}" ]; then SVAR=$CLAWCO_BAERBAR_SVAR; else SVAR=$(spoerg "Installér i bærbar-tilstand? (j/n)" "n"); fi
    case "$SVAR" in j|J|ja|Ja|JA|y|Y|yes) BAERBAR=1;; esac
  fi
  DATA=$(absolut "${DATA:-$HJEM/data}")
  case "$PORT" in '') ;; *[!0-9]*) fejl "Porten skal være et tal mellem 1 og 65535 (fik: $PORT).";; *) [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fejl "Porten skal være et tal mellem 1 og 65535 (fik: $PORT).";; esac
  case "$DATA/" in "$APP/"*) fejl "Brugermappen ($DATA) må ikke ligge i kodemappen ($APP): koden udskiftes ved opdatering, dine data må ikke.";; esac
  case "$APP/" in "$DATA/"*) fejl "Brugermappen ($DATA) må ikke indeholde kodemappen ($APP). Vælg en anden mappe med --data-dir.";; esac
  case "$AGENT_URL" in ''|http://*|https://*) ;; *) fejl "--agent-url skal begynde med http:// eller https:// (fik: $(uden_brugerinfo "$AGENT_URL")).";; esac

  local VIS_PORT=$PORT
  if [ -z "$VIS_PORT" ] && [ -f "$APP/.env.example" ]; then VIS_PORT=$(vaerdi_i KC_PORT "$APP/.env.example"); fi
  if [ "$TOER" = 1 ]; then
    info "Plan (--dry-run: intet bliver ændret):"
    info "  1. System: $OS, node $NODE_VERSION, git og npm er i orden"
    if [ -d "$APP/.git" ]; then info "  2. Kode: opdater $APP (git fetch + fast-forward)"
    else info "  2. Kode: git clone $REPO → $APP"; fi
    info "  3. Afhængigheder: npm ci --omit=dev --ignore-scripts i $APP"
    if [ -f "$ENV_FIL" ]; then info "  4. Brugermappe: $DATA; indstillinger: $ENV_FIL findes og beholdes"
    else
      info "  4. Brugermappe: $DATA; indstillinger: $ENV_FIL (ny, kun læsbar for dig)"
      if [ -z "$AGENT_URL" ]; then info "     Agent: Clawcos indbyggede (KC_AGENT=direkte); nøglefil til dine modelnøgler: $NOEGLEFIL (ny, kun læsbar for dig)"
      else info "     Agent: din egen Hermes på $(uden_brugerinfo "$AGENT_URL") (KC_AGENT=hermes-http)"; fi
    fi
    if [ "$BAERBAR" = 1 ]; then info "     Bærbar-tilstand: Clawco lytter kun på 127.0.0.1 (kun denne maskine), som én bruger uden login (KC_LAPTOP=ja i .env)"; fi
    if [ "$UDEN_SERVICE" = 1 ]; then info "  5. Baggrundstjeneste: springes over (--no-service)"
    elif [ "$OS" = Darwin ]; then info "  5. Baggrundstjeneste: launchd-agent $SERVICE_FIL"
    else info "  5. Baggrundstjeneste: systemd-brugertjeneste $SERVICE_FIL"; fi
    if [ "$UDEN_SERVICE" = 1 ]; then info "  6. Tjek: springes over (ingen tjeneste)"
    else info "  6. Tjek: http://127.0.0.1:${VIS_PORT:-<KC_PORT fra .env.example>}/health"; fi
    if [ "$FRA_AI" = 1 ]; then slut_fra_ai $((1 - UDEN_SERVICE)) dry; fi
    return 0
  fi

  # An existing install is updated by opdater.sh (safety copy, health check, roll back); installs
  # from before it have no opdater.sh yet and fast-forward in step 2 below this one time.
  if [ -d "$APP/.git" ] && [ -f "$ENV_FIL" ] && [ -f "$APP/deploy/opdater.sh" ]; then
    info "Clawco er allerede installeret i $APP; opdaterer i stedet for at installere igen."
    export CLAWCO_HOME="$HJEM" CLAWCO_REPO="$REPO" CLAWCO_LABEL="$LABEL"
    if [ "$FRA_AI" = 1 ]; then # no exec: the JSON line has to come last
      bash "$APP/deploy/opdater.sh" || fejl "Opdateringen af Clawco fejlede (se meddelelserne ovenfor)." "Ret det, opdateringen nævner, og kør installeren igen."
      slut_fra_ai 1
      return 0
    fi
    exec bash "$APP/deploy/opdater.sh"
  fi

  # Advanced: the agent key, read hidden; only its name and length are ever shown.
  if [ -n "$AGENT_URL" ]; then
    if [ "$INTERAKTIV" = 1 ]; then
      printf 'Nøgle til agenten (vises ikke): ' >/dev/tty
      IFS= read -rs NOEGLE </dev/tty || NOEGLE=''
      printf '\n' >/dev/tty
    else
      IFS= read -rs NOEGLE || [ -n "$NOEGLE" ] || NOEGLE=''
    fi
    [ -n "$NOEGLE" ] || fejl "Ingen nøgle modtaget. Uden --yes spørges der; med --yes læses den fra stdin."
    info "KC_HERMES_API_KEY: ${#NOEGLE} tegn"
  fi

  trin 1 "System: $OS, node $NODE_VERSION, git og npm er i orden"

  trin 2 "Koden"
  if [ -d "$APP/.git" ]; then
    git -C "$APP" fetch -q origin || fejl "Kunne ikke hente nyt fra $REPO."
    git -C "$APP" merge -q --ff-only '@{u}' >/dev/null || fejl "Koden i $APP har lokale ændringer, der står i vejen for opdateringen." "Intet er slettet. Ryd op i mappen, og kør installeren igen."
    info "Opdateret: $APP ($(git -C "$APP" rev-parse --short HEAD))"
  elif [ -e "$APP" ]; then
    fejl "$APP findes, men er ikke en Clawco-kodemappe. Flyt den, og kør installeren igen."
  else
    (umask 077; mkdir -p "$HJEM")
    git clone -q "$REPO" "$APP" || fejl "Kunne ikke hente koden fra $REPO."
    info "Hentet: $APP ($(git -C "$APP" rev-parse --short HEAD))"
  fi

  trin 3 "Afhængigheder"
  mkdir -p "$LOGMAPPE"
  (cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund) >"$LOGMAPPE/npm.log" 2>&1 \
    || { tail -20 "$LOGMAPPE/npm.log" >&2; fejl "npm ci fejlede (hele loggen: $LOGMAPPE/npm.log)."; }
  info "npm ci --omit=dev --ignore-scripts: i orden"

  trin 4 "Brugermappe og indstillinger"
  [ -n "$PORT" ] || PORT=$(vaerdi_i KC_PORT "$APP/.env.example")
  [ -n "$PORT" ] || fejl "Ingen port: hverken --port, .env eller KC_PORT i .env.example."
  (umask 077; mkdir -p "$DATA")
  info "Brugermappe: $DATA"
  if [ -f "$ENV_FIL" ]; then
    info ".env beholdt: $ENV_FIL (installeren retter aldrig i den)"
  else
    if [ -z "$AGENT_URL" ]; then lav_noeglefil; fi
    skriv_env
    info ".env skrevet: $ENV_FIL (kun læsbar for dig)"
  fi
  NOEGLE=''

  if [ "$UDEN_SERVICE" = 1 ]; then
    trin 5 "Baggrundstjeneste: springes over (--no-service)"
    info "Start Clawco selv med: cd \"$APP\" && node --env-file=\"$ENV_FIL\" src/server.ts"
    if [ "$BAERBAR" = 1 ]; then baerbar_besked; fi
    if [ "$FRA_AI" = 1 ]; then slut_fra_ai 0; fi
    return 0
  fi
  trin 5 "Baggrundstjeneste"
  genstart_tjeneste

  trin 6 "Tjek"
  local VAERT URL SHA
  VAERT=$(vaerdi_i KC_HOST "$ENV_FIL")
  case "$VAERT" in ''|0.0.0.0|::) VAERT=127.0.0.1;; esac
  URL="http://$VAERT:$PORT"
  SHA=$(vent_paa_health "$URL/health" "$(git -C "$APP" rev-parse --short HEAD)") || fejl "Clawco svarer ikke på $URL/health efter 30 sekunder." "Se loggen: $([ "$OS" = Darwin ] && echo "$LOGMAPPE/clawco.log" || echo "journalctl --user -u $LABEL")"
  SHA=${SHA%% *}
  info "Clawco kører (version $SHA). Åbn: $URL/"
  if [ "$BAERBAR" = 1 ]; then baerbar_besked
  elif command -v tailscale >/dev/null 2>&1; then
    info "Tailscale fundet: 'tailscale serve --bg $PORT' gør Clawco tilgængelig på dit tailnet."
  fi
  if [ "$FRA_AI" = 1 ]; then slut_fra_ai 1; fi
}

main "$@"
