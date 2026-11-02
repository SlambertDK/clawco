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

## Rotation

The tenant verifier (`src/identitet/konto.ts`) accepts two public keys, `KC_KONTO_PUBKEY` and
`KC_KONTO_PUBKEY_NY`, picked by the key id in the header. The order:

1. Make a new seed and its public key on a trusted machine (`noegleFraFroe` in `sky/src/gateway/signer.ts`).
2. Give every tenant the new public key as `KC_KONTO_PUBKEY_NY` beside the old one, and restart them.
3. Set the new seed as `SKY_GATEWAY_SIGNERINGSNOEGLE` and the new public key as `SKY_KONTO_PUBKEY`; restart
   Sky. Requests are now signed with the new key; tenants accept it as `…_NY`.
4. Move the new key to `KC_KONTO_PUBKEY` on every tenant and drop `KC_KONTO_PUBKEY_NY`.

**Not yet possible on the lokal fleet:** `sky/src/fleet/lokal.ts` sets a tenant's environment when its
container is first created and has no `KC_KONTO_PUBKEY_NY`, so step 2 needs a fleet change (a follow-up
ticket) before a rotation can be rehearsed. Until then a rotation means recreating every tenant container
with the new key (the volume, and so the data, is kept).

## Checking it

- `curl -s http://127.0.0.1:8781/health` on kira-home: `gateway: "ok"`.
- From outside: `https://<slug>.<basedomain>/` without a cookie → 302 to `https://konto.<basedomain>/aabn?…`;
  `https://<slug>.<basedomain>/health` → 404; a reserved or unknown name → 404.
- Logs: `journalctl -u sky` lines `sky gateway: <METHOD> <slug> <status> <ms>ms konto=<id>` — never a path,
  query string, cookie, header or body.
