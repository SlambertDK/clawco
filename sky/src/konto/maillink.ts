// Login by mail link (KC-0177): single use, 15 minutes, bound to the browser that asked (a cookie
// set at request time defeats login CSRF), consumed only by a POST (mail scanners that prefetch the
// GET do not burn it). The caller always gets the same neutral answer: no account enumeration.
// Fail closed: a code is stored only if the mail was accepted. Never log the link or the token.
// KC-0246: the same mail carries a short one-time code (4F7K-9Q2M) for a person who asks on one device and opens the mail on
// another: it is typed in the browser that asked, and does exactly what the link does — same binding, same single use (each
// spends the other), same 15 minutes, the same per-IP failure budget — plus at most five wrong tries per login, then the
// login is void. The code is derived from the link token, stored only as a salted hash, compared in constant time, never logged.
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import { findEllerOpretKonto, kontoForEmail, normaliserEmail } from './konto.ts';
import { emailNoegle, erSpaerret, fejlNoegle, ipNoegle, taelOp, FEJL_PR_IP, KODER_PR_EMAIL, KODER_PR_IP } from './graenser.ts';
import { createHash } from 'node:crypto';
import { ensTokens, hashToken, nytToken } from './token.ts';

export const LINK_MS = 15 * 60_000;
/** Wrong tries with a code before that login is void (the person asks for a new mail). */
export const MAKS_FORSOEG = 5;
/** 32 characters, a power of two (a byte maps without bias): digits and capitals without 0, 1, O and I. */
export const KODE_ALFABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The login code of a link token: 8 characters (40 bits), the same for the same token, so the page a link opens can show it. */
export function kodeFraToken(token: string): string {
  const b = createHash('sha256').update(`sky-login-kode-fra-token:${token}`).digest();
  let ud = '';
  for (let i = 0; i < 8; i++) ud += KODE_ALFABET[b[i]! & 31];
  return ud;
}

/** `4F7K9Q2M` → `4F7K-9Q2M`, the way the mail and the pages show it. */
export const grupperKode = (kode: string): string => `${kode.slice(0, 4)}-${kode.slice(4)}`;

/** What a person typed, tidied (case, spaces, hyphens and dashes); null unless it is exactly 8 characters of the alphabet. */
export function normaliserKode(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const k = v.toUpperCase().replace(/[\s\-\u2010-\u2015\u2212]/g, '');
  return k.length === 8 && [...k].every((c) => KODE_ALFABET.includes(c)) ? k : null;
}

/** The stored form of a code: salted with the login's own link hash, so no lookup table serves every login. */
const hashKode = (kode: string, raekkeHash: string): string => createHash('sha256').update(`sky-login-kode-hash:${raekkeHash}:${kode}`).digest('hex');

export type LinkDeps = { db: Database; post: Post; publicUrl: string };

/** Sends a login link when allowed. Always resolves the same way, whatever happened. */
export async function anmodLink(d: LinkDeps, a: { email: unknown; binding: string; ip: string; nu: Date }): Promise<void> {
  const email = normaliserEmail(a.email);
  if (!email || !a.binding) return;
  // Retention: a link row holds an email; once it is past use for a day it has no purpose left.
  await d.db.query('DELETE FROM loginkode WHERE udloeber < $1', [new Date(a.nu.getTime() - 24 * 3_600_000).toISOString()]);
  // Count the IP first: a sprayer at many emails is stopped even when each email is fresh.
  if (!(await taelOp(d.db, ipNoegle(a.ip), KODER_PR_IP, a.nu))) return;
  if (!(await taelOp(d.db, emailNoegle(email), KODER_PR_EMAIL, a.nu))) return;
  if ((await kontoForEmail(d.db, email))?.personale) return;

  const token = nytToken();
  const link = new URL('/log-ind/link', d.publicUrl);
  link.searchParams.set('t', token);
  try {
    await d.db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO loginkode (hash, email, binding, oprettet, udloeber, kode_hash) VALUES ($1, $2, $3, $4, $5, $6)',
        [hashToken(token), email, hashToken(a.binding), a.nu.toISOString(), new Date(a.nu.getTime() + LINK_MS).toISOString(), hashKode(kodeFraToken(token), hashToken(token))],
      );
      // Inside the transaction: if the provider refuses, the code row rolls back (never "sent" but stored).
      await d.post.send({ til: email, skabelon: 'maillink', data: { link: link.toString(), kode: grupperKode(kodeFraToken(token)), minutter: String(LINK_MS / 60_000) } });
    });
  } catch {
    // Deliberately without the error text: a provider error could echo the message, link included.
    console.error('sky konto: et login-link kunne ikke sendes (intet gemt)');
  }
}

/** True while the link is unused and unexpired. Reading never consumes (the GET page uses this). */
export async function findLink(db: Database, token: string, nu: Date): Promise<boolean> {
  if (!token) return false;
  const r = await db.query('SELECT 1 FROM loginkode WHERE hash = $1 AND brugt IS NULL AND udloeber > $2', [hashToken(token), nu.toISOString()]);
  return r.length === 1;
}

/** Consumes the link (POST only) and returns the account, created on first use. Null on any failure. */
export async function bekraeftLink(db: Database, a: { token: string; binding: string; ip: string; nu: Date }): Promise<{ kontoId: number; ny: boolean } | null> {
  if (await erSpaerret(db, fejlNoegle(a.ip), FEJL_PR_IP, a.nu)) return null;
  const ud = a.token && a.binding ? await db.transaction(async (tx) => {
    const [r] = await tx.query<{ email: string }>(
      `UPDATE loginkode SET brugt = $3 WHERE hash = $1 AND binding = $2 AND brugt IS NULL AND udloeber > $3 RETURNING email`,
      [hashToken(a.token), hashToken(a.binding), a.nu.toISOString()],
    );
    if (!r) return null;
    const { konto, ny } = await findEllerOpretKonto(tx, r.email, a.nu);
    if (konto.personale) return null;
    return { kontoId: konto.id, ny };
  }) : null;
  if (!ud) await taelOp(db, fejlNoegle(a.ip), FEJL_PR_IP, a.nu);
  return ud;
}

/** Where a link stands for the browser that opened it: dead (spent, expired, unknown), live in the browser that asked for it
 *  ('her'), or live but opened somewhere else ('anden-browser': the page shows the code to type in the first window).
 *  Reading never consumes anything. */
export async function linkTilstand(db: Database, token: string, binding: string, nu: Date): Promise<'doed' | 'her' | 'anden-browser'> {
  if (!token) return 'doed';
  const [r] = await db.query<{ binding: string }>('SELECT binding FROM loginkode WHERE hash = $1 AND brugt IS NULL AND udloeber > $2', [hashToken(token), nu.toISOString()]);
  if (!r) return 'doed';
  return binding && ensTokens(r.binding, hashToken(binding)) ? 'her' : 'anden-browser';
}

export type KodeSvar = { ok: true; kontoId: number; ny: boolean } | { ok: false; grund: 'forkert' | 'doed' | 'for-mange' };

/** Logs in with the typed code (POST only), in the browser that asked for the mail. Every try is first counted against the
 *  pending login(s) of this browser — atomically, so parallel guesses never get more than MAKS_FORSOEG — and only then compared
 *  (constant time). The right code spends its login (and so its link); the fifth wrong one spends the login without logging
 *  anyone in. A try from a browser with no pending login finds nothing to count against and only counts toward the IP budget the
 *  link shares (FEJL_PR_IP). */
export async function bekraeftKode(db: Database, a: { kode: unknown; binding: string; ip: string; nu: Date }): Promise<KodeSvar> {
  if (await erSpaerret(db, fejlNoegle(a.ip), FEJL_PR_IP, a.nu)) return { ok: false, grund: 'for-mange' };
  const kode = normaliserKode(a.kode);
  const nu = a.nu.toISOString();
  const ud: KodeSvar = a.binding ? await db.transaction(async (tx): Promise<KodeSvar> => {
    const rk = await tx.query<{ hash: string; kode_hash: string; email: string; forsoeg: number }>(
      `UPDATE loginkode SET forsoeg = forsoeg + 1
        WHERE binding = $1 AND kode_hash IS NOT NULL AND brugt IS NULL AND udloeber > $2 AND forsoeg < $3
        RETURNING hash, kode_hash, email, forsoeg`,
      [hashToken(a.binding), nu, MAKS_FORSOEG],
    );
    if (rk.length === 0) return { ok: false, grund: 'doed' };
    // Every pending row is compared, none skipped on a match: the time does not say which one (or whether one) was right.
    let traf: { hash: string; email: string } | null = null;
    for (const r of rk) {
      const lige = kode !== null && ensTokens(r.kode_hash, hashKode(kode, r.hash));
      if (lige && !traf) traf = r;
    }
    if (traf) {
      const [brugt] = await tx.query<{ email: string }>(
        'UPDATE loginkode SET brugt = $2 WHERE hash = $1 AND brugt IS NULL AND udloeber > $2 RETURNING email', [traf.hash, nu]);
      if (brugt) {
        const { konto, ny } = await findEllerOpretKonto(tx, brugt.email, a.nu);
        if (!konto.personale) return { ok: true, kontoId: konto.id, ny };
      }
      return { ok: false, grund: 'doed' };
    }
    // Wrong: a login that has now used its last try is spent, link and code together.
    const brugte = rk.filter((r) => Number(r.forsoeg) >= MAKS_FORSOEG).map((r) => r.hash);
    if (brugte.length) await tx.query('UPDATE loginkode SET brugt = $2 WHERE hash = ANY($1::text[]) AND brugt IS NULL', [brugte, nu]);
    return { ok: false, grund: brugte.length === rk.length ? 'doed' : 'forkert' };
  }) : { ok: false, grund: 'doed' };
  if (!ud.ok) await taelOp(db, fejlNoegle(a.ip), FEJL_PR_IP, a.nu);
  return ud;
}
