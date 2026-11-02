// KC-0191: the plan page, Checkout, the way back and the webhook route over HTTP (Hono app.request),
// with the fake Stripe client. Login and household role are seams (konto/ is not imported by
// abonnement/); here a cookie names the account and the CSRF token is "csrf-<id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { stativ, startProeve, haendelse, fangLog, HEMMELIGHED, EMAIL, PUBLIC, type Stativ } from './stativ.ts';
import { antal } from '../konto/hjaelp.ts';
import { abonnementRuter, type AbonnementDeps, type Indlogget } from '../../src/abonnement/ruter.ts';
import { hentKundeRaekke } from '../../src/abonnement/kunde.ts';
import { hentRettigheder, saetGave } from '../../src/abonnement/synk.ts';
import { FalskBetalingsKlient } from '../../src/abonnement/falsk.ts';
import { anvend, planlaeg } from '../../src/abonnement/opsaet.ts';

type Rolle = { rolle: 'ejer' | 'medlem'; antal: number } | null;

function app(s: Stativ, over: Partial<AbonnementDeps> & { rolle?: Rolle } = {}) {
  const hvem = async (c: Context): Promise<Indlogget | null> => {
    const id = Number(getCookie(c, 'konto') ?? '');
    return id === s.kontoId ? { kontoId: id, email: EMAIL, sprog: 'da', csrf: `csrf-${id}` } : null;
  };
  const d: AbonnementDeps = {
    db: s.db, klient: s.klient, priser: s.priser, publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null },
    webhookHemmelighed: HEMMELIGHED, nu: s.u.nu, taeller: { afvist: 0 },
    adgang: {
      login: hvem,
      beskyttet: async (c, csrf) => {
        if (c.req.header('origin') !== PUBLIC) return null;
        const l = await hvem(c);
        return l && csrf === l.csrf ? l : null;
      },
    },
    husstand: async () => (over.rolle === undefined ? null : over.rolle),
    tilPlan: async () => true,
    ...over,
  };
  const a = abonnementRuter(d);
  const hent = (sti: string, init: RequestInit = {}) => a.request(`${PUBLIC}${sti}`, init);
  return {
    d,
    side: (sti: string, logget = true) => hent(sti, { headers: logget ? { cookie: `konto=${s.kontoId}` } : {} }),
    vaelg: (felter: Record<string, string>, opts: { origin?: string; csrf?: string } = {}) => hent('/api/abonnement/checkout', {
      method: 'POST',
      headers: { cookie: `konto=${s.kontoId}`, origin: opts.origin ?? PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: opts.csrf ?? `csrf-${s.kontoId}`, ...felter }),
    }),
    webhook: (raw: Uint8Array, signatur: string) => hent('/api/abonnement/webhook', { method: 'POST', headers: { 'stripe-signature': signatur, 'content-type': 'application/json' }, body: raw }),
  };
}

const SOLO = { plan: 'sky-solo', interval: 'maaned', land: 'DK' };
const sessioner = (s: Stativ) => s.klient.kald.filter((k) => k.metode === 'opretCheckout');

test('the plan page needs a login and shows both plans from the config, the intervals and the countries, dark', async () => {
  const s = await stativ();
  const a = app(s);
  const ud = await a.side('/konto/abonnement', false);
  assert.equal(ud.status, 303);
  assert.equal(ud.headers.get('location'), '/log-ind?til=/konto/abonnement');
  const r = await a.side('/konto/abonnement');
  assert.equal(r.status, 200);
  const t = await r.text();
  for (const navn of ['Sky Solo', 'Sky Husstand']) assert.ok(t.includes(navn), navn);
  assert.match(t, /79 kr\. om måneden · 790 kr\. om året/);
  assert.match(t, /1\.290 kr\. om året/);
  assert.match(t, /Op til 6 personer/);
  assert.match(t, /action="\/api\/abonnement\/checkout"/);
  assert.match(t, /name="csrf" value="csrf-\d+"/);
  assert.match(t, /<option value="DK" selected>Danmark<\/option>/);
  assert.match(t, /Start 14 dages gratis prøve/);
  assert.match(t, /Du skal ikke taste et kort/);
  assert.match(t, /<meta name="color-scheme" content="dark">/);
  assert.match(r.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/checkout\.stripe\.com https:\/\/billing\.stripe\.com/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('back from Stripe with "cancel": the choice is kept and the page says so', async () => {
  const s = await stativ();
  const t = await (await app(s).side('/konto/abonnement?plan=sky-husstand&interval=aar&land=SE&afbrudt=1')).text();
  assert.match(t, /value="sky-husstand" checked/);
  assert.match(t, /value="aar" checked/);
  assert.match(t, /<option value="SE" selected>Sverige<\/option>/);
  assert.match(t, /Du afbrød betalingen/);
  const f = await (await app(s).side('/konto/abonnement?plan=%22%3E%3Cscript%3E&land=XX')).text();
  assert.ok(!f.includes('<script>'));
});

test('choosing a plan creates one customer for the account and a trial Checkout without card, then redirects to Stripe', async () => {
  const s = await stativ();
  await s.db.query('DELETE FROM abonnement.kunde');
  const r = await app(s).vaelg({ ...SOLO, land: 'SE' });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location') ?? '', /^https:\/\/checkout\.stripe\.test\/c\/cs_falsk_/);
  const k = await hentKundeRaekke(s.db, s.kontoId);
  assert.equal(k?.land, 'SE');
  assert.deepEqual(await s.klient.hentKunde(k!.stripeKunde), { id: k!.stripeKunde, slettet: false, kontoId: s.kontoId });
  const [kald] = sessioner(s);
  const p = kald!.args as { subscription_data: { trial_period_days?: number }; payment_method_collection: string; customer: string; metadata: Record<string, string> };
  assert.equal(p.subscription_data.trial_period_days, 14);
  assert.equal(p.payment_method_collection, 'if_required');
  assert.equal(p.customer, k!.stripeKunde);
  assert.equal(p.metadata['konto_id'], String(s.kontoId));
  assert.equal(k?.aabenCheckout, new URL(r.headers.get('location')!).pathname.split('/').at(-1));
});

test('a double click and a second tab with the same choice give one Checkout Session', async () => {
  const s = await stativ();
  const a = app(s);
  const [r1, r2] = await Promise.all([a.vaelg(SOLO), a.vaelg(SOLO)]);
  assert.equal(r1.headers.get('location'), r2.headers.get('location'));
  assert.equal(new Set(sessioner(s).map((k) => k.idempotensNoegle)).size, 1);
});

test('a second tab with another plan expires the first session, so two subscriptions cannot both be bought', async () => {
  const s = await stativ();
  const a = app(s);
  const forste = new URL((await a.vaelg(SOLO)).headers.get('location')!).pathname.split('/').at(-1)!;
  await a.vaelg({ ...SOLO, plan: 'sky-husstand' });
  assert.equal((await s.klient.hentCheckout(forste))?.status, 'expired');
  assert.throws(() => s.klient.fuldfoerCheckout(forste, s.u.nu()));
});

test('an account with a live subscription never gets a second one: it is sent to the Portal', async () => {
  const s = await stativ();
  await startProeve(s);
  s.klient.kald.length = 0;
  const r = await app(s).vaelg({ ...SOLO, plan: 'sky-husstand' });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location') ?? '', /^https:\/\/billing\.stripe\.test\//);
  assert.equal(sessioner(s).length, 0);
});

test('a trial is given once per account: a cancelled trial (or the stored flag) means a paid Checkout with card', async () => {
  const s = await stativ();
  await startProeve(s);
  const [ab] = await s.klient.listAbonnementer(s.kunde);
  s.klient.saetAbonnement({ ...ab!, status: 'canceled' });
  s.klient.kald.length = 0;
  await app(s).vaelg(SOLO);
  const p = sessioner(s)[0]!.args as { subscription_data: { trial_period_days?: number }; payment_method_collection: string };
  assert.equal(p.subscription_data.trial_period_days, undefined);
  assert.equal(p.payment_method_collection, 'always');

  const t = await stativ();
  await t.db.query('UPDATE abonnement.kunde SET proeve_brugt = true');
  const side = await (await app(t).side('/konto/abonnement')).text();
  assert.match(side, /Gå til betaling/);
  assert.match(side, /haft en gratis prøve før/);
  await app(t).vaelg(SOLO);
  assert.equal((sessioner(t)[0]!.args as { subscription_data: { trial_period_days?: number } }).subscription_data.trial_period_days, undefined);
});

test('only the owner may start Checkout: a member is told to ask the owner, and nothing reaches Stripe', async () => {
  const s = await stativ();
  const a = app(s, { rolle: { rolle: 'medlem', antal: 3 } });
  const r = await a.vaelg(SOLO);
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Spørg den, der ejer abonnementet/);
  assert.match(await (await a.side('/konto/abonnement')).text(), /Spørg den, der ejer abonnementet/);
  assert.equal(sessioner(s).length, 0);
  assert.equal((await app(s, { rolle: { rolle: 'ejer', antal: 1 } }).vaelg(SOLO)).status, 303);
});

test('no Origin or a wrong CSRF token is refused before anything happens', async () => {
  const s = await stativ();
  s.klient.kald.length = 0;
  const a = app(s);
  assert.equal((await a.vaelg(SOLO, { origin: 'https://ond.example' })).status, 403);
  assert.equal((await a.vaelg(SOLO, { csrf: 'forkert' })).status, 403);
  assert.equal(s.klient.kald.length, 0);
});

test('an unknown plan, interval or country is 400 and never defaulted; nothing reaches Stripe', async () => {
  const s = await stativ();
  const a = app(s);
  for (const f of [{ ...SOLO, plan: 'sky-guld' }, { ...SOLO, plan: 'constructor' }, { ...SOLO, interval: 'uge' }, { ...SOLO, land: 'US' }, { interval: 'maaned', land: 'DK' }]) {
    const r = await a.vaelg(f);
    assert.equal(r.status, 400, JSON.stringify(f));
    assert.match(await r.text(), /Vælg en plan/);
  }
  assert.equal(sessioner(s).length, 0);
});

test('no Stripe key: 503, never a silent default; a missing price (setup not run) is 503 too', async () => {
  const s = await stativ();
  assert.equal((await app(s, { klient: null }).vaelg(SOLO)).status, 503);
  const tom = new FalskBetalingsKlient('test');
  const { r } = await fangLog(async () => app(s, { klient: tom }).vaelg(SOLO));
  assert.equal(r.status, 503);
});

test('live mode refuses Checkout until the terms and withdrawal wording exist (KC-0174)', async () => {
  const s = await stativ();
  const live = new FalskBetalingsKlient('live');
  await anvend((await planlaeg(s.priser, live)).skridt, live);
  const { r } = await fangLog(async () => app(s, { klient: live }).vaelg(SOLO));
  assert.equal(r.status, 503);
  assert.equal(live.kald.filter((k) => k.metode === 'opretCheckout').length, 0);
});

test('back from Stripe: the session is re-read; a trial says "Prøven er i gang" with its end, and nothing is written', async () => {
  const s = await stativ();
  const a = app(s);
  const id = new URL((await a.vaelg(SOLO)).headers.get('location')!).pathname.split('/').at(-1)!;
  const aaben = await a.side(`/api/abonnement/tilbage?session=${id}`);
  assert.equal(aaben.status, 200);
  assert.match(await aaben.text(), /Betalingen er ikke gennemført/);
  s.klient.fuldfoerCheckout(id, s.u.nu());
  const r = await a.side(`/api/abonnement/tilbage?session=${id}`);
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Prøven er i gang/);
  assert.match(t, /14\. nov\. 2026/);
  assert.equal(await antal(s.db, 'abonnement.rettigheder'), 0, 'kun webhooks skriver rettigheder (invariant 1)');
  assert.equal((await a.side(`/api/abonnement/tilbage?session=${id}`, false)).status, 303);
});

test('a forged or foreign session id on the way back is refused', async () => {
  const s = await stativ();
  const anden = await s.klient.opretKunde({ kontoId: 999, email: 'x@example.test', sprog: 'da' }, 'anden');
  const pris = await s.klient.prisForLookupKey('clawco-sky-solo-maaned');
  const fremmed = await s.klient.opretCheckout({ mode: 'subscription', customer: anden.id, client_reference_id: String(s.kontoId), line_items: [{ price: pris!.id, quantity: 1 }], success_url: `${PUBLIC}/x` }, 'fremmed');
  s.klient.fuldfoerCheckout(fremmed.id, s.u.nu());
  const a = app(s);
  for (const id of [fremmed.id, 'cs_findes_ikke', '../../konto', '']) {
    const r = await a.side(`/api/abonnement/tilbage?session=${encodeURIComponent(id)}`);
    assert.equal(r.status, 404, id);
    assert.match(await r.text(), /Vi kender ikke den betaling/);
  }
});

test('after the webhook the page shows the plan and the trial end; over the member limit the owner gets the card', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  const a = app(s, { rolle: { rolle: 'ejer', antal: 4 } });
  assert.equal((await a.webhook(h.raw, h.signatur)).status, 200);
  assert.equal((await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu())).status, 'proeve');
  const t = await (await a.side('/konto/abonnement')).text();
  assert.match(t, /Sky Solo/);
  assert.match(t, /Gratis prøve til 14\. nov\. 2026/);
  assert.match(t, /I er 4, Sky Solo er til 1: vælg Sky Husstand eller ret medlemmerne/);
  assert.doesNotMatch(await (await app(s).side('/konto/abonnement')).text(), /I er /);
});

test('the webhook route reads the raw body (larger than the account pages\' 64 KB limit) and answers Stripe plainly', async () => {
  const s = await stativ();
  await startProeve(s);
  const stor = haendelse('checkout.session.completed', s.kunde);
  const krop = JSON.parse(Buffer.from(stor.raw).toString()) as Record<string, unknown>;
  krop['fyld'] = 'x'.repeat(100_000);
  const raw = Buffer.from(JSON.stringify(krop));
  const { signatur } = haendelse('checkout.session.completed', s.kunde);
  const a = app(s);
  assert.equal((await a.webhook(raw, signatur)).status, 400, 'signaturen hører til en anden krop');
  const Stripe = (await import('stripe')).default;
  const r = await a.webhook(raw, Stripe.webhooks.generateTestHeaderString({ payload: raw.toString(), secret: HEMMELIGHED }));
  assert.equal(r.status, 200);
  assert.equal((await app(s, { webhookHemmelighed: null }).webhook(raw, signatur)).status, 503);
});

test('the status page offers the Portal to the owner (cards, invoices, plan change live there, KC-0195)', async () => {
  const s = await stativ();
  await startProeve(s);
  const h = haendelse('checkout.session.completed', s.kunde);
  const a = app(s);
  await a.webhook(h.raw, h.signatur);
  assert.match(await (await a.side('/konto/abonnement')).text(), /action="\/api\/abonnement\/portal"/);
  const post = (csrf: string) => abonnementRuter(a.d).request(`${PUBLIC}/api/abonnement/portal`, {
    method: 'POST', headers: { cookie: `konto=${s.kontoId}`, origin: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf }),
  });
  const r = await post(`csrf-${s.kontoId}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `https://billing.stripe.test/p/${s.kunde}`);
  assert.equal((await post('forkert')).status, 403);
});

test('KC-0198: a Checkout started from the sign-up flow returns into it; anything else in retur is ignored', async () => {
  const s = await stativ();
  const a = app(s);
  const r = await a.vaelg({ ...SOLO, retur: 'tilmelding' });
  assert.equal(r.status, 303);
  assert.ok(String((sessioner(s).at(-1)!.args as { success_url?: string }).success_url).startsWith(`${PUBLIC}/tilmeld?session=`));
  const s2 = await stativ();
  await app(s2).vaelg({ ...SOLO, retur: 'https://ond.example' });
  assert.ok(String((sessioner(s2).at(-1)!.args as { success_url?: string }).success_url).startsWith(`${PUBLIC}/api/abonnement/tilbage`));
});

test('KC-0220: an account that may not choose a plan yet is sent to /tilmeld; one that already has a plan (a gift) still sees it', async () => {
  const s = await stativ();
  const a = app(s, { tilPlan: async () => false });
  const side = await a.side('/konto/abonnement');
  assert.equal(side.status, 303);
  assert.equal(side.headers.get('location'), '/tilmeld');
  const r = await a.vaelg(SOLO);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/tilmeld');
  assert.equal(sessioner(s).length, 0);
  await saetGave(s.db, s.kontoId, 'sky-husstand', s.priser, s.u.nu());
  assert.equal((await a.side('/konto/abonnement')).status, 200);
});
