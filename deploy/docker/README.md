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
  write anywhere else, and a new image never carries data. A model key pasted in Start is saved
  encrypted in `/data/hemmeligheder.enc` (KC-0245); the key that opens it is a file on its own
  volume `clawco-noegle` at `/noegle` (`KC_HEMMELIGHEDER_FIL`), made by `deploy/docker/start.sh` the
  first time and never again, so a copy of the data volume never carries it. Other keys (the
  per-source credentials) are in `/data/hemmeligheder/`.
  A backup is a copy of that volume. The tarball is written by your own shell, not by the container,
  into a folder only you can open, and under `umask 077`, so no other user on the machine can read it
  (KC-0276; the key volume in the second command opens the encrypted keys, so it is as sensitive as a
  password). Never keep these files inside the repository clone:
  `mkdir -p -m 700 "$HOME/Clawco-backups"`
  `(umask 077 && docker run --rm -v clawco_clawco-data:/data:ro busybox tar czf - -C /data . > "$HOME/Clawco-backups/clawco-data.tgz")`
  and, kept as safely as a password, the key volume:
  `(umask 077 && docker run --rm -v clawco_clawco-noegle:/noegle:ro busybox tar czf - -C /noegle . > "$HOME/Clawco-backups/clawco-noegle.tgz")`
  A plain `docker run` needs both `-v` flags (`/data` and `/noegle`) or the saved key cannot be opened
  after the container is replaced.
- **No root.** The app runs as the image's `node` user (uid 1000).

## Updating

`docker compose pull && docker compose up -d`; the user folder volume is untouched. Details in
`deploy/docker/opdater.md` (KC-0158).

## The agent

The container runs Clawco's own built-in agent (`KC_AGENT=direkte`, KC-0245), exactly as
`install.sh` does: Nu works, and Start asks for a key from a model provider, or for a local model.
For a model on this machine (LM Studio, Ollama) give Start the address
`http://host.docker.internal:1234` (`:11434` for Ollama); compose maps that name to the host.
To use your own Hermes instead (advanced), choose it and set its address before `up` (from inside
the container, the host is not `127.0.0.1`):

```bash
KC_AGENT=hermes-http KC_HERMES_URL=http://host.docker.internal:8642 docker compose up -d
```

`KC_AGENT=fake` gives the scripted agent (for development; it reads the mail fixtures in
`test/fixtures/` and writes a fictional mail plan into the user folder, so not for real use).

## Your notes folder (optional)

To use a vault you already have (on this machine or a NAS mount), start with the extra file:
`CLAWCO_NOTER=/path/to/vault docker compose -f compose.yaml -f compose.noter.yaml up -d`. It appears at `/noter`; choose
"I already have an Obsidian vault" in the notes setup and "Gem i Obsidian" saves into its inbox. The folder must be
writable by uid 1000. Without the extra file nothing changes.

## Tailscale (optional profile)

```bash
mkdir -p ~/.config/clawco && umask 077
# paste a key from https://login.tailscale.com/admin/settings/keys into this file, never into the repo:
$EDITOR ~/.config/clawco/tailscale-authkey
docker compose --profile tailscale up -d
# → https://clawco.<your-tailnet>.ts.net (name: CLAWCO_TS_NAVN, key file: CLAWCO_TS_AUTHKEY_FIL)
```

The official `tailscale/tailscale` image joins your tailnet and serves Clawco over HTTPS with
`deploy/docker/tailscale/serve.json`, proxying to `http://127.0.0.1:8750` from inside the app container's network
namespace (`network_mode: service:clawco`), so the app sees Tailscale's identity headers and a household's roles
work; a tagged or shared-in node is not the owner (KC-0277).
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
