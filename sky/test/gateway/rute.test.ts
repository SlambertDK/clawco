// KC-0183: which host goes where, and the route table (the fleet's own tenant rows, state klar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vaertsArt, ruteTabel } from '../../src/gateway/rute.ts';
import { opsaet } from './hjaelp.ts';

const O = { kontoVaert: 'konto.eksempel.test', basedomain: 'eksempel.test' };

test('the account host and loopback names go to Sky itself', () => {
  for (const h of ['konto.eksempel.test', 'KONTO.eksempel.test:443', 'localhost:8781', '127.0.0.1:8781', '[::1]:8781']) {
    assert.deepEqual(vaertsArt(h, O), { art: 'sky' }, h);
  }
});

test('a slug under the base domain goes to the gateway, normalised for case, port and a trailing dot', () => {
  for (const h of ['hus-abcdefgh.eksempel.test', 'HUS-ABCDEFGH.Eksempel.Test.:443', 'hus-abcdefgh.eksempel.test:8796']) {
    assert.deepEqual(vaertsArt(h, O), { art: 'tenant', slug: 'hus-abcdefgh' }, h);
  }
});

test('reserved, malformed, nested and foreign hosts are nobody (the same 404, no hint)', () => {
  for (const h of [undefined, '', 'www.eksempel.test', 'admin.eksempel.test', 'status.eksempel.test', 'eksempel.test',
    'a.hus-abcdefgh.eksempel.test', 'hus-abcdefg1.eksempel.test', 'hus-abcdefgh.andet.test', 'evil.test', 'hus-abcdefgh.eksempel.test.evil.test']) {
    assert.deepEqual(vaertsArt(h, O), { art: 'ingen' }, String(h));
  }
});

test('with the base domain localhost (dev), slug.localhost is a tenant and localhost is Sky', () => {
  const dev = { kontoVaert: 'localhost', basedomain: 'localhost' };
  assert.deepEqual(vaertsArt('hus-abcdefgh.localhost:8796', dev), { art: 'tenant', slug: 'hus-abcdefgh' });
  assert.deepEqual(vaertsArt('localhost:8796', dev), { art: 'sky' });
});

test('find returns a klar tenant with its private address and owner; anything not klar is unknown', async () => {
  const o = await opsaet('http://172.18.0.2:8750');
  const r = ruteTabel({ db: o.db });
  assert.deepEqual(await r.find(o.slug), { slug: o.slug, adresse: 'http://172.18.0.2:8750', ejerKontoId: o.ejer.id, opdateres: false });
  assert.equal(await r.find('hus-zzzzzzzz'), null);
  // KC-0186: a rollout replacing the container sets the flag the gateway turns into its update page.
  await o.db.query('UPDATE flaade.tenant SET opdateres = now() WHERE slug = $1', [o.slug]);
  r.glem(o.slug);
  assert.equal((await r.find(o.slug))?.opdateres, true);
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = $1", [o.slug]);
  r.glem(o.slug);
  assert.equal(await r.find(o.slug), null);
});

test('find caches for a few seconds; glem invalidates at once', async () => {
  const o = await opsaet('http://172.18.0.2:8750');
  let t = 0;
  const r = ruteTabel({ db: o.db, nu: () => t, ttlMs: 5_000 });
  assert.ok(await r.find(o.slug));
  await o.db.query("UPDATE flaade.tenant SET adresse = 'http://172.18.0.9:8750' WHERE slug = $1", [o.slug]);
  assert.equal((await r.find(o.slug))?.adresse, 'http://172.18.0.2:8750');
  t = 5_001;
  assert.equal((await r.find(o.slug))?.adresse, 'http://172.18.0.9:8750');
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = $1", [o.slug]);
  r.glem(o.slug);
  assert.equal(await r.find(o.slug), null);
});

test('a database error propagates (the gateway answers 503, never a cached guess)', async () => {
  const o = await opsaet();
  const r = ruteTabel({ db: { ...o.db, query: async () => { throw new Error('nede'); } } });
  await assert.rejects(r.find(o.slug), /nede/);
});

test('medlem: the owner is a member, a stranger is not, a deleted owner is not', async () => {
  const o = await opsaet();
  let t = 0;
  const r = ruteTabel({ db: o.db, nu: () => t, medlemTtlMs: 30_000 });
  assert.equal(await r.medlem(o.slug, o.ejer.id), true);
  assert.equal(await r.medlem(o.slug, o.fremmed.id), false);
  assert.equal(await r.medlem('hus-zzzzzzzz', o.ejer.id), false);
  await o.db.query('UPDATE konto SET email = NULL, slettet_ved = now() WHERE id = $1', [o.ejer.id]);
  assert.equal(await r.medlem(o.slug, o.ejer.id), true, 'cached up to 30 s');
  t = 30_001;
  assert.equal(await r.medlem(o.slug, o.ejer.id), false);
});

test('glem clears membership too', async () => {
  const o = await opsaet();
  const r = ruteTabel({ db: o.db, nu: () => 0 });
  assert.equal(await r.medlem(o.slug, o.ejer.id), true);
  await o.db.query("UPDATE flaade.tenant SET tilstand = 'afvikles' WHERE slug = $1", [o.slug]);
  r.glem(o.slug);
  assert.equal(await r.medlem(o.slug, o.ejer.id), false);
});
