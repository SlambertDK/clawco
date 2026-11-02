# Clawco in Docker (KC-0157)

The second reference install (the first is `deploy/install.sh`). It needs only Docker with the
Compose plugin.

```bash
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
# → http://127.0.0.1:8750 — Start greets a new user; Nu works from the first minute.
```

Without `GIT_SHA` the image still builds; `/health` then says `"sha": "unknown"`.

## What holds

- **Reachable from this machine or your tailnet only.** The container listens on its own
  interface (`KC_HOST=0.0.0.0`), but compose publishes `127.0.0.1:8750` only.
  `test/docker-files.test.ts` fails if any compose file in the repo publishes a port beyond loopback,
  uses host networking, or a Serve config allows Funnel.
- **Your data lives outside the image.** The user folder is the named volume `clawco-data` at
  `/data` (`KC_DATA_DIR`). The root filesystem is read-only (`read_only: true`), so the app cannot
  write anywhere else, and a new image never carries data. Keys pasted in Start are saved in
  `/data/.env` (`KC_ENV_FILE`), next to the per-source credentials in `/data/hemmeligheder/`.
  A backup is a copy of that volume, for example
  `docker run --rm -v clawco_clawco-data:/data -v "$PWD":/ud busybox tar czf /ud/clawco-data.tgz -C /data .`
- **No root.** The app runs as the image's `node` user (uid 1000).

## The agent

The container starts with the keyless real agent (`KC_AGENT=hermes-http`), exactly as
`install.sh` does: Nu works, and Start asks for the key. To use your own Hermes, set its address
before `up` (from inside the container, the host is not `127.0.0.1`):

```bash
KC_HERMES_URL=http://host.docker.internal:8642 docker compose up -d
```

`KC_AGENT=fake` gives the scripted agent (for development; it reads the mail fixtures in
`test/fixtures/` and writes a fictional mail plan into the user folder, so not for real use).

## Your notes folder (optional)

Uncomment the two notes lines in `compose.yaml` (`KC_VAULT_DIR: /noter` and the
`${CLAWCO_NOTER}:/noter` volume), then `CLAWCO_NOTER=/path/to/vault docker compose up -d`. The
folder must be writable by uid 1000 if Clawco is to save notes in it.

## Tailscale (optional profile)

```bash
mkdir -p ~/.config/clawco && umask 077
# paste a key from https://login.tailscale.com/admin/settings/keys into this file, never into the repo:
$EDITOR ~/.config/clawco/tailscale-authkey
docker compose --profile tailscale up -d
# → https://clawco.<your-tailnet>.ts.net (name: CLAWCO_TS_NAVN, key file: CLAWCO_TS_AUTHKEY_FIL)
```

The official `tailscale/tailscale` image joins your tailnet and serves Clawco over HTTPS with
`deploy/docker/tailscale/serve.json`, proxying to `http://clawco:8750` on the compose network.
The loopback port stays as it is. Funnel is off (`AllowFunnel: false`) and must stay off.

What was checked (2026-10-31), and against which source:

- Variables `TS_AUTHKEY`, `TS_AUTH_ONCE`, `TS_STATE_DIR`, `TS_SERVE_CONFIG`, `TS_HOSTNAME`, and
  the advice to mount the Serve config's directory (not the file) so changes are seen:
  https://tailscale.com/docs/features/containers/docker/docker-params
- The key as a Docker secret: containerboot passes `TS_AUTHKEY` unchanged to
  `tailscale up --authkey=` (`cmd/containerboot/settings.go`, `tailscaled.go`), and
  `tailscale up` reads the key from a file when the value starts with `file:`
  (`cmd/tailscale/cli/up.go`, "if it begins with file:, then it's a path to a file containing the
  authkey"). So `TS_AUTHKEY=file:/run/secrets/ts_authkey`.
- The Serve config is an `ipn.ServeConfig` JSON; containerboot replaces `${TS_CERT_DOMAIN}`
  before parsing and watches the directory (`cmd/containerboot/serve.go`). The shape
  (`TCP` 443 `HTTPS`, `Web` → `Handlers` → `Proxy`, `AllowFunnel`) follows
  https://tailscale.com/blog/docker-tailscale-guide.
- A proxy target other than localhost is accepted by the Serve CLI (it is classed as "remote",
  `cmd/tailscale/cli/serve_v2.go`).

`docker compose --profile tailscale config` is part of `docker-tjek`. The tailnet join itself
(a real auth key) has not been run.

## The proof: `npm run docker:tjek`

`scripts/docker-tjek.mjs` is the cold-start smoke for containers (product spec §10). It builds the
image, runs it read-only on a free loopback port with a new empty volume, checks `/health` (sha,
not root, loopback-only binding, nothing extra in `/app`), loads Start and Nu headless
(`playwright-core` on the host) for a real element, no console errors, dark theme and no overflow at
375 px, then replaces the container on the same volume and checks that the data is still there. Everything it creates
is named `clawco-tjek-<hex>` and removed at the end. `--port N` picks the port; `--adresse URL`
runs only the browser smoke against an instance that is already running.
