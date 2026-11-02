// KC-0183: the way in. The gateway sends a person without a tenant cookie to Sky's /aabn with a signed `next`;
// Sky checks login and membership and sends them back with a one-time code (60 s, single use, bound to konto,
// session and tenant), which only the gateway's /_sky/faa exchanges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { sikkerNaeste, signerNaeste, loginUrl, tenantOrigin, opretKode, indloesKode, loginVejRuter, KODE_MS } from '../../src/gateway/login-vej.ts';
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

test('a code is exchanged once, only on its own tenant, only within 60 seconds; only its hash is stored', async () => {
  const o = await opsaet();
  const a = { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, slug: o.slug, naeste: '/rum/mail', nu: o.ur.nu() };
  assert.equal(KODE_MS, 60_000);
  const kode = await opretKode(o.db, a);
  assert.ok(!JSON.stringify(await o.db.query('SELECT * FROM gateway.kode')).includes(kode));
  assert.equal(await indloesKode(o.db, kode, 'hus-bbbbbbbb', o.ur.nu()), null, 'wrong tenant');
  assert.deepEqual(await indloesKode(o.db, kode, o.slug, o.ur.nu()), { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, naeste: '/rum/mail' });
  assert.equal(await indloesKode(o.db, kode, o.slug, o.ur.nu()), null, 'single use');

  const k2 = await opretKode(o.db, a);
  o.ur.frem(60_000);
  assert.equal(await indloesKode(o.db, k2, o.slug, o.ur.nu()), null, 'expired');
  assert.equal(await indloesKode(o.db, 'gaet', o.slug, o.ur.nu()), null);
});

test('a wrong-tenant attempt does not burn the code for its own tenant', async () => {
  const o = await opsaet();
  const kode = await opretKode(o.db, { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, slug: o.slug, naeste: '/', nu: o.ur.nu() });
  await indloesKode(o.db, kode, 'hus-bbbbbbbb', o.ur.nu());
  assert.ok(await indloesKode(o.db, kode, o.slug, o.ur.nu()));
});

function app(o: Opsat, hvem: { kontoId: number; sessionId: number } | null, n = noegle(), samtykkeOk: (kontoId: number) => Promise<boolean> = async () => true) {
  const a = new Hono();
  a.route('/', loginVejRuter({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle: n, ruter: ruteTabel({ db: o.db }), login: async () => hvem, samtykkeOk, nu: o.ur.nu }));
  return a;
}
const aabn = (o: Opsat, naeste = '/rum/mail', s?: string) => `/aabn?t=${o.slug}&n=${encodeURIComponent(naeste)}&s=${s ?? signerNaeste(noegle().naeste, o.slug, naeste)}`;

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
  assert.deepEqual(await indloesKode(o.db, til.searchParams.get('kode')!, o.slug, o.ur.nu()), { kontoId: o.ejer.id, sessionId: o.ejer.sessionId, naeste: '/rum/mail' });
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
