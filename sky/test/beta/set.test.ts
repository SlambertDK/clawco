// KC-0203: the retention signal. Invariants: only a beta household leaves a row (a paying customer or a hand-given
// gift leaves none); at most one row per household per UTC day, and a request costs no query once it is noted; the
// owner's account is noted whichever household member came; a failing insert is retried by the next request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noterSet } from '../../src/beta/set.ts';
import { opsaetBeta, DAG } from './hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { saetGave } from '../../src/abonnement/synk.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import type { Database } from '../../src/db/pool.ts';

function taelder(db: Database): { db: Database; antal(): number } {
  let n = 0;
  return { antal: () => n, db: { ...db, query: (async (sql: string, p?: unknown[]) => { n++; return db.query(sql, p); }) as Database['query'] } };
}
const dage = async (db: Database, id: number): Promise<string[]> =>
  (await db.query<{ dag: Date | string }>('SELECT dag FROM beta.set WHERE konto_id = $1 ORDER BY dag', [id])).map((r) => new Date(r.dag).toISOString().slice(0, 10));

test('a beta household\'s request leaves one row for today, and the second request the same day costs no query', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa');
  const t = taelder(b.db);
  const note = noterSet({ db: t.db, nu: () => b.u.nu() });
  await note('hus-aaaaaaaa');
  assert.deepEqual(await dage(b.db, id), ['2026-11-01']);
  const efter = t.antal();
  for (let i = 0; i < 50; i++) await note('hus-aaaaaaaa');
  assert.equal(t.antal(), efter, 'no query for the 50 later requests');
  await b.db.close();
});

test('a new UTC day is a new row; the in-memory set is cleared when the day changes', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa');
  const note = noterSet({ db: b.db, nu: () => b.u.nu() });
  await note('hus-aaaaaaaa');
  b.u.frem(DAG);
  await note('hus-aaaaaaaa');
  b.u.frem(DAG);
  await note('hus-aaaaaaaa');
  assert.deepEqual(await dage(b.db, id), ['2026-11-01', '2026-11-02', '2026-11-03']);
  await b.db.close();
});

test('a paying customer or a hand-given gift leaves no row, and the "not beta" answer is cached for ten minutes', async () => {
  const b = await opsaetBeta();
  const betaler = (await findEllerOpretKonto(b.db, 'betaler@example.test', b.u.nu())).konto.id;
  const haand = (await findEllerOpretKonto(b.db, 'haand@example.test', b.u.nu())).konto.id;
  await saetGave(b.db, haand, 'sky-husstand', laesPriser(), b.u.nu());
  for (const [slug, id] of [['hus-bbbbbbbb', betaler], ['hus-cccccccc', haand]] as const) {
    await b.db.query("INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, adresse, oprettet, opdateret) VALUES ($1, $2, 'lokal', 'klar', now(), now(), 'http://172.18.0.5:8750', now(), now())", [slug, id]);
  }
  const t = taelder(b.db);
  const note = noterSet({ db: t.db, nu: () => b.u.nu() });
  await note('hus-bbbbbbbb');
  await note('hus-cccccccc');
  assert.equal((await b.db.query('SELECT 1 FROM beta.set')).length, 0);
  const efter = t.antal();
  await note('hus-bbbbbbbb');
  assert.equal(t.antal(), efter, 'cached');
  b.u.frem(11 * 60_000);
  await note('hus-bbbbbbbb');
  assert.ok(t.antal() > efter, 'looked up again after ten minutes');
  await b.db.close();
});

test('the household is noted by its tenant: any member\'s visit is the owner\'s day; an unknown slug leaves nothing', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa');
  const note = noterSet({ db: b.db, nu: () => b.u.nu() });
  await note('hus-zzzzzzzz');
  assert.equal((await b.db.query('SELECT 1 FROM beta.set')).length, 0);
  await note('hus-aaaaaaaa');
  assert.deepEqual(await dage(b.db, id), ['2026-11-01']);
  await b.db.close();
});

test('a failing insert never throws into the request and is retried by the next one', async () => {
  const b = await opsaetBeta();
  const id = await b.husstand('a@example.test', 'hus-aaaaaaaa');
  let fejl = true;
  const log: string[] = [];
  const db: Database = { ...b.db, query: (async (sql: string, p?: unknown[]) => { if (fejl && /INSERT INTO beta\.set/.test(sql)) throw new Error('database nede'); return b.db.query(sql, p); }) as Database['query'] };
  const note = noterSet({ db, nu: () => b.u.nu(), log: (l) => { log.push(l); } });
  await note('hus-aaaaaaaa');
  assert.equal((await b.db.query('SELECT 1 FROM beta.set')).length, 0);
  assert.equal(log.length, 1);
  fejl = false;
  await note('hus-aaaaaaaa');
  assert.deepEqual(await dage(b.db, id), ['2026-11-01']);
  await b.db.close();
});
