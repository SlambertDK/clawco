// KC-0190: the real client is never called in tests (no key, no network). What is covered: it is a
// BetalingsKlient (type level), it decides its mode from the key, and the mapping to and from the
// SDK's types is right — DKK with EUR in currency_options, no tax behaviour, lookup-key transfer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import type { BetalingsKlient, NyPris } from '../../src/abonnement/stripe-klient.ts';
import { StripeBetalingsKlient, fraStripePris, fraStripeProdukt, kontoHuller, tilPrisParams, fraStripeAbonnement, fraStripeCheckout, fraStripePortalKonfiguration, verificerWebhook } from '../../src/abonnement/stripe-sdk.ts';

const nyPris: NyPris = {
  produkt: 'clawco-sky-solo', navn: 'Sky Solo pr. måned', lookupKey: 'clawco-sky-solo-maaned', dkk: 7900, eur: 1060,
  interval: 'month', metadata: { clawco: 'ja', clawco_plan: 'sky-solo', clawco_interval: 'maaned' }, transferLookupKey: true,
};

test('the SDK client is a BetalingsKlient and takes its mode from the key, without network', () => {
  const k: BetalingsKlient = new StripeBetalingsKlient('rk_test_abc123');
  assert.equal(k.tilstand, 'test');
  assert.equal(new StripeBetalingsKlient('rk_live_abc123').tilstand, 'live');
  assert.throws(() => new StripeBetalingsKlient('sk_live_abc123'), /begrænset/);
  assert.equal(new StripeBetalingsKlient('sk_test_abc123').tilstand, 'test');
});

test('a price becomes DKK with EUR in currency_options, recurring, lookup key with transfer, no tax behaviour', () => {
  const p: Stripe.PriceCreateParams = tilPrisParams(nyPris);
  assert.deepEqual(p, {
    product: 'clawco-sky-solo',
    nickname: 'Sky Solo pr. måned',
    currency: 'dkk',
    unit_amount: 7900,
    currency_options: { eur: { unit_amount: 1060 } },
    recurring: { interval: 'month' },
    lookup_key: 'clawco-sky-solo-maaned',
    transfer_lookup_key: true,
    metadata: { clawco: 'ja', clawco_plan: 'sky-solo', clawco_interval: 'maaned' },
  });
  assert.ok(!('tax_behavior' in p));
});

function pris(over: Record<string, unknown>): Stripe.Price {
  return {
    id: 'price_1', object: 'price', active: true, currency: 'dkk', unit_amount: 7900, lookup_key: 'clawco-sky-solo-maaned',
    product: 'clawco-sky-solo', recurring: { interval: 'month', interval_count: 1 }, metadata: { clawco: 'ja' },
    currency_options: { dkk: { unit_amount: 7900 }, eur: { unit_amount: 1060 } }, ...over,
  } as unknown as Stripe.Price;
}

test('a Stripe price maps back to the seam shape', () => {
  assert.deepEqual(fraStripePris(pris({})), { id: 'price_1', produkt: 'clawco-sky-solo', aktiv: true, lookupKey: 'clawco-sky-solo-maaned', dkk: 7900, eur: 1060, interval: 'month', metadata: { clawco: 'ja' } });
  assert.equal(fraStripePris(pris({ product: { id: 'clawco-x' } })).produkt, 'clawco-x');
  assert.equal(fraStripePris(pris({ currency_options: undefined })).eur, null);
});

test('a price that cannot be ours (other currency, other interval, no amount) never matches an expected price', () => {
  for (const over of [{ currency: 'eur' }, { unit_amount: null }, { recurring: { interval: 'week', interval_count: 1 } }, { recurring: { interval: 'month', interval_count: 3 } }, { recurring: null }]) {
    assert.equal(fraStripePris(pris(over)).dkk, -1, JSON.stringify(over));
  }
});

test('a Stripe product maps back to the seam shape', () => {
  const p = { id: 'clawco-sky-solo', object: 'product', name: 'Clawco Sky Solo', active: false, metadata: { clawco: 'ja' } } as unknown as Stripe.Product;
  assert.deepEqual(fraStripeProdukt(p), { id: 'clawco-sky-solo', navn: 'Clawco Sky Solo', aktiv: false, metadata: { clawco: 'ja' } });
});

test('unset account settings are named, set ones are not', () => {
  const konto = { business_profile: { name: 'Henrik Lambert', support_email: null, support_address: null, url: 'https://clawco.example' } } as unknown as Stripe.Account;
  assert.deepEqual(kontoHuller(konto), ['Support-e-mail', 'Supportadresse']);
  assert.deepEqual(kontoHuller({ business_profile: null } as unknown as Stripe.Account), ['Virksomhedsnavn', 'Support-e-mail', 'Supportadresse', 'Hjemmeside']);
});

// --- KC-0191/KC-0192: subscriptions, checkout sessions and signed webhooks -----------------------

const sek = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

function abonnement(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'trialing', created: sek('2026-10-31T10:00:00Z'),
    trial_start: sek('2026-10-31T10:00:00Z'), trial_end: sek('2026-11-14T10:00:00Z'), cancel_at_period_end: false, cancel_at: null,
    metadata: { clawco: 'ja', konto_id: '7', plan: 'sky-solo' }, latest_invoice: null,
    items: { object: 'list', data: [{ id: 'si_1', current_period_end: sek('2026-11-14T10:00:00Z'), price: { id: 'price_9', lookup_key: 'clawco-sky-solo-maaned' } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

test('a Stripe subscription becomes a snapshot: price and period from the first item (API endive), trial dates, metadata', () => {
  assert.deepEqual(fraStripeAbonnement(abonnement()), {
    id: 'sub_1', kunde: 'cus_1', status: 'trialing', prisId: 'price_9', lookupKey: 'clawco-sky-solo-maaned',
    oprettet: new Date('2026-10-31T10:00:00Z'), proeveStart: new Date('2026-10-31T10:00:00Z'), proeveSlut: new Date('2026-11-14T10:00:00Z'),
    periodeSlut: new Date('2026-11-14T10:00:00Z'), opsigVedPeriodeslut: false, opsigesVed: null, forfaldenSiden: null, prisPlan: null,
    metadata: { clawco: 'ja', konto_id: '7', plan: 'sky-solo' },
  });
});

test('KC-0193: the price\'s clawco_plan metadata rides along, so an archived price without a lookup key still names its plan', () => {
  const item = { id: 'si_1', current_period_end: sek('2026-11-14T10:00:00Z'), price: { id: 'price_gammel', lookup_key: null, metadata: { clawco: 'ja', clawco_plan: 'sky-solo' } } };
  const a = fraStripeAbonnement(abonnement({ items: { object: 'list', data: [item] } }));
  assert.equal(a.lookupKey, null);
  assert.equal(a.prisPlan, 'sky-solo');
});

test('a past_due subscription is overdue since its open latest invoice was finalized; a paid one is not', () => {
  const aaben = { object: 'invoice', status: 'open', status_transitions: { finalized_at: sek('2026-11-14T11:00:00Z') } };
  assert.deepEqual(fraStripeAbonnement(abonnement({ status: 'past_due', latest_invoice: aaben })).forfaldenSiden, new Date('2026-11-14T11:00:00Z'));
  assert.equal(fraStripeAbonnement(abonnement({ status: 'active', latest_invoice: { ...aaben, status: 'paid' } })).forfaldenSiden, null);
  assert.equal(fraStripeAbonnement(abonnement({ latest_invoice: 'in_1' })).forfaldenSiden, null);
  assert.equal(fraStripeAbonnement(abonnement({ customer: { id: 'cus_2' } })).kunde, 'cus_2');
});

test('a checkout session maps to id, url, status, customer, account (client_reference_id) and its subscription when expanded', () => {
  const s = { id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_1', status: 'complete', customer: 'cus_1', client_reference_id: '7', subscription: abonnement() } as unknown as Stripe.Checkout.Session;
  const c = fraStripeCheckout(s);
  assert.equal(c.id, 'cs_1');
  assert.equal(c.url, 'https://checkout.stripe.com/c/cs_1');
  assert.equal(c.status, 'complete');
  assert.equal(c.kunde, 'cus_1');
  assert.equal(c.kontoId, 7);
  assert.equal(c.abonnement?.id, 'sub_1');
  assert.equal(fraStripeCheckout({ ...s, client_reference_id: 'x7', subscription: 'sub_1' } as unknown as Stripe.Checkout.Session).kontoId, null);
  assert.equal(fraStripeCheckout({ ...s, subscription: 'sub_1' } as unknown as Stripe.Checkout.Session).abonnement, null);
});

test('verificerWebhook accepts a correctly signed body and names the customer; wrong secret, changed body and stale timestamp are refused', () => {
  const hemmelighed = 'whsec_testHEMMELIG123';
  const krop = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1' } } });
  const signatur = Stripe.webhooks.generateTestHeaderString({ payload: krop, secret: hemmelighed });
  assert.deepEqual(verificerWebhook(Buffer.from(krop), signatur, hemmelighed), { id: 'evt_1', type: 'customer.subscription.updated', kunde: 'cus_1' });
  assert.throws(() => verificerWebhook(Buffer.from(krop), signatur, 'whsec_andenHEMMELIG'));
  assert.throws(() => verificerWebhook(Buffer.from(krop.replace('cus_1', 'cus_2')), signatur, hemmelighed));
  const gammel = Stripe.webhooks.generateTestHeaderString({ payload: krop, secret: hemmelighed, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.throws(() => verificerWebhook(Buffer.from(krop), gammel, hemmelighed));
  const kunde = JSON.stringify({ id: 'evt_2', object: 'event', type: 'customer.deleted', data: { object: { id: 'cus_9', object: 'customer' } } });
  assert.equal(verificerWebhook(Buffer.from(kunde), Stripe.webhooks.generateTestHeaderString({ payload: kunde, secret: hemmelighed }), hemmelighed).kunde, 'cus_9');
});

test('KC-0206: an invoice becomes number, date, amount, currency, status and its own page, for Hent alt', async () => {
  const { fraStripeFaktura } = await import('../../src/abonnement/stripe-sdk.ts');
  const f = fraStripeFaktura({ id: 'in_1', number: 'ABC-0001', created: 1_793_000_000, total: 7900, currency: 'dkk', status: 'paid', hosted_invoice_url: 'https://invoice.stripe.com/i/x' } as Stripe.Invoice);
  assert.deepEqual(f, { id: 'in_1', nummer: 'ABC-0001', oprettet: new Date(1_793_000_000 * 1000), beloeb: 7900, valuta: 'dkk', status: 'paid', url: 'https://invoice.stripe.com/i/x' });
  const kladde = fraStripeFaktura({ id: 'in_2', number: null, created: 1, total: 0, currency: 'eur', status: 'draft', hosted_invoice_url: null } as Stripe.Invoice);
  assert.equal(kladde.nummer, null);
  assert.equal(kladde.url, null);
});

test('KC-0195: a Portal configuration maps to id, active and its metadata (the fingerprint the setup compares)', () => {
  const c = { id: 'bpc_1', object: 'billing_portal.configuration', active: false, metadata: { clawco: 'ja', clawco_konfig: 'abc' } } as unknown as Stripe.BillingPortal.Configuration;
  assert.deepEqual(fraStripePortalKonfiguration(c), { id: 'bpc_1', aktiv: false, metadata: { clawco: 'ja', clawco_konfig: 'abc' } });
  assert.deepEqual(fraStripePortalKonfiguration({ ...c, metadata: null } as unknown as Stripe.BillingPortal.Configuration).metadata, {});
});
