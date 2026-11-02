// Control calls from Clawco Sky (KC-0184): Sky — never a person — asking this tenant to change its household when
// an invitation is accepted, a member is removed or leaves, or the owner changes a role. The gateway's half is
// sky/src/gateway/signer.ts (signerKontrol) and sky/src/gateway/kontrolkald.ts; the two share only the test vector
// (test/fixtures/kontrol-vektorer.json, byte-identical in sky/test/fixtures/).
//   Clawco-Kontrol: k1.<keyid>.<base64url payload>.<base64url signature>
// payload = JSON exactly {aud: "clawco-tenant-kontrol", t: tenant, m: method, p: path, h: base64url SHA-256 of the
// body, iat: unix seconds, n: 16 hex nonce}; the signature (Ed25519, the gateway key of KC-0179) covers the ASCII
// bytes "k1.<keyid>.<payload>". Its own prefix and audience: a Clawco-Konto header (v1.) or a support bevis (s1.)
// can never pass as one.
//
// Invariant (AGENTS §0 r2/r7): accepted only when signed by this tenant's configured gateway key, for this tenant,
// this method, this path and this exact body, within the window, the first time its nonce is seen, from the gateway's
// address — and never with a person's Clawco-Konto header beside it. Anything else fails closed.
//
// Replay: a nonce is remembered for the window (in memory). A restart forgets them; then a captured call could be
// replayed within 60 seconds, from the gateway's own address only, with the same body — which only repeats the same
// idempotent change. Accepted risk, as for Clawco-Konto (konto.ts).

import { createHash, verify } from 'node:crypto';
import type { Anmodning } from './identitet.ts';
import { KONTO_HEADER, VINDUE_FORTID, VINDUE_FREMTID, type KontoIndstilling } from './konto.ts';

export const KONTROL_HEADER = 'clawco-kontrol';
export const KONTROL_AUD = 'clawco-tenant-kontrol';

export type KontrolAnmodning = Anmodning & { metode: string; sti: string; krop: Buffer };
export type KontrolUdfald = { ok: true } | { ok: false; grund: string };

/** The nonces seen within the window. One per app; `har` also forgets the expired ones. */
export type NonceLager = { brug(n: string, nuSek: number): boolean };
export function nonceLager(): NonceLager {
  const set = new Map<string, number>();
  return {
    brug(n, nuSek) {
      for (const [k, til] of set) if (til < nuSek) set.delete(k);
      if (set.has(n)) return false;
      set.set(n, nuSek + VINDUE_FORTID + VINDUE_FREMTID);
      return true;
    },
  };
}

const HEADER = /^k1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{1,1400})\.([A-Za-z0-9_-]{86})$/;
const ip = (s: string): string => s.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

/** Checks one control call. `grund` is for the log only: it never contains the header value. */
export function verificerKontrol(a: KontrolAnmodning, k: KontoIndstilling, nuSek: number, nonces: NonceLager): KontrolUdfald {
  if (!a.peer || ip(a.peer) !== k.gateway) return { ok: false, grund: 'ikke fra gatewayen' };
  if (a.headers.has(KONTO_HEADER)) return { ok: false, grund: 'en persons Clawco-Konto ved siden af' };
  const raa = a.headers.get(KONTROL_HEADER);
  if (raa === null) return { ok: false, grund: 'ingen Clawco-Kontrol' };
  const m = HEADER.exec(raa);
  if (!m) return { ok: false, grund: 'Clawco-Kontrol har forkert form' };
  const [, id, payload, signatur] = m as unknown as [string, string, string, string];
  const noegle = k.noegler.get(id);
  if (!noegle) return { ok: false, grund: 'ukendt nøgle-id' };
  if (!verify(null, Buffer.from(`k1.${id}.${payload}`), noegle, Buffer.from(signatur, 'base64url'))) return { ok: false, grund: 'signaturen holder ikke' };
  let p: unknown;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, grund: 'payload er ikke JSON' }; }
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, grund: 'payload har forkert form' };
  const o = p as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== 'aud,h,iat,m,n,p,t' || o['aud'] !== KONTROL_AUD || !Number.isSafeInteger(o['iat']) || typeof o['n'] !== 'string' || !/^[a-f0-9]{16}$/.test(o['n'])) return { ok: false, grund: 'payload har forkert form' };
  if (o['t'] !== k.tenant) return { ok: false, grund: 'en anden tenant' };
  if (o['m'] !== a.metode || o['p'] !== a.sti) return { ok: false, grund: 'en anden sti eller metode' };
  if (o['h'] !== createHash('sha256').update(a.krop).digest('base64url')) return { ok: false, grund: 'en anden krop' };
  const alder = nuSek - (o['iat'] as number);
  if (alder > VINDUE_FORTID) return { ok: false, grund: 'udløbet' };
  if (alder < -VINDUE_FREMTID) return { ok: false, grund: 'fra fremtiden' };
  if (!nonces.brug(o['n'] as string, nuSek)) return { ok: false, grund: 'allerede brugt' };
  return { ok: true };
}
