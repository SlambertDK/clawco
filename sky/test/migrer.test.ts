import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrer, MIGRATIONS_DIR } from '../src/db/migrer.ts';
import { pgliteDatabase } from './pglite.ts';

async function mappe(filer: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sky-migrer-'));
  for (const [navn, sql] of Object.entries(filer)) await fs.writeFile(path.join(dir, navn), sql);
  return dir;
}

const GRUNDLAG = 'CREATE TABLE schema_version (version integer PRIMARY KEY, navn text NOT NULL, anvendt timestamptz NOT NULL DEFAULT now());';
const TO = {
  '0001-grundlag.sql': GRUNDLAG,
  // Two statements, and not idempotent: applying it twice would fail on CREATE TABLE.
  '0002-noter.sql': 'CREATE TABLE noter (id serial PRIMARY KEY, tekst text NOT NULL);\nINSERT INTO noter (tekst) VALUES (\'første\');',
};

test('applies the migrations in order and records each in schema_version', async () => {
  const db = await pgliteDatabase();
  const r = await migrer(db, await mappe(TO));
  assert.deepEqual(r, { anvendt: [1, 2], version: 2 });
  const rows = await db.query<{ version: number; navn: string }>('SELECT version, navn FROM schema_version ORDER BY version');
  assert.deepEqual(rows.map((x) => [x.version, x.navn]), [[1, '0001-grundlag.sql'], [2, '0002-noter.sql']]);
  assert.deepEqual((await db.query('SELECT tekst FROM noter')).map((x) => x['tekst']), ['første']);
  await db.close();
});

test('running twice is a no-op', async () => {
  const db = await pgliteDatabase();
  const dir = await mappe(TO);
  await migrer(db, dir);
  assert.deepEqual(await migrer(db, dir), { anvendt: [], version: 2 });
  assert.equal((await db.query('SELECT tekst FROM noter')).length, 1);
  await db.close();
});

test('a new migration on top of an applied set applies only the new one', async () => {
  const db = await pgliteDatabase();
  await migrer(db, await mappe({ '0001-grundlag.sql': GRUNDLAG }));
  assert.deepEqual(await migrer(db, await mappe(TO)), { anvendt: [2], version: 2 });
  await db.close();
});

test('two concurrent runners do not both apply', async () => {
  const db = await pgliteDatabase();
  const dir = await mappe(TO);
  const [a, b] = await Promise.all([migrer(db, dir), migrer(db, dir)]);
  assert.deepEqual([...a.anvendt, ...b.anvendt].sort(), [1, 2]);
  assert.equal((await db.query('SELECT tekst FROM noter')).length, 1);
  await db.close();
});

test('a failing migration applies nothing (all or nothing)', async () => {
  const db = await pgliteDatabase();
  await assert.rejects(migrer(db, await mappe({ ...TO, '0003-fejl.sql': 'CREATE TABLE ok3 (id int);\nSELECT * FROM findes_ikke;' })));
  assert.deepEqual(await db.query("SELECT to_regclass('schema_version') AS t"), [{ t: null }]);
  await db.close();
});

test('the real migrations bring an empty database to version 16 (0002 = konti, KC-0177; 0003 = abonnement, KC-0191/KC-0192; 0004 = fleet, KC-0182; 0005 = hemmeligheder, KC-0181; 0006 = gateway, KC-0183; 0007 = tilmelding, KC-0198; 0008 = backup, KC-0185; 0009 = sletning, KC-0206; 0010 = udrulning, KC-0186; 0011 = forbrugerret, KC-0209; 0012 = stoette, KC-0188; 0013 = udsendte_mails, KC-0196; 0014 = helbred, KC-0189; 0015 = medlemskab, KC-0184; 0016 = mailvalg, KC-0200)', async () => {
  const db = await pgliteDatabase();
  assert.deepEqual(await migrer(db, MIGRATIONS_DIR), { anvendt: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], version: 16 });
  for (const t of ['abonnement.kunde', 'abonnement.stripe_haendelser', 'abonnement.rettigheder', 'abonnement.rettigheds_haendelser', 'flaade.tenant', 'hemmeligheder.tenant_noegle', 'gateway.kode', 'drift.kopi', 'drift.snapshot', 'drift.proeve', 'eksportlink', 'sletkvittering', 'udsendte_mails', 'drift.helbred_maaling', 'drift.helbred_komponent', 'drift.helbred_dag', 'drift.helbred_post', 'drift.helbred_haendelse', 'medlemskab', 'invitation', 'mailvalg']) {
    assert.deepEqual(await db.query('SELECT to_regclass($1)::text AS t', [t]), [{ t }]);
  }
  await db.close();
});

test('a misnamed, duplicate or missing migration number refuses to run', async () => {
  const db = await pgliteDatabase();
  await assert.rejects(migrer(db, await mappe({ '0001-grundlag.sql': GRUNDLAG, '2-noter.sql': 'SELECT 1;' })), /2-noter\.sql/);
  await assert.rejects(migrer(db, await mappe({ '0001-grundlag.sql': GRUNDLAG, '0001-igen.sql': 'SELECT 1;' })), /0001/);
  await assert.rejects(migrer(db, await mappe({ '0001-grundlag.sql': GRUNDLAG, '0003-hul.sql': 'SELECT 1;' })), /0002/);
  assert.deepEqual(await db.query("SELECT to_regclass('schema_version') AS t"), [{ t: null }]);
  await db.close();
});

test('a database newer than the code refuses to run (no silent rollback)', async () => {
  const db = await pgliteDatabase();
  await migrer(db, await mappe(TO));
  await assert.rejects(migrer(db, await mappe({ '0001-grundlag.sql': GRUNDLAG })), /nyere/);
  await db.close();
});
