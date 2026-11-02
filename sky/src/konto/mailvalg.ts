// "No thanks" to the tips mail (KC-0200). Tips are on until the person turns them off, on the account's mail page or
// through the one-click link in the tips mail itself (RFC 8058). The link's token is 32 random bytes, stored as SHA-256
// only (migration 0016), and does one thing: turn tips off for its own account. Service mails (welcome, trial ending,
// billing) never read this. The welcome job reads the choice at send time, so a "no" counts from the next tick.
import type { Database } from '../db/pool.ts';
import { hashToken, nytToken } from './token.ts';

export type MailSprog = 'da' | 'en';

export async function vilHaveTips(db: Database, kontoId: number): Promise<boolean> {
  const [r] = await db.query<{ tips: boolean }>('SELECT tips FROM mailvalg WHERE konto_id = $1', [kontoId]);
  return r ? r.tips : true;
}

export async function saetTips(db: Database, kontoId: number, tips: boolean, nu: Date): Promise<void> {
  await db.query(
    `INSERT INTO mailvalg (konto_id, tips, opdateret) VALUES ($1, $2, $3)
     ON CONFLICT (konto_id) DO UPDATE SET tips = EXCLUDED.tips, opdateret = EXCLUDED.opdateret`,
    [kontoId, tips, nu.toISOString()],
  );
}

/** A fresh unsubscribe link for this account (the previous one stops working). Leaves the choice itself as it is. */
export async function nytAfmeldLink(db: Database, a: { kontoId: number; publicUrl: string; sprog: MailSprog; nu: Date }): Promise<string> {
  const token = nytToken();
  await db.query(
    `INSERT INTO mailvalg (konto_id, tips, afmeld_hash, opdateret) VALUES ($1, true, $2, $3)
     ON CONFLICT (konto_id) DO UPDATE SET afmeld_hash = EXCLUDED.afmeld_hash, opdateret = EXCLUDED.opdateret`,
    [a.kontoId, hashToken(token), a.nu.toISOString()],
  );
  const u = new URL('/post/afmeld', a.publicUrl);
  u.searchParams.set('t', token);
  u.searchParams.set('sprog', a.sprog);
  return u.href;
}

/** True when the token belongs to an account (tips are then off); false for an unknown or replaced token. */
export async function afmeldMedToken(db: Database, token: string, nu: Date): Promise<boolean> {
  if (!token) return false;
  const r = await db.query('UPDATE mailvalg SET tips = false, opdateret = $2 WHERE afmeld_hash = $1 RETURNING konto_id', [hashToken(token), nu.toISOString()]);
  return r.length === 1;
}

/** Whether the token belongs to an account, without changing anything (the page a GET shows). */
export async function gyldigtAfmeldToken(db: Database, token: string): Promise<boolean> {
  if (!token) return false;
  return (await db.query('SELECT 1 FROM mailvalg WHERE afmeld_hash = $1', [hashToken(token)])).length === 1;
}
