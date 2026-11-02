// Login by mail link (KC-0177): single use, 15 minutes, bound to the browser that asked (a cookie
// set at request time defeats login CSRF), consumed only by a POST (mail scanners that prefetch the
// GET do not burn it). The caller always gets the same neutral answer: no account enumeration.
// Fail closed: a code is stored only if the mail was accepted. Never log the link or the token.
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import { findEllerOpretKonto, kontoForEmail, normaliserEmail } from './konto.ts';
import { emailNoegle, erSpaerret, fejlNoegle, ipNoegle, taelOp, FEJL_PR_IP, KODER_PR_EMAIL, KODER_PR_IP } from './graenser.ts';
import { hashToken, nytToken } from './token.ts';

export const LINK_MS = 15 * 60_000;

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
        'INSERT INTO loginkode (hash, email, binding, oprettet, udloeber) VALUES ($1, $2, $3, $4, $5)',
        [hashToken(token), email, hashToken(a.binding), a.nu.toISOString(), new Date(a.nu.getTime() + LINK_MS).toISOString()],
      );
      // Inside the transaction: if the provider refuses, the code row rolls back (never "sent" but stored).
      await d.post.send({ til: email, skabelon: 'maillink', data: { link: link.toString(), minutter: String(LINK_MS / 60_000) } });
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
