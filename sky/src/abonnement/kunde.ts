// One Stripe customer per Clawco account (KC-0191), made on the first Checkout with metadata.konto_id
// and the account language; never card data, never a Stripe object body in our tables or logs.
// Also the billing side of "delete my account": konto emits konto.slettet, we cancel the account's
// live subscriptions (Stripe keeps its records; nothing is deleted by billing).
import type { Database } from '../db/pool.ts';
import type { Haendelser } from '../delt/haendelser.ts';
import type { BetalingsKlient, CheckoutSession } from './stripe-klient.ts';
import { skjulNoegler } from './stripe-klient.ts';

export type KundeRaekke = { kontoId: number; stripeKunde: string; land: string; proeveBrugt: boolean; aabenCheckout: string | null };

type Raekke = { konto_id: unknown; stripe_kunde: string; land: string; proeve_brugt: boolean; aaben_checkout: string | null };
const somKunde = (r: Raekke): KundeRaekke => ({ kontoId: Number(r.konto_id), stripeKunde: r.stripe_kunde, land: r.land, proeveBrugt: r.proeve_brugt, aabenCheckout: r.aaben_checkout });

export async function hentKundeRaekke(db: Database, kontoId: number): Promise<KundeRaekke | null> {
  const [r] = await db.query<Raekke>('SELECT konto_id, stripe_kunde, land, proeve_brugt, aaben_checkout FROM abonnement.kunde WHERE konto_id = $1', [kontoId]);
  return r ? somKunde(r) : null;
}

/** The Checkout Session `id` when it is this account's — by our customer row and by the session's own reference —
 *  else null. A session id from a URL is never trusted on its own (the way back from Stripe, KC-0191, and
 *  sign-up's return, KC-0198). Stripe errors are thrown to the caller. */
export async function kontoensCheckout(db: Database, klient: BetalingsKlient, kontoId: number, id: string): Promise<CheckoutSession | null> {
  const kunde = await hentKundeRaekke(db, kontoId);
  if (!kunde) return null;
  const s = await klient.hentCheckout(id);
  return s && s.kunde === kunde.stripeKunde && s.kontoId === kontoId ? s : null;
}

/** Our own record of which account a Stripe customer belongs to (we made the customer). */
export async function kontoForStripeKunde(db: Database, stripeKunde: string): Promise<number | null> {
  const [r] = await db.query<{ konto_id: unknown }>('SELECT konto_id FROM abonnement.kunde WHERE stripe_kunde = $1', [stripeKunde]);
  return r ? Number(r.konto_id) : null;
}

/** The account's customer, created in Stripe now if there is none; `land` is the person's latest choice. */
export async function sikrKunde(
  db: Database,
  klient: BetalingsKlient,
  a: { kontoId: number; email: string; sprog: 'da' | 'en'; land: string; nu: Date },
): Promise<KundeRaekke> {
  const fandtes = await hentKundeRaekke(db, a.kontoId);
  if (fandtes) {
    if (fandtes.land !== a.land) await db.query('UPDATE abonnement.kunde SET land = $2 WHERE konto_id = $1', [a.kontoId, a.land]);
    return { ...fandtes, land: a.land };
  }
  // Stripe replays the same customer for this key within 24 hours (double click, two tabs).
  const { id } = await klient.opretKunde({ kontoId: a.kontoId, email: a.email, sprog: a.sprog }, `clawco-kunde-${a.kontoId}`);
  await db.query(
    'INSERT INTO abonnement.kunde (konto_id, stripe_kunde, land, oprettet) VALUES ($1, $2, $3, $4) ON CONFLICT (konto_id) DO NOTHING',
    [a.kontoId, id, a.land, a.nu.toISOString()],
  );
  const k = await hentKundeRaekke(db, a.kontoId);
  if (!k) throw new Error('kunden forsvandt under oprettelse');
  return k;
}

export async function saetAabenCheckout(db: Database, kontoId: number, sessionId: string): Promise<void> {
  await db.query('UPDATE abonnement.kunde SET aaben_checkout = $2 WHERE konto_id = $1', [kontoId, sessionId]);
}

export async function markerProeveBrugt(db: Database, kontoId: number): Promise<void> {
  await db.query('UPDATE abonnement.kunde SET proeve_brugt = true WHERE konto_id = $1 AND NOT proeve_brugt', [kontoId]);
}

const LEVENDE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']);

/** When an account is deleted, its live subscriptions are cancelled now, so nothing is charged again.
 *  Stripe's webhook then turns the entitlement into "opsagt". Returns the unsubscribe function. */
export function opsigVedSletning(h: Haendelser, d: { db: Database; klient: BetalingsKlient | null }): () => void {
  return h.lyt('konto.slettet', async ({ kontoId }) => {
    const k = await hentKundeRaekke(d.db, kontoId);
    if (!k) return;
    if (!d.klient) throw new Error(`konto ${kontoId} har en Stripe-kunde, men betaling er ikke sat op: abonnementet er ikke opsagt`);
    for (const a of await d.klient.listAbonnementer(k.stripeKunde)) {
      if (!LEVENDE.has(a.status)) continue;
      try {
        await d.klient.opsigAbonnement(a.id);
        console.log(`sky abonnement: konto ${kontoId} slettet, abonnement ${a.id} opsagt`);
      } catch (err) {
        console.error(`sky abonnement: konto ${kontoId} slettet, men abonnement ${a.id} kunne ikke opsiges: ${skjulNoegler((err as Error).message)}`);
      }
    }
  });
}
