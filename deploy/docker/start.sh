#!/bin/sh
# KC-0245: the container's entrypoint. The built-in agent (KC_AGENT=direkte) saves the model keys pasted in Start
# encrypted in $KC_DATA_DIR/hemmeligheder.enc; this makes the key file that opens it (KC_HEMMELIGHEDER_FIL, on the
# /noegle volume, outside /data so a copy of the data folder never carries it) the first time, and never again.
# Never overwrites a key file, and never makes a new one for a store that already exists (it could not open it).
# Prints no key. Then runs the command it was given (the image's CMD).
set -eu

# Which agent, when nobody chose (KC_AGENT empty, and none in the user folder's .env): Hermes for a container that
# already used it (an address set, or a Hermes key saved in Start), else the built-in agent. Only names are read.
if [ -z "${KC_AGENT:-}" ]; then
  envfil=${KC_ENV_FILE:-}
  if [ -n "$envfil" ] && [ -f "$envfil" ] && grep -q '^KC_AGENT=' "$envfil"; then
    # compose sets it empty; Node's --env-file never overrides a set variable, so unset it and the file decides.
    unset KC_AGENT
  elif [ -n "${KC_HERMES_URL:-}" ] || { [ -n "$envfil" ] && [ -f "$envfil" ] && grep -q '^KC_HERMES_API_KEY=' "$envfil"; }; then
    export KC_AGENT=hermes-http
  else
    export KC_AGENT=direkte
  fi
fi

noegle=${KC_HEMMELIGHEDER_FIL:-}
data=${KC_DATA_DIR:-/data}
if [ -n "$noegle" ] && [ ! -e "$noegle" ]; then
  if [ -e "$data/hemmeligheder.enc" ]; then
    echo "Clawco: $data/hemmeligheder.enc findes, men nøglefilen $noegle mangler. Behold volumen med nøglefilen sammen med datavolumen, eller slet hemmeligheder.enc og indsæt modelnøglen i Start igen." >&2
  else
    (umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64") + "\n")' >"$noegle.tmp" && mv "$noegle.tmp" "$noegle") \
      || echo "Clawco: kunne ikke lave nøglefilen $noegle; en modelnøgle kan ikke gemmes, før den findes." >&2
  fi
fi
exec "$@"
