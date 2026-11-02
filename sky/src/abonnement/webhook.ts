// POST /api/abonnement/webhook (KC-0192). The signature is checked against the raw bytes before
// anything is parsed; no secret → 503, never 200 (AGENTS §0 r7). The event id is inserted first,
// in the same transaction as the work, so a duplicate is a no-op and a crash retries cleanly. The
// event only says which customer changed: synkKunde re-reads Stripe (one API call per event,
// acceptable at this scale), so order never matters. Logs carry type, event id, account id and
// statuses only — never the body, an email or a secret.
import type { Database } from '../db/pool.ts';
import type { Priser } from './priser.ts';
import type { BetalingsKlient, StripeHaendelse } from './stripe-klient.ts';
import { skjulNoegler } from './stripe-klient.ts';
import { verificerWebhook } from './stripe-sdk.ts';
import { kontoForStripeKunde } from './kunde.ts';
import { synkKunde } from './synk.ts';

export const HAANDTEREDE_HAENDELSER: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.deleted',
]);

export type WebhookDeps = {
  db: Database;
  klient: BetalingsKlient | null;
  priser: Priser;
  /** SKY_STRIPE_WEBHOOK_SECRET; null when unset. */
  hemmelighed: string | null;
  nu: () => Date;
  /** Refused signatures since start (the only trace a bad request leaves). */
  taeller: { afvist: number };
  verificer?: (raw: Uint8Array, signatur: string, hemmelighed: string) => StripeHaendelse;
  /** KC-0209: runs after an event was handled and committed, for the account it touched (the purchase receipt). A failure
   *  is logged and never fails the webhook: the entitlement is already written. */
  efter?: (kontoId: number) => Promise<void>;
};

export type WebhookSvar = { status: 200 | 400 | 500 | 503; svar: string };

const kort = (id: string): string => (id.length > 14 ? `${id.slice(0, 14)}…` : id);

/** Our table says which account owns the customer; Stripe's metadata.konto_id must agree unless the
 *  customer is deleted (a deleted customer has no metadata left). */
async function kontoFor(tx: Database, klient: BetalingsKlient, stripeKunde: string): Promise<number | null> {
  const vores = await kontoForStripeKunde(tx, stripeKunde);
  if (vores === null) return null;
  const k = await klient.hentKunde(stripeKunde);
  if (!k) return null;
  if (!k.slettet && k.kontoId !== vores) return null;
  return vores;
}

export async function modtagWebhook(d: WebhookDeps, raw: Uint8Array, signatur: string | undefined): Promise<WebhookSvar> {
  if (!d.hemmelighed || !d.klient) {
    console.error('sky abonnement: webhook afvist med 503: betaling er ikke sat op (SKY_STRIPE_WEBHOOK_SECRET eller SKY_STRIPE_SECRET_KEY mangler)');
    return { status: 503, svar: 'ikke sat op' };
  }
  let h: StripeHaendelse;
  try {
    if (!signatur) throw new Error('ingen signatur');
    h = (d.verificer ?? verificerWebhook)(raw, signatur, d.hemmelighed);
  } catch {
    d.taeller.afvist++;
    console.error(`sky abonnement: webhook med ugyldig signatur afvist (${d.taeller.afvist} siden start)`);
    return { status: 400, svar: 'ugyldig signatur' };
  }
  if (!HAANDTEREDE_HAENDELSER.has(h.type)) return { status: 200, svar: 'ignoreret' };
  if (!h.kunde) {
    console.error(`sky abonnement: ${h.type} ${kort(h.id)} uden kunde, ignoreret`);
    return { status: 200, svar: 'ingen kunde' };
  }
  const klient = d.klient;
  const stripeKunde = h.kunde;
  const nu = d.nu();
  const berort: { kontoId: number | null } = { kontoId: null };
  let svar: WebhookSvar;
  try {
    svar = await d.db.transaction(async (tx): Promise<WebhookSvar> => {
      const ny = await tx.query('INSERT INTO abonnement.stripe_haendelser (id, type, modtaget) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id', [h.id, h.type, nu.toISOString()]);
      if (ny.length === 0) return { status: 200, svar: 'dublet' };
      const kontoId = await kontoFor(tx, klient, stripeKunde);
      if (kontoId === null) {
        // 200 so Stripe does not retry forever; the shared account also holds ShelfAtlas' customers.
        console.error(`sky abonnement: ${h.type} ${kort(h.id)} for ukendt kunde ${kort(stripeKunde)}, ignoreret`);
        return { status: 200, svar: 'ukendt kunde' };
      }
      const r = await synkKunde(tx, klient, d.priser, { stripeKunde, kontoId, grund: h.type, haendelseId: h.id, nu });
      berort.kontoId = kontoId;
      console.log(`sky abonnement: ${h.type} ${kort(h.id)} → konto ${kontoId}: ${r.aendret ? `${r.fra?.status ?? 'ingen'}/${r.fra?.plan ?? 'ingen'} → ${r.til.status}/${r.til.plan}` : 'uændret'}`);
      return { status: 200, svar: r.aendret ? 'opdateret' : 'uændret' };
    });
  } catch (err) {
    console.error(`sky abonnement: ${h.type} ${kort(h.id)} fejlede, intet gemt (Stripe prøver igen): ${skjulNoegler((err as Error).message)}`);
    return { status: 500, svar: 'fejl' };
  }
  if (berort.kontoId !== null && d.efter) {
    try { await d.efter(berort.kontoId); } catch (err) {
      console.error(`sky abonnement: efterbehandling af ${h.type} ${kort(h.id)} for konto ${berort.kontoId} fejlede: ${skjulNoegler((err as Error).message)}`);
    }
  }
  return svar;
}
