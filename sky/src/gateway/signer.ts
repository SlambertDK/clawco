// KC-0179: the gateway's half of the identity contract with a tenant (the tenant's half is
// src/identitet/konto.ts in the app; the two share no code, only test/fixtures/konto-vektorer.json).
// After login the gateway (KC-0183) puts who the person is on every request to the tenant as
//   Clawco-Konto: v1.<keyid>.<base64url payload>.<base64url signature>
// payload = JSON {t: tenant id, k: konto id, e: verified email, iat: unix seconds, m: method, p: path}, in that key
// order (KC-0272: m and p bind the header to the one request it was made for, so a captured header cannot be
// replayed onto another method or path within the window; p is the path without the query);
// signature = Ed25519 over the exact ASCII bytes "v1.<keyid>.<payload>"; keyid = the first 8 bytes of
// SHA-256 of the raw 32-byte public key, base64url — derived from the key, so a tenant configured with
// two public keys (rotation) picks the right one without a separate id setting.
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

export const KONTO_HEADER = 'Clawco-Konto';
/** KC-0188: a support session adds three claims, in this order after iat: sa (the grant's id), su (when the grant
 *  ends, unix seconds) and sn (this session's random id). The tenant accepts them only beside its own record of the
 *  grant (src/identitet/stoette.ts), so a gateway bug cannot extend one. */
export type StoettePaastand = { sa: string; su: number; sn: string };
export type KontoPaastand = { t: string; k: string; e: string; iat: number; m: string; p: string } & Partial<StoettePaastand>;
/** The longest path a header can name (the tenant caps the whole header; a longer path is refused at the gateway). */
export const STI_MAKS = 512;

/** The key id of a raw 32-byte Ed25519 public key. */
export function noegleId(offentligRaw: Buffer): string {
  return createHash('sha256').update(offentligRaw).digest().subarray(0, 8).toString('base64url');
}

// PKCS#8 DER prefix of an Ed25519 private key; the 32-byte seed follows (RFC 8410).
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The signing key from its 32-byte seed, with the public key (raw, base64url) a tenant is configured with. */
export function noegleFraFroe(froe: Buffer): { privat: KeyObject; offentlig: string; id: string } {
  if (froe.length !== 32) throw new Error('en Ed25519-frø er 32 bytes');
  const privat = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, froe]), format: 'der', type: 'pkcs8' });
  return { privat, ...offentligAf(privat) };
}

function offentligAf(privat: KeyObject): { offentlig: string; id: string } {
  const x = createPublicKey(privat).export({ format: 'jwk' }).x;
  if (typeof x !== 'string') throw new Error('nøglen er ikke en Ed25519-nøgle');
  return { offentlig: x, id: noegleId(Buffer.from(x, 'base64url')) };
}

/** The header value for one request. Refuses a claim the tenant would never accept, so a bug fails here, not there. */
export function signerKonto(privat: KeyObject, p: KontoPaastand): string {
  for (const felt of ['t', 'k', 'e'] as const) if (typeof p[felt] !== 'string' || !p[felt]) throw new Error(`påstanden mangler ${felt}`);
  if (!Number.isSafeInteger(p.iat) || p.iat < 0) throw new Error('iat skal være hele sekunder');
  if (typeof p.m !== 'string' || !/^[A-Z]{3,7}$/.test(p.m)) throw new Error('m skal være metoden');
  if (typeof p.p !== 'string' || !p.p.startsWith('/') || p.p.length > STI_MAKS || p.p.includes('?')) throw new Error('p skal være stien');
  const stoette = p.sa !== undefined || p.su !== undefined || p.sn !== undefined;
  if (stoette && (typeof p.sa !== 'string' || !/^\d{1,18}$/.test(p.sa) || !Number.isSafeInteger(p.su) || typeof p.sn !== 'string' || !/^[a-f0-9]{16}$/.test(p.sn))) throw new Error('støttepåstanden er ufuldstændig');
  const { id } = offentligAf(privat);
  const krop = stoette ? { t: p.t, k: p.k, e: p.e, iat: p.iat, m: p.m, p: p.p, sa: p.sa, su: p.su, sn: p.sn } : { t: p.t, k: p.k, e: p.e, iat: p.iat, m: p.m, p: p.p };
  return signer(privat, 'v1', id, krop);
}

function signer(privat: KeyObject, version: 'v1' | 's1' | 'k1', id: string, krop: unknown): string {
  const til = `${version}.${id}.${Buffer.from(JSON.stringify(krop)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), privat).toString('base64url')}`;
}

/** KC-0188: the bevis Sky sends a tenant when its owner turns support on: the grant, signed with the gateway key under
 *  its own prefix `s1.` (so a Clawco-Konto header can never pass as a bevis, nor a bevis as a header). payload =
 *  {t: tenant, a: grant id, g: given, u: ends (unix seconds), h: hours, r: the owner's reason, iat}, in that order. */
export type StoetteBevis = { t: string; a: string; g: number; u: number; h: number; r: string; iat: number };

export function signerStoetteBevis(privat: KeyObject, b: StoetteBevis): string {
  if (!b.t || !/^\d{1,18}$/.test(b.a) || ![b.g, b.u, b.h, b.iat].every(Number.isSafeInteger) || b.u <= b.g || typeof b.r !== 'string') throw new Error('beviset er ugyldigt');
  return signer(privat, 's1', offentligAf(privat).id, { t: b.t, a: b.a, g: b.g, u: b.u, h: b.h, r: b.r, iat: b.iat });
}

/** KC-0184: a control call from Sky to a tenant's internal route (gateway/kontrolkald.ts), never a person. Header
 *  `Clawco-Kontrol: k1.<keyid>.<payload>.<signature>`, its own prefix and audience, so a Clawco-Konto header (v1.) or a
 *  support bevis (s1.) can never pass as one, nor one as them. payload = {aud, t: tenant, m: method, p: path,
 *  h: base64url SHA-256 of the exact body, iat, n: a 16-hex nonce the tenant accepts once}, in that order. */
export const KONTROL_HEADER = 'Clawco-Kontrol';
export const KONTROL_AUD = 'clawco-tenant-kontrol';
export type KontrolPaastand = { t: string; m: string; p: string; h: string; iat: number; n: string };

export const kropHash = (krop: string | Buffer): string => createHash('sha256').update(krop).digest('base64url');

export function signerKontrol(privat: KeyObject, k: KontrolPaastand): string {
  if (!k.t || !/^[A-Z]{3,7}$/.test(k.m) || !/^\/[a-z0-9/_-]{1,200}$/.test(k.p) || !/^[A-Za-z0-9_-]{43}$/.test(k.h) || !Number.isSafeInteger(k.iat) || k.iat < 0 || !/^[a-f0-9]{16}$/.test(k.n)) throw new Error('kontrolkaldet er ugyldigt');
  return signer(privat, 'k1', offentligAf(privat).id, { aud: KONTROL_AUD, t: k.t, m: k.m, p: k.p, h: k.h, iat: k.iat, n: k.n });
}
