// KC-0190: test vs live is decided by the key prefix alone, only restricted keys are accepted (the
// Stripe account is Henrik's personal one, shared with ShelfAtlas), and no key value ever reaches
// an error message. The fake client behaves like Stripe where the setup depends on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilstandFraNoegle, skjulNoegler, NOEGLE_NAVN, WEBHOOK_NOEGLE_NAVN, laesBetaling } from '../../src/abonnement/stripe-klient.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';

const SENTINEL_TEST = 'rk_test_SENTINELhemmelig0123456789';
const SENTINEL_LIVE = 'rk_live_SENTINELhemmelig0123456789';

function afviserUdenVaerdi(noegle: string | undefined, moenster: RegExp): void {
  assert.throws(() => tilstandFraNoegle(noegle), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, moenster);
    assert.ok(err.message.includes(NOEGLE_NAVN), `fejlen nævner ikke ${NOEGLE_NAVN}`);
    if (noegle && noegle.trim().length > 3) assert.ok(!err.message.includes(noegle.trim()), 'fejlen viser nøglen');
    assert.ok(!err.message.includes('SENTINEL'), 'fejlen viser en del af nøglen');
    return true;
  });
}

test('billing config (KC-0191/KC-0192): all optional, validated when set, errors name the key and never the value', () => {
  assert.deepEqual(laesBetaling({}), { noegle: null, webhookHemmelighed: null, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null } });
  const c = laesBetaling({ SKY_STRIPE_SECRET_KEY: SENTINEL_TEST, SKY_STRIPE_WEBHOOK_SECRET: 'whsec_SENTINEL123', SKY_VILKAAR_URL: 'https://clawco.example/vilkaar', SKY_PRIVATLIV_URL: 'https://clawco.example/privatliv' });
  assert.equal(c.noegle, SENTINEL_TEST);
  assert.equal(c.webhookHemmelighed, 'whsec_SENTINEL123');
  assert.deepEqual(c.juridisk, { vilkaarUrl: 'https://clawco.example/vilkaar', privatlivUrl: 'https://clawco.example/privatliv', fortrydelsesTekst: null });
  for (const [env, navn] of [
    [{ SKY_STRIPE_SECRET_KEY: 'sk_live_SENTINELhemmelig' }, NOEGLE_NAVN],
    [{ SKY_STRIPE_WEBHOOK_SECRET: 'SENTINELhemmelig' }, WEBHOOK_NOEGLE_NAVN],
    [{ SKY_VILKAAR_URL: 'http://clawco.example/SENTINEL' }, 'SKY_VILKAAR_URL'],
    [{ SKY_PRIVATLIV_URL: 'ikke en url SENTINEL' }, 'SKY_PRIVATLIV_URL'],
  ] as const) {
    assert.throws(() => laesBetaling(env), (err: unknown) => err instanceof Error && err.message.includes(navn) && !err.message.includes('SENTINEL'), navn);
  }
  assert.equal(WEBHOOK_NOEGLE_NAVN, 'SKY_STRIPE_WEBHOOK_SECRET');
});

test('the key is named SKY_STRIPE_SECRET_KEY (sky convention, settable by saet-hemmelighed.sh)', () => {
  assert.equal(NOEGLE_NAVN, 'SKY_STRIPE_SECRET_KEY');
});

test('a restricted test key means test mode, a restricted live key means live mode', () => {
  assert.equal(tilstandFraNoegle(SENTINEL_TEST), 'test');
  assert.equal(tilstandFraNoegle(SENTINEL_LIVE), 'live');
});

test('test mode may use a standard secret key (sk_test_); a live secret key (sk_live_) is refused: live needs rk_live_', () => {
  assert.equal(tilstandFraNoegle('sk_test_SENTINELhemmelig0123456789'), 'test');
  afviserUdenVaerdi('sk_live_SENTINELhemmelig0123456789', /begrænset/);
});

test('a missing, blank or malformed key is refused and names the key, never its value', () => {
  afviserUdenVaerdi(undefined, /mangler/);
  afviserUdenVaerdi('   ', /mangler/);
  afviserUdenVaerdi('pk_test_SENTINELhemmelig0123456789', /ugyldig/);
  afviserUdenVaerdi('SENTINELhemmelig', /ugyldig/);
  afviserUdenVaerdi(` ${SENTINEL_TEST}`, /mellemrum/);
  afviserUdenVaerdi('rk_test_SENTINEL-hemmelig', /ugyldig/);
});

test('skjulNoegler masks any Stripe key in free text', () => {
  const t = skjulNoegler(`Invalid API Key provided: ${SENTINEL_TEST} and sk_live_abcDEF123 and whsec_abc123`);
  assert.ok(!t.includes('SENTINEL'));
  assert.ok(!t.includes('abcDEF123'));
  assert.ok(!t.includes('whsec_abc123'));
  assert.match(t, /Invalid API Key provided/);
});

test('the fake records every write with its idempotency key and counts writes only', async () => {
  const k = new FalskBetalingsKlient('test');
  await k.listProdukter();
  assert.equal(k.skrivninger, 0);
  await k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'idem-1');
  assert.equal(k.skrivninger, 1);
  assert.deepEqual(k.kald.map((c) => [c.metode, c.idempotensNoegle]), [['opretProdukt', 'idem-1']]);
  assert.deepEqual((await k.listProdukter()).map((p) => p.id), ['clawco-x']);
});

test('the fake only lists products marked metadata.clawco (the account is shared with ShelfAtlas)', async () => {
  const k = new FalskBetalingsKlient('test', { produkter: [{ id: 'prod_shelf', navn: 'ShelfAtlas', aktiv: true, metadata: {} }] });
  assert.deepEqual(await k.listProdukter(), []);
});

test('the fake enforces unique lookup keys like Stripe, and transferLookupKey moves one', async () => {
  const k = new FalskBetalingsKlient('test');
  await k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'p');
  const pris = { produkt: 'clawco-x', navn: 'X', lookupKey: 'clawco-x-maaned', dkk: 100, eur: 10, interval: 'month' as const, metadata: { clawco: 'ja' }, transferLookupKey: false };
  const a = await k.opretPris(pris, 'a');
  await assert.rejects(k.opretPris({ ...pris, dkk: 200 }, 'b'), /lookup_key/);
  const c = await k.opretPris({ ...pris, dkk: 200, transferLookupKey: true }, 'c');
  const aktive = await k.listPriser('clawco-x');
  assert.equal(aktive.find((p) => p.id === a.id)?.lookupKey, null);
  assert.equal(aktive.find((p) => p.id === c.id)?.lookupKey, 'clawco-x-maaned');
  await k.arkiverPris(a.id);
  assert.deepEqual((await k.listPriser('clawco-x')).map((p) => [p.id, p.aktiv]), [[a.id, false], [c.id, true]], 'arkiverede priser listes også, som i Stripe uden active-filter');
});

test('the fake replays an idempotency key like Stripe: same request → same object, other request → error', async () => {
  const k = new FalskBetalingsKlient('test');
  const a = await k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'samme');
  const b = await k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'samme');
  assert.deepEqual(a, b);
  await assert.rejects(k.opretProdukt({ id: 'clawco-y', navn: 'Y', metadata: { clawco: 'ja' } }, 'samme'), /idempotens/);
});

test('the fake can be told to fail the next call of a method', async () => {
  const k = new FalskBetalingsKlient('test');
  k.fejlNaeste('opretProdukt', 'netværksfejl');
  await assert.rejects(k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'p'), /netværksfejl/);
  await k.opretProdukt({ id: 'clawco-x', navn: 'X', metadata: { clawco: 'ja' } }, 'p');
  assert.equal((await k.listProdukter()).length, 1);
});

// --- KC-0191/KC-0192: customers, Checkout and subscriptions in the fake ---------------------------

const NU = new Date('2026-10-31T10:00:00.000Z');

async function medPris(): Promise<{ k: FalskBetalingsKlient; prisId: string }> {
  const k = new FalskBetalingsKlient('test');
  await k.opretProdukt({ id: 'clawco-sky-solo', navn: 'Clawco Sky Solo', metadata: { clawco: 'ja' } }, 'p');
  const p = await k.opretPris({ produkt: 'clawco-sky-solo', navn: 'Sky Solo pr. måned', lookupKey: 'clawco-sky-solo-maaned', dkk: 7900, eur: 1060, interval: 'month', metadata: { clawco: 'ja' }, transferLookupKey: false }, 'pr');
  return { k, prisId: p.id };
}

function proeveParams(kunde: string, prisId: string) {
  return {
    mode: 'subscription' as const, customer: kunde, client_reference_id: '7',
    line_items: [{ price: prisId, quantity: 1 }],
    payment_method_collection: 'if_required' as const,
    subscription_data: { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } }, metadata: { clawco: 'ja', konto_id: '7', plan: 'sky-solo' } },
    success_url: 'https://sky.example.test/api/abonnement/tilbage?session={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://sky.example.test/konto/abonnement',
  };
}

test('the fake finds a price by lookup key and keeps one customer per idempotency key with the account in metadata', async () => {
  const { k, prisId } = await medPris();
  assert.equal((await k.prisForLookupKey('clawco-sky-solo-maaned'))?.id, prisId);
  assert.equal(await k.prisForLookupKey('clawco-ukendt-maaned'), null);
  const a = await k.opretKunde({ kontoId: 7, email: 'a@example.test', sprog: 'da' }, 'kunde-7');
  const b = await k.opretKunde({ kontoId: 7, email: 'a@example.test', sprog: 'da' }, 'kunde-7');
  assert.equal(a.id, b.id);
  assert.deepEqual(await k.hentKunde(a.id), { id: a.id, slettet: false, kontoId: 7 });
  assert.equal(await k.hentKunde('cus_ukendt'), null);
});

test('the fake Checkout: one session per idempotency key; completing a trial session gives a trialing subscription 14 days out', async () => {
  const { k, prisId } = await medPris();
  const kunde = await k.opretKunde({ kontoId: 7, email: 'a@example.test', sprog: 'da' }, 'kunde-7');
  const s1 = await k.opretCheckout(proeveParams(kunde.id, prisId), 'co-1');
  const s2 = await k.opretCheckout(proeveParams(kunde.id, prisId), 'co-1');
  assert.equal(s1.id, s2.id);
  assert.equal(s1.status, 'open');
  assert.ok(s1.url);
  const tilbage = k.fuldfoerCheckout(s1.id, NU);
  assert.equal(tilbage, `https://sky.example.test/api/abonnement/tilbage?session=${s1.id}`);
  const [ab] = await k.listAbonnementer(kunde.id);
  assert.equal(ab?.status, 'trialing');
  assert.deepEqual(ab?.proeveSlut, new Date('2026-11-14T10:00:00.000Z'));
  assert.equal(ab?.lookupKey, 'clawco-sky-solo-maaned');
  assert.deepEqual(ab?.metadata, { clawco: 'ja', konto_id: '7', plan: 'sky-solo' });
  const efter = await k.hentCheckout(s1.id);
  assert.equal(efter?.status, 'complete');
  assert.equal(efter?.kontoId, 7);
  assert.equal(efter?.abonnement?.id, ab?.id);
});

test('the fake refuses what Stripe refuses: unknown price or customer, completing an expired session, expiring a completed one', async () => {
  const { k, prisId } = await medPris();
  const kunde = await k.opretKunde({ kontoId: 7, email: 'a@example.test', sprog: 'da' }, 'kunde-7');
  await assert.rejects(k.opretCheckout(proeveParams(kunde.id, 'price_ukendt'), 'x'), /pris/);
  await assert.rejects(k.opretCheckout(proeveParams('cus_ukendt', prisId), 'y'), /kunde/);
  const s = await k.opretCheckout(proeveParams(kunde.id, prisId), 'a');
  await k.udloebCheckout(s.id);
  assert.throws(() => k.fuldfoerCheckout(s.id, NU), /udløbet|expired/);
  const t = await k.opretCheckout(proeveParams(kunde.id, prisId), 'b');
  k.fuldfoerCheckout(t.id, NU);
  await assert.rejects(k.udloebCheckout(t.id), /complete|gennemført/);
});

test('the fake cancels a subscription, deletes a customer (its subscriptions cancel) and opens a Portal', async () => {
  const { k, prisId } = await medPris();
  const kunde = await k.opretKunde({ kontoId: 7, email: 'a@example.test', sprog: 'da' }, 'kunde-7');
  k.fuldfoerCheckout((await k.opretCheckout(proeveParams(kunde.id, prisId), 'a')).id, NU);
  const [ab] = await k.listAbonnementer(kunde.id);
  await k.opsigAbonnement(ab!.id);
  assert.equal((await k.listAbonnementer(kunde.id))[0]?.status, 'canceled');
  assert.match((await k.opretPortal(kunde.id, 'https://sky.example.test/konto')).url, /^https:\/\//);
  k.sletKunde(kunde.id);
  assert.deepEqual(await k.hentKunde(kunde.id), { id: kunde.id, slettet: true, kontoId: null });
});
