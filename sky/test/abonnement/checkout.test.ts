// KC-0191: the Checkout Session parameters are a pure function of account, plan, interval, country
// and language. The return type is the pinned SDK's SessionCreateParams, so a misspelt Stripe field
// fails the typecheck; the table below pins the values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggCheckout, type CheckoutInput, type Juridisk } from '../../src/abonnement/checkout.ts';
import { LANDE } from '../../src/abonnement/lande.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';

const priser = laesPriser();
const JURA: Juridisk = { vilkaarUrl: 'https://clawco.example/vilkaar', privatlivUrl: 'https://clawco.example/privatliv', fortrydelsesTekst: 'Jeg giver afkald på fortrydelsesretten (udkast).' };

function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    kontoId: 7, kunde: 'cus_1', plan: 'sky-solo', interval: 'maaned', land: 'DK', sprog: 'da', valuta: 'dkk', skat: null,
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
          assert.equal(p.currency, 'dkk', navn);
          assert.equal(p.payment_method_collection, 'if_required', navn);
          assert.equal(p.subscription_data?.trial_period_days, priser.proeve.dage, navn);
          assert.equal(priser.proeve.dage, 14);
          assert.deepEqual(p.subscription_data?.trial_settings, { end_behavior: { missing_payment_method: 'pause' } }, navn);
          const md = { clawco: 'ja', konto_id: '7', plan, interval, land };
          assert.deepEqual(p.metadata, md, navn);
          assert.deepEqual(p.subscription_data?.metadata, md, navn);
          assert.equal(p.consent_collection?.terms_of_service, 'required', navn);
          assert.ok(!('automatic_tax' in p), `${navn}: ingen moms før KC-0194`);
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
