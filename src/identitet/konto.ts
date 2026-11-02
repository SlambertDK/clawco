// Identity provider `konto` (KC-0179, spec §2 / D12): in Clawco Sky the gateway (KC-0183) has logged the
// person in and puts who they are on every request it forwards, signed with its Ed25519 key:
//   Clawco-Konto: v1.<keyid>.<base64url payload>.<base64url signature>
// payload = JSON exactly {t: tenant id, k: konto id, e: verified email, iat: unix seconds}; the signature
// covers the ASCII bytes "v1.<keyid>.<payload>"; keyid = first 8 bytes of SHA-256 of the raw public key,
// base64url. The gateway's half is sky/src/gateway/signer.ts; the two share only the test vectors
// (test/fixtures/konto-vektorer.json, byte-identical in sky/test/fixtures/).
//
// Invariant (AGENTS §0 r2/r7): a request is accepted only with a signature this tenant's configured
// gateway key made for this tenant within the window, arriving from the gateway's address — never from
// a cookie, query or body the client controls. Anything else fails closed.
//
// Replay: a captured header is valid for up to 60 seconds. Accepted risk: the hop gateway → tenant is a
// private network and TLS terminates at the gateway, so nobody outside it sees a header to replay; the
// peer check means a replay must also come from the gateway's own address.
//
// Pure: no I/O. The caller supplies the headers, the TCP peer and the clock.

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';
import type { Anmodning } from './identitet.ts';

export const KONTO_HEADER = 'clawco-konto';
/** Seconds a signature is good for after `iat`, and the clock skew allowed before it. */
export const VINDUE_FORTID = 60;
export const VINDUE_FREMTID = 10;

export type KontoIndstilling = { tenant: string; gateway: string; noegler: ReadonlyMap<string, KeyObject> };
export type KontoUdfald = { ok: true; email: string } | { ok: false; grund: string };

const TENANT = /^[a-z0-9][a-z0-9-]{0,39}$/; // as Sky's fleet names tenants (sky/src/fleet/flaade.ts)
const NOEGLE = /^[A-Za-z0-9_-]{43}$/; // 32 raw bytes, base64url without padding
const HEADER = /^v1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{1,1400})\.([A-Za-z0-9_-]{86})$/;

const ip = (s: string): string => s.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

function offentligNoegle(navn: string, vaerdi: string): [string, KeyObject] {
  if (!NOEGLE.test(vaerdi)) throw new Error(`${navn} mangler eller er ikke en Ed25519-nøgle (32 bytes, base64url)`);
  try {
    const noegle = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: vaerdi }, format: 'jwk' });
    return [createHash('sha256').update(Buffer.from(vaerdi, 'base64url')).digest().subarray(0, 8).toString('base64url'), noegle];
  } catch { throw new Error(`${navn} er ikke en gyldig Ed25519-nøgle`); }
}

/**
 * The provider from the environment: null = tailnet (the default), else the konto settings. Throws an Error that
 * names the key on any missing or invalid value, so the app refuses to start rather than run half-configured.
 */
export function kontoFraMiljoe(e: Record<string, string | undefined>): KontoIndstilling | null {
  const v = (k: string): string => (e[k] ?? '').trim();
  const valg = v('KC_IDENTITET') || 'tailnet';
  if (valg === 'tailnet') return null;
  if (valg !== 'konto') throw new Error('KC_IDENTITET skal være tailnet eller konto');
  const tenant = v('KC_KONTO_TENANT');
  if (!TENANT.test(tenant)) throw new Error('KC_KONTO_TENANT mangler eller er ugyldig (små bogstaver, tal og bindestreg, højst 40 tegn)');
  const gateway = v('KC_KONTO_GATEWAY');
  if (!isIP(gateway)) throw new Error('KC_KONTO_GATEWAY mangler eller er ikke en IP-adresse');
  const noegler = new Map([offentligNoegle('KC_KONTO_PUBKEY', v('KC_KONTO_PUBKEY'))]);
  if (v('KC_KONTO_PUBKEY_NY')) noegler.set(...offentligNoegle('KC_KONTO_PUBKEY_NY', v('KC_KONTO_PUBKEY_NY')));
  return { tenant, gateway: ip(gateway), noegler };
}

const tekst = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/** Checks the header of one request. `grund` is for the log only: it never contains the header value. */
export function verificerKonto(a: Anmodning, k: KontoIndstilling, nuSek: number): KontoUdfald {
  if (!a.peer || ip(a.peer) !== k.gateway) return { ok: false, grund: 'ikke fra gatewayen' };
  const raa = a.headers.get(KONTO_HEADER);
  if (raa === null) return { ok: false, grund: 'ingen Clawco-Konto' };
  const m = HEADER.exec(raa); // a duplicated header arrives joined by ", " and fails here
  if (!m) return { ok: false, grund: 'Clawco-Konto har forkert form' };
  const [, id, payload, signatur] = m as unknown as [string, string, string, string];
  const noegle = k.noegler.get(id);
  if (!noegle) return { ok: false, grund: 'ukendt nøgle-id' };
  if (!verify(null, Buffer.from(`v1.${id}.${payload}`), noegle, Buffer.from(signatur, 'base64url'))) return { ok: false, grund: 'signaturen holder ikke' };
  let p: unknown;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, grund: 'payload er ikke JSON' }; }
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, grund: 'payload er ikke et objekt' };
  const o = p as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== 'e,iat,k,t' || !tekst(o['t'], 40) || !tekst(o['k'], 100) || !tekst(o['e'], 200) || !Number.isSafeInteger(o['iat'])) return { ok: false, grund: 'payload har forkert form' };
  if (o['t'] !== k.tenant) return { ok: false, grund: 'en anden tenant' };
  const alder = nuSek - (o['iat'] as number);
  if (alder > VINDUE_FORTID) return { ok: false, grund: 'udløbet' };
  if (alder < -VINDUE_FREMTID) return { ok: false, grund: 'fra fremtiden' };
  return { ok: true, email: o['e'] as string };
}
