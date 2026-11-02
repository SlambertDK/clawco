// KC-0198: the sign-up routes over HTTP (Hono app.request). The account, entitlement, tenant and consent seams
// are an in-memory world here (server.ts wires the real ones; the smoke test runs them); a cookie names the
// account and the CSRF token is "csrf-<id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { tilmeldingRuter, type TilmeldingDeps, type TenantVisning } from '../../src/tilmelding/ruter.ts';
import { laesSamtykke } from '../../src/tilmelding/samtykke.ts';
import { LANGSOM_MS, type RettighedsStatus } from '../../src/tilmelding/trin.ts';

const PUBLIC = 'https://konto.example.test';
const S = laesSamtykke();
const ID = 7;

type Verden = {
  profil: { land: string | null; sprog: 'da' | 'en' | null; vilkaar: string | null; privatliv: string | null; oprettet: Date; tilmeldingMs: number | null } | null;
  rettighed: { status: RettighedsStatus; kilde: 'stripe' | 'gave' };
  tenant: TenantVisning | null;
  fuldfoert: Set<string>;
  igen: number;
  gemt: unknown[];
  tider: Date[];
  alarmer: string[];
  koder: string[];
  nu: Date;
};

function verden(o: Partial<Verden> = {}): Verden {
  return {
    profil: { land: 'DK', sprog: 'da', vilkaar: S.vilkaar.version, privatliv: S.privatliv.version, oprettet: new Date('2026-11-01T09:59:00Z'), tilmeldingMs: null },
    rettighed: { status: 'ingen', kilde: 'stripe' }, tenant: null, fuldfoert: new Set(), igen: 0, gemt: [], tider: [], alarmer: [], koder: [],
    nu: new Date('2026-11-01T10:00:00Z'), ...o,
  };
}

function app(v: Verden, over: Partial<TilmeldingDeps> = {}) {
  const hvem = async (c: Context) => (Number(getCookie(c, 'konto') ?? '') === ID ? { kontoId: ID, csrf: `csrf-${ID}` } : null);
  const d: TilmeldingDeps = {
    publicUrl: PUBLIC, tilstand: 'open', dev: false, samtykke: S, lande: ['DK', 'SE', 'DE'],
    planer: [{ id: 'sky-solo', navn: 'Sky Solo', medlemmer: 1, maaned: 7900, aar: 79000 }, { id: 'sky-husstand', navn: 'Sky Husstand', medlemmer: 6, maaned: 12900, aar: 129000 }],
    proeveDage: 14,
    adgang: { login: hvem, beskyttet: async (c, csrf) => (c.req.header('origin') === PUBLIC && csrf === `csrf-${ID}` ? hvem(c) : null) },
    profil: {
      hent: async () => v.profil,
      gem: async (_id, p) => { v.gemt.push(p); v.profil = { ...v.profil!, land: p.land, sprog: p.sprog, vilkaar: p.vilkaar, privatliv: p.privatliv }; },
      noterTid: async (_id, klar) => { v.tider.push(klar); },
    },
    rettighed: async () => v.rettighed,
    harProeve: async () => true,
    checkoutFuldfoert: async (_id, s) => (v.fuldfoert.has(s) ? { proeve: !s.endsWith('_betalt') } : null),
    tenant: async () => v.tenant,
    proevIgen: async () => { v.igen++; },
    aabnUrl: (slug) => `${PUBLIC}/aabn?t=${slug}&n=%2Frum%2Fstart&s=sig`,
    alarm: (l) => { v.alarmer.push(l); },
    nu: () => v.nu,
    ...over,
  };
  const a = tilmeldingRuter(d);
  const hent = (sti: string, init: RequestInit & { logget?: boolean } = {}) => {
    const h = new Headers(init.headers);
    if (init.logget !== false) h.set('cookie', `konto=${ID}`);
    return a.request(`${PUBLIC}${sti}`, { ...init, headers: h });
  };
  return {
    side: (sti: string, logget = true, headers: Record<string, string> = {}) => hent(sti, { logget, headers }),
    form: (sti: string, felter: Record<string, string>, o: { origin?: string; csrf?: string } = {}) => hent(sti, {
      method: 'POST', headers: { origin: o.origin ?? PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: o.csrf ?? `csrf-${ID}`, ...felter }),
    }),
  };
}

const tenant = (tilstand: TenantVisning['tilstand'], o: Partial<TenantVisning> = {}): TenantVisning => ({ slug: 'hus-abcdefgh', tilstand, fejl: null, bestilt: new Date('2026-11-01T09:59:50Z'), klar: null, ...o });

test('not logged in: the account step, carrying plan and interval into the mail link; Danish by default, English on request', async () => {
  const a = app(verden());
  const r = await a.side('/tilmeld?plan=sky-husstand&interval=aar', false);
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /<html lang="da">/);
  assert.match(t, /Kom i gang med Clawco i skyen/);
  assert.match(t, /name="til" value="\/tilmeld\?plan=sky-husstand&amp;interval=aar"/);
  assert.match(t, /action="\/log-ind\/link"/);
  assert.match(await (await a.side('/tilmeld?sprog=en', false)).text(), /<html lang="en">[\s\S]*Get started with Clawco in the cloud/);
  assert.match(await (await a.side('/tilmeld', false, { 'accept-language': 'en-GB,en;q=0.9' })).text(), /<html lang="en">/);
  assert.match(await (await a.side('/tilmeld', false, { 'accept-language': 'da-DK,da;q=0.9,en;q=0.5' })).text(), /<html lang="da">/);
  // Anything that is not a plan id or an interval is dropped from what rides along.
  assert.match(await (await a.side('/tilmeld?plan=%22x&interval=uge', false)).text(), /name="til" value="\/tilmeld"/);
});

test('security headers: Checkout may be a form target, nothing else; never cached', async () => {
  const r = await app(verden()).side('/tilmeld', false);
  assert.match(r.headers.get('content-security-policy') ?? '', /form-action 'self' https:\/\/checkout\.stripe\.com;/);
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
});

test('logged in without a profile: country, language and both consents, then on to the plan with the choice kept', async () => {
  const v = verden({ profil: { land: null, sprog: null, vilkaar: null, privatliv: null, oprettet: new Date(), tilmeldingMs: null } });
  const a = app(v);
  const t = await (await a.side('/tilmeld?plan=sky-husstand&interval=aar')).text();
  assert.match(t, /Om dig/);
  assert.match(t, /name="plan" value="sky-husstand"/);
  const ok = await a.form('/tilmeld/profil', { land: 'SE', sprog: 'en', vilkaar: S.vilkaar.version, privatliv: S.privatliv.version, plan: 'sky-husstand', interval: 'aar' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/tilmeld?plan=sky-husstand&interval=aar');
  assert.deepEqual(v.gemt, [{ land: 'SE', sprog: 'en', vilkaar: S.vilkaar.version, privatliv: S.privatliv.version, nu: v.nu }]);
  // The language is the account's from now on.
  assert.match(await (await a.side('/tilmeld')).text(), /<html lang="en">[\s\S]*Choose your plan/);
});

test('profile: a missing consent, a wrong version, a country we do not sell in, or no CSRF saves nothing', async () => {
  const v = verden({ profil: { land: null, sprog: null, vilkaar: null, privatliv: null, oprettet: new Date(), tilmeldingMs: null } });
  const a = app(v);
  const gyldig = { land: 'DK', sprog: 'da', vilkaar: S.vilkaar.version, privatliv: S.privatliv.version };
  for (const forkert of [{ vilkaar: '' }, { privatliv: 'gammel' }, { land: 'US' }, { sprog: 'de' }]) {
    const r = await a.form('/tilmeld/profil', { ...gyldig, ...forkert });
    assert.equal(r.status, 400, JSON.stringify(forkert));
    assert.match(await r.text(), /sæt begge flueben/);
  }
  assert.equal((await a.form('/tilmeld/profil', gyldig, { csrf: 'x' })).status, 403);
  assert.equal((await a.form('/tilmeld/profil', gyldig, { origin: 'https://ond.example' })).status, 403);
  assert.deepEqual(v.gemt, []);
});

test('an older consent version on the account asks again, on one short screen (KC-0204), not the whole profile', async () => {
  const v = verden();
  v.profil!.vilkaar = '0.0-gammel';
  const t = await (await app(v).side('/tilmeld')).text();
  assert.match(t, /Vilkårene er ændret/);
  assert.doesNotMatch(t, /Om dig/);
  assert.match(t, /href="\/konto\/slet"/);
  assert.deepEqual(await (await app(v).side('/api/tilmelding/status')).json(), { noegle: 'samtykke' });
});

test('KC-0204: even with a klar tenant and a live subscription, a bumped version blocks "Åbn Clawco" until accepted; then it is there again', async () => {
  const v = verden({ rettighed: { status: 'aktiv', kilde: 'stripe' }, tenant: tenant('klar', { klar: new Date('2026-11-01T09:59:58Z') }) });
  v.profil!.privatliv = '0.0-gammel';
  const a = app(v);
  const foer = await (await a.side('/tilmeld')).text();
  assert.match(foer, /Vilkårene er ændret/);
  assert.doesNotMatch(foer, /Åbn Clawco/);
  const ok = await a.form('/tilmeld/samtykke', { vilkaar: S.vilkaar.version, privatliv: S.privatliv.version });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/tilmeld');
  assert.deepEqual(v.gemt, [{ land: 'DK', sprog: 'da', vilkaar: S.vilkaar.version, privatliv: S.privatliv.version, nu: v.nu }], 'country and language are kept as they were');
  assert.match(await (await a.side('/tilmeld')).text(), /Åbn Clawco/);
});

test('KC-0204 re-accept: a missing box, an old version, no CSRF or a foreign origin saves nothing; a first-time profile cannot use it', async () => {
  const v = verden();
  v.profil!.vilkaar = '0.0-gammel';
  const a = app(v);
  for (const forkert of [{ vilkaar: '' }, { privatliv: 'gammel' }, { vilkaar: '0.0-gammel' }]) {
    const r = await a.form('/tilmeld/samtykke', { vilkaar: S.vilkaar.version, privatliv: S.privatliv.version, ...forkert });
    assert.equal(r.status, 400, JSON.stringify(forkert));
    assert.match(await r.text(), /Vilkårene er ændret/);
  }
  const gyldig = { vilkaar: S.vilkaar.version, privatliv: S.privatliv.version };
  assert.equal((await a.form('/tilmeld/samtykke', gyldig, { csrf: 'x' })).status, 403);
  assert.equal((await a.form('/tilmeld/samtykke', gyldig, { origin: 'https://ond.example' })).status, 403);
  assert.deepEqual(v.gemt, []);
  const ny = verden({ profil: { land: null, sprog: null, vilkaar: null, privatliv: null, oprettet: new Date(), tilmeldingMs: null } });
  const r = await app(ny).form('/tilmeld/samtykke', gyldig);
  assert.equal(r.status, 303, 'not an error page, just back to the profile step');
  assert.deepEqual(ny.gemt, [], 'nothing saved for an account without country and language');
});

test('open mode: the plan step with the account country, prices and the pricing-page preselection; a cancelled Checkout keeps the choice', async () => {
  const a = app(verden());
  const t = await (await a.side('/tilmeld?plan=sky-husstand&interval=aar')).text();
  assert.match(t, /Vælg din plan/);
  assert.match(t, /name="land" value="DK"/);
  assert.match(t, /name="retur" value="tilmelding"/);
  assert.match(t, /value="sky-husstand" checked/);
  assert.match(t, /value="aar" checked/);
  assert.match(t, /14 dage gratis, intet kort/);
  assert.match(await (await a.side('/tilmeld?plan=sky-solo&interval=maaned&afbrudt=1')).text(), /Du afbrød betalingen/);
});

test('invitation mode: the code field instead of the plan; without KC-0203 a code gets an honest answer, never a dead end', async () => {
  const v = verden();
  const a = app(v, { tilstand: 'invitation' });
  const t = await (await a.side('/tilmeld')).text();
  assert.match(t, /Tilmelding kræver en invitation/);
  assert.match(t, /name="kode"/);
  assert.doesNotMatch(t, /\/api\/abonnement\/checkout/);
  const r = await a.form('/tilmeld/invitation', { kode: 'ABC-123' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /kan ikke indløses endnu/);
  // With KC-0203's seam: a good code moves on, a bad one says so.
  const b = app(v, { tilstand: 'invitation', invitation: async (_id, kode) => kode === 'GOD' });
  assert.equal((await b.form('/tilmeld/invitation', { kode: 'GOD' })).headers.get('location'), '/tilmeld');
  const ond = await b.form('/tilmeld/invitation', { kode: 'ond' });
  assert.equal(ond.status, 400);
  assert.match(await ond.text(), /kender vi ikke/);
  assert.equal((await b.form('/tilmeld/invitation', { kode: 'GOD' }, { csrf: 'x' })).status, 403);
});

test('back from Stripe before the webhook: "Prøven er i gang", waiting and polling; a session that is not complete is the plan again', async () => {
  const v = verden({ fuldfoert: new Set(['cs_test_1']) });
  const a = app(v);
  const t = await (await a.side('/tilmeld?session=cs_test_1')).text();
  assert.match(t, /Prøven er i gang/);
  assert.match(t, /data-poll="\/api\/tilmelding\/status\?session=cs_test_1"/);
  assert.match(t, /data-efter-30s hidden/);
  assert.match(await (await a.side('/tilmeld?session=cs_test_2')).text(), /Vælg din plan/);
  // The title follows the Checkout that was completed (a trial, or a paid start), not the account's history:
  // the webhook that marks the trial as used may well have arrived already.
  v.fuldfoert.add('cs_test_betalt');
  assert.match(await (await a.side('/tilmeld?session=cs_test_betalt')).text(), /Betalingen er gennemført/);
  assert.match(await (await a.side('/tilmeld?session=../x')).text(), /Vælg din plan/);
  const s = await a.side('/api/tilmelding/status?session=cs_test_1');
  assert.deepEqual(await s.json(), { noegle: 'betaling' });
  v.rettighed = { status: 'proeve', kilde: 'stripe' };
  assert.deepEqual(await (await a.side('/api/tilmelding/status?session=cs_test_1')).json(), { noegle: 'klargoering:bestilles:i-gang' });
});

test('the status endpoint follows the real fleet states and needs a login', async () => {
  const v = verden({ rettighed: { status: 'proeve', kilde: 'stripe' } });
  const a = app(v);
  assert.equal((await a.side('/api/tilmelding/status', false)).status, 401);
  for (const s of ['bestilt', 'startet', 'sund', 'i-gateway'] as const) {
    v.tenant = tenant(s);
    assert.deepEqual(await (await a.side('/api/tilmelding/status')).json(), { noegle: `klargoering:${s}:i-gang` });
  }
  v.tenant = tenant('klar', { klar: new Date('2026-11-01T10:00:00Z') });
  assert.deepEqual(await (await a.side('/api/tilmelding/status')).json(), { noegle: 'aabn' });
});

test('closing the tab and coming back resumes where the server says (the page stores nothing)', async () => {
  const v = verden({ rettighed: { status: 'proeve', kilde: 'stripe' }, tenant: tenant('startet') });
  const a = app(v);
  const t = await (await a.side('/tilmeld')).text();
  assert.match(t, /Vi gør din Clawco klar/);
  assert.match(t, /data-noegle="klargoering:startet:i-gang"/);
  assert.doesNotMatch(t, /%/);
});

test('klar: one button "Åbn Clawco" through /aabn into the Start room; the sign-up time is recorded from the tenant\'s klar stamp', async () => {
  const klar = new Date('2026-11-01T10:00:30Z');
  const v = verden({ rettighed: { status: 'aktiv', kilde: 'gave' }, tenant: tenant('klar', { klar }) });
  const t = await (await app(v, { tilstand: 'invitation' }).side('/tilmeld')).text();
  assert.match(t, /<a class="knap primaer" href="https:\/\/konto\.example\.test\/aabn\?t=hus-abcdefgh&amp;n=%2Frum%2Fstart&amp;s=sig">Åbn Clawco<\/a>/);
  assert.deepEqual(v.tider, [klar]);
});

test('a ready tenant with a lapsed entitlement is never opened from here', async () => {
  for (const status of ['pause', 'forfalden', 'opsagt', 'ingen'] as const) {
    const v = verden({ rettighed: { status, kilde: 'stripe' }, tenant: tenant('klar', { klar: new Date() }) });
    const t = await (await app(v).side('/tilmeld')).text();
    assert.doesNotMatch(t, /Åbn Clawco<\/a>/, status);
  }
});

test('failed provisioning: plain words and a retry; the retry needs CSRF and starts the fleet once per click', async () => {
  const v = verden({ rettighed: { status: 'proeve', kilde: 'stripe' }, tenant: tenant('startet', { fejl: 'docker: no such image clawco:x' }) });
  const a = app(v);
  const t = await (await a.side('/tilmeld')).text();
  assert.match(t, /Klargøringen gik i stå/);
  assert.doesNotMatch(t, /docker|no such image/, 'never the raw error');
  assert.equal((await a.form('/api/tilmelding/igen', {}, { csrf: 'x' })).status, 403);
  const r = await a.form('/api/tilmelding/igen', {});
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/tilmeld');
  assert.equal(v.igen, 1);
});

test('retry is only for an entitled account that is provisioning (never a way to get a tenant without a plan)', async () => {
  const v = verden();
  const a = app(v);
  assert.equal((await a.form('/api/tilmelding/igen', {})).status, 303);
  v.rettighed = { status: 'proeve', kilde: 'stripe' };
  v.tenant = tenant('klar', { klar: new Date() });
  await a.form('/api/tilmelding/igen', {});
  assert.equal(v.igen, 0);
});

test('slow (> 2 min): the "longer than usual" line, and Henrik is alerted once per tenant, not on every poll', async () => {
  const v = verden({ rettighed: { status: 'proeve', kilde: 'stripe' }, tenant: tenant('startet', { bestilt: new Date(new Date('2026-11-01T10:00:00Z').getTime() - LANGSOM_MS - 1) }) });
  const a = app(v);
  assert.match(await (await a.side('/tilmeld')).text(), /længere end normalt/);
  await a.side('/api/tilmelding/status');
  await a.side('/api/tilmelding/status');
  assert.equal(v.alarmer.length, 1);
  assert.match(v.alarmer[0]!, /ADVARSEL/);
  assert.match(v.alarmer[0]!, /hus-abcdefgh/);
  assert.doesNotMatch(v.alarmer[0]!, /@/, 'no personal data in the alert');
});

test('paused subscription: sent to the subscription page; a tenant being deleted: said plainly', async () => {
  assert.match(await (await app(verden({ rettighed: { status: 'pause', kilde: 'stripe' } })).side('/tilmeld')).text(), /href="\/konto\/abonnement"/);
  assert.match(await (await app(verden({ rettighed: { status: 'aktiv', kilde: 'stripe' }, tenant: tenant('afvikles') })).side('/tilmeld')).text(), /bliver slettet/);
});

test('the client script is served; the dev gallery of every state exists only with SKY_DEV', async () => {
  const a = app(verden());
  const js = await a.side('/tilmeld.js', false);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  assert.equal((await a.side('/dev/tilmelding', false)).status, 404);
  const d = app(verden(), { dev: true });
  const g = await (await d.side('/dev/tilmelding', false)).text();
  assert.match(g, /klargoering-fejlet/);
  assert.match(await (await d.side('/dev/tilmelding/klargoering-fejlet?sprog=en', false)).text(), /<html lang="en">[\s\S]*Try again/);
  assert.equal((await d.side('/dev/tilmelding/findes-ikke', false)).status, 404);
  // A still picture: the gallery never polls (it would reload forever without a session).
  assert.doesNotMatch(await (await d.side('/dev/tilmelding/klargoering-startet', false)).text(), /data-poll/);
});
