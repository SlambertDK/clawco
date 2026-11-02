// KC-0195 over HTTP: the Portal session endpoint (owner only, an account with a Stripe customer only, Clawco's own
// configuration only, a session per click that is never logged), and the "Abonnement" page reading invoices from Stripe
// on demand and showing only what the webhook has confirmed (invariants 1–3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, startProeve, haendelse, fangLog, PUBLIC, type Stativ } from './stativ.ts';
import { app } from './appstativ.ts';
import { hentRettigheder } from '../../src/abonnement/synk.ts';
import { lookupKey } from '../../src/abonnement/opsaet.ts';
import { portalKonfiguration } from '../../src/abonnement/portal.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';

const portalKald = (s: Stativ) => s.klient.kald.filter((k) => k.metode === 'opretPortal');
const tekst = (t: string): string => t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function medProeve(): Promise<{ s: Stativ; sub: string }> {
  const s = await stativ();
  const sub = await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  await app(s).webhook(h.raw, h.signatur);
  return { s, sub };
}

test('the owner gets a fresh Portal session on Clawco\'s own configuration, in the account\'s language, back to the page', async () => {
  const { s } = await medProeve();
  const { r: r1, log } = await fangLog(async () => app(s).send('/api/abonnement/portal', {}));
  assert.equal(r1.status, 303);
  assert.equal(r1.headers.get('location'), `https://billing.stripe.test/p/${s.kunde}`);
  assert.equal(r1.headers.get('cache-control'), 'no-store');
  assert.ok(!log.includes('billing.stripe'), 'the session URL is never logged');
  await app(s, { sprog: 'en' }).send('/api/abonnement/portal', {});
  const kald = portalKald(s).map((k) => k.args as { kunde: string; returUrl: string; konfiguration: string; sprog: string });
  assert.equal(kald.length, 2, 'one session per click, never reused');
  assert.deepEqual(kald[0], { kunde: s.kunde, returUrl: `${PUBLIC}/konto/abonnement`, konfiguration: (await portalKonfiguration(s.klient))!, sprog: 'da' });
  assert.equal(kald[1]?.sprog, 'en');
});

test('the endpoint refuses a member, a forged request and an account without a Stripe customer, before Stripe', async () => {
  const { s } = await medProeve();
  const m = await app(s, { rolle: { rolle: 'medlem', antal: 2 } }).send('/api/abonnement/portal', {});
  assert.equal(m.status, 403);
  assert.match(await m.text(), /Spørg den, der ejer abonnementet/);
  assert.equal((await app(s).send('/api/abonnement/portal', {}, { csrf: 'forkert' })).status, 403);
  assert.equal((await app(s).send('/api/abonnement/portal', {}, { origin: 'https://ond.example' })).status, 403);
  await s.db.query('DELETE FROM abonnement.kunde');
  const u = await app(s).send('/api/abonnement/portal', {});
  assert.equal(u.status, 303);
  assert.equal(u.headers.get('location'), '/konto/abonnement');
  assert.equal(portalKald(s).length, 0);
});

test('without Clawco\'s portal configuration (setup not run) the endpoint is 503 and never opens the shared account\'s default portal', async () => {
  const { s } = await medProeve();
  const id = (await portalKonfiguration(s.klient))!;
  await s.klient.opdaterPortalKonfiguration(id, { active: false });
  const { r, log } = await fangLog(async () => app(s).send('/api/abonnement/portal', {}));
  assert.equal(r.status, 503);
  assert.match(log, /stripe:opsaet/);
  assert.equal(portalKald(s).length, 0);
  // The Checkout route's way to the Portal (a live subscription) follows the same rule.
  const c = await app(s).vaelg({ plan: 'sky-husstand', interval: 'maaned', land: 'DK' });
  assert.equal(c.status, 503);
  assert.equal(portalKald(s).length, 0);
});

test('a Stripe error is 502 and the log masks keys; nothing is cached', async () => {
  const { s } = await medProeve();
  s.klient.fejlNaeste('opretPortal', 'Invalid API Key provided: rk_test_SENTINEL0123456789'); // gitleaks:allow
  const { r, log } = await fangLog(async () => app(s).send('/api/abonnement/portal', {}));
  assert.equal(r.status, 502);
  assert.ok(!log.includes('SENTINEL'));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('the page lists the account\'s invoices from Stripe on demand (12 at most) and still shows the plan when Stripe fails', async () => {
  const { s } = await medProeve();
  const tom = await (await app(s).side('/konto/abonnement')).text();
  assert.match(tekst(tom), /Ingen fakturaer endnu/);
  for (let i = 1; i <= 13; i++) {
    s.klient.tilfoejFaktura({ id: `in_${i}`, nummer: `CLAWCO-${String(i).padStart(4, '0')}`, oprettet: new Date(Date.UTC(2026, 10, i)), beloeb: 7900, valuta: 'dkk', status: 'paid', url: `https://invoice.stripe.com/i/test_${i}`, kunde: s.kunde });
  }
  const t = await (await app(s).side('/konto/abonnement')).text();
  assert.equal([...t.matchAll(/Se faktura/g)].length, 12);
  assert.match(t, /href="https:\/\/invoice\.stripe\.com\/i\/test_13"/);
  assert.doesNotMatch(t, /test_1"/);
  s.klient.fejlNaeste('listFakturaer', 'Stripe er nede');
  const { r, log } = await fangLog(async () => app(s).side('/konto/abonnement'));
  assert.equal(r.status, 200);
  const f = await r.text();
  assert.match(tekst(f), /Sky Solo/);
  assert.match(tekst(f), /Fakturaerne kan ikke hentes lige nu/);
  assert.match(log, /fakturaer/i);
});

test('invariant 1: a plan change shows only after the webhook confirmed it, never from the query string', async () => {
  const { s, sub } = await medProeve();
  s.klient.skiftPris(sub, (await s.klient.prisForLookupKey(lookupKey('sky-husstand', 'maaned')))!.id);
  const foer = tekst(await (await app(s).side('/konto/abonnement?plan=sky-husstand&status=aktiv')).text());
  assert.match(foer, /Sky Solo/);
  assert.doesNotMatch(foer, /Sky Husstand/);
  const h = haendelse('customer.subscription.updated', s.kunde);
  await app(s).webhook(h.raw, h.signatur);
  assert.match(tekst(await (await app(s).side('/konto/abonnement')).text()), /Sky Husstand/);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'proeve', 'the status is still the one Stripe holds (a trial)');
});

test('invariant 2: cancelling in the Portal keeps the subscription usable to the period end, and the page says the date', async () => {
  const { s, sub } = await medProeve();
  await s.klient.opsigVedPeriodeslut(sub);
  const h = haendelse('customer.subscription.updated', s.kunde);
  await app(s).webhook(h.raw, h.signatur);
  const r = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(r.status, 'proeve');
  assert.ok(r.opsiges);
  const t = tekst(await (await app(s).side('/konto/abonnement')).text());
  assert.match(t, /Slutter 14\. nov\. 2026/);
  assert.match(t, /Du kan bruge Clawco indtil 14\. nov\. 2026/);
});

test('invariant 3: a downgrade that leaves too many members shows the over-limit card, never an error', async () => {
  const { s, sub } = await medProeve();
  s.klient.skiftPris(sub, (await s.klient.prisForLookupKey(lookupKey('sky-husstand', 'maaned')))!.id);
  const h1 = haendelse('customer.subscription.updated', s.kunde);
  await app(s).webhook(h1.raw, h1.signatur);
  s.klient.skiftPris(sub, (await s.klient.prisForLookupKey(lookupKey('sky-solo', 'maaned')))!.id);
  const h2 = haendelse('customer.subscription.updated', s.kunde);
  await app(s).webhook(h2.raw, h2.signatur);
  const r = await app(s, { rolle: { rolle: 'ejer', antal: 3 } }).side('/konto/abonnement');
  assert.equal(r.status, 200);
  assert.match(tekst(await r.text()), /I er 3, Sky Solo er til 1: vælg Sky Husstand eller ret medlemmerne/);
});

test('a member sees the owner\'s plan read-only with "Spørg ejeren"; Stripe is not asked', async () => {
  const { s } = await medProeve();
  const { konto: medlem } = await findEllerOpretKonto(s.db, 'medlem@example.test', s.u.nu());
  s.klient.fejlNaeste('listFakturaer', 'must not be called');
  const a = app({ ...s, kontoId: medlem.id }, { rolle: { rolle: 'medlem', antal: 2, ejerKontoId: s.kontoId } });
  const r = await a.side('/konto/abonnement');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(tekst(t), /Sky Solo/);
  assert.match(tekst(t), /Spørg ejeren/);
  assert.doesNotMatch(t, /action="\/api\/abonnement\/portal"/);
  assert.doesNotMatch(t, /Fakturaer/);
  await assert.rejects(s.klient.listFakturaer(s.kunde), /must not be called/, 'the page never asked Stripe');
});
