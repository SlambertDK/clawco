// The grace stages' mails (KC-0196): which stage an account is in is frist.ts (pure, from forfaldenSiden and the
// clock); this sends the owner the mail that stage owes and remembers it in udsendte_mails, so one stage of one
// failed payment gives one mail however often it runs (a scheduler tick, a restart, a webhook heard twice). It runs
// after every handled webhook for the account (ruter.ts: the day-0 mail goes out within the webhook's round trip)
// and on a clock in server.ts (day 7 needs no event). Only the account that holds the entitlement — the owner, who
// pays — is written to; a member has no entitlement row. Nothing here changes the entitlement, stops or deletes
// anything: it reads the row and sends a mail.
import type { Database } from '../db/pool.ts';
import { erSendt, frigivMail, markerSendt, paatagMail, type MailNoegle } from '../delt/udsendte.ts';
import { beregnFrist } from './frist.ts';
import { dato } from './forbrugerret.ts';
import { produktNavn, sendMail, type KoebDeps } from './kvittering.ts';
import { skjulNoegler } from './stripe-klient.ts';
import { hentRettigheder } from './synk.ts';

export type FristDeps = Pick<KoebDeps, 'db' | 'priser' | 'post' | 'publicUrl' | 'nu' | 'kontakt'>;
export type FristUdfald = 'sendt' | 'intet' | 'fejl';

/** Where the card is fixed (the Portal button) or a plan chosen: the subscription page. */
export const abonnementLink = (d: Pick<KoebDeps, 'publicUrl'>): string => new URL('/konto/abonnement', d.publicUrl).href;

/** Stripe-sourced accounts in a state that can owe a grace mail, not deleted. */
export async function kontiIFrist(db: Database): Promise<number[]> {
  const r = await db.query<{ konto_id: unknown }>(
    "SELECT r.konto_id FROM abonnement.rettigheder r JOIN konto k ON k.id = r.konto_id WHERE r.kilde = 'stripe' AND r.status IN ('forfalden', 'pause') AND k.slettet_ved IS NULL ORDER BY r.konto_id",
  );
  return r.map((x) => Number(x.konto_id));
}

/** Sends the mail the account's stage owes, once. 'fejl' = the provider refused it; the next pass tries again. */
export async function fristForKonto(d: FristDeps, kontoId: number): Promise<FristUdfald> {
  const nu = d.nu();
  const r = await hentRettigheder(d.db, kontoId, d.priser, nu);
  const f = beregnFrist(r, d.priser, nu);
  if (!f.mail || !f.episode || !f.siden) return 'intet';
  const m: MailNoegle = { kontoId, slags: f.mail, noegle: f.episode };
  if (await erSendt(d.db, m)) return 'intet';
  const k = await d.kontakt(kontoId);
  if (!k) return 'intet'; // no address left (a deleted account): nothing is claimed, nothing is lost
  if (!(await paatagMail(d.db, m, nu))) return 'intet';
  const fra = dato(new Date(f.siden), k.sprog);
  const data: Record<string, string> = f.mail === 'proeve-slut'
    ? { dato: fra, link: abonnementLink(d) }
    : { produkt: produktNavn(d, r.plan), dato: fra, link: abonnementLink(d) };
  if (!(await sendMail(d, { til: k.email, skabelon: f.mail, sprog: k.sprog, data }, kontoId))) {
    await frigivMail(d.db, m);
    return 'fejl';
  }
  await markerSendt(d.db, m, nu);
  console.log(`sky abonnement: ${f.mail}-mail sendt til konto ${kontoId} (trin ${f.trin})`);
  return 'sendt';
}

/** One pass over every account that may owe a mail. One account's failure never stops the others. */
export async function fristGennemloeb(d: FristDeps): Promise<{ sendt: number; fejl: number }> {
  let sendt = 0;
  let fejl = 0;
  for (const id of await kontiIFrist(d.db)) {
    try {
      const u = await fristForKonto(d, id);
      if (u === 'sendt') sendt++;
      if (u === 'fejl') fejl++;
    } catch (err) {
      fejl++;
      console.error(`sky abonnement: frist for konto ${id} fejlede (prøves igen ved næste gennemløb): ${skjulNoegler((err as Error).message)}`);
    }
  }
  return { sendt, fejl };
}

/** A pass now, then every `interval` ms; passes never overlap. */
export function fristLoekke(d: FristDeps, o: { interval: number }): { stop(): void; gennemloeb(): Promise<void> } {
  let igang: Promise<void> | null = null;
  const koer = async (): Promise<void> => {
    try {
      const u = await fristGennemloeb(d);
      if (u.sendt || u.fejl) console.log(`sky abonnement: frist-gennemløb: ${u.sendt} mails sendt, ${u.fejl} fejl`);
    } catch (err) {
      console.error(`sky abonnement: frist-gennemløbet fejlede: ${skjulNoegler((err as Error).message)}`);
    }
  };
  const gennemloeb = (): Promise<void> => {
    igang ??= koer().finally(() => { igang = null; });
    return igang;
  };
  void gennemloeb();
  const t = setInterval(() => { void gennemloeb(); }, o.interval);
  t.unref();
  return { stop: () => { clearInterval(t); }, gennemloeb };
}
