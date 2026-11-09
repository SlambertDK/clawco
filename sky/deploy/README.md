# Clawco Sky — deploy (KC-0176, KC-0212)

Sky is the control plane for the hosted Clawco. Under Henrik's zero-cost rule (spec D18, KC-0212) the
private and public beta run on **kira-home**, which is already paid for: the control plane as the
system user `sky`, its own system Postgres over a unix socket, and a Cloudflare Tunnel that publishes
`konto.clawco.work` (the account app) and `*.clawco.work` (the tenants, through the gateway KC-0183; `clawco.work` and `www` stay the static site)
without opening any port on kira-home. A paid server (Hetzner, spec D13) comes only when
`config/omkostninger.json` says customers cover it; the `hetzner` fleet driver refuses until then.

Status 2026-10-31: the files are written and tested on the Mac (`sky/test/deploy.test.ts`). A dry run on
kira-home showed no Postgres server there; installing it is now a step of the root script, not a stop.

## Layout on kira-home

| Path / name | What |
|---|---|
| user `sky` | system user, no login shell, home `/srv/sky` (0750) |
| `/srv/sky/kontrolcenter` | git checkout of `main`; `origin` = the bare repo `/home/henrik/kontrolcenter.git` the Mac pushes to (the repo is private; kira-home has no GitHub credentials) |
| `/srv/sky/.env` | secrets, 0600, owned by `sky`, **outside** the checkout |
| system Postgres | kira-home (Ubuntu 22.04) has only `postgresql-client-14`, so the root script installs the distro server — `postgresql-common` first, then `create_main_cluster = false` in `/etc/postgresql-common/createcluster.conf`, then `postgresql`, so no default cluster ever appears on TCP 5432. It then creates one cluster for Sky, stopped (`pg_createcluster <ver> main -p 5433`; 5433 only names its socket), makes it **socket-only** (`conf.d/clawco-sky.conf`: `listen_addresses = ''`) before its first start, and starts it. Role + database `sky`, peer auth. TCP 127.0.0.1:5432 belongs to honcho's Docker Postgres and is never touched |
| `sky.service` | `node src/server.ts` on 127.0.0.1:8781 (`SKY_PORT`) |
| `clawco-sky-netfilter.service` | root oneshot at boot (before `sky.service`): the tenant pool's iptables filter and `/run/sky/netfilter.ok` (KC-0279) |
| `clawco-sky-tunnel.service` | `cloudflared tunnel run --token-file …` as `sky`; needs cloudflared ≥ 2025.4.0. The host's own `cloudflared.service` and `cloudflared-petrilab.service` (other sites) are never touched |
| `/etc/sudoers.d/clawco-sky` | `henrik` may act as `sky` through four fixed scripts only (`deploy.sh`, `saet-env.sh SKY_*`, `masternoegle.sh ny\|--roter\|--afslut`; KC-0276; `udrul.sh`, which validates its own arguments; KC-0279), and restart exactly Sky's two units; `sky` may restart `sky`. Any other command as `sky` needs henrik's password |
| `/etc/systemd/journald.conf.d/clawco-30-dage.conf` | `MaxRetentionSec=30day`: the legal texts promise server logs for at most 30 days (KC-0204); the app, Sky and the tenants (Docker's `journald` log driver) all log to journald |

`SKY_DATABASE_URL` is written by the root script: `postgres:///sky?host=/var/run/postgresql&port=<cluster port>`.

## Henrik's two actions

1. **Root, once** (in a terminal on kira-home, from his checkout):
   `sudo bash ~/kontrolcenter/sky/deploy/opsaet-root.sh`
   It prints each step as `ok` (already so) or `gør` (done now) and stops with a plain message if a
   precondition is missing. Re-running changes nothing. `--dry-run` shows the plan without root.
2. **Cloudflare, once**: in Cloudflare Zero Trust → Networks → Tunnels, create a tunnel
   (type cloudflared) named `clawco-sky`, and add two public hostnames:
   - `konto.clawco.work` → `http://127.0.0.1:8781`
   - `*.clawco.work` → `http://127.0.0.1:8781` as well: Sky's own process is the gateway and tells the
     two apart by `Host` (KC-0183; details and DNS in `sky/deploy/gateway/README.md`)

   Copy the tunnel token. The agent then stores it with
   `sky/scripts/saet-hemmelighed.sh SKY_CLOUDFLARE_TUNNEL_TOKEN` (hidden prompt; prints name and
   length only). The token is the only new secret.

**Tenant hostnames (gate G7, answered 2026-10-31):** tenants are first-level names `<slug>.clawco.work`, so Cloudflare's free Universal SSL covers them; reserved slugs (`www`, `konto`, `status`, `api`, `mail`, `sky`, `docs`, `admin`) are enforced by the gateway (KC-0183). Account cookies are host-only on `konto.clawco.work`, never `Domain=clawco.work`.

## After the root step (the agent, as henrik over ssh)

```bash
# Secrets and settings into /srv/sky/.env (name + length only; values never on a command line):
sky/scripts/saet-hemmelighed.sh SKY_PUBLIC_URL                      # https://konto.clawco.work
sky/scripts/saet-hemmelighed.sh SKY_CLOUDFLARE_TUNNEL_TOKEN
sky/scripts/saet-hemmelighed.sh --fra-bws DEV__STRIPE_SECRET_KEY    # → SKY_STRIPE_SECRET_KEY (KC-0190)
sky/scripts/saet-hemmelighed.sh --fra-bws DEV__R2_ACCOUNT_ID        # → SKY_R2_ACCOUNT_ID (KC-0185) …
# Deploy (pull main from the bare repo, npm ci, restart, /health must show the new sha):
ssh kira-home 'sudo -u sky bash /srv/sky/kontrolcenter/sky/deploy/deploy.sh'
ssh kira-home 'sudo systemctl restart clawco-sky-tunnel && sudo systemctl is-active clawco-sky-tunnel'
```

After a reboot of kira-home, `clawco-sky-netfilter.service` (a root oneshot before `sky.service`, KC-0279) puts the tenant
pool's iptables filter and `/run/sky/netfilter.ok` back by itself (`netfilter-ved-boot.sh` reads `SKY_TENANT_POOL`), so Sky does
not refuse tenants until the next deploy; `opsaet-root.sh` installs and enables it.

`--fra-bws` reads Bitwarden Secrets Manager (project `shelfatlas`) through
`~/projects/ShelfAtlas/scripts/secrets/runtime.mjs`, which loads its own machine token; Henrik is never
asked to paste a key that already lives there. Logs: `journalctl -u sky -n 100` and
`journalctl -u clawco-sky-tunnel -n 100` (as henrik when he is in the `adm` or `systemd-journal` group — not checked yet; deliberately not granted via sudo, since a pager as root is a root shell).

## Each deploy (agent-run, like AGENTS §7)

After the squash-merge to `main`: push `main` to the `kira` remote, then
`ssh kira-home 'sudo -u sky bash /srv/sky/kontrolcenter/sky/deploy/deploy.sh'`. It pulls `main`, runs
`npm ci --omit=dev` in `sky/`, restarts the unit (migrations apply at start under an advisory lock; a
failing migration stops the start), and fails unless `/health` answers with the new sha.

When a unit file or the sudoers text changes, Henrik re-runs the root script (it only redoes what differs).

## Tenants on kira-home (beta)

`SKY_FLAADE=lokal` makes Sky run one container per tenant from `SKY_TENANT_BILLEDE` (KC-0157), one
named volume per tenant, on the Docker network `SKY_TENANT_NETVAERK` (default `clawco-sky`) that the
gateway joins; no tenant port is ever published on the host. **Beta volumes are not encrypted at rest
yet**: Sky has no root on kira-home's disks (no LUKS), and the key-fed encryption seam waits for the
tenant key (KC-0181). Until `SKY_FLAADE` is set, Sky provisions nothing and an owner's account deletion
refuses. Giving `sky` access to Docker (the `docker` group is root-equivalent on the host) is a separate,
explicit step when provisioning goes live; the root script does not do it.

**What a tenant is told about itself (KC-0246).** Every container gets `KC_ADRESSE=https://<slug>.<SKY_BASEDOMAIN>` (the
tenant origin, from `tenantOrigin`: the one place a tenant's URL is made), so "Log ind med Google" has a callback address to
register (`<KC_ADRESSE>/api/kilder/<id>/tilbage`, forwarded by the gateway like any other path), and `KC_SPROG=da|en`, the
language the owner chose at sign-up (read by the tenant for a NEW data folder only; an existing folder never changes
language from it). A container's environment is fixed when it is created: **tenants created before this change get both only
when their container is recreated** — by the next rollout (`udrul.ts start`), or on purpose now:
`node --env-file=/srv/sky/.env sky/scripts/genstart-flaade.ts --dry-run`, then without `--dry-run` (same image, same volume,
one tenant at a time). Their language is already fixed in their data folder, so for them only the address changes.

Planning numbers (measured 2026-10-31): Henrik's data dir 192 KB, his Obsidian vault 161 MB; kira-home
has 15 GB RAM and 1.7 TB free disk; zstd is present for the nightly snapshots (KC-0185).

## Backups (KC-0185)

Every night each provisioned tenant's volume and Sky's own database are copied to the R2 bucket
`clawco-sky-backup` (Cloudflare's EU jurisdiction, free tier) and kept **exactly 30 days**. The job runs inside
the Sky process (`sky/src/drift/backup/`): a pass at start and every 5 minutes, each scope in its own slot
between 00:00 and 04:00 UTC, catch-up after downtime, hourly retry after a failure. A failed run deletes
nothing; older copies are pruned only after a success, and the newest copy is never pruned by age.

- **Tenant copy**: `docker run --rm` with the tenant volume mounted `:ro` (after `docker volume inspect` has
  seen it), `tar` of all of `/data` (nothing excluded), gzip, AES-256-GCM under the tenant's own `backup` key
  (HKDF from its DEK, KC-0181), object `tenant/<slug>/<id>.ckb`. One tenant's key opens only its own copies.
- **Database copy**: `pg_dump --format=custom` (connection through `PG*` variables, never argv), sealed under
  the `db-backup` key derived from the master key, object `db/<id>.ckb`. The copy records its master-key
  version: **after a master-key rotation, keep the previous key's sealed offline copy (NOEGLE.md) for 30
  days**, or the older dumps cannot be opened.
- **Deleted tenant**: its copies stay until its data key's purge date (30 days after deletion) and are then
  deleted with it. Restoring one before that is Henrik's explicit action (the script below), never automatic.
- **Drill**: once a calendar month (UTC) Sky restores the internal test tenant (`SKY_KOPI_TESTTENANT`) and two
  random tenants into scratch containers `clawco-p-…` (no gateway route), waits for `/health`, compares the
  restored files with the manifest taken at backup time and removes the scratch; the newest dump is opened,
  checked against its checksum and read by `pg_restore --list`. Results are in `drift.proeve`.
- **Alerts** (KC-0187 is not built yet): log lines `ADVARSEL: …` in `journalctl -u sky` with counts only — no
  copy in 36 hours, a failed drill, copies above 80 % of R2's free 10 GB.

Keys in `/srv/sky/.env` (names only; values via `saet-hemmelighed.sh --fra-bws …`): `SKY_R2_ACCOUNT_ID`,
`SKY_R2_ACCESS_KEY_ID`, `SKY_R2_SECRET_ACCESS_KEY`, `SKY_R2_BUCKET`, optionally `SKY_R2_JURISDICTION` (unset =
`eu`) and `SKY_KOPI_TESTTENANT`. Backups also need `SKY_MASTERNOEGLE`; Sky says at start whether they are on.
The token needs object read/write on the bucket only (PUT/GET/DELETE object and ListObjectsV2).

By hand, as `sky` on kira-home (prints counts and ids only, never a key):

```bash
cd /srv/sky/kontrolcenter
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts status
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts koer <slug>|db|alle   # a copy now
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts liste <slug>|db
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts gendan <slug> [<id>]  # NEW volume + container clawco-g-…
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts fjern clawco-g-…      # remove it again
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts proeve <slug>|db      # one drill now
node --env-file=/srv/sky/.env sky/scripts/sikkerhedskopi.ts db-gendan <scratch-db> [<id>]  # into an existing empty DB
```

A restored container `clawco-g-…` runs like its tenant (same image, identity, hardening) but is not in the
gateway; moving the tenant onto it ("Gendan til i går" on the account page) is a follow-up. Its lager key is
not delivered, so it runs without the tenant's model keys.

## Udrulning: a new tenant image, cohort by cohort (KC-0186)

A **release** is a local tenant image `clawco:<sha>` on kira-home (there is no registry; nothing is pushed). Tenants
run its **image id** (`sha256:…`), never the tag. Cohorts: `intern` (the operator's own test tenant, set by hand),
`kanari` (filled automatically to ceil(5 %) of the others, at least one), `alle` (every new tenant). Soak: intern 10
minutes, kanari 1 hour (`sky/src/drift/udrulning/hold.ts`). At most two tenants are replaced at once, never every
tenant of the host.

Per tenant: its current image and `/health` sha are recorded (a tenant that does not answer now is skipped), a
**restore point** is taken (the same sealed copy as the nightly backup; in R2 when it is set up, otherwise in
`SKY_LOKALE_KOPIER`, default `/srv/sky/kopier`, 0700 — on the host's own disk, so a restore point and not an offsite
backup; pruned 7 days after the rollout ends; none → the tenant is skipped with an `ADVARSEL:` line), the gateway
shows "Opdaterer, et øjeblik", the container is replaced with the release's image on the same volume, the lager key
is delivered again, and the tenant counts as upgraded only when its own `/health` shows the release's sha within 60 s.
Otherwise that tenant is rolled back to its previous image (verified by its previous sha) and the rollout **halts**.
Before anything starts, the release must prove a rollback works: the new image on a fresh scratch disk, then the
previous image on that same disk (scratch `clawco-u-…`, removed after).

1. Build the image on kira-home (as henrik, in `~/kontrolcenter` at the `main` sha to release):

   ```bash
   sha=$(git rev-parse --short HEAD)
   docker build --build-arg GIT_SHA=$sha -t clawco:$sha .
   ```

2. Roll it out from the Mac through the fixed wrapper `sky/deploy/udrul.sh` (KC-0279): it runs as the user Sky runs
   as (it needs Docker, like `SKY_FLAADE=lokal`), `cd`s into the checkout itself (`/srv/sky` is 0750) and accepts only
   the forms below, so `henrik` may run it without a password (sudoers line from `opsaet-root.sh`). `start` runs in the
   foreground through every soak: run it under `nohup … &` on the host (or `tmux`), and watch with a second ssh
   running `status`. Killed, `fortsaet` continues where it stopped.

   ```bash
   U='sudo -n -u sky /usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/udrul.sh'
   ssh kira-home "$U hold <henriks-slug> intern"        # once; <slug> = hus- and eight characters
   ssh kira-home "$U start clawco:<sha>"
   ssh kira-home "$U status"
   ssh kira-home "$U fortsaet"                          # after a kill, or past a halt (failed tenants stay old)
   ssh kira-home "$U tilbage"                           # every tenant of the rollout back to its old image
   ```

   The one-liner for a release is `ssh kira-home 'sudo -n -u sky /usr/bin/bash /srv/sky/kontrolcenter/sky/deploy/udrul.sh start clawco:<sha>'`.

3. When it is done, set `SKY_TENANT_BILLEDE=clawco:<sha>` in `/srv/sky/.env` and restart Sky, so new tenants start
   on the release too (a rollout only moves tenants that exist when it starts).

A destructive data change in the tenant ships in two releases and needs Henrik's explicit yes (AGENTS §0 r1): the
compatibility check refuses a release the previous one cannot run after.

## Refunds after "Fortryd aftale" (KC-0209)

A customer who withdraws inside the 14 days leaves a **refund task** (table `abonnement.refusion_opgave`) and one journal line
`sky abonnement: REFUSIONSOPGAVE …` (`journalctl -u sky`). No code in Sky refunds anything (AGENTS §9; `sky/test/abonnement/opsigelse-saum.test.ts`
fails if a refund call ever appears): the owner refunds the amount in the Stripe dashboard by hand, then marks the task done.

```bash
node --env-file=/srv/sky/.env sky/scripts/refusioner.ts                 # the open tasks: number, account, amount, due date
node --env-file=/srv/sky/.env sky/scripts/refusioner.ts udfoert <nr>    # after refunding it in Stripe
```

The receipt, cancellation and withdrawal mails go through the same Post seam as the login link; the renewal reminder
(`abonnement/paamindelse.ts`) is built but nothing sends it yet (no scheduler sends mail; a follow-up).

## Status feed (KC-0189)

Every minute Sky asks each klar tenant's `/health` on its private address (the tenant network, never the public edge),
judges the components (login, adgang via the canary tenant's host on Sky's own port, oprettelse, sikkerhedskopi, mail,
the tenants' own health) and stores the pass in `drift.helbred_*`. `GET /status.json` on the account host is the
public feed: counts and percentages only, cached 30 s, CORS for `SKY_STATUS_ORIGIN` only. Five minutes of a tenant
answering syg raises the `tenant-usund` alert (KC-0187). The daily clean-up logs one line `sky helbred: oprullet …`.
With backups off (no R2 token, KC-0185) the `sikkerhedskopi` component is `nede`, by design.

```bash
curl -s https://<account host>/status.json                                               # the feed
node --env-file=/srv/sky/.env sky/scripts/haendelse.mjs ny "<titel>" "<tekst>"            # an incident (plain text)
node --env-file=/srv/sky/.env sky/scripts/haendelse.mjs liste                             # with ids
node --env-file=/srv/sky/.env sky/scripts/haendelse.mjs slut <id>                         # ended now
```

## The included model (KC-0264)

Every Sky plan includes the Calm model (Henrik 2026-11-03, KC-0253 D1) through Sky's own model proxy on the account host:
`POST <SKY_PUBLIC_URL>/model/v1/messages` (the Messages wire, SSE passed through) and `GET …/model/v1/forbrug`. The gateway
never forwards `/model/` from a tenant host. Each tenant has its own model token: derived from its data key, stored only as
a SHA-256 (`hemmeligheder.model_token`, migration 0019), delivered after every container start to
`/run/secrets/model-token` on the private key tmpfs (the env carries the path, `KC_MODEL_TOKEN_FIL`, never the token),
revoked when the tenant is deleted. Each call is one row in `model.forbrug` (token counts and micro-USD, never content);
the month's cap is the plan's `inkluderetModel.loftMikroUsd` in `config/priser.json` (a household shares it), checked before
each call (402 `kvote_brugt` with the reset date, the first of next UTC month).

**Off until all three hold** (each missing piece is named in the start log line `sky: inkluderet model …`, /model answers 503):

1. `SKY_INKLUDERET_MODEL=ja` (also what tells tenants `KC_MODEL_PROXY_URL`, at their next create or recreate:
   `sky/scripts/genstart-flaade.ts`).
2. A provider: `SKY_MODEL_UDBYDER=anthropic` with `SKY_ANTHROPIC_API_KEY`, or `SKY_MODEL_UDBYDER=bedrock` with
   `SKY_AWS_ACCESS_KEY_ID` + `SKY_AWS_SECRET_ACCESS_KEY` (optional `SKY_AWS_REGION`, default eu-north-1). Set each with
   `sky/scripts/saet-hemmelighed.sh <NAME>` (name and length only), then restart Sky. Sky removes the keys from its
   environment at start, so no child process (docker, pg_dump) inherits them.
   Bedrock means `bedrock-runtime.eu-north-1.amazonaws.com` with the EU cross-region inference profile
   `eu.anthropic.claude-haiku-5-5` (`config/modelpriser.json`; requests from eu-north-1 stay within eu-central-1, eu-north-1, eu-south-1,
   eu-south-2, eu-west-1, eu-west-3). The IAM user behind `SKY_AWS_ACCESS_KEY_ID` gets only this policy (ACCOUNT_ID = the
   AWS account):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Sid": "Profil", "Effect": "Allow",
         "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:GetInferenceProfile"],
         "Resource": "arn:aws:bedrock:eu-north-1:ACCOUNT_ID:inference-profile/eu.anthropic.claude-haiku-5-5" },
       { "Sid": "ModelViaProfil", "Effect": "Allow",
         "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
         "Resource": [
           "arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-haiku-5-5",
           "arn:aws:bedrock:eu-north-1::foundation-model/anthropic.claude-haiku-5-5",
           "arn:aws:bedrock:eu-south-1::foundation-model/anthropic.claude-haiku-5-5",
           "arn:aws:bedrock:eu-south-2::foundation-model/anthropic.claude-haiku-5-5",
           "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-5-5",
           "arn:aws:bedrock:eu-west-3::foundation-model/anthropic.claude-haiku-5-5"
         ],
         "Condition": { "StringEquals": { "bedrock:InferenceProfileArn": "arn:aws:bedrock:eu-north-1:ACCOUNT_ID:inference-profile/eu.anthropic.claude-haiku-5-5" } } }
     ]
   }
   ```

   The very first call also needs `aws-marketplace:Subscribe` and `aws-marketplace:ViewSubscriptions` (Resource `*`) to
   enable the model in the account; add them for that call, or enable the model once as an admin, then remove them.
3. The provider's host listed as a subprocessor in `docs/legal/behandlinger.json` (KC-0266, after Henrik's provider choice;
   then `node scripts/behandlinger.ts --skriv` regenerates the public list).

Rotate one tenant's token: `node --env-file=/srv/sky/.env sky/scripts/roter-modeltoken.ts <slug>` (delivers the new one to the
running container; prints no token). The owner's cost view, per UTC day and the month so far:
`node --env-file=/srv/sky/.env sky/scripts/model-forbrug.ts [--dage 30] [--json]`.

## Local run (development)

```bash
npm --prefix sky ci
createdb sky_dev            # any local Postgres
SKY_DATABASE_URL=postgres:///sky_dev SKY_PUBLIC_URL=http://localhost:8781 npm --prefix sky start
curl http://127.0.0.1:8781/health
```

Tests need no Postgres: they use PGlite (in-process). `npm run sky:test` from the repo root.
