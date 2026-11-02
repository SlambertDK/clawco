// Shared test setup for KC-0191/KC-0192: a migrated database with one account, the fake Stripe client
// holding the config's products and prices, the account's customer, and signed webhook events.
import Stripe from 'stripe';
import { nyDb, ur, type Ur } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { anvend, planlaeg, lookupKey } from '../../src/abonnement/opsaet.ts';
import { opsaetPortal, portalReturUrl } from '../../src/abonnement/portal.ts';
import { laesPriser, type Priser } from '../../src/abonnement/priser.ts';
import { sikrKunde } from '../../src/abonnement/kunde.ts';
import { byggCheckout } from '../../src/abonnement/checkout.ts';
import type { Database } from '../../src/db/pool.ts';

export const HEMMELIGHED = 'whsec_testSENTINEL0123456789';
export const EMAIL = 'kunde@example.test';
export const PUBLIC = 'https://sky.example.test';

export type Stativ = { db: Database; klient: FalskBetalingsKlient; priser: Priser; u: Ur; kontoId: number; kunde: string };

export async function stativ(): Promise<Stativ> {
  const db = await nyDb();
  const u = ur();
  const priser = laesPriser();
  const klient = new FalskBetalingsKlient('test');
  await anvend((await planlaeg(priser, klient)).skridt, klient);
  await opsaetPortal(priser, klient, portalReturUrl(PUBLIC));
  const { konto } = await findEllerOpretKonto(db, EMAIL, u.nu());
  const k = await sikrKunde(db, klient, { kontoId: konto.id, email: EMAIL, sprog: 'da', land: 'DK', nu: u.nu() });
  return { db, klient, priser, u, kontoId: konto.id, kunde: k.stripeKunde };
}

/** The person completes a trial Checkout on Stripe's page; returns the subscription id. */
export async function startProeve(s: Stativ, plan = 'sky-solo'): Promise<string> {
  const pris = await s.klient.prisForLookupKey(lookupKey(plan, 'maaned'));
  const params = byggCheckout({
    kontoId: s.kontoId, kunde: s.kunde, plan, interval: 'maaned', land: 'DK', sprog: 'da', valuta: 'dkk', skat: null, prisId: pris!.id, proeve: true,
    publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null }, tilstand: 'test',
  }, s.priser);
  const session = await s.klient.opretCheckout(params, `co-${Math.random()}`);
  s.klient.fuldfoerCheckout(session.id, s.u.nu());
  return (await s.klient.hentCheckout(session.id))!.abonnement!.id;
}

let n = 0;
/** A signed webhook body for `type` about `kunde` (the object is the customer for customer.*). */
export function haendelse(type: string, kunde: string, over: { id?: string; hemmelighed?: string } = {}): { raw: Uint8Array; signatur: string; id: string } {
  const id = over.id ?? `evt_test_${++n}`;
  const objekt = type.startsWith('customer.') && !type.startsWith('customer.subscription')
    ? { id: kunde, object: 'customer' }
    : { id: `obj_${n}`, object: type.split('.')[0] === 'invoice' ? 'invoice' : type.startsWith('checkout') ? 'checkout.session' : 'subscription', customer: kunde };
  const krop = JSON.stringify({ id, object: 'event', type, data: { object: objekt } });
  return { raw: Buffer.from(krop), signatur: Stripe.webhooks.generateTestHeaderString({ payload: krop, secret: over.hemmelighed ?? HEMMELIGHED }), id };
}

/** Captures console.log/error/warn while fn runs. */
export async function fangLog<T>(fn: () => Promise<T>): Promise<{ r: T; log: string }> {
  const linjer: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn };
  const fang = (...a: unknown[]) => { linjer.push(a.map(String).join(' ')); };
  console.log = fang; console.error = fang; console.warn = fang;
  try {
    const r = await fn();
    return { r, log: linjer.join('\n') };
  } finally {
    Object.assign(console, gemt);
  }
}
