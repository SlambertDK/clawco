// KC-0191: the Checkout Session parameters are a pure function of account, plan, interval, country
// and language. The return type is the pinned SDK's SessionCreateParams, so a misspelt Stripe field
// fails the typecheck; the table below pins the values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggCheckout, type CheckoutInput, type Juridisk } from '../../src/abonnement/checkout.ts';
import { LANDE } from '../../src/abonnement/lande.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';

const priser = laesPriser();
const JURA: Juridisk = { vilkaarUrl: 'https://clawco.example/vilkaar', privatlivUrl: 'https://clawco.example/privatliv', fortrydelsesTekst: { da: 'Jeg giver afkald på fortrydelsesretten (udkast).', en: 'I waive the right of withdrawal (draft).' } };

function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    kontoId: 7, kunde: 'cus_1', plan: 'sky-solo', interval: 'maaned', land: 'DK', sprog: 'da',
    prisId: 'price_1', proeve: true, publicUrl: 'https://sky.example.test', juridisk: JURA, tilstand: 'test', ...over,
  };
}

test('every plan × interval × country × language gives a subscription session with a 14-day trial, no card, pause at trial end', () => {
  for (const plan of Object.keys(priser.planer)) {
    for (const interval of ['maaned', 'aar'] as const) {
      for (const land of ['DK', 'SE']) {
        for (const sprog of ['da', 'en'] as const) {
          const navn = `${plan}/${interval}/${land}/${sprog}`;
          const p = byggCheckout(input({ plan, interval, land, sprog, prisId: `price_${plan}_${interval}` }), priser);
          assert.equal(p.mode, 'subscription', navn);
          assert.equal(p.customer, 'cus_1', navn);
          assert.equal(p.client_reference_id, '7', navn);
          assert.deepEqual(p.line_items, [{ price: `price_${plan}_${interval}`, quantity: 1 }], navn);
          assert.equal(p.locale, sprog, navn);
          // KC-0194: kroner in Denmark, euro elsewhere, from the account's country.
          assert.equal(p.currency, land === 'DK' ? 'dkk' : 'eur', navn);
          assert.equal(p.payment_method_collection, 'if_required', navn);
          assert.equal(p.subscription_data?.trial_period_days, priser.proeve.dage, navn);
          assert.equal(priser.proeve.dage, 14);
          assert.deepEqual(p.subscription_data?.trial_settings, { end_behavior: { missing_payment_method: 'pause' } }, navn);
          const md = { clawco: 'ja', konto_id: '7', plan, interval, land };
          assert.deepEqual(p.metadata, md, navn);
          assert.deepEqual(p.subscription_data?.metadata, md, navn);
          assert.equal(p.consent_collection?.terms_of_service, 'required', navn);
          // KC-0194 (G6): moms.aktiv is false, so Stripe Tax is off and no tax field reaches Stripe.
          for (const felt of ['automatic_tax', 'billing_address_collection', 'customer_update', 'tax_id_collection']) assert.ok(!(felt in p), `${navn}: ${felt} while VAT is off`);
          assert.equal(p.success_url, 'https://sky.example.test/api/abonnement/tilbage?session={CHECKOUT_SESSION_ID}', navn);
          const cancel = new URL(p.cancel_url!);
          assert.equal(cancel.pathname, '/konto/abonnement', navn);
          assert.deepEqual(Object.fromEntries(cancel.searchParams), { plan, interval, land, afbrudt: '1' }, navn);
        }
      }
    }
  }
});

test('the terms text links Vilkår and Privatlivspolitik and carries the withdrawal-right wording, in the account language', () => {
  const da = byggCheckout(input(), priser).custom_text?.terms_of_service_acceptance;
  assert.ok(da && typeof da === 'object');
  assert.match(da.message, /\[Vilkår\]\(https:\/\/clawco\.example\/vilkaar\)/);
  assert.match(da.message, /\(https:\/\/clawco\.example\/privatliv\)/);
  assert.match(da.message, /fortrydelsesretten/);
  const en = byggCheckout(input({ sprog: 'en' }), priser).custom_text?.terms_of_service_acceptance;
  assert.ok(en && typeof en === 'object');
  assert.match(en.message, /\[Terms\]\(https:\/\/clawco\.example\/vilkaar\)/);
});

test('an account that has had a trial gets none: no trial days, no pause rule, card collected', () => {
  const p = byggCheckout(input({ proeve: false }), priser);
  assert.equal(p.subscription_data?.trial_period_days, undefined);
  assert.equal(p.subscription_data?.trial_settings, undefined);
  assert.equal(p.payment_method_collection, 'always');
  assert.deepEqual(p.subscription_data?.metadata, { clawco: 'ja', konto_id: '7', plan: 'sky-solo', interval: 'maaned', land: 'DK' });
});

test('KC-0194: a DKK customer never gets a EUR session and the reverse, over every country on the list', () => {
  for (const l of LANDE) {
    const p = byggCheckout(input({ land: l.kode }), priser);
    assert.equal(p.currency, l.kode === 'DK' ? 'dkk' : 'eur', l.kode);
  }
});

test('KC-0194: a missing billing country is refused before anything else (fail closed)', () => {
  for (const land of ['', ' ', undefined as unknown as string]) assert.throws(() => byggCheckout(input({ land }), priser), /land/, String(land));
});

test('KC-0194: with moms.aktiv true, Stripe Tax is on: automatic tax, a required billing address saved to the customer, tax ids for businesses', () => {
  const medMoms = { ...priser, moms: { ...priser.moms, aktiv: true } };
  for (const land of ['DK', 'DE']) {
    const p = byggCheckout(input({ land }), medMoms);
    assert.deepEqual(p.automatic_tax, { enabled: true }, land);
    assert.equal(p.billing_address_collection, 'required', land);
    assert.deepEqual(p.customer_update, { address: 'auto', name: 'auto' }, land);
    assert.deepEqual(p.tax_id_collection, { enabled: true }, land);
    assert.equal(p.currency, land === 'DK' ? 'dkk' : 'eur', land);
  }
});

test('an unknown plan, interval or country is refused, never defaulted', () => {
  assert.throws(() => byggCheckout(input({ plan: 'sky-guld' }), priser), /plan/);
  assert.throws(() => byggCheckout(input({ interval: 'uge' as never }), priser), /interval/);
  assert.throws(() => byggCheckout(input({ land: 'US' }), priser), /land/);
  assert.throws(() => byggCheckout(input({ land: 'dk' }), priser), /land/);
});

test('live mode refuses without terms URLs or the withdrawal wording (KC-0174); test mode marks the terms as drafts', () => {
  for (const mangler of ['vilkaarUrl', 'privatlivUrl', 'fortrydelsesTekst'] as const) {
    assert.throws(() => byggCheckout(input({ tilstand: 'live', juridisk: { ...JURA, [mangler]: null } }), priser), /KC-0174/);
  }
  assert.ok(byggCheckout(input({ tilstand: 'live' }), priser));
  const p = byggCheckout(input({ juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null } }), priser);
  const t = p.custom_text?.terms_of_service_acceptance;
  assert.ok(t && typeof t === 'object');
  assert.match(t.message, /udkast/);
  assert.equal(p.consent_collection?.terms_of_service, 'required');
});

test('the country list is EU/EEA only (D13), ISO codes with Danish names, Denmark first', () => {
  assert.equal(LANDE[0]?.kode, 'DK');
  assert.equal(LANDE.length, 30);
  for (const l of LANDE) assert.match(l.kode, /^[A-Z]{2}$/);
  assert.equal(new Set(LANDE.map((l) => l.kode)).size, LANDE.length);
});

test('KC-0198: retur "tilmelding" returns into the sign-up flow (success with the session id, cancel with the choice kept)', () => {
  const p = byggCheckout(input({ plan: 'sky-husstand', interval: 'aar', retur: 'tilmelding' }), priser);
  assert.equal(p.success_url, 'https://sky.example.test/tilmeld?session={CHECKOUT_SESSION_ID}');
  const cancel = new URL(p.cancel_url!);
  assert.equal(cancel.pathname, '/tilmeld');
  assert.deepEqual(Object.fromEntries(cancel.searchParams), { plan: 'sky-husstand', interval: 'aar', afbrudt: '1' });
  // Without retur (or with konto) nothing changes for the subscription page.
  assert.equal(byggCheckout(input({ retur: 'konto' }), priser).success_url, 'https://sky.example.test/api/abonnement/tilbage?session={CHECKOUT_SESSION_ID}');
});

test('KC-0209: the live-payment refusal lifts only because the withdrawal text now exists; without the terms and privacy URLs it still refuses', async () => {
  const { laesBetaling } = await import('../../src/abonnement/stripe-klient.ts');
  const fraConfig = laesBetaling({});
  assert.equal(fraConfig.juridisk.vilkaarUrl, null);
  assert.throws(() => byggCheckout(input({ tilstand: 'live', juridisk: fraConfig.juridisk }), priser), /live-betaling afvist/);
  const medUrl = laesBetaling({ SKY_VILKAAR_URL: 'https://clawco.example/vilkaar', SKY_PRIVATLIV_URL: 'https://clawco.example/privatliv' });
  const p = byggCheckout(input({ tilstand: 'live', juridisk: medUrl.juridisk }), priser);
  const besked = (p.custom_text?.terms_of_service_acceptance as { message?: string } | undefined)?.message ?? '';
  assert.match(besked, /Du har 14 dages fortrydelsesret/);
  assert.match(besked, /betaler for det leverede/);
  const en = byggCheckout(input({ tilstand: 'live', sprog: 'en', juridisk: medUrl.juridisk }), priser);
  assert.match((en.custom_text?.terms_of_service_acceptance as { message?: string } | undefined)?.message ?? '', /14-day right of withdrawal/);
  assert.throws(() => byggCheckout(input({ tilstand: 'live', juridisk: { ...medUrl.juridisk, fortrydelsesTekst: null } }), priser), /live-betaling afvist/);
});
