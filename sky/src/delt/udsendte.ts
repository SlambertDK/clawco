// One scheduled mail per account, kind and key (KC-0196; KC-0200's welcome mails reuse it). The sender claims the
// row before it sends and marks it sent after; a failed send gives the claim back, and a claim whose send never
// finished (a crash between claim and send) can be taken again after GENTAG_EFTER_MS. Nothing is ever removed
// here: a sent row stays sent. Rows hold no address and no content (migration 0013).

/** What this needs of db/pool.ts's Database (delt/ never imports another folder). */
type Database = { query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> };

export type MailNoegle = { kontoId: number; slags: string; noegle: string };

/** How long an unfinished claim blocks another sender (longer than any one send takes). */
export const GENTAG_EFTER_MS = 10 * 60_000;

/** True when this caller now owns the send: no row yet, or an old claim that never got sent. */
export async function paatagMail(db: Database, m: MailNoegle, nu: Date): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO udsendte_mails (konto_id, slags, noegle, paataget) VALUES ($1, $2, $3, $4)
     ON CONFLICT (konto_id, slags, noegle) DO UPDATE SET paataget = EXCLUDED.paataget
     WHERE udsendte_mails.sendt IS NULL AND udsendte_mails.paataget <= $5
     RETURNING konto_id`,
    [m.kontoId, m.slags, m.noegle, nu.toISOString(), new Date(nu.getTime() - GENTAG_EFTER_MS).toISOString()],
  );
  return r.length === 1;
}

export async function markerSendt(db: Database, m: MailNoegle, nu: Date): Promise<void> {
  await db.query('UPDATE udsendte_mails SET sendt = $4 WHERE konto_id = $1 AND slags = $2 AND noegle = $3 AND sendt IS NULL', [m.kontoId, m.slags, m.noegle, nu.toISOString()]);
}

/** The send failed: the next pass may claim it at once. */
export async function frigivMail(db: Database, m: MailNoegle): Promise<void> {
  await db.query("UPDATE udsendte_mails SET paataget = '-infinity' WHERE konto_id = $1 AND slags = $2 AND noegle = $3 AND sendt IS NULL", [m.kontoId, m.slags, m.noegle]);
}

export async function erSendt(db: Database, m: MailNoegle): Promise<boolean> {
  const [r] = await db.query<{ sendt: unknown }>('SELECT sendt FROM udsendte_mails WHERE konto_id = $1 AND slags = $2 AND noegle = $3', [m.kontoId, m.slags, m.noegle]);
  return r !== undefined && r.sendt !== null;
}
