// KC-0196: the grace mails. One mail per stage per failed payment, whoever runs the job and however often (the
// scheduler, a restart, a webhook heard twice); only the account holding the entitlement is written to; a failed
// send is tried again; nothing about the entitlement changes, nothing is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, startProeve, haendelse, fangLog, EMAIL, PUBLIC, type Stativ } from './stativ.ts';
import { app } from './appstativ.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import { synkKunde, hentRettigheder, saetGave } from '../../src/abonnement/synk.ts';
import { fristForKonto, fristGennemloeb, kontiIFrist, abonnementLink, type FristDeps } from '../../src/abonnement/frist-job.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { antal } from '../konto/hjaelp.ts';

const DAG = 86_400_000;
const TIME = 3_600_000;

function deps(s: Stativ, post: FalskPost, over: Partial<FristDeps> = {}): FristDeps {
  return { db: s.db, priser: s.priser, post, publicUrl: PUBLIC, nu: s.u.nu, kontakt: async (id) => (id === s.kontoId ? { email: EMAIL, sprog: 'da' } : null), ...over };
}

/** A paid-for trial whose card declines: at the trial's end the first invoice fails and the account is overdue. */
async function forfalden(): Promise<Stativ> {
  const s = await stativ();
  await startProeve(s);
  s.klient.vedhaeftBetalingsmiddel(s.kunde, 'pm_card_chargeCustomerFail');
  await frem(s, 14 * DAG + TIME);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'forfalden');
  return s;
}

async function frem(s: Stativ, ms: number): Promise<void> {
  s.u.frem(ms);
  s.klient.spolFrem(s.u.nu());
  await synkKunde(s.db, s.klient, s.priser, { stripeKunde: s.kunde, kontoId: s.kontoId, grund: 'test', haendelseId: null, nu: s.u.nu() });
}

const skabeloner = (p: FalskPost): string[] => p.udbakke.map((b) => b.skabelon);

test('day 0 and day 7 each send one mail to the owner, in the owner\'s language, with the date and the subscription link', async () => {
  const s = await forfalden();
  const post = falskPost();
  const d = deps(s, post, { kontakt: async () => ({ email: EMAIL, sprog: 'en' }) });
  await fangLog(() => fristGennemloeb(d));
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
  const b = post.udbakke[0]!;
  assert.equal(b.til, EMAIL);
  assert.equal(b.sprog, 'en');
  assert.equal(b.data['link'], abonnementLink({ publicUrl: PUBLIC }));
  assert.equal(b.data['link'], `${PUBLIC}/konto/abonnement`);
  assert.equal(b.data['produkt'], 'Sky Solo');
  assert.equal(b.data['dato'], '14 November 2026');
  // Every tick until day 7 is quiet.
  for (let i = 0; i < 6; i++) { await frem(s, DAG); await fangLog(() => fristGennemloeb(d)); }
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
  await frem(s, DAG);
  await fangLog(() => fristGennemloeb(d));
  assert.deepEqual(skabeloner(post), ['betaling-fejlet', 'betaling-paamindelse']);
  // Read-only on day 14 carries no mail of its own (the terms promise no automatic stop in beta), and nothing repeats.
  await frem(s, 7 * DAG);
  await fangLog(() => fristGennemloeb(d));
  assert.deepEqual(skabeloner(post), ['betaling-fejlet', 'betaling-paamindelse']);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).skrivebeskyttet, true);
});

test('a restart (a new job with new deps over the same database) neither repeats nor skips a stage', async () => {
  const s = await forfalden();
  const post = falskPost();
  await fangLog(() => fristGennemloeb(deps(s, post)));
  await fangLog(() => fristGennemloeb(deps(s, post))); // "restarted"
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
  // The scheduler was down from day 1 to day 15: the owed day-7 mail still goes, once; read-only came by the clock.
  await frem(s, 15 * DAG);
  await fangLog(() => fristGennemloeb(deps(s, post)));
  await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.deepEqual(skabeloner(post), ['betaling-fejlet', 'betaling-paamindelse']);
});

test('a webhook sends the day-0 mail within its round trip; the same invoice.payment_failed again sends nothing', async () => {
  const s = await stativ();
  await startProeve(s);
  s.klient.vedhaeftBetalingsmiddel(s.kunde, 'pm_card_chargeCustomerFail');
  s.u.frem(14 * DAG + TIME);
  s.klient.spolFrem(s.u.nu());
  const post = falskPost();
  const a = app(s, { post });
  const h = haendelse('invoice.payment_failed', s.kunde);
  const { r } = await fangLog(async () => (await a.webhook(h.raw, h.signatur)).text());
  assert.equal(r, 'opdateret');
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
  await fangLog(async () => (await a.webhook(h.raw, h.signatur)).text());
  const igen = haendelse('invoice.payment_failed', s.kunde); // Stripe's retry: a new event about the same invoice
  await fangLog(async () => (await a.webhook(igen.raw, igen.signatur)).text());
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
});

test('only the account holding the entitlement is mailed: a member account without one, a deleted account and a gift get nothing', async () => {
  const s = await forfalden();
  const { konto: medlem } = await findEllerOpretKonto(s.db, 'medlem@example.test', s.u.nu());
  const post = falskPost();
  const kontaktet: number[] = [];
  const d = deps(s, post, { kontakt: async (id) => { kontaktet.push(id); return { email: id === s.kontoId ? EMAIL : 'medlem@example.test', sprog: 'da' }; } });
  assert.deepEqual(await kontiIFrist(s.db), [s.kontoId]);
  assert.equal(await fristForKonto(d, medlem.id), 'intet');
  await fangLog(() => fristGennemloeb(d));
  assert.deepEqual(post.udbakke.map((b) => b.til), [EMAIL]);
  assert.ok(!kontaktet.includes(medlem.id));
  // Deleted: konto/slet.ts clears the address and sets slettet_ved; the job no longer sees the account.
  await s.db.query('UPDATE konto SET email = NULL, slettet_ved = $2 WHERE id = $1', [s.kontoId, s.u.nu().toISOString()]);
  assert.deepEqual(await kontiIFrist(s.db), []);
  // A gift (KC-0203) never takes part, whatever Stripe says.
  const g = await forfalden();
  await saetGave(g.db, g.kontoId, 'sky-solo', g.priser, g.u.nu());
  assert.deepEqual(await kontiIFrist(g.db), []);
  assert.equal(await fristForKonto(deps(g, post), g.kontoId), 'intet');
});

test('a refused mail is tried again on the next pass and then sent once; the entitlement and its outbox are untouched by the job', async () => {
  const s = await forfalden();
  const post = falskPost();
  post.fejl = true;
  const foer = await antal(s.db, 'abonnement.rettigheds_haendelser');
  const r1 = await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.deepEqual(r1.r, { sendt: 0, fejl: 1 });
  assert.doesNotMatch(r1.log, /example\.test/, 'the log never names the address');
  post.fejl = false;
  const r2 = await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.deepEqual(r2.r, { sendt: 1, fejl: 0 });
  await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.deepEqual(skabeloner(post), ['betaling-fejlet']);
  assert.equal(await antal(s.db, 'abonnement.rettigheds_haendelser'), foer);
});

test('the card is fixed: paid again, active, no longer read-only, and no more mails; a new failure later is a new episode', async () => {
  const s = await forfalden();
  const post = falskPost();
  await frem(s, 15 * DAG);
  await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).skrivebeskyttet, true);
  s.klient.vedhaeftBetalingsmiddel(s.kunde, 'pm_card_visa');
  s.klient.betalAabne(s.kunde);
  await frem(s, 0);
  const r = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(r.status, 'aktiv');
  assert.equal(r.skrivebeskyttet, false);
  const sendt = post.udbakke.length;
  await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.equal(post.udbakke.length, sendt);
  // The card declines again at a later renewal: a new failed payment, a new day-0 mail.
  s.klient.vedhaeftBetalingsmiddel(s.kunde, 'pm_card_chargeCustomerFail');
  await frem(s, 16 * DAG); // one day past the renewal
  await fangLog(() => fristGennemloeb(deps(s, post)));
  assert.deepEqual(skabeloner(post).slice(sendt), ['betaling-fejlet']);
});

test('a trial that ends without a card: one "trial ended" mail, never repeated', async () => {
  const s = await stativ();
  await startProeve(s);
  await frem(s, 14 * DAG + TIME);
  const r = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(r.status, 'pause');
  assert.equal(r.skrivebeskyttet, true);
  const post = falskPost();
  for (let i = 0; i < 3; i++) { await fangLog(() => fristGennemloeb(deps(s, post))); await frem(s, 7 * DAG); }
  assert.deepEqual(skabeloner(post), ['proeve-slut']);
  assert.equal(post.udbakke[0]!.data['dato'], '14. november 2026');
  assert.equal(post.udbakke[0]!.data['link'], `${PUBLIC}/konto/abonnement`);
});
