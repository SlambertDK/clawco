import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helbred } from '../src/helbred.ts';
import { createSkyApp } from '../src/server.ts';
import fs from 'node:fs';
import { migrer, MIGRATIONS_DIR } from '../src/db/migrer.ts';
import type { Database } from '../src/db/pool.ts';
import { pgliteDatabase } from './pglite.ts';

const nede = (fejl: () => Promise<never>): Database => ({
  query: fejl, exec: fejl, transaction: fejl, close: async () => {},
});

test('health on a migrated database has exactly the agreed shape', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const h = await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 63_400 });
  const version = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;
  assert.deepEqual(h, { ok: true, sha: 'abc1234', uptimeSec: 62, db: { ok: true, version } });
  await db.close();
});

test('an empty (unmigrated) database answers, but is not ok', async () => {
  const db = await pgliteDatabase();
  const h = await helbred({ db, sha: 'abc1234', startet: Date.now() });
  assert.deepEqual({ ok: h.ok, db: h.db }, { ok: false, db: { ok: false, version: null } });
  await db.close();
});

test('a database that refuses gives ok:false and still answers', async () => {
  const h = await helbred({ db: nede(async () => { throw new Error('ECONNREFUSED 127.0.0.1:5432 password=hemmelig'); }), sha: 'abc1234', startet: Date.now() });
  assert.deepEqual({ ok: h.ok, db: h.db, sha: h.sha }, { ok: false, db: { ok: false, version: null }, sha: 'abc1234' });
  assert.ok(!JSON.stringify(h).includes('hemmelig'), 'health viser fejlteksten fra databasen');
});

test('a database that hangs gives ok:false within the timeout', async () => {
  const start = Date.now();
  const h = await helbred({ db: nede(() => new Promise<never>(() => {})), sha: 'x', startet: start, timeoutMs: 50 });
  assert.equal(h.db.ok, false);
  assert.ok(Date.now() - start < 1000);
});

test('GET /health answers 200 with the JSON when ok, 503 with the same shape when the database is down', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const op = await createSkyApp({ db, sha: 'abc1234', startet: Date.now() }).request('/health');
  assert.equal(op.status, 200);
  assert.deepEqual(Object.keys(await op.json() as object).sort(), ['db', 'ok', 'sha', 'uptimeSec']);
  await db.close();

  const ned = await createSkyApp({ db: nede(async () => { throw new Error('nede'); }), sha: 'abc1234', startet: Date.now() }).request('/health');
  assert.equal(ned.status, 503);
  const body = await ned.json() as { ok: boolean; db: { ok: boolean } };
  assert.equal(body.ok, false);
  assert.equal(body.db.ok, false);
});

test('anything but /health is 404 (no other surface yet)', async () => {
  const db = await pgliteDatabase();
  const r = await createSkyApp({ db, sha: 'x', startet: Date.now() }).request('/');
  assert.equal(r.status, 404);
  await db.close();
});

test('KC-0182: health names the fleet driver when one is chosen (and only its name)', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const h = await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 2_000, flaade: 'lokal' });
  assert.equal(h.flaade, 'lokal');
  assert.equal('flaade' in (await helbred({ db, sha: 'abc1234', startet: 1_000 })), false);
  await db.close();
});

test('KC-0181: health reports the master key as ok or mangler (a word, never a value); with a fleet a missing key is 503', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const mangler = await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 2_000, flaade: 'lokal', noegler: 'mangler' });
  assert.equal(mangler.noegler, 'mangler');
  assert.equal(mangler.ok, false);
  assert.equal((await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 2_000, flaade: 'lokal', noegler: 'ok' })).ok, true);
  // Without a fleet nothing needs the key: reported, not fatal.
  const ingenFlaade = await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 2_000, noegler: 'mangler' });
  assert.deepEqual({ ok: ingenFlaade.ok, noegler: ingenFlaade.noegler }, { ok: true, noegler: 'mangler' });
  assert.equal('noegler' in (await helbred({ db, sha: 'abc1234', startet: 1_000 })), false);
  const app = createSkyApp({ db, sha: 'x', startet: Date.now(), flaade: 'lokal', noegler: 'mangler' });
  const r = await app.request('/health');
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as { noegler?: string }).noegler, 'mangler');
  await db.close();
});

test('KC-0183: health reports the gateway key as ok or mangler (a word, never a value); with a fleet a missing key is 503', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  const mangler = await helbred({ db, sha: 'abc1234', startet: 1_000, nu: () => 2_000, flaade: 'lokal', noegler: 'ok', gateway: 'mangler' });
  assert.deepEqual({ ok: mangler.ok, gateway: mangler.gateway }, { ok: false, gateway: 'mangler' });
  assert.equal((await helbred({ db, sha: 'abc1234', startet: 1_000, flaade: 'lokal', noegler: 'ok', gateway: 'ok' })).ok, true);
  const ingenFlaade = await helbred({ db, sha: 'abc1234', startet: 1_000, gateway: 'mangler' });
  assert.deepEqual({ ok: ingenFlaade.ok, gateway: ingenFlaade.gateway }, { ok: true, gateway: 'mangler' });
  assert.equal('gateway' in (await helbred({ db, sha: 'abc1234', startet: 1_000 })), false);
  const r = await createSkyApp({ db, sha: 'x', startet: Date.now(), flaade: 'lokal', noegler: 'ok', gateway: 'mangler' }).request('/health');
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as { gateway?: string }).gateway, 'mangler');
  await db.close();
});

test('KC-0217: health says noegleskift: forberedt while SKY_KONTO_PUBKEY_NY is set (one word, no key); never otherwise', async () => {
  const db = await pgliteDatabase();
  await migrer(db);
  assert.equal((await helbred({ db, sha: 'abc1234', startet: 1_000, flaade: 'lokal', noegler: 'ok', gateway: 'ok', noegleskift: 'forberedt' })).noegleskift, 'forberedt');
  assert.equal('noegleskift' in (await helbred({ db, sha: 'abc1234', startet: 1_000, flaade: 'lokal', noegler: 'ok', gateway: 'ok' })), false);
  const r = await createSkyApp({ db, sha: 'x', startet: Date.now(), flaade: 'lokal', noegler: 'ok', gateway: 'ok', noegleskift: 'forberedt' }).request('/health');
  assert.equal(r.status, 200, 'a rotation in progress is not a fault');
  assert.equal(((await r.json()) as { noegleskift?: string }).noegleskift, 'forberedt');
  assert.equal('noegleskift' in ((await (await createSkyApp({ db, sha: 'x', startet: Date.now() }).request('/health')).json()) as object), false);
  await db.close();
});
