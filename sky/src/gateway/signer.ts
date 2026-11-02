// KC-0179: the gateway's half of the identity contract with a tenant (the tenant's half is
// src/identitet/konto.ts in the app; the two share no code, only test/fixtures/konto-vektorer.json).
// After login the gateway (KC-0183) puts who the person is on every request to the tenant as
//   Clawco-Konto: v1.<keyid>.<base64url payload>.<base64url signature>
// payload = JSON {t: tenant id, k: konto id, e: verified email, iat: unix seconds}, in that key order;
// signature = Ed25519 over the exact ASCII bytes "v1.<keyid>.<payload>"; keyid = the first 8 bytes of
// SHA-256 of the raw 32-byte public key, base64url — derived from the key, so a tenant configured with
// two public keys (rotation) picks the right one without a separate id setting.
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

export const KONTO_HEADER = 'Clawco-Konto';
export type KontoPaastand = { t: string; k: string; e: string; iat: number };

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
  const { id } = offentligAf(privat);
  const payload = Buffer.from(JSON.stringify({ t: p.t, k: p.k, e: p.e, iat: p.iat })).toString('base64url');
  const til = `v1.${id}.${payload}`;
  return `${til}.${sign(null, Buffer.from(til), privat).toString('base64url')}`;
}
