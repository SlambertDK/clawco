// KC-0183: the way in. The gateway sends a person without a tenant cookie to Sky's /aabn with a signed `next`;
// Sky checks login and membership and sends them back with a one-time code (60 s, single use, bound to konto,
// session and tenant), which only the gateway's /_sky/faa exchanges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { sikkerNaeste, signerNaeste, loginUrl, tenantOrigin, opretKode, indloesKode, loginVejRuter, KODE_MS, bindingHash, nyBinding } from '../../src/gateway/login-vej.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { antal } from '../konto/hjaelp.ts';
import { FROE, opsaet, type Opsat } from './hjaelp.ts';

const PUBLIC = 'https://konto.eksempel.test';
const noegle = () => laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, null).noegle!;

test('sikkerNaeste keeps relative paths on the tenant host and replaces everything else with /', () => {
  for (const ok of ['/', '/rum/mail', '/rum/dagen?x=1&y=2', '/a%20b']) assert.equal(sikkerNaeste(ok), ok, ok);
  for (const nej of ['//evil.test/x', '/\\evil.test', 'https://evil.test/', 'rum', '', '/_sky/faa?kode=x', '/_sky/', '/a\nb', `/${'a'.repeat(2048)}`, 5, undefined, '/%0d%0aSet-Cookie:x']) {
    assert.equal(sikkerNaeste(nej), '/', String(nej));
  }
});

test('the tenant origin follows the public URL’s scheme and port', () => {
  assert.equal(tenantOrigin('hus-abcdefgh', PUBLIC, 'eksempel.test'), 'https://hus-abcdefgh.eksempel.test');
  assert.equal(tenantOrigin('hus-abcdefgh', 'http://localhost:8796', 'localhost'), 'http://hus-abcdefgh.localhost:8796');
});

test('loginUrl points at Sky’s /aabn with the slug, next and a signature over both', () => {
  const n = noegle();
  const u = new URL(loginUrl({ publicUrl: `${PUBLIC}/konto`, noegle: n, slug: 'hus-abcdefgh', naeste: '/rum/mail?x=1' }));
  assert.equal(u.origin + u.pathname, `${PUBLIC}/aabn`);
  assert.equal(u.searchParams.get('t'), 'hus-abcdefgh');
  assert.equal(u.searchParams.get('n'), '/rum/mail?x=1');
  assert.equal(u.searchParams.get('s'), signerNaeste(n.naeste, 'hus-abcdefgh', '/rum/mail?x=1'));
  assert.notEqual(signerNaeste(n.naeste, 'hus-bbbbbbbb', '/rum/mail?x=1'), u.searchParams.get('s'));
});

test('KC-0272: loginUrl with the browser\'s binding carries its hash as b, and the signature covers it too', () => {
  const n = noegle();
  const v = nyBinding();
  const u = new URL(loginUrl({ publicUrl: PUBLIC, noegle: n, slug: 'hus-abcdefgh', naeste: '/rum/mail', binding: v }));
  assert.equal(u.searchParams.get('b'), bindingHash(v));
  assert.ok(!u.href.includes(v), 'the binding itself never leaves the tenant host');
  assert.equal(u.searchParams.get('s'), signerNaeste(n.naeste, 'hus-abcdefgh', '/rum/mail', bindingHash(v)));
  assert.notEqual(u.searchParams.get('s'), signerNaeste(n.naeste, 'hus-abcdefgh', '/rum/mail'));
});

const B = bindingHash('browserens-egen-tilstand-paa-lejerens-vaert-xyz');

test('a code is exchanged once, only on its own tenant, only within 60 seconds; only its hash is stored', async () => {
  const o = await opsaet();
  const a = { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, slug: o.slug, naeste: '/rum/mail', nu: o.ur.nu(), binding: B };
  assert.equal(KODE_MS, 60_000);
  const kode = await opretKode(o.db, a);
  assert.ok(!JSON.stringify(await o.db.query('SELECT * FROM gateway.kode')).includes(kode));
  assert.equal(await indloesKode(o.db, kode, 'hus-bbbbbbbb', o.ur.nu(), B), null, 'wrong tenant');
  assert.deepEqual(await indloesKode(o.db, kode, o.slug, o.ur.nu(), B), { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, naeste: '/rum/mail' });
  assert.equal(await indloesKode(o.db, kode, o.slug, o.ur.nu(), B), null, 'single use');

  const k2 = await opretKode(o.db, a);
  o.ur.frem(60_000);
  assert.equal(await indloesKode(o.db, k2, o.slug, o.ur.nu(), B), null, 'expired');
  assert.equal(await indloesKode(o.db, 'gaet', o.slug, o.ur.nu(), B), null);
});

test('a wrong-tenant attempt does not burn the code for its own tenant', async () => {
  const o = await opsaet();
  const kode = await opretKode(o.db, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, slug: o.slug, naeste: '/', nu: o.ur.nu(), binding: B });
  await indloesKode(o.db, kode, 'hus-bbbbbbbb', o.ur.nu(), B);
  assert.ok(await indloesKode(o.db, kode, o.slug, o.ur.nu(), B));
});

test('KC-0272 (D1): a member code is bound to the browser that asked for it; another browser cannot spend it, nor burn it', async () => {
  const o = await opsaet();
  const a = { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, slug: o.slug, naeste: '/', nu: o.ur.nu() };
  await assert.rejects(opretKode(o.db, a), /binding/, 'a member code without a binding is never made');
  const kode = await opretKode(o.db, { ...a, binding: B });
  assert.equal(await indloesKode(o.db, kode, o.slug, o.ur.nu()), null, 'no binding (the victim\'s browser)');
  assert.equal(await indloesKode(o.db, kode, o.slug, o.ur.nu(), bindingHash(nyBinding())), null, 'another browser\'s binding');
  assert.ok(await indloesKode(o.db, kode, o.slug, o.ur.nu(), B), 'the asking browser still can');
});

test('KC-0272: a binding is 32 random bytes; its hash is what travels and what the code is bound to', () => {
  const v = nyBinding();
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(nyBinding(), v);
  assert.match(bindingHash(v), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(bindingHash(v), v);
});

function app(o: Opsat, hvem: { kontoId: number; sessionId: number } | null, n = noegle(), samtykkeOk: (kontoId: number) => Promise<boolean> = async () => true) {
  const a = new Hono();
  a.route('/', loginVejRuter({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: n, ruter: ruteTabel({ db: o.db }), login: async () => hvem, samtykkeOk, nu: o.ur.nu }));
  return a;
}
const aabn = (o: Opsat, naeste = '/rum/mail', s?: string, b = B) => `/aabn?t=${o.slug}&n=${encodeURIComponent(naeste)}&b=${b}&s=${s ?? signerNaeste(noegle().naeste, o.slug, naeste, b)}`;

test('/aabn without a login sends the person to log in and back to exactly this /aabn', async () => {
  const o = await opsaet();
  const sti = aabn(o);
  const r = await app(o, null).request(sti);
  assert.equal(r.status, 303);
  const til = new URL(r.headers.get('location')!, PUBLIC);
  assert.equal(til.pathname, '/log-ind');
  assert.equal(til.searchParams.get('til'), sti);
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
});

test('/aabn for a member issues a code bound to the tenant and redirects to its exchange route', async () => {
  const o = await opsaet();
  const r = await app(o, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId }).request(aabn(o));
  assert.equal(r.status, 303);
  const til = new URL(r.headers.get('location')!);
  assert.equal(til.origin + til.pathname, `https://${o.slug}.eksempel.test/_sky/faa`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(await indloesKode(o.db, til.searchParams.get('kode')!, o.slug, o.ur.nu()), null, 'not without the binding');
  assert.deepEqual(await indloesKode(o.db, til.searchParams.get('kode')!, o.slug, o.ur.nu(), B), { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, naeste: '/rum/mail' });
});

test('KC-0272: an /aabn link without a binding (the account page, an old link) issues no code: it sends the person to the tenant, whose gateway binds the browser first', async () => {
  const o = await opsaet();
  const legacy = `/aabn?t=${o.slug}&n=${encodeURIComponent('/rum/start')}&s=${signerNaeste(noegle().naeste, o.slug, '/rum/start')}`;
  const r = await app(o, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId }).request(legacy);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `https://${o.slug}.eksempel.test/rum/start`);
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
  assert.equal((await app(o, { kontoId: o.fremmed.id, sessionId: o.fremmed.sessionId }).request(legacy)).status, 403, 'membership is still checked');
});

test('KC-0272: a binding swapped into a signed link, or a malformed one, is 400 and issues nothing', async () => {
  const o = await opsaet();
  const a = app(o, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId });
  const andet = bindingHash(nyBinding());
  for (const sti of [
    `/aabn?t=${o.slug}&n=%2Frum%2Fmail&b=${andet}&s=${signerNaeste(noegle().naeste, o.slug, '/rum/mail', B)}`,
    `/aabn?t=${o.slug}&n=%2Frum%2Fmail&b=${andet}&s=${signerNaeste(noegle().naeste, o.slug, '/rum/mail')}`,
    `/aabn?t=${o.slug}&n=%2Frum%2Fmail&b=kort&s=${signerNaeste(noegle().naeste, o.slug, '/rum/mail', 'kort')}`,
  ]) assert.equal((await a.request(sti)).status, 400, sti);
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
});

test('/aabn for a stranger is 403 and issues nothing; an unknown tenant is 404', async () => {
  const o = await opsaet();
  const r = await app(o, { kontoId: o.fremmed.id, sessionId: o.fremmed.sessionId }).request(aabn(o));
  assert.equal(r.status, 403);
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
  const ukendt = `/aabn?t=hus-zzzzzzzz&n=%2F&s=${signerNaeste(noegle().naeste, 'hus-zzzzzzzz', '/')}`;
  assert.equal((await app(o, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId }).request(ukendt)).status, 404);
});

test('/aabn with a bad or missing signature, or a bad slug, is 400 and issues nothing', async () => {
  const o = await opsaet();
  const a = app(o, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId });
  for (const sti of [aabn(o, '/rum/mail', 'x'.repeat(43)), `/aabn?t=${o.slug}&n=%2F`, '/aabn', `/aabn?t=www&n=%2F&s=${signerNaeste(noegle().naeste, 'www', '/')}`]) {
    assert.equal((await a.request(sti)).status, 400, sti);
  }
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
});

test('/aabn without the gateway key is 503', async () => {
  const o = await opsaet();
  const a = new Hono();
  a.route('/', loginVejRuter({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: null, ruter: ruteTabel({ db: o.db }), login: async () => ({ kontoId: o.ejer.id, sessionId: o.ejer.sessionId }), samtykkeOk: async () => true }));
  assert.equal((await a.request(aabn(o))).status, 503);
});

test('KC-0204: /aabn for a member whose accepted version is no longer current sends them to accept first and issues no code', async () => {
  const o = await opsaet();
  const hvem = { kontoId: o.ejer.id, sessionId: o.ejer.sessionId };
  const r = await app(o, hvem, noegle(), async () => false).request(aabn(o));
  assert.equal(r.status, 303);
  assert.equal(new URL(r.headers.get('location')!, PUBLIC).pathname, '/tilmeld');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(await antal(o.db, 'gateway.kode'), 0);
  assert.equal((await app(o, hvem, noegle(), async () => true).request(aabn(o))).status, 303, 'accepted: the normal way in');
});

test('KC-0204: the check runs for the logged-in account, and a failing check is 503 with no code (fail closed)', async () => {
  const o = await opsaet();
  const set: number[] = [];
  const hvem = { kontoId: o.ejer.id, sessionId: o.ejer.sessionId };
  await app(o, hvem, noegle(), async (id) => { set.push(id); return true; }).request(aabn(o));
  assert.deepEqual(set, [o.ejer.id]);
  const r = await app(o, hvem, noegle(), async () => { throw new Error('db nede'); }).request(aabn(o));
  assert.equal(r.status, 503);
  assert.equal(await antal(o.db, 'gateway.kode'), 1, 'only the first, accepted request issued a code');
});
