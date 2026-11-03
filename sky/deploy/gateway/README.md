# The gateway (KC-0183) — operating notes

The gateway is not its own service: it lives inside Sky's process (`sky/src/gateway/`). Sky listens on
`127.0.0.1:8781` and dispatches on `Host`:

| Host | Goes to |
|---|---|
| the host of `SKY_PUBLIC_URL` (the account app), `localhost`, `127.0.0.1` | the account app (and `/health`, which `deploy.sh` reads on loopback) |
| `<slug>.<SKY_BASEDOMAIN>` (a valid `hus-…` slug, not a reserved name) | the gateway |
| anything else | a plain 404 |

TLS ends at Cloudflare (Universal SSL covers first-level names under the zone); the Cloudflare Tunnel
(`clawco-sky-tunnel.service`) forwards to Sky's loopback port. No tenant container publishes a port: tenants
sit on the `clawco-sky` Docker network with inter-container traffic off, reachable only from the host.

## Cloudflare, once (Zero Trust → Networks → Tunnels → `clawco-sky` → Public hostnames)

In this order (Cloudflare matches top to bottom):

1. `konto.<basedomain>` → `http://127.0.0.1:8781` (exists since KC-0212)
2. `*.<basedomain>` → `http://127.0.0.1:8781` — the same port: Sky tells the two apart by `Host`.
   Leave "HTTP Host Header" empty (the original `Host` must reach Sky) and do not enable "No TLS Verify" or
   any origin rewrite.
3. The tunnel's catch-all stays `http_status:404`.

DNS (Cloudflare → the zone → DNS): a **proxied** `CNAME` named `*` pointing at `<tunnel-id>.cfargotunnel.com`
(the dashboard creates it with the wildcard hostname; check it is there and orange-clouded). The apex and
`www` keep their own records (the static site); an explicit record always wins over the wildcard, so they
are untouched. The gateway refuses the reserved names (`www`, `konto`, `status`, `api`, `mail`, `sky`,
`docs`, `admin`, from `sky/src/delt/slug.ts`) even if a request for one arrives.

## The signing key

`SKY_GATEWAY_SIGNERINGSNOEGLE` in `/srv/sky/.env`: a 32-byte Ed25519 seed as base64url, the private half of
`SKY_KONTO_PUBKEY` (the public key every tenant gets as `KC_KONTO_PUBKEY`). Sky checks the pair at start: a
missing key or a pair that does not match leaves every tenant address at 503 and `/health` at
`gateway: "mangler"` (503 with a fleet). Set it with `sky/scripts/saet-hemmelighed.sh
SKY_GATEWAY_SIGNERINGSNOEGLE` (hidden prompt; prints name and length only). The same seed also keys the tenant
cookie and the login path's `next` (HKDF, separate purposes), so changing it logs every tenant browser out
once (they are sent through login again; nothing else is lost).

## Rotation (KC-0217)

The tenant verifier (`src/identitet/konto.ts`) accepts two public keys, `KC_KONTO_PUBKEY` and `KC_KONTO_PUBKEY_NY`,
picked by the key id in the header. Sky hands a tenant the second one when `SKY_KONTO_PUBKEY_NY` is set (public, not
a secret; Sky refuses to start if it equals `SKY_KONTO_PUBKEY`). A container's environment is fixed when it is created,
so `sky/scripts/genstart-flaade.ts` recreates every klar tenant's container with the current environment (same image,
same volume, so the data stays; the rollout's order intern → kanari → alle, key delivery and `/health` wait; one tenant
at a time; stops at the first failure; `--dry-run` lists and changes nothing; refused while a rollout is active).

**What it costs a customer.** Each tenant restarts once per `genstart-flaade` run (steps 2 and 4), a few seconds behind
the "Opdaterer, et øjeblik" page. **Step 3 logs every tenant browser out once:** the seed also keys the tenant cookie and
the login path's `next` (HKDF, `gateway/noegle.ts`), so a new seed invalidates every cookie and any login link in flight;
people are sent through the account login again and nothing else is lost. That is the current design, not a fault.
Do step 3 at a quiet hour.

Commands run from the repo root on the Mac (`HOST=henrik@kira-home`, key `~/.ssh/kira-home`); secrets never reach the
terminal, only names and lengths. Use a 0600 file in `$HOME` for a seed (`umask 077`) and delete it at the end.

1. **A new seed and its public key.** The seed goes to a file, the public key is printed:
   ```
   (umask 077; node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { noegleFraFroe } from './sky/src/gateway/signer.ts'; const f = randomBytes(32); console.log(f.toString('base64url')); console.error('ny offentlig: ' + noegleFraFroe(f).offentlig + ' (frø: ' + f.length + ' bytes)')" > ~/.clawco-ny-froe)
   (umask 077; ssh -i ~/.ssh/kira-home henrik@kira-home "sudo -n -u sky bash -c 'grep ^SKY_GATEWAY_SIGNERINGSNOEGLE= /srv/sky/.env'" | cut -d= -f2 > ~/.clawco-gammel-froe)   # kept for rollback
   ```
   (KC-0276: `sudo -n -u sky` now only runs the fixed scripts; the `grep` above needs henrik's password, so run it in a terminal on kira-home as `sudo -u sky grep ^SKY_GATEWAY_SIGNERINGSNOEGLE= /srv/sky/.env`.)
   Note the printed public key (`NY_PUB` below) and the old one (`SKY_KONTO_PUBKEY` in `/srv/sky/.env`, `GAMMEL_PUB`).
2. **Every tenant gets both keys.** Mac first, then kira-home as `sky` in `/srv/sky/kontrolcenter` (as for `udrul.ts`,
   `sky/deploy/README.md`, Udrulning; run it under `tmux`):
   ```
   printf '%s\n' "$NY_PUB" | sky/scripts/saet-hemmelighed.sh SKY_KONTO_PUBKEY_NY
   ssh kira-home 'sudo systemctl restart sky'
   # kira-home:
   curl -s http://127.0.0.1:8781/health    # shows "noegleskift":"forberedt"
   node --env-file=/srv/sky/.env sky/scripts/genstart-flaade.ts --dry-run   # the list, nothing changes
   node --env-file=/srv/sky/.env sky/scripts/genstart-flaade.ts             # "<slug>: genstartet" per tenant, then "N genstartet, 0 fejlede"
   ```
   Go on only when it ends `0 fejlede` (otherwise fix the named tenant and run it again; a tenant created in the
   meantime already has both keys). Requests are still signed with the old key.
3. **Sign with the new key** (logs browsers out once, see above). Mac, then kira-home:
   ```
   sky/scripts/saet-hemmelighed.sh SKY_GATEWAY_SIGNERINGSNOEGLE < ~/.clawco-ny-froe
   printf '%s\n' "$NY_PUB" | sky/scripts/saet-hemmelighed.sh SKY_KONTO_PUBKEY
   # kira-home, as henrik: take SKY_KONTO_PUBKEY_NY out of the file
   sudo -u sky bash -c "sed -i '/^SKY_KONTO_PUBKEY_NY=/d' /srv/sky/.env"
   sudo systemctl restart sky
   curl -s http://127.0.0.1:8781/health    # gateway "ok", no "noegleskift"
   ```
   Sky checks the pair at start (a seed that does not match `SKY_KONTO_PUBKEY` leaves every tenant at 503 and `/health`
   at `gateway: "mangler"`: put the old values back, see Rollback). Tenants that still run with the old key as
   `KC_KONTO_PUBKEY` accept the new one as `KC_KONTO_PUBKEY_NY`; a tenant created from now on has the new key as
   `KC_KONTO_PUBKEY`. Open one tenant address (Checking it, below) to see it answer.
4. **Drop the old key everywhere.** On kira-home, as in step 2: `node --env-file=/srv/sky/.env
   sky/scripts/genstart-flaade.ts` once more. Every tenant now has `KC_KONTO_PUBKEY=<new>` and no `_NY`; the old key
   is accepted nowhere. Then on the Mac `rm ~/.clawco-ny-froe ~/.clawco-gammel-froe`.

**Rollback.** Until step 4 has run: put the old values back (`saet-hemmelighed.sh SKY_GATEWAY_SIGNERINGSNOEGLE <
~/.clawco-gammel-froe`, and `SKY_KONTO_PUBKEY` = `GAMMEL_PUB`), remove `SKY_KONTO_PUBKEY_NY` as in step 3, restart Sky:
the tenants' primary key is still the old one, so they accept it at once (browsers are logged out once more). Run
`genstart-flaade` afterwards only to take `KC_KONTO_PUBKEY_NY` out of the containers. After step 4 the old key is gone
from every tenant, so going back is a new rotation with the old seed as the "new" one.

## Checking it

- `curl -s http://127.0.0.1:8781/health` on kira-home: `gateway: "ok"`.
- From outside: `https://<slug>.<basedomain>/` without a cookie → 302 to `https://konto.<basedomain>/aabn?…`;
  `https://<slug>.<basedomain>/health` → 404; a reserved or unknown name → 404.
- Logs: `journalctl -u sky` lines `sky gateway: <METHOD> <slug> <status> <ms>ms konto=<id>` — never a path,
  query string, cookie, header or body.
