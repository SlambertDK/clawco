#!/usr/bin/env bash
# Install Clawco Sky's control plane on kira-home (KC-0212, spec D18) — the ONE root step. Henrik runs
# it once from his checkout; every later step is the agent's (as henrik, through the sudoers drop-in
# this installs):
#   sudo bash ~/kontrolcenter/sky/deploy/opsaet-root.sh            # install
#   bash sky/deploy/opsaet-root.sh --dry-run                        # no root: print what it would do
#   bash sky/deploy/opsaet-root.sh --sudoers                        # print the sudoers drop-in
# Idempotent: each step checks first (read-only) and acts only when needed, so a second run changes
# nothing. It never prints a secret, never touches honcho's Docker Postgres on 127.0.0.1:5432 (the
# system Postgres it enables is socket-only), and never touches the two existing cloudflared units.
# Bash 3.2-compatible on purpose: sky/test/deploy.test.ts runs --dry-run on the Mac.
set -euo pipefail

SKY_USER=sky
SKY_HOME=/srv/sky
CHECKOUT="$SKY_HOME/kontrolcenter"
ENV_FIL="$SKY_HOME/.env"
HENRIK=henrik
BARE="/home/$HENRIK/kontrolcenter.git"
UNITS=/etc/systemd/system
SKY_UNIT=sky.service
TUNNEL_UNIT=clawco-sky-tunnel.service
SUDOERS=/etc/sudoers.d/clawco-sky
JOURNALD_KONF=/etc/systemd/journald.conf.d/clawco-30-dage.conf
PG_KONF_NAVN=clawco-sky.conf
PG_SOCKET=/var/run/postgresql
NODE=/usr/bin/node
NODE_MIN=22.18          # TypeScript type stripping without a flag
CLOUDFLARED_MIN=2025.4.0 # `tunnel run --token-file`
# Units on this host that belong to other sites: never installed, enabled, restarted or edited here.
FREMMEDE_UNITS="cloudflared.service cloudflared-petrilab.service"
HER="$(cd "$(dirname "$0")" && pwd)"

TOER=0
case "${1:-}" in
  --dry-run) TOER=1 ;;
  --sudoers) ;;
  "") ;;
  *) echo "brug: opsaet-root.sh [--dry-run | --sudoers]"; exit 2 ;;
esac

sudoers_tekst() {
  cat <<EOF
# Clawco Sky (KC-0212), installed by sky/deploy/opsaet-root.sh — rerun the script, never edit by hand.
# $HENRIK (and the agent over ssh as $HENRIK) acts as the service user $SKY_USER without a password:
# deploy.sh, saet-hemmelighed.sh writing $ENV_FIL, psql as the sky role.
$HENRIK ALL=($SKY_USER) NOPASSWD: ALL
# ... and restarts exactly Sky's two units. Nothing that opens a pager (status, journalctl) runs as root.
$HENRIK ALL=(root) NOPASSWD: /usr/bin/systemctl restart sky, /usr/bin/systemctl restart clawco-sky-tunnel, /usr/bin/systemctl is-active sky, /usr/bin/systemctl is-active clawco-sky-tunnel
# deploy.sh, run as $SKY_USER, restarts the control plane after a pull.
$SKY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart sky
EOF
}

if [ "${1:-}" = "--sudoers" ]; then sudoers_tekst; exit 0; fi
ROD=0; [ "$(id -u)" = 0 ] && ROD=1
if [ "$TOER" = 0 ] && [ "$ROD" = 0 ]; then echo "Kør med sudo (eller --dry-run for at se planen uden root)."; exit 2; fi

# ---------- helpers ----------
som_bruger() { # som_bruger <user> <cmd…>: as that user, with its own HOME (root only; false otherwise)
  local u="$1"; shift
  [ "$ROD" = 1 ] && command -v runuser >/dev/null 2>&1 || return 1
  local h; h="$(getent passwd "$u" | cut -d: -f6)"
  runuser -u "$u" -- env HOME="${h:-/}" "$@"
}
ver_ge() { # ver_ge <have> <want>: version have ≥ want (dotted numbers)
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}
mode_ejer() { stat -c '%a %U' "$1" 2>/dev/null || true; }
pg_klynge() { command -v pg_lsclusters >/dev/null 2>&1 && pg_lsclusters --no-header 2>/dev/null | awk 'NF { print $1, $2, $3 }' || true; }
pg_konf_dir() { local k; k="$(pg_klynge | head -1)"; [ -n "$k" ] && echo "/etc/postgresql/$(echo "$k" | cut -d' ' -f1)/$(echo "$k" | cut -d' ' -f2)"; }
pg_port() { pg_klynge | head -1 | cut -d' ' -f3; }
# The cluster's own systemd unit: the umbrella postgresql.service stays "active" without starting a cluster made after it.
pg_enhed() { local k; k="$(pg_klynge | head -1)"; [ -n "$k" ] && echo "postgresql@$(echo "$k" | cut -d' ' -f1)-$(echo "$k" | cut -d' ' -f2).service"; }
pg_online() { command -v pg_lsclusters >/dev/null 2>&1 && [ "$(pg_lsclusters --no-header 2>/dev/null | awk 'NF { print $4; exit }')" = online ]; }
db_url() { echo "postgres:///sky?host=$PG_SOCKET&port=$(pg_port)"; }

trin() { # trin <description> <check> <do>: the check is read-only; do only runs when it fails
  local hvad="$1" tjek="$2" goer="$3"
  if "$tjek"; then echo "  ok      $hvad"; return 0; fi
  if [ "$TOER" = 1 ]; then echo "  ville   $hvad"; return 0; fi
  echo "  gør     $hvad"
  "$goer"
  "$tjek" || { echo "FEJL: $hvad lykkedes ikke"; exit 1; }
}

# ---------- preconditions (missing ones stop a real run; a dry run lists them) ----------
MANGLER=0
kraev() { # kraev <description> <cmd…>
  local hvad="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok      $hvad"; else echo "  mangler $hvad"; MANGLER=1; fi
}
node_ok() { [ -x "$NODE" ] && ver_ge "$("$NODE" --version | tr -d v)" "$NODE_MIN"; }
cloudflared_ok() { command -v cloudflared && ver_ge "$(cloudflared --version | awk '{print $3}')" "$CLOUDFLARED_MIN"; }
hoejst_en_klynge() { [ "$(pg_klynge | grep -c .)" -le 1 ]; }
echo "Forudsætninger:"
kraev "Node ≥ $NODE_MIN på $NODE" node_ok
kraev "cloudflared ≥ $CLOUDFLARED_MIN (--token-file)" cloudflared_ok
# No Postgres server yet is fine (a step installs it); two clusters would leave Sky's ambiguous.
kraev "højst én Postgres-klynge (pg_lsclusters)" hoejst_en_klynge
kraev "bare-repoet $BARE" test -f "$BARE/HEAD"
kraev "systemctl, runuser, setfacl, visudo, git, apt-get" sh -c 'test -x /usr/bin/systemctl && command -v runuser && command -v setfacl && command -v visudo && command -v git && command -v apt-get && command -v dpkg-query'
if [ "$MANGLER" = 1 ] && [ "$TOER" = 0 ]; then echo "Stopper: ret det, der mangler, og kør igen."; exit 1; fi

# ---------- steps ----------
tjek_bruger() { id -u "$SKY_USER" >/dev/null 2>&1; }
goer_bruger() { useradd --system --home-dir "$SKY_HOME" --create-home --shell /usr/sbin/nologin "$SKY_USER"; }

tjek_hjem() { [ "$(mode_ejer "$SKY_HOME")" = "750 $SKY_USER" ]; }
goer_hjem() { install -d -m 750 -o "$SKY_USER" -g "$SKY_USER" "$SKY_HOME"; chmod 750 "$SKY_HOME"; }

# The service user reads the bare repo the Mac pushes to (deploy.sh fetches from it): traverse henrik's
# home (x only, no listing) and read the repo, also what later pushes add (default ACL).
tjek_repo_adgang() { som_bruger "$SKY_USER" test -r "$BARE/HEAD" && som_bruger "$SKY_USER" git config --global --get-all safe.directory | grep -qx "$BARE"; }
goer_repo_adgang() {
  setfacl -m "u:$SKY_USER:--x" "/home/$HENRIK"
  setfacl -R -m "u:$SKY_USER:rX" "$BARE"
  find "$BARE" -type d -exec setfacl -m "d:u:$SKY_USER:rX" {} +
  som_bruger "$SKY_USER" git config --global --get-all safe.directory | grep -qx "$BARE" || som_bruger "$SKY_USER" git config --global --add safe.directory "$BARE"
}

tjek_checkout() { [ -d "$CHECKOUT/.git" ]; }
goer_checkout() { som_bruger "$SKY_USER" git clone -q --branch main "$BARE" "$CHECKOUT"; }

# The server package. Ubuntu's postinst creates and starts a "main" cluster on TCP 5432, where honcho's
# Docker Postgres already listens: postgresql-common goes in first, its createcluster.conf is told not to,
# and only then the server. Runs only while the server package is missing.
PG_CREATECLUSTER_KONF=/etc/postgresql-common/createcluster.conf
tjek_pg_server() { dpkg-query -W -f='${Status}' postgresql 2>/dev/null | grep -q 'install ok installed'; }
goer_pg_server() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q postgresql-common
  if grep -Eq '^[#[:space:]]*create_main_cluster[[:space:]]*=' "$PG_CREATECLUSTER_KONF"; then
    sed -i -E 's/^[#[:space:]]*create_main_cluster[[:space:]]*=.*/create_main_cluster = false/' "$PG_CREATECLUSTER_KONF"
  else
    echo 'create_main_cluster = false' >> "$PG_CREATECLUSTER_KONF"
  fi
  grep -qx 'create_main_cluster = false' "$PG_CREATECLUSTER_KONF" || { echo "FEJL: $PG_CREATECLUSTER_KONF siger ikke create_main_cluster = false; installerer ikke serveren"; exit 1; }
  apt-get install -y -q postgresql
}

# Sky's own cluster, created stopped (no --start) so the socket-only file below is in place before it
# ever runs. Port 5433 names its socket (.s.PGSQL.5433); it never listens on TCP.
tjek_pg_klynge() { [ -n "$(pg_klynge)" ]; }
goer_pg_klynge() {
  local ver; ver="$(ls /usr/lib/postgresql 2>/dev/null | sort -n | tail -1)"
  [ -n "$ver" ] || { echo "FEJL: ingen Postgres-server under /usr/lib/postgresql"; exit 1; }
  pg_createcluster "$ver" main -p 5433
}

# Socket-only BEFORE the first start: honcho's Docker Postgres owns 127.0.0.1:5432, and Sky connects
# over the unix socket with peer auth (no password exists to leak).
tjek_pg_socket() { local d; d="$(pg_konf_dir)"; [ -n "$d" ] && grep -qx "listen_addresses = ''" "$d/conf.d/$PG_KONF_NAVN" 2>/dev/null; }
goer_pg_socket() {
  local d; d="$(pg_konf_dir)"
  grep -Eq "^[[:space:]]*include_dir[[:space:]]*=[[:space:]]*'conf.d'" "$d/postgresql.conf" || { echo "FEJL: $d/postgresql.conf læser ikke conf.d"; exit 1; }
  install -d -m 755 -o postgres -g postgres "$d/conf.d"
  printf "# Clawco Sky (KC-0212): unix socket only; TCP 5432 on this host is honcho's Docker Postgres.\nlisten_addresses = ''\n" > "$d/conf.d/$PG_KONF_NAVN"
  chown postgres:postgres "$d/conf.d/$PG_KONF_NAVN"
  if pg_online; then systemctl restart "$(pg_enhed)"; fi
}

tjek_pg_koerer() { systemctl is-enabled --quiet postgresql 2>/dev/null && pg_online; }
goer_pg_koerer() { systemctl daemon-reload; systemctl enable postgresql; systemctl start "$(pg_enhed)"; sleep 2; }

psql_svar() { som_bruger postgres psql -p "$(pg_port)" -tAc "$1" 2>/dev/null; }
tjek_pg_rolle() { [ "$(psql_svar "SELECT 1 FROM pg_roles WHERE rolname = 'sky'")" = 1 ]; }
goer_pg_rolle() { som_bruger postgres createuser -p "$(pg_port)" "$SKY_USER"; }
tjek_pg_db() { [ "$(psql_svar "SELECT 1 FROM pg_database WHERE datname = 'sky'")" = 1 ]; }
goer_pg_db() { som_bruger postgres createdb -p "$(pg_port)" -O "$SKY_USER" sky; }

# The secrets file: 0600, owned by sky, outside the checkout. This script only adds the two keys that are
# not secrets; the rest arrives through sky/scripts/saet-hemmelighed.sh (name and length only).
tjek_env() { [ "$(mode_ejer "$ENV_FIL")" = "600 $SKY_USER" ] && grep -q '^SKY_DATABASE_URL=' "$ENV_FIL" 2>/dev/null && grep -q '^SKY_PORT=' "$ENV_FIL" 2>/dev/null; }
goer_env() {
  [ -f "$ENV_FIL" ] || install -m 600 -o "$SKY_USER" -g "$SKY_USER" /dev/null "$ENV_FIL"
  chown "$SKY_USER:$SKY_USER" "$ENV_FIL"; chmod 600 "$ENV_FIL"
  grep -q '^SKY_DATABASE_URL=' "$ENV_FIL" || echo "SKY_DATABASE_URL=$(db_url)" >> "$ENV_FIL"
  grep -q '^SKY_PORT=' "$ENV_FIL" || echo "SKY_PORT=8781" >> "$ENV_FIL"
}

er_fremmed() { case " $FREMMEDE_UNITS " in *" $1 "*) return 0 ;; esac; return 1; }
installer_unit() { # installer_unit <name>: copy from this checkout, never one of the foreign units
  er_fremmed "$1" && { echo "FEJL: $1 tilhører et andet site"; exit 1; }
  install -m 644 "$HER/$1" "$UNITS/$1"
  systemctl daemon-reload
}
tjek_sky_unit() { cmp -s "$HER/$SKY_UNIT" "$UNITS/$SKY_UNIT" && systemctl is-enabled --quiet "$SKY_UNIT" 2>/dev/null; }
goer_sky_unit() { installer_unit "$SKY_UNIT"; systemctl enable "$SKY_UNIT"; }
tjek_tunnel_unit() { cmp -s "$HER/$TUNNEL_UNIT" "$UNITS/$TUNNEL_UNIT" && systemctl is-enabled --quiet "$TUNNEL_UNIT" 2>/dev/null; }
goer_tunnel_unit() { installer_unit "$TUNNEL_UNIT"; systemctl enable "$TUNNEL_UNIT"; }

tjek_sudoers() { sudoers_tekst | cmp -s - "$SUDOERS"; }
goer_sudoers() {
  local tmp; tmp="$(mktemp)"
  sudoers_tekst > "$tmp"
  visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; echo "FEJL: sudoers-filen er ugyldig; intet installeret"; exit 1; }
  install -m 440 -o root -g root "$tmp" "$SUDOERS"
  rm -f "$tmp"
}

# The legal texts promise server logs for at most 30 days (KC-0204): the app, Sky and the tenants (Docker's
# journald log driver) all log to journald, so one retention limit covers them all.
journald_tekst() { printf '[Journal]\nMaxRetentionSec=30day\n'; }
tjek_journald() { journald_tekst | cmp -s - "$JOURNALD_KONF"; }
goer_journald() {
  install -d -m 755 -o root -g root "$(dirname "$JOURNALD_KONF")"
  local tmp; tmp="$(mktemp)"
  journald_tekst > "$tmp"
  install -m 644 -o root -g root "$tmp" "$JOURNALD_KONF"
  rm -f "$tmp"
  systemctl restart systemd-journald
}

echo "Trin:"
trin "brugeren $SKY_USER (ingen login-shell, hjem $SKY_HOME)" tjek_bruger goer_bruger
trin "$SKY_HOME er 0750 og ejes af $SKY_USER" tjek_hjem goer_hjem
trin "$SKY_USER kan læse $BARE" tjek_repo_adgang goer_repo_adgang
trin "checkout i $CHECKOUT" tjek_checkout goer_checkout
trin "Postgres-serveren installeret uden automatisk klynge på TCP 5432" tjek_pg_server goer_pg_server
trin "én Postgres-klynge til Sky på port 5433 (oprettet stoppet)" tjek_pg_klynge goer_pg_klynge
trin "Postgres lytter kun på unix-socket (ikke TCP 5432)" tjek_pg_socket goer_pg_socket
trin "Postgres er slået til og kører" tjek_pg_koerer goer_pg_koerer
trin "Postgres-rollen sky (peer over socket)" tjek_pg_rolle goer_pg_rolle
trin "databasen sky ejet af sky" tjek_pg_db goer_pg_db
trin "$ENV_FIL er 0600, ejes af $SKY_USER, har SKY_DATABASE_URL og SKY_PORT" tjek_env goer_env
trin "$SKY_UNIT installeret og slået til" tjek_sky_unit goer_sky_unit
trin "$TUNNEL_UNIT installeret og slået til" tjek_tunnel_unit goer_tunnel_unit
trin "sudoers-filen $SUDOERS (tjekket med visudo)" tjek_sudoers goer_sudoers
trin "journald gemmer logs højst 30 dage ($JOURNALD_KONF)" tjek_journald goer_journald
if [ "$TOER" = 1 ]; then echo "Tørkørsel: intet er ændret."; else echo "Færdig. Næste skridt (agenten): sky/deploy/README.md, \"Efter root-trinnet\"."; fi
