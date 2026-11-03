// The tenant cookie (KC-0183): `__Host-clawco` on the tenant's own host (host-only, Secure, HttpOnly, Lax)
// holds a short-lived token v1.<payload>.<HMAC-SHA256>, payload = {t: slug, k: konto id, s: Sky session id,
// e: verified email, iat, exp}. Good for 15 minutes without asking the database; after that it is refreshed
// only while the Sky session behind it lives and the account is not deleted — so logging out, revoking a
// session or deleting the account ends tenant access within one refresh. A token names its tenant: one for
// A is nothing on B.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/pool.ts';

export const COOKIE = '__Host-clawco';
export const TOKEN_MS = 15 * 60_000;
/** The cookie lives as long as a Sky session can (30 days); the token inside is what expires. */
const COOKIE_SEK = 30 * 86_400;

/** KC-0188: a support session (kind `stoette`) also names its grant `g` and its random session id `n`; it never lives
 *  past the grant (`til`), and the gateway still asks the database on every request. */
export type TokenIndhold = { t: string; k: number; s: number; e: string; iat: number; exp: number; g?: number; n?: string };
export type TokenUdfald = { ok: true; p: TokenIndhold; udloebet: boolean } | { ok: false };

const mac = (n: Buffer, s: string): Buffer => createHmac('sha256', n).update(s).digest();

export function udstedToken(n: Buffer, p: { t: string; k: number; s: number; e: string; g?: number; n?: string }, nu: Date, til?: Date): string {
  const iat = nu.getTime();
  const exp = Math.min(iat + TOKEN_MS, til ? til.getTime() : Number.POSITIVE_INFINITY);
  const stoette = p.g !== undefined ? { g: p.g, n: p.n } : {};
  const payload = Buffer.from(JSON.stringify({ t: p.t, k: p.k, s: p.s, e: p.e, iat, exp, ...stoette })).toString('base64url');
  return `v1.${payload}.${mac(n, `v1.${payload}`).toString('base64url')}`;
}

export function laesToken(n: Buffer, vaerdi: string | undefined, slug: string, nu: Date): TokenUdfald {
  const m = /^v1\.([A-Za-z0-9_-]{1,2000})\.([A-Za-z0-9_-]{43})$/.exec(vaerdi ?? '');
  if (!m) return { ok: false };
  const givet = Buffer.from(m[2]!, 'base64url');
  const ventet = mac(n, `v1.${m[1]}`);
  if (givet.length !== ventet.length || !timingSafeEqual(givet, ventet)) return { ok: false };
  let p: TokenIndhold;
  try { p = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as TokenIndhold; } catch { return { ok: false }; }
  if (p.t !== slug || !Number.isSafeInteger(p.k) || !Number.isSafeInteger(p.s) || typeof p.e !== 'string' || !p.e || !Number.isSafeInteger(p.exp)) return { ok: false };
  if ((p.g !== undefined || p.n !== undefined) && (!Number.isSafeInteger(p.g) || typeof p.n !== 'string' || !/^[a-f0-9]{16}$/.test(p.n))) return { ok: false };
  return { ok: true, p, udloebet: nu.getTime() >= p.exp };
}

/** The account's verified email while Sky session `s` of account `k` lives and the account is not deleted. */
export async function sessionLever(db: Database, p: { s: number; k: number }, nu: Date): Promise<string | null> {
  const [r] = await db.query<{ email: string | null }>(
    `SELECT k.email FROM session s JOIN konto k ON k.id = s.konto_id
      WHERE s.id = $1 AND s.konto_id = $2 AND s.udloeber > $3 AND k.slettet_ved IS NULL`, [p.s, p.k, nu.toISOString()]);
  return r?.email ?? null;
}

/** Our cookie's value out of a Cookie header (the first one, as browsers send the most specific first). `navn`
 *  (KC-0272): another of the gateway's own cookies. */
export function cookieFra(header: string | undefined, navn: string = COOKIE): string | undefined {
  for (const del of (header ?? '').split(';')) {
    const i = del.indexOf('=');
    if (i > 0 && del.slice(0, i).trim() === navn) return del.slice(i + 1).trim();
  }
  return undefined;
}

export function saetCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_SEK}; HttpOnly; Secure; SameSite=Lax`;
}

export function sletCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
