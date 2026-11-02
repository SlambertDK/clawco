// KC-0209: the flows behind the buttons, with the fake Stripe, the fake mail and a real (PGlite) database:
// the receipt after a purchase, "Opsig" (at period end), "Fortryd aftale" (cancel at once, receipt, refund TASK) and
// the renewal reminder. Money is never moved by code: the only Stripe writes are cancellations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, EMAIL, PUBLIC, type Stativ } from './stativ.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { byggCheckout } from '../../src/abonnement/checkout.ts';
import { lookupKey } from '../../src/abonnement/opsaet.ts';
import { opretBestilling, hentBestilling, aabneRefusioner, hentFortrydelse } from '../../src/abonnement/bestilling.ts';
import { efterKoeb, type KoebDeps } from '../../src/abonnement/kvittering.ts';
import { opsig } from '../../src/abonnement/opsig.ts';
import { fortryd, fortrydOversigt } from '../../src/abonnement/fortryd.ts';
import { sendPaamindelser } from '../../src/abonnement/paamindelse.ts';
import { synkKunde } from '../../src/abonnement/synk.ts';
import type { IntervalNavn } from '../../src/abonnement/opsaet.ts';

const DAG = 86_400_000;
const SAELGER = 'Sælger Eksempel (personligt drevet), Eksempelvej 1, 1000 By, Danmark.';

function deps(s: Stativ, post: FalskPost = falskPost(), over: Omit<Partial<KoebDeps>, 'post'> = {}): KoebDeps & { post: FalskPost } {
  return {
    db: s.db, klient: s.klient, priser: s.priser, post, publicUrl: PUBLIC, nu: s.u.nu,
    saelger: () => SAELGER,
    vilkaar: { version: '0.1-udkast', url: (sprog) => `https://clawco.example.test${sprog === 'en' ? '/en' : ''}/vilkaar` },
    kontakt: async () => ({ email: EMAIL, sprog: 'da' }),
    ...over,
  };
}

/** The person ticks both boxes, pays on Stripe's page: an order and a completed Checkout. Returns the order id and subscription. */
async function koeb(s: Stativ, o: { plan?: string; interval?: IntervalNavn; proeve?: boolean } = {}): Promise<{ bestilling: number; abonnement: string; session: string }> {
  const plan = o.plan ?? 'sky-solo';
  const interval = o.interval ?? 'maaned';
  const proeve = o.proeve ?? false;
  const pris = await s.klient.prisForLookupKey(lookupKey(plan, interval));
  const params = byggCheckout({
    kontoId: s.kontoId, kunde: s.kunde, plan, interval, land: 'DK', sprog: 'da', valuta: 'dkk', skat: null, prisId: pris!.id, proeve,
    publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null }, tilstand: 'test',
  }, s.priser);
  const session = await s.klient.opretCheckout(params, `co-${Math.random()}`);
  const b = await opretBestilling(s.db, { kontoId: s.kontoId, checkoutSession: session.id, plan, interval, prisOere: pris!.dkk, proeve, vilkaarVersion: '0.1-udkast', sprog: 'da', nu: s.u.nu() });
  s.klient.fuldfoerCheckout(session.id, s.u.nu());
  return { bestilling: b, abonnement: (await s.klient.hentCheckout(session.id))!.abonnement!.id, session: session.id };
}
const mailTil = (p: FalskPost, skabelon: string) => p.udbakke.filter((m) => m.skabelon === skabelon);
const stripeSkriv = (s: Stativ) => s.klient.kald.filter((k) => k.metode === 'opsigAbonnement' || k.metode === 'opsigVedPeriodeslut').map((k) => k.metode);

// --- The receipt ---------------------------------------------------------------------------------
test('after a purchase the order is tied to its subscription and one receipt is sent: seller, product, price, how to cancel and withdraw, the terms version', async () => {
  const s = await stativ();
  const d = deps(s);
  const k = await koeb(s);
  await efterKoeb(d, s.kontoId);
  const b = await hentBestilling(s.db, k.bestilling);
  assert.equal(b?.stripeAbonnement, k.abonnement);
  assert.equal(b?.startet?.toISOString(), s.u.nu().toISOString(), 'the 14 days run from the day Stripe made the subscription');
  const [m] = mailTil(d.post, 'kvittering');
  assert.equal(mailTil(d.post, 'kvittering').length, 1);
  assert.equal(m?.til, EMAIL);
  assert.equal(m?.data['saelger'], SAELGER, 'the seller is what the seam read, not a literal');
  assert.equal(m?.data['produkt'], 'Sky Solo');
  assert.equal(m?.data['pris'], '79 kr. om måneden. Det er hele prisen: der kommer ingen moms oveni.');
  assert.match(m!.data['betaling']!, /^79 kr\. betalt\. Næste betaling: /);
  assert.equal(m?.data['vilkaarversion'], '0.1-udkast');
  assert.equal(m?.data['vilkaarlink'], 'https://clawco.example.test/vilkaar');
  assert.equal(m?.data['link'], `${PUBLIC}/konto`);
  assert.match(m!.data['fortrydfrist']!, /november 2026/);
  await efterKoeb(d, s.kontoId);
  assert.equal(mailTil(d.post, 'kvittering').length, 1, 'a second event sends no second receipt');
});

test('the receipt of a trial says nothing was charged, and when the trial ends', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s, { proeve: true });
  await efterKoeb(d, s.kontoId);
  const [m] = mailTil(d.post, 'kvittering');
  assert.match(m!.data['betaling']!, /Din gratis prøve varer til .*2026\. Der er ikke trukket noget/);
});

test('the receipt follows the language the person chose', async () => {
  const s = await stativ();
  const d = deps(s, falskPost(), { kontakt: async () => ({ email: EMAIL, sprog: 'en' }) });
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  const [m] = mailTil(d.post, 'kvittering');
  assert.equal(m?.sprog, 'en');
  assert.equal(m?.data['pris'], 'DKK 79 per month. This is the whole price: no VAT is added on top.');
  assert.equal(m?.data['vilkaarlink'], 'https://clawco.example.test/en/vilkaar');
});

test('a Checkout that never completed gets no receipt and no subscription link; a failed mail is tried again by the next event', async () => {
  const s = await stativ();
  const post = falskPost();
  const d = deps(s, post);
  const pris = await s.klient.prisForLookupKey(lookupKey('sky-solo', 'maaned'));
  const params = byggCheckout({ kontoId: s.kontoId, kunde: s.kunde, plan: 'sky-solo', interval: 'maaned', land: 'DK', sprog: 'da', valuta: 'dkk', skat: null, prisId: pris!.id, proeve: false, publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null }, tilstand: 'test' }, s.priser);
  const aaben = await s.klient.opretCheckout(params, 'co-aaben');
  const ikkeFaerdig = await opretBestilling(s.db, { kontoId: s.kontoId, checkoutSession: aaben.id, plan: 'sky-solo', interval: 'maaned', prisOere: 7900, proeve: false, vilkaarVersion: '0.1-udkast', sprog: 'da', nu: s.u.nu() });
  await efterKoeb(d, s.kontoId);
  assert.equal(post.udbakke.length, 0);
  assert.equal((await hentBestilling(s.db, ikkeFaerdig))?.stripeAbonnement, null);
  await s.klient.udloebCheckout(aaben.id);
  await koeb(s);
  post.fejl = true;
  await efterKoeb(d, s.kontoId);
  assert.equal(post.udbakke.length, 0, 'the provider refused');
  post.fejl = false;
  await efterKoeb(d, s.kontoId);
  assert.equal(mailTil(post, 'kvittering').length, 1, 'the next event delivers it');
});

test('an account without an address gets no receipt and nothing throws', async () => {
  const s = await stativ();
  const d = deps(s, falskPost(), { kontakt: async () => null });
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  assert.equal(d.post.udbakke.length, 0);
});

// --- Opsig ----------------------------------------------------------------------------------------
test('Opsig ends the subscription at period end, keeps access until then and confirms by mail', async () => {
  const s = await stativ();
  const d = deps(s);
  const k = await koeb(s);
  await efterKoeb(d, s.kontoId);
  const r = await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.udfald, 'opsagt');
  assert.equal(r.udfald === 'opsagt' && r.mail, true);
  const [a] = await s.klient.listAbonnementer(s.kunde);
  assert.equal(a?.id, k.abonnement);
  assert.equal(a?.status, 'active', 'access until the period ends');
  assert.equal(a?.opsigVedPeriodeslut, true);
  assert.deepEqual(stripeSkriv(s), ['opsigVedPeriodeslut']);
  const [m] = mailTil(d.post, 'opsigelse');
  assert.equal(m?.til, EMAIL);
  assert.equal(m?.data['slutter'], new Date(a!.periodeSlut!).toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen', dateStyle: 'long' }));
  assert.equal(r.udfald === 'opsagt' && r.slutter.toISOString(), a?.periodeSlut?.toISOString());
});

test('Opsig twice: the second finds it already cancelled, sends no mail and makes no Stripe call', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  const igen = await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(igen.udfald, 'allerede');
  assert.deepEqual(stripeSkriv(s), ['opsigVedPeriodeslut']);
  assert.equal(mailTil(d.post, 'opsigelse').length, 1);
});

test('Opsig with no running subscription says so and calls nothing; a trial is cancelled at its end too', async () => {
  const s = await stativ();
  const d = deps(s);
  assert.equal((await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' })).udfald, 'intet');
  await koeb(s, { proeve: true });
  const r = await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.udfald, 'opsagt');
  assert.equal(r.udfald === 'opsagt' && r.slutter.getTime(), s.u.nu().getTime() + 14 * DAG);
});

test('a failed confirmation mail does not undo the cancellation, and a Stripe failure changes nothing and says so', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  d.post.fejl = true;
  const r = await opsig(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.udfald === 'opsagt' && r.mail, false);
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.opsigVedPeriodeslut, true);
  const s2 = await stativ();
  const d2 = deps(s2);
  await koeb(s2);
  s2.klient.fejlNaeste('opsigVedPeriodeslut', 'stripe er nede');
  await assert.rejects(opsig(d2, { kontoId: s2.kontoId, email: EMAIL, sprog: 'da' }), /stripe er nede/);
  assert.equal((await s2.klient.listAbonnementer(s2.kunde))[0]?.opsigVedPeriodeslut, false);
  assert.equal(mailTil(d2.post, 'opsigelse').length, 0);
});

// --- Fortryd aftale -------------------------------------------------------------------------------
test('Fortryd aftale: recorded with its time, cancelled at once, receipt by mail, and a refund TASK for the owner with the proportional amount', async () => {
  const s = await stativ();
  const d = deps(s);
  const k = await koeb(s);
  await efterKoeb(d, s.kontoId);
  s.u.frem(4 * DAG + 3_600_000);
  const o = await fortrydOversigt(d, s.kontoId);
  assert.equal(o.art, 'klar');
  assert.equal(o.art === 'klar' && o.tilbageOere, 6583, 'what the screen shows before the confirmation');
  const r = await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.art, 'fortrudt');
  assert.equal(r.art === 'fortrudt' && r.tilbageOere, 6583);
  const f = await hentFortrydelse(s.db, k.bestilling);
  assert.equal(f?.tidspunkt.toISOString(), s.u.nu().toISOString());
  assert.deepEqual([f?.brugteDage, f?.periodeDage, f?.tilbageOere], [5, 30, 6583]);
  assert.ok(f?.opsagtVed);
  assert.deepEqual(stripeSkriv(s), ['opsigAbonnement'], 'cancelled now, not at period end');
  assert.equal((await s.klient.listAbonnementer(s.kunde))[0]?.status, 'canceled');
  const [m] = mailTil(d.post, 'fortrydelse');
  assert.equal(m?.data['tilbage'], 'Vi tilbagebetaler 65,83 kr. inden for 14 dage.');
  assert.equal(m?.data['saelger'], SAELGER);
  const [opgave] = await aabneRefusioner(s.db);
  assert.equal(opgave?.beloebOere, 6583);
  assert.equal(opgave?.bestillingId, k.bestilling);
  assert.equal(opgave?.forfald.toISOString(), new Date(s.u.nu().getTime() + 14 * DAG).toISOString());
});

test('money is never moved: a withdrawal makes only a cancellation call at Stripe, nothing else', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  const foer = s.klient.kald.length;
  await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.deepEqual(s.klient.kald.slice(foer).map((k) => k.metode), ['opsigAbonnement']);
});

test('the second press of Fortryd finds the first: no second task, no second mail, no second cancellation', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  s.u.frem(60_000);
  const igen = await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(igen.art, 'allerede');
  assert.equal((await aabneRefusioner(s.db)).length, 1);
  assert.equal(mailTil(d.post, 'fortrydelse').length, 1);
  assert.deepEqual(stripeSkriv(s), ['opsigAbonnement']);
});

test('after the 14 days the right is gone: nothing is recorded, cancelled or refunded, and the person is told', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  s.u.frem(16 * DAG);
  const o = await fortrydOversigt(d, s.kontoId);
  assert.equal(o.art, 'udloebet');
  const r = await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.art, 'udloebet');
  assert.equal(r.art === 'udloebet' && r.frist.toISOString(), '2026-11-14T22:59:59.999Z');
  assert.deepEqual(stripeSkriv(s), []);
  assert.equal((await aabneRefusioner(s.db)).length, 0);
  assert.equal(mailTil(d.post, 'fortrydelse').length, 0);
});

test('a withdrawal with nothing bought says there is nothing to withdraw from', async () => {
  const s = await stativ();
  const d = deps(s);
  assert.equal((await fortrydOversigt(d, s.kontoId)).art, 'intet');
  assert.equal((await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' })).art, 'intet');
});

test('a trial is withdrawn from without a refund task, and the receipt says nothing was paid', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s, { proeve: true });
  await efterKoeb(d, s.kontoId);
  const r = await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.art === 'fortrudt' && r.tilbageOere, 0);
  assert.equal((await aabneRefusioner(s.db)).length, 0);
  assert.equal(mailTil(d.post, 'fortrydelse')[0]?.data['tilbage'], 'Du havde ikke betalt noget, så der er intet at tilbagebetale.');
});

test('if Stripe cannot cancel, the withdrawal stays recorded with its first time; pressing again finishes it once', async () => {
  const s = await stativ();
  const d = deps(s);
  const k = await koeb(s);
  await efterKoeb(d, s.kontoId);
  s.klient.fejlNaeste('opsigAbonnement', 'stripe er nede');
  const foerste = s.u.nu().toISOString();
  await assert.rejects(fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' }), /stripe er nede/);
  let f = await hentFortrydelse(s.db, k.bestilling);
  assert.equal(f?.tidspunkt.toISOString(), foerste);
  assert.equal(f?.opsagtVed, null);
  assert.equal((await aabneRefusioner(s.db)).length, 1, 'the refund task exists from the moment of the request');
  s.u.frem(5 * 60_000);
  const r = await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  assert.equal(r.art, 'fortrudt');
  f = await hentFortrydelse(s.db, k.bestilling);
  assert.equal(f?.tidspunkt.toISOString(), foerste, 'the request keeps the time it was made');
  assert.ok(f?.opsagtVed);
  assert.equal((await aabneRefusioner(s.db)).length, 1);
  assert.equal(mailTil(d.post, 'fortrydelse').length, 1);
});

test('a withdrawal that the webhook later reads makes the entitlement "opsagt" (billing sees the cancellation like any other)', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s);
  await efterKoeb(d, s.kontoId);
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: 'e1', nu: s.u.nu() });
  await fortryd(d, { kontoId: s.kontoId, email: EMAIL, sprog: 'da' });
  const r = await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: 'e2', nu: s.u.nu() });
  assert.equal(r.til.status, 'opsagt');
});

// --- Renewal reminder -----------------------------------------------------------------------------
test('the renewal reminder goes to an active annual plan inside 14 days, once per period, with seller, price and date', async () => {
  const s = await stativ();
  const d = deps(s);
  const k = await koeb(s, { interval: 'aar' });
  await efterKoeb(d, s.kontoId);
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: 'e1', nu: s.u.nu() });
  assert.equal((await sendPaamindelser(d)).sendt, 0, 'a year away');
  s.u.frem(355 * DAG);
  const r = await sendPaamindelser(d);
  assert.equal(r.sendt, 1);
  const [m] = mailTil(d.post, 'fornyelse');
  assert.equal(m?.til, EMAIL);
  assert.equal(m?.data['pris'], '790 kr. om året. Det er hele prisen: der kommer ingen moms oveni.');
  assert.equal(m?.data['saelger'], SAELGER);
  assert.match(m!.data['dato']!, /31\. oktober 2027/);
  assert.equal((await sendPaamindelser(d)).sendt, 0, 'one reminder per period');
  assert.ok((await hentBestilling(s.db, k.bestilling))?.paamindetFor);
});

test('no reminder for monthly plans, cancelled plans or when the mail fails (it is tried again)', async () => {
  const s = await stativ();
  const d = deps(s);
  await koeb(s, { interval: 'maaned' });
  await efterKoeb(d, s.kontoId);
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: 'e1', nu: s.u.nu() });
  s.u.frem(27 * DAG);
  assert.equal((await sendPaamindelser(d)).sendt, 0, 'monthly');
  const s2 = await stativ();
  const d2 = deps(s2);
  await koeb(s2, { interval: 'aar' });
  await efterKoeb(d2, s2.kontoId);
  await synkKunde(s2.db, s2.klient, s2.priser, { stripeKunde: s2.kunde, kontoId: s2.kontoId, grund: 'test', haendelseId: 'e1', nu: s2.u.nu() });
  s2.u.frem(355 * DAG);
  d2.post.fejl = true;
  assert.deepEqual(await sendPaamindelser(d2), { sendt: 0, fejl: 1 });
  d2.post.fejl = false;
  await opsig(d2, { kontoId: s2.kontoId, email: EMAIL, sprog: 'da' });
  await synkKunde(s2.db, s2.klient, s2.priser, { stripeKunde: s2.kunde, kontoId: s2.kontoId, grund: 'test', haendelseId: 'e2', nu: s2.u.nu() });
  assert.equal((await sendPaamindelser(d2)).sendt, 0, 'cancelled: nothing renews');
});
