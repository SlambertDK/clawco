// Sessions (KC-0177): cookie __Host-sky holds a random id, the database only its SHA-256.
// 30 days sliding, never past 90 days from login (KC-0272); revocable one by one; every state-changing POST checks Origin and a per-session
// CSRF token; "fresh" (passkey or link within 5 minutes) guards passkey changes and deletion.
import type { Database } from '../db/pool.ts';
import { ensTokens, hashToken, nytToken } from './token.ts';

export const SESSION_DAGE = 30;
/** KC-0272 (D6): however often it is used, a session ends this long after login (then the person logs in again). */
export const SESSION_MAKS_DAGE = 90;
const MAKS_MS = SESSION_MAKS_DAGE * 24 * 3_600_000;
export const FRISK_MS = 5 * 60_000;
const SESSION_MS = SESSION_DAGE * 24 * 3_600_000;
/** Sliding writes at most this often per session (each request would otherwise be a write). */
const GLID_MS = 60 * 60_000;

export type Metode = 'passkey' | 'link';

export type Session = {
  id: number;
  kontoId: number;
  csrf: string;
  metode: Metode;
  autentificeret: Date;
  udloeber: Date;
  /** True when this read moved the expiry (the router re-sets the cookie's Max-Age then). */
  forlaenget: boolean;
};

export type SessionVisning = { id: number; oprettet: Date; sidstSet: Date; enhed: string; metode: Metode };

type Raekke = { id: unknown; konto_id: unknown; csrf: string; metode: Metode; autentificeret: Date; udloeber: Date; sidst_set: Date; oprettet: Date };

const iso = (d: Date): string => d.toISOString();

export async function opretSession(db: Database, a: { kontoId: number; metode: Metode; enhed: string; nu: Date }): Promise<{ token: string; session: Session }> {
  const token = nytToken();
  const csrf = nytToken();
  const udloeber = new Date(a.nu.getTime() + SESSION_MS);
  const [r] = await db.query<{ id: unknown }>(
    `INSERT INTO session (hash, konto_id, oprettet, sidst_set, udloeber, autentificeret, metode, enhed, csrf)
     VALUES ($1, $2, $3, $3, $4, $3, $5, $6, $7) RETURNING id`,
    [hashToken(token), a.kontoId, iso(a.nu), iso(udloeber), a.metode, a.enhed.slice(0, 200), csrf],
  );
  return { token, session: { id: Number(r!.id), kontoId: a.kontoId, csrf, metode: a.metode, autentificeret: a.nu, udloeber, forlaenget: true } };
}

/** The live session for a cookie value, or null. Slides the expiry on use. */
export async function hentSession(db: Database, token: string, nu: Date): Promise<Session | null> {
  if (!token) return null;
  const [r] = await db.query<Raekke>(
    `SELECT s.id, s.konto_id, s.csrf, s.metode, s.autentificeret, s.udloeber, s.sidst_set, s.oprettet
       FROM session s JOIN konto k ON k.id = s.konto_id
      WHERE s.hash = $1 AND s.udloeber > $2 AND s.oprettet > $3 AND k.slettet_ved IS NULL`,
    [hashToken(token), iso(nu), iso(new Date(nu.getTime() - MAKS_MS))],
  );
  if (!r) return null;
  let udloeber = new Date(r.udloeber);
  let forlaenget = false;
  if (nu.getTime() - new Date(r.sidst_set).getTime() >= GLID_MS) {
    udloeber = new Date(Math.min(nu.getTime() + SESSION_MS, new Date(r.oprettet).getTime() + MAKS_MS));
    await db.query('UPDATE session SET sidst_set = $2, udloeber = $3 WHERE id = $1', [r.id, iso(nu), iso(udloeber)]);
    forlaenget = true;
  }
  return { id: Number(r.id), kontoId: Number(r.konto_id), csrf: r.csrf, metode: r.metode, autentificeret: new Date(r.autentificeret), udloeber, forlaenget };
}

export async function sessioner(db: Database, kontoId: number, nu: Date): Promise<SessionVisning[]> {
  const rk = await db.query<{ id: unknown; oprettet: Date; sidst_set: Date; enhed: string; metode: Metode }>(
    'SELECT id, oprettet, sidst_set, enhed, metode FROM session WHERE konto_id = $1 AND udloeber > $2 ORDER BY sidst_set DESC',
    [kontoId, iso(nu)],
  );
  return rk.map((r) => ({ id: Number(r.id), oprettet: new Date(r.oprettet), sidstSet: new Date(r.sidst_set), enhed: r.enhed, metode: r.metode }));
}

/** Ends one session of this account. False when it is not this account's (or does not exist). */
export async function tilbagekald(db: Database, kontoId: number, sessionId: number): Promise<boolean> {
  const r = await db.query('DELETE FROM session WHERE id = $1 AND konto_id = $2 RETURNING id', [sessionId, kontoId]);
  return r.length === 1;
}

/** Log out: ends the session behind this cookie value. */
export async function afslutSession(db: Database, token: string): Promise<void> {
  if (token) await db.query('DELETE FROM session WHERE hash = $1', [hashToken(token)]);
}

export function erFrisk(s: Pick<Session, 'autentificeret'>, nu: Date): boolean {
  return nu.getTime() - s.autentificeret.getTime() < FRISK_MS;
}

/** A state-changing request must come from our own pages: Origin equals the public origin exactly. */
export function tjekOrigin(origin: string | undefined, publicUrl: string): boolean {
  if (!origin) return false;
  try { return origin === new URL(publicUrl).origin; } catch { return false; }
}

/** "Chrome på Mac": enough to recognise a session on the account page, without storing the raw UA. */
export function enhedNavn(ua: string | undefined): string {
  if (!ua) return 'Ukendt enhed';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  if (!system || !browser) return 'Ukendt enhed';
  return `${browser} på ${system}`;
}

export function tjekCsrf(s: Pick<Session, 'csrf'>, givet: string | undefined): boolean {
  return typeof givet === 'string' && ensTokens(s.csrf, givet);
}
