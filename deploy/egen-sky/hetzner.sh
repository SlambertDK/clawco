#!/usr/bin/env bash
# Clawco in your own cloud, on Hetzner Cloud (KC-0171). Bring-your-own-cloud: the server is in YOUR Hetzner
# account, reachable only over YOUR Tailscale net, with no public port. Clawco never sees the token, the key or
# the data. Docs: https://clawco.work/install and deploy/egen-sky/README.md.
#   bash hetzner.sh [--dry-run] [--navn NAVN] [--sted fsn1|nbg1|hel1] [--type cx22]
#                   [--authkey-fil FIL] [--sha SHA | --ref REF]
# Secrets: the API token is read from HCLOUD_TOKEN only (never an argument, never written to disk). The
# Tailscale auth key is read from --authkey-fil or, interactively, hidden from the terminal; it goes into the
# cloud-init only, and the VM shreds its copy once the node has joined the tailnet.
# The only hosts this script talks to: api.hetzner.cloud (your account) and, from the VM, github.com (the public
# mirror the code is cloned from). Test hooks only: CLAWCO_VENTEPAUSE (seconds between polls, default 5) and
# CLAWCO_FORSOEG (number of polls, default 72).
# Must stay bash 3.2 compatible (macOS /bin/bash): no associative arrays, no ${var,,}.
set -euo pipefail

HETZNER_API=https://api.hetzner.cloud/v1
REPO_URL=https://github.com/SlambertDK/clawco.git
NOEGLEFIL_PAA_VM=/root/.config/clawco/tailscale-authkey

fejl() { printf '%s\n' "$@" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

brug() {
  cat <<'TEKST'
Brug: hetzner.sh [valg]
  Sætter Clawco op på en lille server i din EGEN Hetzner Cloud-konto. Serveren kan kun nås over dit eget
  Tailscale-net: ingen port er åben mod internettet, og der er ingen SSH. Den repareres ikke, den
  genskabes (slet den i Hetzners konsol og kør scriptet igen). Dine data ligger på serveren hos dig, aldrig hos os.

  --dry-run          vis planen, cloud-init og firewall; send intet og kræv intet token
  --navn NAVN        serverens navn og dens adresse på dit net (standard: clawco; a-z, 0-9 og bindestreg)
  --sted STED        fsn1 (Falkenstein), nbg1 (Nürnberg) eller hel1 (Helsinki) (standard: fsn1; alle i EU)
  --type TYPE        servertype (standard: cx22, den mindste)
  --authkey-fil FIL  filen med din Tailscale-nøgle; uden den bliver du spurgt, og svaret vises ikke
  --sha SHA          hent præcis denne version af Clawco (til at genskabe en server på en bestemt version)
  --ref REF          hent denne gren eller dette tag (højst én af --sha og --ref)

Det her skal du bruge først:
  1. En Hetzner Cloud-konto og et API-token med læse- og skriveadgang (Projekt, Sikkerhed, API-tokens).
     Giv det scriptet i terminalen: export HCLOUD_TOKEN=...   (kun nødvendigt uden --dry-run)
  2. En Tailscale-konto (gratis) med HTTPS slået til under DNS i Tailscales administration, og en
     engangsnøgle: Settings, Keys, Generate auth key, uden "Reusable", med kort udløbstid.
     Gem den i en fil og peg på den med --authkey-fil.

Det her betaler du, og til hvem:
  Hetzner: ca. 4–5 euro om måneden for den mindste server, direkte til Hetzner. Clawco er gratis,
  og din Tailscale-konto er gratis. Slet serveren i Hetzners konsol, og betalingen stopper.
TEKST
}

# The monthly cost line for a server type; only the sizes we have looked at, otherwise a pointer to the console.
pris_for() {
  case "$1" in
    cx22|cx23) PRIS="ca. 4–5 euro om måneden, betalt til Hetzner";;
    *) PRIS="prisen for $1 står i Hetzners konsol";;
  esac
}

# ---------------------------------------------------------------- the generated files

# The firewall: Hetzner firewalls are allow-lists, so no inbound rule means all inbound is dropped. Outbound is open.
firewall_json() {
  printf '{"name":"clawco-%s","rules":[],"labels":{"clawco":"egen-sky"}}' "$1"
}

# The cloud-init (Ubuntu 24.04). $1 = the value written into the key file ($NOEGLE, or a mask in a dry run).
# The host firewall is a second lock; Docker publishes only on 127.0.0.1 (compose.yaml) and the Tailscale
# container does the serving. No SSH: there is no openssh rule and no way in.
cloud_init() {
  local noegle=$1 klon
  if [ -n "$SHA" ]; then
    klon="git clone $REPO_URL /opt/clawco
  - git -C /opt/clawco checkout $SHA"
  elif [ -n "$REF" ]; then klon="git clone --depth 1 --branch $REF $REPO_URL /opt/clawco"
  else klon="git clone --depth 1 $REPO_URL /opt/clawco"; fi
  cat <<EOF
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - ufw
  - git
  - unattended-upgrades
write_files:
  - path: $NOEGLEFIL_PAA_VM
    permissions: '0600'
    owner: root:root
    content: '$noegle'
  - path: /etc/apt/apt.conf.d/20auto-upgrades
    permissions: '0644'
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";
  - path: /usr/local/sbin/clawco-start
    permissions: '0700'
    content: |
      #!/bin/sh
      set -eu
      cd /opt/clawco
      GIT_SHA=\$(git rev-parse --short HEAD)
      export GIT_SHA
      export CLAWCO_TS_NAVN=$NAVN
      export CLAWCO_TS_AUTHKEY_FIL=$NOEGLEFIL_PAA_VM
      docker compose --profile tailscale up -d --build
      i=0
      while [ "\$i" -lt 60 ]; do
        if docker compose --profile tailscale exec -T tailscale tailscale ip -4 >/dev/null 2>&1; then break; fi
        i=\$((i + 1))
        sleep 5
      done
      shred -u $NOEGLEFIL_PAA_VM
      : > $NOEGLEFIL_PAA_VM
      chmod 600 $NOEGLEFIL_PAA_VM
runcmd:
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 41641/udp
  - ufw --force enable
  - systemctl enable --now docker
  - $klon
  - /usr/local/sbin/clawco-start
EOF
}

# One JSON string from text on stdin: backslash, quote, newlines. (The inputs are validated, so no other control characters.)
json_streng() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN { ORS = "" } { print $0 "\\n" }'
}

# ---------------------------------------------------------------- the Hetzner API (no jq: a few fields with sed/grep)

# api METODE STI [BODY]. Sets API_KODE and API_KROP. The token goes to curl as a config on a file descriptor and
# the body on its stdin (printf is a builtin), so neither is on a command line (ps) or on disk.
api() {
  local metode=$1 sti=$2 krop=${3:-} svar
  if [ "$metode" = POST ]; then
    svar=$(printf '%s' "$krop" | curl -sS --connect-timeout 10 --max-time 60 -X POST -K <(printf 'header = "Authorization: Bearer %s"\n' "$HCLOUD_TOKEN") \
      -H 'Content-Type: application/json' --data-binary @- -w '\n%{http_code}' "$HETZNER_API$sti") || fejl "Kunne ikke nå Hetzners API. Tjek din internetforbindelse og prøv igen."
  else
    svar=$(curl -sS --connect-timeout 10 --max-time 60 -X "$metode" -K <(printf 'header = "Authorization: Bearer %s"\n' "$HCLOUD_TOKEN") \
      -w '\n%{http_code}' "$HETZNER_API$sti") || fejl "Kunne ikke nå Hetzners API. Tjek din internetforbindelse og prøv igen."
  fi
  API_KODE=$(printf '%s' "$svar" | tail -n 1)
  API_KROP=$(printf '%s\n' "$svar" | sed '$d' | tr -d '\n')
}

# The first number after "id": in a response.
foerste_id() { printf '%s' "$1" | grep -o '"id": *[0-9][0-9]*' | head -n 1 | grep -o '[0-9][0-9]*' || true; }

# One plain Danish sentence for an API error (never the token, never the body's request).
api_fejl() {
  local hvad=$1 kode
  kode=$(printf '%s' "$API_KROP" | grep -o '"code": *"[a-z_]*"' | head -n 1 | sed 's/.*: *"\(.*\)"/\1/' || true)
  case "$API_KODE:$kode" in
    401:*) fejl "Hetzner afviste din API-nøgle (401). Tjek HCLOUD_TOKEN: den skal høre til det projekt, serveren skal oprettes i, og have læse- og skriveadgang.";;
    *:resource_limit_exceeded|*:server_limit_exceeded) fejl "Din Hetzner-konto har ramt en grænse (kvote), så $hvad kunne ikke oprettes. Bed Hetzner om en højere grænse eller slet en server, du ikke bruger.";;
    403:*) fejl "Hetzner siger, at dit token ikke må $hvad (403). Lav et token med læse- og skriveadgang i projektet.";;
    *:uniqueness_error) fejl "Der findes allerede noget i projektet med det navn, så $hvad kunne ikke oprettes. Vælg et andet navn med --navn.";;
    *:placement_error|*:no_space_left_in_location) fejl "Hetzner har ikke plads til den servertype på det sted lige nu. Prøv et andet sted med --sted.";;
    *) fejl "Hetzner svarede ${API_KODE:-uden svar}${kode:+ ($kode)}, så $hvad kunne ikke oprettes. Prøv igen, eller se i Hetzners konsol.";;
  esac
}

# ---------------------------------------------------------------- main

main() {
  local TOER=0 NAVN=clawco STED=fsn1 TYPE=cx22 NOEGLEFIL='' SHA='' REF='' PRIS='' NOEGLE='' MASKE='' FW_JSON='' CLOUD='' FW_ID='' SRV_ID='' status='' forsoeg=0 maxforsoeg
  local API_KODE='' API_KROP='' SRV_JSON='' FEJL_KODE='' FEJL_KROP=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) TOER=1;;
      --navn|--sted|--type|--authkey-fil|--sha|--ref)
        [ $# -ge 2 ] || fejl "$1 skal have en værdi." "$(brug)"
        case "$1" in --navn) NAVN=$2;; --sted) STED=$2;; --type) TYPE=$2;; --authkey-fil) NOEGLEFIL=$2;; --sha) SHA=$2;; --ref) REF=$2;; esac
        shift;;
      -h|--help) brug; exit 0;;
      *) fejl "Ukendt valg: $1" "$(brug)";;
    esac
    shift
  done

  # Everything that ends up in the YAML or the shell is checked against a short allow-list first.
  printf '%s' "$NAVN" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' || fejl "--navn må kun være små bogstaver a-z, tal og bindestreg (højst 31 tegn, ikke først en bindestreg)."
  case "$STED" in fsn1|nbg1|hel1) ;; *) fejl "--sted skal være fsn1, nbg1 eller hel1 (de tre i EU).";; esac
  printf '%s' "$TYPE" | grep -Eq '^[a-z0-9]{2,12}$' || fejl "--type ser ikke ud som en Hetzner-servertype (for eksempel cx22)."
  [ -z "$SHA" ] || [ -z "$REF" ] || fejl "Brug enten --sha eller --ref, ikke begge."
  [ -z "$SHA" ] || printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{7,40}$' || fejl "--sha skal være 7 til 40 hex-tegn (a-f og 0-9)."
  [ -z "$REF" ] || printf '%s' "$REF" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]{0,60}$' || fejl "--ref må kun indeholde bogstaver, tal, punktum, bindestreg, understreg og skråstreg."
  command -v curl >/dev/null 2>&1 || [ "$TOER" = 1 ] || fejl "curl mangler på denne maskine; installer den og prøv igen."

  # The Tailscale auth key: a file, or hidden from the terminal. A dry run needs only its shape (and shows a mask).
  if [ -n "$NOEGLEFIL" ]; then
    [ -r "$NOEGLEFIL" ] || fejl "Jeg kan ikke læse nøglefilen: $NOEGLEFIL (den skal indeholde din Tailscale-nøgle)."
    NOEGLE=$(head -n 1 "$NOEGLEFIL" | tr -d '\r' | sed 's/[[:space:]]*$//')
    [ "$(wc -l <"$NOEGLEFIL" | tr -d ' ')" -le 1 ] || fejl "Nøglefilen skal kun indeholde selve nøglen på én linje."
  elif [ "$TOER" = 0 ]; then
    (exec </dev/tty) 2>/dev/null || fejl "Jeg skal bruge din Tailscale-nøgle, og der er hverken --authkey-fil eller en terminal at spørge i."
    printf 'Indsæt din Tailscale-nøgle (vises ikke): ' >/dev/tty
    IFS= read -rs NOEGLE </dev/tty || NOEGLE=''
    printf '\n' >/dev/tty
  fi
  if [ -n "$NOEGLE" ] || [ -n "$NOEGLEFIL" ]; then
    printf '%s' "$NOEGLE" | grep -Eq '^tskey-[A-Za-z0-9_-]+$' || fejl "Nøglen ser ikke ud som en Tailscale-nøgle (den begynder med tskey- og har kun bogstaver, tal, - og _)."
  fi
  MASKE="<NØGLE, ${#NOEGLE} tegn, vises ikke>"
  [ -n "$NOEGLE" ] || MASKE="<NØGLE, vises ikke>"

  pris_for "$TYPE"
  FW_JSON=$(firewall_json "$NAVN")

  if [ "$TOER" = 1 ]; then
    info "Clawco i din egen sky: prøvekørsel (--dry-run). Der sendes intet, og der oprettes intet."
    info ""
    info "  Udbyder:  Hetzner Cloud (din egen konto)"
    info "  Server:   clawco-$NAVN, $TYPE, Ubuntu 24.04, $STED"
    info "  Pris:     $PRIS. Clawco er gratis, og din Tailscale-konto er gratis."
    info "  Adresse:  https://$NAVN.<dit tailnet>.ts.net (kun på dit eget net)"
    info "  Firewall: ingen indgående regler, så al indgående trafik afvises"
    info ""
    info "$FIREWALL_MARKOER"
    printf '%s\n' "$FW_JSON"
    info "$CLOUDINIT_MARKOER"
    cloud_init "$MASKE"
    info "$SLUT_MARKOER"
    info "Kør uden --dry-run (og med HCLOUD_TOKEN sat) for at oprette serveren."
    return 0
  fi

  [ -n "${HCLOUD_TOKEN:-}" ] || fejl "Sæt dit Hetzner API-token i HCLOUD_TOKEN først (export HCLOUD_TOKEN=...). Scriptet læser det kun derfra og gemmer det ikke."
  printf '%s' "$HCLOUD_TOKEN" | grep -Eq '^[A-Za-z0-9_-]+$' || fejl "HCLOUD_TOKEN ser ikke ud som et Hetzner-token (kun bogstaver, tal, - og _)."
  info "Opretter firewall clawco-$NAVN (ingen indgående regler) ..."
  CLOUD=$(cloud_init "$NOEGLE")

  api POST /firewalls "$FW_JSON"
  case "$API_KODE" in 200|201) ;; *) api_fejl "firewallen";; esac
  FW_ID=$(foerste_id "$API_KROP")
  [ -n "$FW_ID" ] || fejl "Hetzner svarede uden et firewall-id; der blev ikke oprettet nogen server."

  info "Opretter serveren clawco-$NAVN ($TYPE i $STED) ..."
  SRV_JSON=$(printf '{"name":"clawco-%s","server_type":"%s","image":"ubuntu-24.04","location":"%s","start_after_create":true,"public_net":{"enable_ipv4":true,"enable_ipv6":true},"firewalls":[{"firewall":%s}],"labels":{"clawco":"egen-sky"},"user_data":"%s"}' \
    "$NAVN" "$TYPE" "$STED" "$FW_ID" "$(printf '%s\n' "$CLOUD" | json_streng)")
  api POST /servers "$SRV_JSON"
  case "$API_KODE" in
    200|201) ;;
    *)
      # Take back what this run made, so a failed run leaves nothing behind.
      FEJL_KODE=$API_KODE; FEJL_KROP=$API_KROP
      api DELETE "/firewalls/$FW_ID"
      info "Firewallen clawco-$NAVN, som blev oprettet først, er slettet igen." >&2
      API_KODE=$FEJL_KODE; API_KROP=$FEJL_KROP
      api_fejl "serveren";;
  esac
  SRV_ID=$(foerste_id "$API_KROP")
  [ -n "$SRV_ID" ] || fejl "Hetzner svarede uden et server-id. Se i Hetzners konsol, om serveren blev oprettet."

  maxforsoeg=${CLAWCO_FORSOEG:-72}
  info "Venter på, at serveren starter ..."
  while [ "$forsoeg" -lt "$maxforsoeg" ]; do
    api GET "/servers/$SRV_ID"
    status=$(printf '%s' "$API_KROP" | grep -o '"status": *"[a-z_]*"' | head -n 1 | sed 's/.*: *"\(.*\)"/\1/' || true)
    [ "$status" != running ] || break
    forsoeg=$((forsoeg + 1))
    sleep "${CLAWCO_VENTEPAUSE:-5}"
  done
  [ "$status" = running ] || fejl "Serveren startede ikke inden for tiden (status: ${status:-ukendt}). Se den i Hetzners konsol (server $SRV_ID)."

  info ""
  info "Serveren kører, og Clawco gør sig klar. Clawco kommer op på https://$NAVN.<dit tailnet>.ts.net om et par minutter."
  info "Dit tailnet-navn står på https://login.tailscale.com/admin/dns."
  info "Tjek det fra en enhed på dit net:"
  info "  curl -fsS https://$NAVN.<dit tailnet>.ts.net/health"
  info "Vises serveren ikke under dine maskiner i Tailscale efter ti minutter, så slet den i Hetzners konsol og kør scriptet igen med en ny engangsnøgle."
}

FIREWALL_MARKOER='--- firewall (JSON) ---'
CLOUDINIT_MARKOER='--- cloud-init ---'
SLUT_MARKOER='--- slut ---'

main "$@"
