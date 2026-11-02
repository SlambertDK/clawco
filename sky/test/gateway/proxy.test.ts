// KC-0183: the gateway in front of a fake tenant. Invariant: a request reaches the tenant only with a valid,
// unexpired token for that tenant and a current membership, always with a gateway-made signature; nothing the
// client sends is read as identity; on any doubt the answer is 503/404 and nothing is proxied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { udstedToken, TOKEN_MS } from '../../src/gateway/cookie.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { opretKode } from '../../src/gateway/login-vej.ts';
import { tilbagekald } from '../../src/konto/session.ts';
import type { GatewayDeps } from '../../src/gateway/proxy.ts';
import { FROE, OFFENTLIG, opsaet, type Opsat } from './hjaelp.ts';
import { anmod, falskTenant, foersteBid, startGateway, type FalskTenant, type Gw } from './net.ts';

const PUBLIC = 'https://konto.eksempel.test';
const NOEGLE = laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, OFFENTLIG).noegle!;

type Stativ = { o: Opsat; t: FalskTenant; gw: Gw; host: string; log: string[]; cookie: (hvem?: 'ejer' | 'fremmed', slug?: string) => string; luk: () => Promise<void> };

async function stativ(over: Partial<GatewayDeps> = {}, tenantAdresse?: string): Promise<Stativ> {
  const t = await falskTenant();
  const o = await opsaet(tenantAdresse ?? t.adresse);
  const log: string[] = [];
  const gw = await startGateway({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, ruter: ruteTabel({ db: o.db }), samtykkeOk: async () => true, log: (s) => log.push(s), nu: o.ur.nu, ...over });
  const cookie = (hvem: 'ejer' | 'fremmed' = 'ejer', slug = o.slug) => {
    const p = o[hvem];
    return `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: slug, k: p.id, s: p.sessionId, e: p.email }, o.ur.nu())}`;
  };
  return { o, t, gw, host: `${o.slug}.eksempel.test`, log, cookie, luk: async () => { await gw.luk(); await t.luk(); await o.db.close(); } };
}

function tjekSignatur(header: string, slug: string, kontoId: number, email: string): void {
  const m = /^v1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(header);
  assert.ok(m, 'Clawco-Konto has the KC-0179 form');
  assert.equal(m[1], NOEGLE.id);
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: OFFENTLIG }, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(`v1.${m[1]}.${m[2]}`), pub, Buffer.from(m[3]!, 'base64url')), 'signed with the gateway key');
  const p = JSON.parse(Buffer.from(m[2]!, 'base64url').toString()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(p), ['t', 'k', 'e', 'iat']);
  assert.equal(p['t'], slug);
  assert.equal(p['k'], String(kontoId));
  assert.equal(p['e'], email);
}

test('forged identity headers are stripped and replaced by a gateway signature; our cookie never reaches the tenant', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, {
      host: s.host, sti: '/rum/mail?x=1',
      headers: {
        cookie: `andet=1; ${s.cookie()}; tredje=3`,
        'clawco-konto': 'v1.forfalsket.x.y', 'tailscale-user-login': 'ond@example.test', 'tailscale-user-name': 'Ond',
        'x-forwarded-for': '6.6.6.6', 'x-forwarded-host': 'evil.test', forwarded: 'for=6.6.6.6', 'x-real-ip': '6.6.6.6', 'cf-connecting-ip': '6.6.6.6',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'max-age=7');
    assert.equal(r.headers['etag'], '"v1"');
    const [m] = s.t.modtaget;
    assert.ok(m);
    assert.equal(m.url, '/rum/mail?x=1');
    tjekSignatur(String(m.headers['clawco-konto']), s.o.slug, s.o.ejer.id, s.o.ejer.email);
    for (const h of Object.keys(m.headers)) assert.doesNotMatch(h, /^(tailscale-|x-forwarded-|forwarded$|x-real-ip$|cf-)/, h);
    assert.equal(m.headers.cookie, 'andet=1; tredje=3');
    assert.equal(m.headers.host, s.host);
  } finally { await s.luk(); }
});

test('without any other cookie, no Cookie header reaches the tenant at all', async () => {
  const s = await stativ();
  try {
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie() } })).status, 200);
    assert.equal(s.t.modtaget[0]?.headers.cookie, undefined);
  } finally { await s.luk(); }
});

test('Server-Sent Events stream through unbuffered', async () => {
  const s = await stativ();
  try {
    const r = await foersteBid(s.gw.port, { host: s.host, sti: '/sse', headers: { cookie: s.cookie() } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/event-stream');
    assert.equal(r.bid, 'data: foerste\n\n', 'the first event arrives while the tenant still holds the stream open');
    s.t.sseSlut();
    assert.match(await r.resten, /data: sidste/);
  } finally { await s.luk(); }
});

test('a request body passes through', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/api/x', metode: 'POST', krop: '{"a":1}', headers: { cookie: s.cookie(), 'content-type': 'application/json' } });
    assert.equal(r.status, 200);
    assert.equal(s.t.modtaget[0]?.krop, '{"a":1}');
    assert.equal(s.t.modtaget[0]?.metode, 'POST');
  } finally { await s.luk(); }
});

test('a logged-in stranger gets 403 and nothing is proxied', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie('fremmed') } });
    assert.equal(r.status, 403);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('/health and /_sky/ are never forwarded, in any spelling', async () => {
  const s = await stativ();
  try {
    for (const sti of ['/health', '/health?x=1', '/health/', '//health', '/%68ealth', '/HEALTH', '/_sky/', '/_sky/andet', '/_sky']) {
      assert.equal((await anmod(s.gw.port, { host: s.host, sti, headers: { cookie: s.cookie() } })).status, 404, sti);
    }
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('without the gateway key every tenant host answers 503 and nothing is proxied', async () => {
  const s = await stativ({ noegle: null });
  try {
    for (const sti of ['/', '/_sky/faa?kode=x']) assert.equal((await anmod(s.gw.port, { host: s.host, sti, headers: { cookie: s.cookie() } })).status, 503);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('with the database down the answer is 503, not a guess', async () => {
  const t = await falskTenant();
  const o = await opsaet(t.adresse);
  const nede = { ...o.db, query: async () => { throw new Error('nede'); } };
  const gw = await startGateway({ db: nede, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: NOEGLE, ruter: ruteTabel({ db: nede }), samtykkeOk: async () => true, log: () => {}, nu: o.ur.nu });
  try {
    const c = `__Host-clawco=${udstedToken(NOEGLE.cookie, { t: o.slug, k: o.ejer.id, s: o.ejer.sessionId, e: o.ejer.email }, o.ur.nu())}`;
    assert.equal((await anmod(gw.port, { host: `${o.slug}.eksempel.test`, sti: '/', headers: { cookie: c } })).status, 503);
    assert.equal(t.modtaget.length, 0);
  } finally { await gw.luk(); await t.luk(); await o.db.close(); }
});

test('an unknown or not-klar tenant is a plain 404', async () => {
  const s = await stativ();
  try {
    assert.equal((await anmod(s.gw.port, { host: 'hus-zzzzzzzz.eksempel.test', sti: '/' })).status, 404);
    await s.o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = $1", [s.o.slug]);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie() } })).status, 404);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('no cookie: a GET is sent to Sky’s login with a signed next; anything else is 401; nothing proxied', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/rum/mail?x=1' });
    assert.equal(r.status, 302);
    const til = new URL(String(r.headers.location));
    assert.equal(til.origin + til.pathname, `${PUBLIC}/aabn`);
    assert.equal(til.searchParams.get('t'), s.o.slug);
    assert.equal(til.searchParams.get('n'), '/rum/mail?x=1');
    assert.ok(til.searchParams.get('s'));
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/api/x', metode: 'POST', krop: 'x' })).status, 401);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('a token for another tenant is no login here', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie('ejer', 'hus-bbbbbbbb') } });
    assert.equal(r.status, 302);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('an expired token is refreshed while the Sky session lives, and ends with it', async () => {
  const s = await stativ();
  try {
    const gammel = s.cookie();
    s.o.ur.frem(TOKEN_MS);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: gammel } });
    assert.equal(r.status, 200);
    const ny = [r.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('__Host-clawco='));
    assert.ok(ny, 'a fresh token is set');
    assert.notEqual(ny.split(';')[0], gammel);
    assert.equal(s.t.modtaget.length, 1);

    await tilbagekald(s.o.db, s.o.ejer.id, s.o.ejer.sessionId);
    s.o.ur.frem(TOKEN_MS);
    const ud = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: ny.split(';')[0]! } });
    assert.equal(ud.status, 302);
    assert.ok([ud.headers['set-cookie'] ?? []].flat().some((c) => /^__Host-clawco=;.*Max-Age=0/.test(c)), 'the dead cookie is cleared');
    assert.equal(s.t.modtaget.length, 1);
  } finally { await s.luk(); }
});

test('the exchange route spends the code, sets the host-only cookie and lands on next; a reused code is refused', async () => {
  const s = await stativ();
  try {
    const kode = await opretKode(s.o.db, { kontoId: s.o.ejer.id, sessionId: s.o.ejer.sessionId, slug: s.o.slug, naeste: '/rum/mail', nu: s.o.ur.nu() });
    const r = await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode}` });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/rum/mail');
    const c = [r.headers['set-cookie'] ?? []].flat().find((x) => x.startsWith('__Host-clawco='))!;
    assert.match(c, /HttpOnly/);
    assert.match(c, /Secure/);
    assert.match(c, /SameSite=Lax/);
    assert.doesNotMatch(c, /Domain=/i);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: c.split(';')[0]! } })).status, 200);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode}` })).status, 400);
  } finally { await s.luk(); }
});

test('a code made for a stranger who is no member sets no cookie', async () => {
  const s = await stativ();
  try {
    const kode = await opretKode(s.o.db, { kontoId: s.o.fremmed.id, sessionId: s.o.fremmed.sessionId, slug: s.o.slug, naeste: '/', nu: s.o.ur.nu() });
    const r = await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode}` });
    assert.equal(r.status, 403);
    assert.equal(r.headers['set-cookie'], undefined);
  } finally { await s.luk(); }
});

// KC-0204: a bumped consent version ends access to the product at the next refresh or entry, not at the next login.
test('KC-0204: an account whose accepted version is no longer current gets no cookie from the exchange route, and nothing is proxied', async () => {
  const gyldig = { ok: false };
  const s = await stativ({ samtykkeOk: async () => gyldig.ok });
  try {
    const kode = await opretKode(s.o.db, { kontoId: s.o.ejer.id, sessionId: s.o.ejer.sessionId, slug: s.o.slug, naeste: '/rum/mail', nu: s.o.ur.nu() });
    const r = await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode}` });
    assert.equal(r.status, 403);
    assert.equal(r.headers['set-cookie'], undefined);
    assert.match(r.krop, /Vilkårene er ændret/);
    assert.equal(s.t.modtaget.length, 0);
    // Once accepted, a fresh entry works.
    gyldig.ok = true;
    const kode2 = await opretKode(s.o.db, { kontoId: s.o.ejer.id, sessionId: s.o.ejer.sessionId, slug: s.o.slug, naeste: '/rum/mail', nu: s.o.ur.nu() });
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: `/_sky/faa?kode=${kode2}` })).status, 303);
  } finally { await s.luk(); }
});

test('KC-0204: when the version is bumped, a live token works until it expires; the refresh then fails and sends the person to Sky to accept', async () => {
  const gyldig = { ok: true };
  const s = await stativ({ samtykkeOk: async () => gyldig.ok });
  try {
    const gammel = s.cookie();
    gyldig.ok = false; // the text changed
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: gammel } })).status, 200, 'inside the 15-minute token: bounded, documented');
    s.o.ur.frem(TOKEN_MS);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: gammel } });
    assert.equal(r.status, 302);
    assert.equal(new URL(String(r.headers.location)).pathname, '/aabn');
    assert.ok([r.headers['set-cookie'] ?? []].flat().some((c) => /^__Host-clawco=;.*Max-Age=0/.test(c)), 'the cookie is cleared');
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/api/x', metode: 'POST', krop: 'x', headers: { cookie: gammel } })).status, 401);
    assert.equal(s.t.modtaget.length, 1, 'only the request inside the live token reached the tenant');
    gyldig.ok = true;
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie() } })).status, 200);
  } finally { await s.luk(); }
});

test('KC-0204: if the consent check itself fails, the refresh fails closed (503), never open', async () => {
  const s = await stativ({ samtykkeOk: async () => { throw new Error('db nede'); } });
  try {
    const gammel = s.cookie();
    s.o.ur.frem(TOKEN_MS);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: gammel } });
    assert.equal(r.status, 503);
    assert.equal(s.t.modtaget.length, 0);
  } finally { await s.luk(); }
});

test('the exchange route has a simple per-IP cap', async () => {
  const s = await stativ({ faaPrMinut: 3 });
  try {
    const svar = [];
    for (let i = 0; i < 4; i++) svar.push((await anmod(s.gw.port, { host: s.host, sti: '/_sky/faa?kode=gaet' })).status);
    assert.deepEqual(svar, [400, 400, 400, 429]);
  } finally { await s.luk(); }
});

test('a tenant that does not answer gives 502 with no detail', async () => {
  const s = await stativ({}, 'http://127.0.0.1:1');
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/', headers: { cookie: s.cookie() } });
    assert.equal(r.status, 502);
    assert.doesNotMatch(r.krop, /ECONNREFUSED|127\.0\.0\.1/);
  } finally { await s.luk(); }
});

test('a tenant cannot overwrite the gateway cookie; its own cookies pass', async () => {
  const s = await stativ();
  try {
    const r = await anmod(s.gw.port, { host: s.host, sti: '/saet-cookie', headers: { cookie: s.cookie() } });
    assert.deepEqual([r.headers['set-cookie'] ?? []].flat(), ['tenant=1; Path=/']);
  } finally { await s.luk(); }
});

// KC-0186: while a rollout replaces a tenant's container, its members get a short, calm page instead of an error.
test('a member of a tenant being updated gets "Opdaterer, et øjeblik": dark, Danish, no error code shown, nothing proxied', async () => {
  const s = await stativ();
  try {
    await s.o.db.query('UPDATE flaade.tenant SET opdateres = now() WHERE slug = $1', [s.o.slug]);
    const r = await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: s.cookie() } });
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '10');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(String(r.headers['content-type']), /^text\/html; charset=utf-8/);
    assert.match(String(r.headers['content-security-policy']), /default-src 'none'/);
    assert.match(r.krop, /<html lang="da">/);
    assert.match(r.krop, /Opdaterer, et øjeblik/);
    assert.match(r.krop, /color-scheme: dark/);
    assert.match(r.krop, /http-equiv="refresh" content="10"/);
    assert.doesNotMatch(r.krop, /503|fejl|error/i);
    assert.equal(s.t.modtaget.length, 0);
    // A stranger still gets the usual refusal, not a hint that the tenant exists and is updating.
    const f = await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: s.cookie('fremmed') } });
    assert.equal(f.status, 403);
    await s.o.db.query('UPDATE flaade.tenant SET opdateres = NULL WHERE slug = $1', [s.o.slug]);
  } finally { await s.luk(); }
});

test('KC-0203: a member let through is noted for the household (once per request, by slug); a stranger, an unlogged request and a refused one are not', async () => {
  const noteret: string[] = [];
  const s = await stativ({ noterSet: (slug) => { noteret.push(slug); } });
  try {
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: s.cookie() } })).status, 200);
    assert.deepEqual(noteret, [s.o.slug]);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: s.cookie('fremmed') } })).status, 403);
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail' })).status, 302);
    assert.deepEqual(noteret, [s.o.slug], 'a stranger and a request with no login leave nothing');
  } finally { await s.luk(); }
});

test('KC-0203: a failing or slow note never changes the answer', async () => {
  const s = await stativ({ noterSet: () => Promise.reject(new Error('database nede')) });
  try {
    assert.equal((await anmod(s.gw.port, { host: s.host, sti: '/rum/mail', headers: { cookie: s.cookie() } })).status, 200);
  } finally { await s.luk(); }
  const t = await stativ({ noterSet: () => { throw new Error('synkront'); } });
  try {
    assert.equal((await anmod(t.gw.port, { host: t.host, sti: '/rum/mail', headers: { cookie: t.cookie() } })).status, 200);
  } finally { await t.luk(); }
});
