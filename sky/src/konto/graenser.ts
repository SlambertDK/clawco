// Rate limits for login (KC-0177), kept in Postgres so they hold across restarts and processes.
// Fixed windows: one counter row per key and window. The limits and the window live here only.
import { createHash } from 'node:crypto';
import type { Database } from '../db/pool.ts';

/** Length of one counting window. */
export const VINDUE_MS = 15 * 60_000;
/** Login links one email address can be sent per window at the request of one IP address (KC-0272: per requester,
 *  so one address cannot lock a person out of their own login). */
export const KODER_PR_EMAIL = 5;
/** Login links one email address can be sent per window by all requesters together (no mail-bombing one inbox). */
export const KODER_PR_EMAIL_I_ALT = 20;
/** Login links one IP address can ask for per window (any emails). */
export const KODER_PR_IP = 20;
/** Failed confirmations (bad link, bad passkey answer) one IP address may make per window. */
export const FEJL_PR_IP = 10;

const noegle = (art: string, v: string): string => createHash('sha256').update(`${art}:${v}`).digest('hex');
export const emailNoegle = (email: string): string => noegle('email', email);
export const emailIpNoegle = (email: string, ip: string): string => noegle('email-ip', `${email}\n${ip}`);
export const ipNoegle = (ip: string): string => noegle('ip', ip);
export const fejlNoegle = (ip: string): string => noegle('fejl', ip);

function vindue(nu: Date): string {
  return new Date(Math.floor(nu.getTime() / VINDUE_MS) * VINDUE_MS).toISOString();
}

/** Counts one attempt for `n`. True while the count is within `graense` for the current window. */
export async function taelOp(db: Database, n: string, graense: number, nu: Date): Promise<boolean> {
  // Old windows are worthless; clear them as we go (the table stays small).
  await db.query('DELETE FROM graense WHERE vindue < $1', [new Date(nu.getTime() - 24 * 3_600_000).toISOString()]);
  const [r] = await db.query<{ antal: number }>(
    `INSERT INTO graense (noegle, vindue, antal) VALUES ($1, $2, 1)
     ON CONFLICT (noegle, vindue) DO UPDATE SET antal = graense.antal + 1 RETURNING antal`,
    [n, vindue(nu)],
  );
  return (r?.antal ?? Infinity) <= graense;
}

/** True when `n` has already reached `graense` in the current window. Does not count. */
export async function erSpaerret(db: Database, n: string, graense: number, nu: Date): Promise<boolean> {
  const [r] = await db.query<{ antal: number }>('SELECT antal FROM graense WHERE noegle = $1 AND vindue = $2', [n, vindue(nu)]);
  return (r?.antal ?? 0) >= graense;
}
