# Hermes' API server on kira-home

Kontrolcenter talks to Hermes through hermes-agent's built-in
OpenAI-compatible API server (`gateway/platforms/api_server.py`). It is off
until enabled in Hermes' own env file.

## 1. Enable it (once)

Append to `~/.hermes/.env` on kira-home (the key is a fresh random secret;
`scripts/enable-hermes-api.sh` does this and prints key names + lengths only):

```
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<random 48 hex chars>
```

Then `hermes gateway restart` and check `hermes gateway status`. The same
key goes into `~/kontrolcenter/.env` as `KC_HERMES_API_KEY`.

Runs arrive in Hermes as sessions on the `api_server` platform (visible in
`hermes sessions list`). They use the gateway's model (claude-sonnet-5.5 via
copilot today) and its toolsets.

## 2. Reach the app over Tailscale

The app listens on 127.0.0.1:8750. Port 443 on kira-home is taken by the
old OpenClaw UI (Tailscale Serve), so use a second HTTPS port:

```
sudo tailscale serve --bg --https=8750 http://127.0.0.1:8750
```

Then https://kira-home.<tailnet>.ts.net:8750 works from every device on
the tailnet. `tailscale serve status` shows the mapping. Nothing is exposed
publicly.

**The easy address (KC-0017):** https://kontrol.<tailnet>.ts.net — no port.
Kontrolcenter has its own Tailscale machine `kontrol`: a second tailscaled
in userspace mode, run as henrik by `deploy/kontrol-tailscale.service`
(`deploy.sh` installs and enables it). Its own CLI socket:

```
ts() { tailscale --socket=$HOME/.local/state/kontrol-ts/tailscaled.sock "$@"; }
ts up --hostname=kontrol --accept-dns=false   # once; Henrik approves the login link
ts serve --bg 8750                            # https://kontrol.<tailnet>/ → app
ts serve --bg --http=80 8750                  # http://kontrol/ → app → 301 to https
ts serve status
```

When the tailscale package is upgraded, `kontrol` keeps the old version in
memory until restarted; `deploy/kontrol-tailscale-opdatering.path` watches
`/usr/sbin/tailscaled` and restarts it automatically (KC-0026). Check:
`ts version --daemon` prints no version-mismatch warning.

The app redirects any short host name (no dot) to `KC_ADRESSE` in `.env`,
so typing `kontrol/` in the address bar lands on the https address (the
microphone needs https). The old `:8750` address keeps working.

## 3. Health

`curl -s http://127.0.0.1:8750/health` → `{ ok, sha, uptimeSec, hermes: { mode: "http", reachable: true } }`.
`reachable: false` means Hermes' API server is down or the key differs.

## 4. Morning build (KC-0003)

`kontrolcenter-dagen.timer` fires 07:05 every day and runs
`deploy/dagen-morgen.sh`, which waits for today's `avis_data` file (max 10
min) and POSTs `/api/rum/dagen/opdater`. `deploy.sh` installs and enables
it. Check: `systemctl --user list-timers kontrolcenter-dagen.timer`; run by
hand: `systemctl --user start kontrolcenter-dagen.service`; log:
`journalctl --user -u kontrolcenter-dagen`.
