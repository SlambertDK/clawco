// The order record and the withdrawal (KC-0209), the SQL half. An order row is written when the person presses
// the button on the statement page with both boxes ticked: it keeps the price shown, the terms version and the
// time of both consents, and later the Stripe subscription and the day the agreement began (the 14 days run from
// it). A withdrawal ("Fortryd aftale") is recorded once, and with a payment behind it creates a refund task for the
// owner: a row, never a refund made by code (AGENTS §9). No e-mail address and no free text is stored here, since
// the rows are kept after an account is deleted (konto/beholdt.ts).
import type { Database } from '../db/pool.ts';
import type { IntervalNavn } from './opsaet.ts';
import type { Valuta } from './valuta.ts';
import { fristSlut } from './forbrugerret.ts';

export type Bestilling = {
  id: number;
  kontoId: number;
  checkoutSession: string;
  plan: string;
  interval: IntervalNavn;
  prisOere: number;
  /** KC-0194: the currency of prisOere (the one the statement showed and Checkout charged). */
  valuta: Valuta;
  proeve: boolean;
  vilkaarVersion: string;
  vilkaarSamtykkeVed: Date;
  straksStartSamtykkeVed: Date;
  sprog: 'da' | 'en';
  oprettet: Date;
  stripeAbonnement: string | null;
  startet: Date | null;
  kvitteringSendt: Date | null;
  paamindetFor: Date | null;
};

type Raekke = {
  id: unknown; konto_id: unknown; checkout_session: string; plan: string; interval: IntervalNavn; pris_oere: number; valuta: string; proeve: boolean; vilkaar_version: string;
  vilkaar_samtykke_ved: Date | string; straks_start_samtykke_ved: Date | string; sprog: 'da' | 'en'; oprettet: Date | string;
  stripe_abonnement: string | null; startet: Date | string | null; kvittering_sendt: Date | string | null; paamindet_for: Date | string | null;
};
const KOLONNER = 'id, konto_id, checkout_session, plan, interval, pris_oere, valuta, proeve, vilkaar_version, vilkaar_samtykke_ved, straks_start_samtykke_ved, sprog, oprettet, stripe_abonnement, startet, kvittering_sendt, paamindet_for';

const d = (v: Date | string): Date => new Date(v);
const dn = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));
const somBestilling = (r: Raekke): Bestilling => ({
  id: Number(r.id), kontoId: Number(r.konto_id), checkoutSession: r.checkout_session, plan: r.plan, interval: r.interval, prisOere: Number(r.pris_oere), valuta: r.valuta === 'eur' ? 'eur' : 'dkk', proeve: r.proeve,
  vilkaarVersion: r.vilkaar_version, vilkaarSamtykkeVed: d(r.vilkaar_samtykke_ved), straksStartSamtykkeVed: d(r.straks_start_samtykke_ved), sprog: r.sprog, oprettet: d(r.oprettet),
  stripeAbonnement: r.stripe_abonnement, startet: dn(r.startet), kvitteringSendt: dn(r.kvittering_sendt), paamindetFor: dn(r.paamindet_for),
});

/** Records an order with both consents given now. The same Checkout Session is one order (a double click): the
 *  first consent time stands. Returns the order's id. */
export async function opretBestilling(
  db: Database,
  a: { kontoId: number; checkoutSession: string; plan: string; interval: IntervalNavn; prisOere: number; valuta: Valuta; proeve: boolean; vilkaarVersion: string; sprog: 'da' | 'en'; nu: Date },
): Promise<number> {
  const nu = a.nu.toISOString();
  await db.query(
    `INSERT INTO abonnement.bestilling (konto_id, checkout_session, plan, interval, pris_oere, valuta, proeve, vilkaar_version, vilkaar_samtykke_ved, straks_start_samtykke_ved, sprog, oprettet)
     VALUES ($1, $2, $3, $4, $5, $10, $6, $7, $8, $8, $9, $8) ON CONFLICT (checkout_session) DO NOTHING`,
    [a.kontoId, a.checkoutSession, a.plan, a.interval, a.prisOere, a.proeve, a.vilkaarVersion, nu, a.sprog, a.valuta],
  );
  const [r] = await db.query<{ id: unknown }>('SELECT id FROM abonnement.bestilling WHERE checkout_session = $1', [a.checkoutSession]);
  return Number(r!.id);
}

export async function hentBestilling(db: Database, id: number): Promise<Bestilling | null> {
  const [r] = await db.query<Raekke>(`SELECT ${KOLONNER} FROM abonnement.bestilling WHERE id = $1`, [id]);
  return r ? somBestilling(r) : null;
}

/** The account's orders Stripe has not yet been asked about (no subscription linked), newest first. */
export async function ubehandlede(db: Database, kontoId: number): Promise<Bestilling[]> {
  return (await db.query<Raekke>(`SELECT ${KOLONNER} FROM abonnement.bestilling WHERE konto_id = $1 AND stripe_abonnement IS NULL ORDER BY id DESC`, [kontoId])).map(somBestilling);
}

/** Stripe says the Checkout completed: the order now has its subscription and the day it began. */
export async function knytBestilling(db: Database, id: number, abonnement: string, startet: Date): Promise<void> {
  await db.query('UPDATE abonnement.bestilling SET stripe_abonnement = $2, startet = $3 WHERE id = $1 AND stripe_abonnement IS NULL', [id, abonnement, startet.toISOString()]);
}

/** The order the person may still withdraw from: the newest one that has begun, is not withdrawn and is inside the
 *  14 days. null when there is none. */
export async function senesteFortrydbare(db: Database, kontoId: number, nu: Date): Promise<Bestilling | null> {
  const rk = await db.query<Raekke>(
    `SELECT ${KOLONNER} FROM abonnement.bestilling b WHERE konto_id = $1 AND stripe_abonnement IS NOT NULL AND startet IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM abonnement.fortrydelse f WHERE f.bestilling_id = b.id) ORDER BY startet DESC, id DESC`,
    [kontoId],
  );
  for (const r of rk) {
    const b = somBestilling(r);
    if (b.startet && nu.getTime() < fristSlut(b.startet).getTime()) return b;
  }
  return null;
}

export type Fortrydelse = { bestillingId: number; kontoId: number; tidspunkt: Date; brugteDage: number; periodeDage: number; tilbageOere: number; opsagtVed: Date | null; kvitteringSendt: Date | null };
type FRaekke = { bestilling_id: unknown; konto_id: unknown; tidspunkt: Date | string; brugte_dage: number; periode_dage: number; tilbage_oere: number; opsagt_ved: Date | string | null; kvittering_sendt: Date | string | null };

export async function hentFortrydelse(db: Database, bestillingId: number): Promise<Fortrydelse | null> {
  const [r] = await db.query<FRaekke>('SELECT bestilling_id, konto_id, tidspunkt, brugte_dage, periode_dage, tilbage_oere, opsagt_ved, kvittering_sendt FROM abonnement.fortrydelse WHERE bestilling_id = $1', [bestillingId]);
  return r ? { bestillingId: Number(r.bestilling_id), kontoId: Number(r.konto_id), tidspunkt: d(r.tidspunkt), brugteDage: Number(r.brugte_dage), periodeDage: Number(r.periode_dage), tilbageOere: Number(r.tilbage_oere), opsagtVed: dn(r.opsagt_ved), kvitteringSendt: dn(r.kvittering_sendt) } : null;
}

/** The newest withdrawal of the account, if any (for "you have already withdrawn"). */
export async function senesteFortrydelse(db: Database, kontoId: number): Promise<Fortrydelse | null> {
  const [r] = await db.query<{ bestilling_id: unknown }>('SELECT bestilling_id FROM abonnement.fortrydelse WHERE konto_id = $1 ORDER BY tidspunkt DESC LIMIT 1', [kontoId]);
  return r ? hentFortrydelse(db, Number(r.bestilling_id)) : null;
}

/** Records the withdrawal request with its time, once per order, and (when something was paid) the owner's refund
 *  task, in one transaction. The second press finds the first: `ny` false and the first time stands. */
export async function registrerFortrydelse(
  db: Database,
  a: { bestillingId: number; kontoId: number; tidspunkt: Date; brugteDage: number; periodeDage: number; tilbageOere: number; forfald: Date; beloebOpgave: number; valuta: Valuta },
): Promise<{ ny: boolean; refusionId: number | null }> {
  return db.transaction(async (tx) => {
    const ny = await tx.query(
      `INSERT INTO abonnement.fortrydelse (bestilling_id, konto_id, tidspunkt, brugte_dage, periode_dage, tilbage_oere) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (bestilling_id) DO NOTHING RETURNING bestilling_id`,
      [a.bestillingId, a.kontoId, a.tidspunkt.toISOString(), a.brugteDage, a.periodeDage, a.tilbageOere],
    );
    if (ny.length === 0) return { ny: false, refusionId: null };
    if (a.beloebOpgave <= 0) return { ny: true, refusionId: null };
    const [o] = await tx.query<{ id: unknown }>(
      'INSERT INTO abonnement.refusion_opgave (bestilling_id, konto_id, beloeb_oere, valuta, oprettet, forfald) VALUES ($1, $2, $3, $6, $4, $5) RETURNING id',
      [a.bestillingId, a.kontoId, a.beloebOpgave, a.tidspunkt.toISOString(), a.forfald.toISOString(), a.valuta],
    );
    return { ny: true, refusionId: Number(o!.id) };
  });
}

export async function markerOpsagt(db: Database, bestillingId: number, nu: Date): Promise<void> {
  await db.query('UPDATE abonnement.fortrydelse SET opsagt_ved = $2 WHERE bestilling_id = $1 AND opsagt_ved IS NULL', [bestillingId, nu.toISOString()]);
}

/** Claims the withdrawal receipt: true for the one caller that may send it. */
export async function paataagFortrydKvittering(db: Database, bestillingId: number, nu: Date): Promise<boolean> {
  return (await db.query('UPDATE abonnement.fortrydelse SET kvittering_sendt = $2 WHERE bestilling_id = $1 AND kvittering_sendt IS NULL RETURNING bestilling_id', [bestillingId, nu.toISOString()])).length > 0;
}
export async function frigivFortrydKvittering(db: Database, bestillingId: number): Promise<void> {
  await db.query('UPDATE abonnement.fortrydelse SET kvittering_sendt = NULL WHERE bestilling_id = $1', [bestillingId]);
}

/** Claims the purchase receipt: true for the one caller that may send it (a second webhook finds it taken). */
export async function paataagKvittering(db: Database, id: number, nu: Date): Promise<boolean> {
  return (await db.query('UPDATE abonnement.bestilling SET kvittering_sendt = $2 WHERE id = $1 AND kvittering_sendt IS NULL RETURNING id', [id, nu.toISOString()])).length > 0;
}
export async function frigivKvittering(db: Database, id: number): Promise<void> {
  await db.query('UPDATE abonnement.bestilling SET kvittering_sendt = NULL WHERE id = $1', [id]);
}

/** Orders whose receipt has not been sent: a Checkout started in the last two days that may still complete, and any
 *  order that began but whose mail failed. The next webhook for the account tries them again. */
export async function udenKvittering(db: Database, kontoId: number, nu: Date): Promise<Bestilling[]> {
  return (await db.query<Raekke>(
    `SELECT ${KOLONNER} FROM abonnement.bestilling WHERE konto_id = $1 AND kvittering_sendt IS NULL
       AND (stripe_abonnement IS NOT NULL OR oprettet > $2) ORDER BY id`,
    [kontoId, new Date(nu.getTime() - 2 * 86_400_000).toISOString()],
  )).map(somBestilling);
}

/** The newest order that has begun (withdrawn or not, inside the period or not). */
export async function senesteStartede(db: Database, kontoId: number): Promise<Bestilling | null> {
  const [r] = await db.query<Raekke>(`SELECT ${KOLONNER} FROM abonnement.bestilling WHERE konto_id = $1 AND startet IS NOT NULL ORDER BY startet DESC, id DESC LIMIT 1`, [kontoId]);
  return r ? somBestilling(r) : null;
}

// --- The owner's refund tasks ------------------------------------------------------------------------
export type Refusion = { id: number; bestillingId: number; kontoId: number; beloebOere: number; valuta: Valuta; oprettet: Date; forfald: Date };

/** The open refund tasks, oldest first: what the owner works through in Stripe by hand. */
export async function aabneRefusioner(db: Database): Promise<Refusion[]> {
  const rk = await db.query<{ id: unknown; bestilling_id: unknown; konto_id: unknown; beloeb_oere: number; valuta: string; oprettet: Date | string; forfald: Date | string }>(
    "SELECT id, bestilling_id, konto_id, beloeb_oere, valuta, oprettet, forfald FROM abonnement.refusion_opgave WHERE status = 'aaben' ORDER BY forfald, id");
  return rk.map((r) => ({ id: Number(r.id), bestillingId: Number(r.bestilling_id), kontoId: Number(r.konto_id), beloebOere: Number(r.beloeb_oere), valuta: r.valuta === 'eur' ? 'eur' : 'dkk', oprettet: d(r.oprettet), forfald: d(r.forfald) }));
}

/** The owner has refunded it in Stripe: mark it done. false when it was not open. */
export async function markerRefusionUdfoert(db: Database, id: number, nu: Date): Promise<boolean> {
  return (await db.query("UPDATE abonnement.refusion_opgave SET status = 'udfoert', udfoert_ved = $2 WHERE id = $1 AND status = 'aaben' RETURNING id", [id, nu.toISOString()])).length > 0;
}

// --- Renewal reminders ----------------------------------------------------------------------------------
export async function markerPaamindet(db: Database, id: number, periodeSlut: Date): Promise<void> {
  await db.query('UPDATE abonnement.bestilling SET paamindet_for = $2 WHERE id = $1', [id, periodeSlut.toISOString()]);
}
