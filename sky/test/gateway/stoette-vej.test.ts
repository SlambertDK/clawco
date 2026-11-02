// KC-0188: the gateway's half of "Lad support se med". Invariant (D15, AGENTS §0 r2/r7): a staff identity reaches a
// tenant only through an unexpired grant its owner made, checked against the database on every request (no cache);
// it reaches only that tenant, only reads (every other method is refused here before the tenant sees it), and every
// session start is logged with the staff account's id. No grant, an expired or revoked one, another tenant's, or a
// database that cannot answer: nothing is proxied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { Hono } from 'hono';
import { udstedToken } from '../../src/gateway/cookie.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { opretKode } from '../../src/gateway/login-vej.ts';
import { tenantKald } from '../../src/gateway/tenantkald.ts';
import { KONTAKT, SLAA_FRA, stoetteVejRuter, type StoetteSeams } from '../../src/gateway/stoette-vej.ts';
import type { GatewayDeps } from '../../src/gateway/proxy.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { opretSession } from '../../src/konto/session.ts';
import { bestil, skift } from '../../src/fleet/tilstand.ts';
import { aabnStoette, aktiveStoetter, annullerStoette, givStoette, sessionStartet, stoetteGyldig, stoetteHaendelser, tilbagekaldStoette } from '../../src/konto/stoette.ts';
import { FROE, OFFENTLIG, opsaet, type Opsat } from './hjaelp.ts';
import { anmod, falskTenant, startGateway, type FalskTenant, type Gw, type Modtaget } from './net.ts';

const PUBLIC = 'https://konto.eksempel.test';
const NOEGLE = laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, OFFENTLIG).noegle!;
const TIME = 3_600_000;
const PUB = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: OFFENTLIG }, format: 'jwk' });

type Hvem = { id: number; email: string; sessionId: number };
type Stativ = {
  o: Opsat; t: FalskTenant; gw: Gw; host: string; origin: string; log: string[]; personale: Hvem; kvitteringer: { kontoId: number; timer: number }[];
  ejerCookie: () => string; tenantSvar: { start: number; slut: number }; post: { fejl: boolean }; luk: () => Promise<void>;
};

function svarFra(s: { start: number; slut: number }) {
  return (m: Modtaget) => {
    if (m.url === '/api/stoette/start') {
      const id = (JSON.parse(m.krop || '{}') as { bevis?: string }).bevis ? 'ok' : '';
      return { status: s.start, json: s.start === 200 && id ? { aktiv: true } : { error: 'nej' } };
    }
    if (m.url === '/api/stoette/slaa-fra') return { status: s.slut, json: { aktiv: false } };
    return null;
  };
}

async function stativ(over: Partial<GatewayDeps> = {}): Promise<Stativ> {
  const tenantSvar = { start: 200, slut: 200 };
  const t = await falskTenant(svarFra(tenantSvar));
  const o = await opsaet(t.adresse);
  const { konto } = await findEllerOpretKonto(o.db, 'personale@example.test', o.ur.nu());
  await o.db.query("INSERT INTO passkey (konto_id, credential_id, public_key, taeller, navn, oprettet) VALUES ($1, 'cred-p', 'pk', 0, 'nøgle', now())", [konto.id]);
  await o.db.query('UPDATE konto SET personale = true WHERE id = $1', [konto.id]);
  const { session } = await opretSession(o.db, { kontoId: konto.id, metode: 'passkey', enhed: '', nu: o.ur.nu() });
  const personale = { id: konto.id, email: 'personale@example.test', sessionId: session.id };
  const log: string[] = [];
  const kvitteringer: { kontoId: number; timer: number }[] = [];
  const post = { fejl: false };
  const seams: StoetteSeams = {
    giv: (a) => givStoette(o.db, a),
    annuller: (id, nu) => annullerStoette(o.db, id, nu),
    tilbagekald: (a) => tilbagekaldStoette(o.db, a),
    gyldig: (a) => stoetteGyldig(o.db, a),
    sessionStartet: (a) => sessionStartet(o.db, a),
    kvittering: async (kontoId, a) => { if (post.fejl) throw new Error('post nede'); kvitteringer.push({ kontoId, timer: a.timer }); },
    kald: tenantKald({ noegle: NOEGLE, nu: o.ur.nu }),
  };
  const gw = await startGateway({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, ruter: ruteTabel({ db: o.db }), samtykkeOk: async () => true, log: (x) => log.push(x), nu: o.ur.nu, stoette: seams, ...over });
  const ejerCookie = () => `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: o.slug, k: o.ejer.id, s: o.ejer.sessionId, e: o.ejer.email }, o.ur.nu())}`;
  return {
    o, t, gw, host: `${o.slug}.eksempel.test`, origin: `https://${o.slug}.eksempel.test`, log, personale, kvitteringer, ejerCookie, tenantSvar, post,
    luk: async () => { await gw.luk(); await t.luk(); await o.db.close(); },
  };
}

const form = (felter: Record<string, string>): string => new URLSearchParams(felter).toString();

async function slaaTil(s: Stativ, felter: Record<string, string> = { timer: '1', grund: 'Mail viser ingenting' }, headers: Record<string, string> = {}) {
  return anmod(s.gw.port, { host: s.host, sti: KONTAKT, metode: 'POST', headers: { cookie: s.ejerCookie(), origin: s.origin, 'content-type': 'application/x-www-form-urlencoded', ...headers }, krop: form(felter) });
}

/** A staff member's gateway cookie for a grant, made the way the staff page does it (code → exchange). */
async function somPersonale(s: Stativ, id: number, slug = s.o.slug): Promise<string> {
  const aabnet = await aabnStoette(s.o.db, { id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.o.ur.nu() });
  assert.ok(aabnet, 'the staff member opens the grant');
  const kode = await opretKode(s.o.db, { kontoId: s.personale.id, sessionId: s.personale.sessionId, slug, naeste: '/rum/hjem', nu: s.o.ur.nu(), stoetteId: id });
  const r = await anmod(s.gw.port, { host: `${slug}.eksempel.test`, sti: `/_sky/faa?kode=${kode}` });
  assert.equal(r.status, 303, r.krop);
  const c = [r.headers['set-cookie'] ?? []].flat().find((x) => x.startsWith('__Host-clawco='));
  assert.ok(c);
  return c.split(';')[0]!;
}

const payload = (header: string): Record<string, unknown> => JSON.parse(Buffer.from(header.split('.')[2]!, 'base64url').toString()) as Record<string, unknown>;

test('the owner turns it on: one grant, the tenant is told with a bevis only Sky can sign, a notice mail goes to the owner', async () => {
  const s = await stativ();
  try {
    const r = await slaaTil(s, { timer: '4', grund: 'Mail viser ingenting' });
    assert.equal(r.status, 303, r.krop);
    assert.equal(r.headers.location, '/');
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    assert.ok(a);
    assert.equal(a.slug, s.o.slug);
    assert.equal(a.udloeber.getTime() - a.givet.getTime(), 4 * TIME);
    const kald = s.t.modtaget.filter((m) => m.url === '/api/stoette/start');
    assert.equal(kald.length, 1);
    assert.equal(kald[0]!.metode, 'POST');
    // The tenant call is signed as the owner (KC-0206's channel) and carries the grant as a separately signed bevis.
    assert.equal(payload(String(kald[0]!.headers['clawco-konto']))['k'], String(s.o.ejer.id));
    const bevis = (JSON.parse(kald[0]!.krop) as { bevis: string }).bevis;
    const m = /^s1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(bevis);
    assert.ok(m, 'bevis has the s1 form');
    assert.ok(verify(null, Buffer.from(`s1.${m[1]}.${m[2]}`), PUB, Buffer.from(m[3]!, 'base64url')));
    assert.ok(!verify(null, Buffer.from(`v1.${m[1]}.${m[2]}`), PUB, Buffer.from(m[3]!, 'base64url')), 'a bevis is never a user header');
    const p = JSON.parse(Buffer.from(m[2]!, 'base64url').toString()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(p), ['t', 'a', 'g', 'u', 'h', 'r', 'iat']);
    assert.deepEqual([p['t'], p['a'], p['h'], p['r'], p['u']], [s.o.slug, String(a.id), 4, 'Mail viser ingenting', Math.floor(a.udloeber.getTime() / 1000)]);
    assert.deepEqual(s.kvitteringer, [{ kontoId: s.o.ejer.id, timer: 4 }]);
    assert.deepEqual((await stoetteHaendelser(s.o.db, a.id)).map((h) => h.slags), ['givet']);
  } finally { await s.luk(); }
});

test('only the owner, only from the tenant\'s own page, only 1, 4 or 24 hours; nothing is half-made', async () => {
  const s = await stativ();
  try {
    const fremmed = `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: s.o.slug, k: s.o.fremmed.id, s: s.o.fremmed.sessionId, e: s.o.fremmed.email }, s.o.ur.nu())}`;
    assert.equal((await slaaTil(s, undefined, { cookie: fremmed })).status, 403, 'a non-owner');
    assert.equal((await slaaTil(s, undefined, { cookie: '' })).status, 401, 'nobody');
    assert.equal((await slaaTil(s, undefined, { origin: 'https://evil.test' })).status, 403, 'another site');
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: KONTAKT, metode: 'POST', headers: { cookie: s.ejerCookie(), 'content-type': 'application/x-www-form-urlencoded' }, krop: form({ timer: '1' }) })).status, 403, 'no Origin');
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: KONTAKT, headers: { cookie: s.ejerCookie() } })).status, 405, 'GET');
    for (const timer of ['2', '25', '48', '', 'x']) assert.equal((await slaaTil(s, { timer })).status, 400, timer);
    assert.equal((await slaaTil(s, { timer: '1', grund: 'x'.repeat(121) })).status, 400);
    assert.deepEqual(await aktiveStoetter(s.o.db, s.o.ur.nu()), []);
    assert.equal(s.t.modtaget.length, 0, 'the tenant heard nothing');
    // The tenant refuses → the grant is rolled back; the mail fails → rolled back and the tenant is told to stop.
    s.tenantSvar.start = 500;
    assert.equal((await slaaTil(s)).status, 502);
    assert.deepEqual(await aktiveStoetter(s.o.db, s.o.ur.nu()), []);
    s.tenantSvar.start = 200;
    s.post.fejl = true;
    assert.equal((await slaaTil(s)).status, 502);
    assert.deepEqual(await aktiveStoetter(s.o.db, s.o.ur.nu()), []);
    assert.ok(s.t.modtaget.some((m) => m.url === '/api/stoette/slaa-fra'), 'the tenant is told to stop again');
    assert.deepEqual(s.kvitteringer, []);
  } finally { await s.luk(); }
});

test('no grant means 403: a code without a live grant opens nothing, and a forged grant id in a cookie opens nothing', async () => {
  const s = await stativ();
  try {
    assert.equal((await slaaTil(s)).status, 303);
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    await aabnStoette(s.o.db, { id: a!.id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.o.ur.nu() });
    const kode = await opretKode(s.o.db, { kontoId: s.personale.id, sessionId: s.personale.sessionId, slug: s.o.slug, naeste: '/', nu: s.o.ur.nu(), stoetteId: a!.id });
    await tilbagekaldStoette(s.o.db, { slug: s.o.slug, kontoId: s.o.ejer.id, nu: s.o.ur.nu() });
    const r = await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode}` });
    assert.equal(r.status, 403);
    assert.match(r.krop, /Støtteadgangen/);
    const falsk = `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: s.o.slug, k: s.personale.id, s: s.personale.sessionId, e: s.personale.email, g: 999, n: 'abcdefabcdefabcd' }, s.o.ur.nu())}`;
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/hjem', headers: { cookie: falsk } })).status, 403);
    // A staff member without any grant is no member either: a plain staff session gets the usual 403.
    const uden = `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: s.o.slug, k: s.personale.id, s: s.personale.sessionId, e: s.personale.email }, s.o.ur.nu())}`;
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/hjem', headers: { cookie: uden } })).status, 403);
    assert.equal(s.t.modtaget.filter((m) => !m.url.startsWith('/api/stoette/')).length, 0, 'nothing proxied');
  } finally { await s.luk(); }
});

test('with a grant, staff read: the request carries a signed support claim, the session start is logged with the staff id, and only reads pass', async () => {
  const s = await stativ();
  try {
    await slaaTil(s);
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    const cookie = await somPersonale(s, a!.id);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/rum/hjem?x=1', headers: { cookie } });
    assert.equal(r.status, 200);
    const sidste = s.t.modtaget.at(-1)!;
    const p = payload(String(sidste.headers['clawco-konto']));
    assert.deepEqual(Object.keys(p), ['t', 'k', 'e', 'iat', 'sa', 'su', 'sn']);
    assert.deepEqual([p['t'], p['k'], p['sa'], p['su']], [s.o.slug, String(s.personale.id), String(a!.id), Math.floor(a!.udloeber.getTime() / 1000)]);
    assert.match(String(p['sn']), /^[a-f0-9]{16}$/);
    assert.deepEqual((await stoetteHaendelser(s.o.db, a!.id)).map((h) => [h.slags, h.kontoId]), [['givet', s.o.ejer.id], ['aabnet', s.personale.id]]);
    const foer = s.t.modtaget.length;
    for (const metode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const w = await anmod(s.gw.port, { host: s.host, sti: '/api/rum/mail/handling', metode, headers: { cookie, 'content-type': 'application/json', 'content-length': '2' }, krop: '{}' });
      assert.equal(w.status, 403, metode);
      assert.match((JSON.parse(w.krop) as { error: string }).error, /Support kan kun se med/, 'JSON the app\'s client shows');
    }
    assert.equal(s.t.modtaget.length, foer, 'no write reached the tenant');
    // Staff can never turn support on or off.
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: SLAA_FRA, metode: 'POST', headers: { cookie, origin: s.origin } })).status, 403);
    assert.ok(s.log.some((l) => l.includes(`konto=${s.personale.id}`) && l.includes(`stoette=${a!.id}`)), 'Sky logs the staff id and the grant');
    assert.ok(s.log.every((l) => !l.includes('/rum/hjem') && !l.includes('x=1')), 'never a path or query');
  } finally { await s.luk(); }
});

test('expired means 403 within a request: the database is asked on every request, not cached', async () => {
  const s = await stativ();
  try {
    await slaaTil(s, { timer: '1' });
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    const cookie = await somPersonale(s, a!.id);
    s.o.ur.frem(TIME - 1000);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/hjem', headers: { cookie } })).status, 200);
    const foer = s.t.modtaget.length;
    s.o.ur.frem(1000);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/rum/hjem', headers: { cookie } });
    assert.equal(r.status, 403);
    assert.match(r.krop, /Støtteadgangen er slut/);
    assert.ok([r.headers['set-cookie'] ?? []].flat().some((c) => /^__Host-clawco=;.*Max-Age=0/.test(c)), 'the cookie is cleared');
    assert.equal(s.t.modtaget.length, foer);
  } finally { await s.luk(); }
});

test('a grant for tenant A does not open tenant B', async () => {
  const s = await stativ();
  try {
    const b = await bestil(s.o.db, { kontoId: s.o.fremmed.id, driver: 'lokal', nu: s.o.ur.nu(), nySlug: () => 'hus-bbbbbbbb' });
    await skift(s.o.db, b.slug, ['bestilt'], 'klar', s.o.ur.nu(), { adresse: s.t.adresse });
    await slaaTil(s);
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    await aabnStoette(s.o.db, { id: a!.id, personaleKontoId: s.personale.id, sessionId: s.personale.sessionId, nu: s.o.ur.nu() });
    const kode = await opretKode(s.o.db, { kontoId: s.personale.id, sessionId: s.personale.sessionId, slug: b.slug, naeste: '/', nu: s.o.ur.nu(), stoetteId: a!.id });
    assert.equal((await anmod(s.gw.port, { host: `${b.slug}.eksempel.test`, sti: `/_sky/faa?kode=${kode}` })).status, 403);
    const tilB = `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: b.slug, k: s.personale.id, s: s.personale.sessionId, e: s.personale.email, g: a!.id, n: 'abcdefabcdefabcd' }, s.o.ur.nu())}`;
    assert.equal((await anmod(s.gw.port, { host: `${b.slug}.eksempel.test`, sti: '/', headers: { cookie: tilB } })).status, 403);
    assert.equal(s.t.modtaget.filter((m) => !m.url.startsWith('/api/stoette/')).length, 0);
  } finally { await s.luk(); }
});

test('the owner\'s Slå fra ends it at once: Sky first, then the tenant; staff\'s next request is refused', async () => {
  const s = await stativ();
  try {
    await slaaTil(s);
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    const cookie = await somPersonale(s, a!.id);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie } })).status, 200);
    const r = await anmod(s.gw.port, { host: s.host, sti: SLAA_FRA, metode: 'POST', headers: { cookie: s.ejerCookie(), origin: s.origin } });
    assert.equal(r.status, 303);
    assert.ok(s.t.modtaget.some((m) => m.url === '/api/stoette/slaa-fra' && m.metode === 'POST'));
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie } })).status, 403);
    assert.deepEqual((await stoetteHaendelser(s.o.db, a!.id)).map((h) => h.slags), ['givet', 'aabnet', 'tilbagekaldt']);
    // Even if the tenant cannot be told, Sky has already stopped the gateway (and says so).
    await slaaTil(s);
    s.tenantSvar.slut = 500;
    const r2 = await anmod(s.gw.port, { host: s.host, sti: SLAA_FRA, metode: 'POST', headers: { cookie: s.ejerCookie(), origin: s.origin } });
    assert.equal(r2.status, 502);
    assert.match(r2.krop, /Support er slået fra/);
    assert.deepEqual(await aktiveStoetter(s.o.db, s.o.ur.nu()), []);
  } finally { await s.luk(); }
});

test('a database that cannot answer is a 503 for a support session, never a guess', async () => {
  const s = await stativ();
  try {
    await slaaTil(s);
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    const cookie = await somPersonale(s, a!.id);
    const nede: StoetteSeams['gyldig'] = async () => { throw new Error('database nede'); };
    await s.gw.luk();
    const seams = { giv: async () => { throw new Error('x'); }, annuller: async () => {}, tilbagekald: async () => null, gyldig: nede, sessionStartet: async () => {}, kvittering: async () => {}, kald: tenantKald({ noegle: NOEGLE }) } satisfies StoetteSeams;
    const gw = await startGateway({ db: s.o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, ruter: ruteTabel({ db: s.o.db }), samtykkeOk: async () => true, log: () => {}, nu: s.o.ur.nu, stoette: seams });
    const foer = s.t.modtaget.length;
    assert.equal((await anmod(gw.port, { host: s.host, sti: '/rum/hjem', headers: { cookie } })).status, 503);
    assert.equal(s.t.modtaget.length, foer);
    await gw.luk();
    // Without the support seams at all, a support cookie is no way in.
    const gw2 = await startGateway({ db: s.o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, ruter: ruteTabel({ db: s.o.db }), samtykkeOk: async () => true, log: () => {}, nu: s.o.ur.nu });
    assert.equal((await anmod(gw2.port, { host: s.host, sti: '/rum/hjem', headers: { cookie } })).status, 403);
    assert.equal((await anmod(gw2.port, { host: s.host, sti: KONTAKT, metode: 'POST', headers: { cookie: s.ejerCookie(), origin: s.origin } })).status, 404);
    await gw2.luk();
    await s.t.luk();
    await s.o.db.close();
  } catch (err) { await s.luk().catch(() => {}); throw err; }
});

test('the staff page: only staff logged in by passkey; it lists live grants and opens one with a one-time code', async () => {
  const s = await stativ();
  try {
    await slaaTil(s, { timer: '1', grund: '<b>Mail</b> viser ingenting' });
    const [a] = await aktiveStoetter(s.o.db, s.o.ur.nu());
    let hvem: Awaited<ReturnType<Parameters<typeof stoetteVejRuter>[0]['personale']>> = null;
    const app = new Hono();
    app.route('/', stoetteVejRuter({
      db: s.o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, nu: s.o.ur.nu,
      personale: async () => hvem,
      personaleBeskyttet: async (_c, csrf) => (hvem && hvem !== 'ikke-logget-ind' && csrf === hvem.csrf ? hvem : null),
      aktive: (nu) => aktiveStoetter(s.o.db, nu),
      aabn: (x) => aabnStoette(s.o.db, x),
    }));
    hvem = 'ikke-logget-ind';
    const ud = await app.request('/personale');
    assert.equal(ud.status, 303);
    assert.equal(ud.headers.get('location'), '/log-ind?til=%2Fpersonale');
    hvem = null;
    assert.equal((await app.request('/personale')).status, 403, 'logged in, but not staff by passkey');
    hvem = { kontoId: s.personale.id, sessionId: s.personale.sessionId, csrf: 'csrf-x' };
    const side = await app.request('/personale');
    assert.equal(side.status, 200);
    const tekst = await side.text();
    assert.ok(tekst.includes(s.o.slug));
    assert.ok(tekst.includes('&lt;b&gt;Mail&lt;/b&gt;') && !tekst.includes('<b>Mail</b>'), 'the reason is escaped');
    assert.ok(tekst.includes('Åbn med støtteadgang'));
    assert.match(side.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    const forkert = await app.request('/personale/aabn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id: String(a!.id), csrf: 'forkert' }) });
    assert.equal(forkert.status, 403);
    const r = await app.request('/personale/aabn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id: String(a!.id), csrf: 'csrf-x' }) });
    assert.equal(r.status, 303);
    const til = new URL(r.headers.get('location')!);
    assert.equal(til.origin, s.origin);
    assert.equal(til.pathname, '/_sky/faa');
    const svar = await anmod(s.gw.port, { host: s.host, sti: `${til.pathname}${til.search}` });
    assert.equal(svar.status, 303);
    assert.equal(svar.headers.location, '/rum/hjem');
    const ukendt = await app.request('/personale/aabn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id: '999999', csrf: 'csrf-x' }) });
    assert.equal(ukendt.status, 403);
  } finally { await s.luk(); }
});
