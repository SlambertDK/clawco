// Re-read and upsert (KC-0192). A webhook only names the customer; this reads every subscription the
// customer has in Stripe now, computes the entitlement and writes it with an outbox row when it
// changed. Because the input is Stripe's current state, the order and number of events never matter
// (invariant 2). Invariant 1: for Stripe-sourced accounts this is the only writer of
// abonnement.rettigheder (the webhook calls it); saetGave is the admin path for gifts (KC-0203).
// E10's fleet reads hentRettigheder and polls abonnement.rettigheds_haendelser; billing never calls it.
import type { Database } from '../db/pool.ts';
import type { Priser } from './priser.ts';
import type { BetalingsKlient } from './stripe-klient.ts';
import { beregnRettigheder, erSkrivebeskyttet, INGEN, vaelgAbonnement, type Rettighed, type RettighedsStatus } from './rettigheder.ts';
import { markerProeveBrugt } from './kunde.ts';

type Raekke = {
  kilde: Rettighed['kilde']; plan: string; status: RettighedsStatus; medlemmer_max: number;
  proeve_slutter: Date | string | null; periode_slutter: Date | string | null; opsiges: Date | string | null; forfalden_siden: Date | string | null;
  skrivebeskyttet: boolean; stripe_abonnement: string | null;
};

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

async function laesRaekke(db: Database, kontoId: number): Promise<Rettighed | null> {
  const [r] = await db.query<Raekke>(
    'SELECT kilde, plan, status, medlemmer_max, proeve_slutter, periode_slutter, opsiges, forfalden_siden, skrivebeskyttet, stripe_abonnement FROM abonnement.rettigheder WHERE konto_id = $1',
    [kontoId],
  );
  if (!r) return null;
  return {
    kilde: r.kilde, plan: r.plan, status: r.status, medlemmerMax: Number(r.medlemmer_max),
    proeveSlutter: iso(r.proeve_slutter), periodeSlutter: iso(r.periode_slutter), opsiges: iso(r.opsiges), forfaldenSiden: iso(r.forfalden_siden),
    skrivebeskyttet: r.skrivebeskyttet, abonnement: r.stripe_abonnement,
  };
}

/** What the account may use now (INGEN without a row). The time-based read-only rule is applied at
 *  read time too, so an overdue account turns read-only without waiting for another event. */
export async function hentRettigheder(db: Database, kontoId: number, priser: Priser, nu: Date): Promise<Rettighed> {
  const r = await laesRaekke(db, kontoId);
  if (!r) return { ...INGEN };
  return { ...r, skrivebeskyttet: erSkrivebeskyttet(r, priser, nu) };
}

const ens = (a: Rettighed, b: Rettighed): boolean => JSON.stringify(a) === JSON.stringify(b);

async function skriv(db: Database, kontoId: number, fra: Rettighed | null, til: Rettighed, grund: string, haendelseId: string | null, nu: Date): Promise<void> {
  // The WHERE keeps a gift out of reach of a Stripe write even if a caller got it wrong.
  await db.query(
    `INSERT INTO abonnement.rettigheder (konto_id, kilde, plan, status, medlemmer_max, proeve_slutter, periode_slutter, opsiges, forfalden_siden, skrivebeskyttet, stripe_abonnement, opdateret)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (konto_id) DO UPDATE SET kilde = EXCLUDED.kilde, plan = EXCLUDED.plan, status = EXCLUDED.status, medlemmer_max = EXCLUDED.medlemmer_max,
       proeve_slutter = EXCLUDED.proeve_slutter, periode_slutter = EXCLUDED.periode_slutter, opsiges = EXCLUDED.opsiges, forfalden_siden = EXCLUDED.forfalden_siden,
       skrivebeskyttet = EXCLUDED.skrivebeskyttet, stripe_abonnement = EXCLUDED.stripe_abonnement, opdateret = EXCLUDED.opdateret
     WHERE abonnement.rettigheder.kilde = 'stripe' OR EXCLUDED.kilde = 'gave'`,
    [kontoId, til.kilde, til.plan, til.status, til.medlemmerMax, til.proeveSlutter, til.periodeSlutter, til.opsiges, til.forfaldenSiden, til.skrivebeskyttet, til.abonnement, nu.toISOString()],
  );
  await db.query(
    'INSERT INTO abonnement.rettigheds_haendelser (konto_id, fra, til, grund, haendelse_id, tidspunkt) VALUES ($1, $2, $3, $4, $5, $6)',
    [kontoId, fra === null ? null : JSON.stringify(fra), JSON.stringify(til), grund, haendelseId, nu.toISOString()],
  );
}

/** Accounts that may have a Clawco now (KC-0182): a trial or an active plan (a gift is active), and not
 *  deleted. The fleet's reconciler orders a tenant for each one without (server.ts hands this over). */
export async function kontiMedAdgang(db: Database): Promise<number[]> {
  const r = await db.query<{ konto_id: unknown }>(
    "SELECT r.konto_id FROM abonnement.rettigheder r JOIN konto k ON k.id = r.konto_id WHERE r.status IN ('proeve', 'aktiv') AND k.slettet_ved IS NULL ORDER BY r.konto_id",
  );
  return r.map((x) => Number(x.konto_id));
}

/** Reads the customer's subscriptions from Stripe and upserts the account's entitlement. Run it inside
 *  the webhook's transaction: a throw rolls back the event id too, so Stripe's retry starts clean. */
export async function synkKunde(
  tx: Database,
  klient: BetalingsKlient,
  priser: Priser,
  a: { stripeKunde: string; kontoId: number; grund: string; haendelseId: string | null; nu: Date },
): Promise<{ fra: Rettighed | null; til: Rettighed; aendret: boolean }> {
  const alle = await klient.listAbonnementer(a.stripeKunde);
  if (alle.some((s) => s.proeveStart !== null)) await markerProeveBrugt(tx, a.kontoId);
  const fra = await laesRaekke(tx, a.kontoId);
  const { rettighed: til, advarsel } = beregnRettigheder({ snapshot: vaelgAbonnement(alle), forrige: fra }, priser, a.nu);
  if (advarsel) console.error(`sky abonnement: ADVARSEL konto ${a.kontoId}: ${advarsel}`);
  if (ens(fra ?? INGEN, til)) return { fra, til, aendret: false };
  await skriv(tx, a.kontoId, fra, til, a.grund, a.haendelseId, a.nu);
  return { fra, til, aendret: true };
}

/** A gift (private beta, KC-0203): set by an admin script or the beta's invitation redemption only; webhooks never
 *  change it. `slutter` is the end date a beta gift carries (it is information for the person and the beta-end
 *  notice; nothing cuts a gift off by itself). */
export async function saetGave(db: Database, kontoId: number, plan: string, priser: Priser, nu: Date, slutter: Date | null = null): Promise<void> {
  const p = priser.planer[plan];
  if (!p || !Object.hasOwn(priser.planer, plan)) throw new Error(`ukendt plan: ${plan}`);
  await db.transaction(async (tx) => {
    const fra = await laesRaekke(tx, kontoId);
    await skriv(tx, kontoId, fra, { ...INGEN, kilde: 'gave', plan, status: 'aktiv', medlemmerMax: p.medlemmer, periodeSlutter: slutter ? slutter.toISOString() : null }, 'gave', null, nu);
  });
}

/** KC-0203's beta-end notice: moves a gift's end date to `til` when that is later than what it has now (no end date
 *  counts as earlier). Never shortens, never touches a Stripe entitlement. True when it changed. */
export async function forlaengGave(db: Database, kontoId: number, til: Date, nu: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const fra = await laesRaekke(tx, kontoId);
    if (!fra || fra.kilde !== 'gave') return false;
    if (fra.periodeSlutter !== null && new Date(fra.periodeSlutter).getTime() >= til.getTime()) return false;
    await skriv(tx, kontoId, fra, { ...fra, periodeSlutter: til.toISOString() }, 'gave-forlaenget', null, nu);
    return true;
  });
}
