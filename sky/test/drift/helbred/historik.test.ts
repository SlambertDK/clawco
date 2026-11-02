// KC-0189: history. Raw passes are kept 7 days, rolled into one row per component per day kept 90 days; the daily
// clean-up is logged with its counts. Uptime is the share of expected passes that were ok: a missing pass (Sky was
// down) and an unknown status both count against it, never for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dage90, forventedePas, gemPass, noterPost, oppetid, oppetid90, rydOp, DAG_DAGE, RAA_DAGE } from '../../../src/drift/helbred/historik.ts';
import { KOMPONENTER, type KomponentId } from '../../../src/drift/helbred/komponenter.ts';
import type { Status } from '../../../src/drift/helbred/vurder.ts';
import { nyDb } from '../../konto/hjaelp.ts';
import type { Database } from '../../../src/db/pool.ts';

const DAG = 86_400_000;
const alle = (s: Status): Record<KomponentId, Status> => Object.fromEntries(KOMPONENTER.map((k) => [k, s])) as Record<KomponentId, Status>;

async function pas(db: Database, tid: Date, s: Partial<Record<KomponentId, Status>> = {}): Promise<void> {
  await gemPass(db, tid, [{ slug: 'hus-aaaaaaaa', tid, ok: true, ms: 12, sha: 'abc1234', tilstand: 'sund' }], { ...alle('ok'), ...s });
}

test('uptime arithmetic: ok over expected, unknown and missing count against, no data is null', () => {
  assert.equal(oppetid([{ ok: 1440, nedsat: 0, nede: 0, ukendt: 0 }]), 100);
  assert.equal(oppetid([{ ok: 1430, nedsat: 5, nede: 5, ukendt: 0 }, { ok: 1440, nedsat: 0, nede: 0, ukendt: 0 }]), 99.65);
  assert.equal(oppetid([{ ok: 720, nedsat: 0, nede: 0, ukendt: 720 }]), 50);
  assert.equal(oppetid([]), null);
  assert.equal(oppetid([{ ok: 0, nedsat: 0, nede: 0, ukendt: 0 }]), null);
});

test('expected passes: a whole day is 1440; the first day counts from the first pass; today counts to now', () => {
  const dag = new Date('2026-11-01T00:00:00.000Z');
  assert.equal(forventedePas(dag, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-11-03T00:00:00.000Z')), 1440);
  assert.equal(forventedePas(dag, new Date('2026-11-01T12:00:00.000Z'), new Date('2026-11-03T00:00:00.000Z')), 720);
  assert.equal(forventedePas(dag, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-11-01T06:00:30.000Z')), 360);
});

test('the rollup: whole days into one row per component, raw rows older than 7 days deleted, idempotent, logged', async () => {
  const db = await nyDb();
  try {
    const start = new Date('2026-08-01T00:00:00.000Z');
    // Ten passes on Aug 1 (two nede for login).
    for (let i = 0; i < 10; i++) await pas(db, new Date(start.getTime() + i * 60_000), i < 2 ? { login: 'nede' } : {});
    await noterPost(db, { tid: start, ok: true, kode: null });
    const linjer: string[] = [];
    const nu = new Date('2026-08-02T00:05:00.000Z');
    const r = await rydOp(db, nu, (l) => linjer.push(l));
    assert.equal(r.dage, 1);
    const login = await db.query<{ ok: number; nede: number; ukendt: number }>("SELECT ok, nede, ukendt FROM drift.helbred_dag WHERE komponent = 'login' AND dag = '2026-08-01'");
    // 1440 passes expected that day, 10 recorded: the other 1430 minutes count as unknown.
    assert.deepEqual(login.map((x) => [x.ok, x.nede, x.ukendt]), [[8, 2, 1430]]);
    assert.equal(r.slettet.maalinger, 0, 'Aug 1 is within 7 days of Aug 2');
    // Again the same night: idempotent, nothing new.
    const igen = await rydOp(db, nu, () => {});
    assert.equal(igen.dage, 0);
    assert.equal((await db.query("SELECT * FROM drift.helbred_dag WHERE komponent = 'login'")).length, 1);
    // Eight days later the raw rows go; the day row stays; the days with no pass at all are rolled as unknown.
    const senere = new Date(start.getTime() + (RAA_DAGE + 1) * DAG + 600_000);
    const r2 = await rydOp(db, senere, (l) => linjer.push(l));
    assert.equal(r2.dage, RAA_DAGE);
    assert.equal(r2.slettet.maalinger, 10);
    assert.equal(r2.slettet.komponenter, 10 * KOMPONENTER.length);
    assert.equal(r2.slettet.post, 1);
    assert.equal((await db.query("SELECT * FROM drift.helbred_dag WHERE dag = '2026-08-01'")).length, KOMPONENTER.length);
    const tom = await db.query<{ ok: number; ukendt: number }>("SELECT ok, ukendt FROM drift.helbred_dag WHERE komponent = 'login' AND dag = '2026-08-05'");
    assert.deepEqual(tom.map((x) => [x.ok, x.ukendt]), [[0, 1440]]);
    assert.equal(linjer.length, 2);
    assert.match(linjer[1]!, /slettet 10 målinger/);
  } finally { await db.close(); }
});

test('day rows older than 90 days are deleted (logged with the count)', async () => {
  const db = await nyDb();
  try {
    const nu = new Date('2026-11-02T00:05:00.000Z');
    const gammel = new Date(nu.getTime() - (DAG_DAGE + 1) * DAG).toISOString().slice(0, 10);
    const inden = new Date(nu.getTime() - (DAG_DAGE - 1) * DAG).toISOString().slice(0, 10);
    await db.query("INSERT INTO drift.helbred_dag (dag, komponent, ok, nedsat, nede, ukendt) VALUES ($1, 'login', 1440, 0, 0, 0), ($2, 'login', 1440, 0, 0, 0)", [gammel, inden]);
    const linjer: string[] = [];
    const r = await rydOp(db, nu, (l) => linjer.push(l));
    assert.equal(r.slettet.dage, 1);
    assert.deepEqual((await db.query<{ dag: string }>("SELECT to_char(dag, 'YYYY-MM-DD') AS dag FROM drift.helbred_dag WHERE ok = 1440")).map((x) => x.dag), [inden]);
    assert.ok(linjer.some((l) => /slettet .*1 dagsrække/.test(l)));
  } finally { await db.close(); }
});

test('uptime over 90 days: day rows plus today live from the raw passes', async () => {
  const db = await nyDb();
  try {
    await db.query("INSERT INTO drift.helbred_dag (dag, komponent, ok, nedsat, nede, ukendt) VALUES ('2026-11-01', 'mail', 1440, 0, 0, 0), ('2026-07-01', 'mail', 0, 0, 1440, 0)");
    const idag = new Date('2026-11-02T00:00:00.000Z');
    for (let i = 0; i < 10; i++) await pas(db, new Date(idag.getTime() + i * 60_000), i < 5 ? { mail: 'nede' } : {});
    const nu = new Date('2026-11-02T00:10:00.000Z');
    const o = await oppetid90(db, nu);
    // Nov 1: 1440 ok; today: 5 ok of 10 expected; July is outside the window.
    assert.equal(o.mail, Math.round(((1440 + 5) / 1450) * 10_000) / 100);
    assert.equal(o.login, Math.round(((10) / 10) * 10_000) / 100);
  } finally { await db.close(); }
});

test('dage90: 90 entries per component, oldest first, ending today; a full day, a day with nede, a day with no row (null)', async () => {
  const db = await nyDb();
  try {
    await db.query(`INSERT INTO drift.helbred_dag (dag, komponent, ok, nedsat, nede, ukendt) VALUES
      ('2026-11-01', 'mail', 1440, 0, 0, 0),
      ('2026-10-31', 'mail', 1000, 0, 440, 0),
      ('2026-10-29', 'mail', 720, 0, 0, 720)`);
    const idag = new Date('2026-11-02T00:00:00.000Z');
    for (let i = 0; i < 10; i++) await pas(db, new Date(idag.getTime() + i * 60_000), i < 5 ? { mail: 'nede' } : {});
    const nu = new Date('2026-11-02T00:10:00.000Z');
    const d = await dage90(db, nu);
    assert.deepEqual(Object.keys(d).sort(), [...KOMPONENTER].sort());
    for (const k of KOMPONENTER) {
      assert.equal(d[k].length, DAG_DAGE, `${k}: 90 entries`);
      assert.equal(d[k].at(-1)!.dag, '2026-11-02', 'ends today');
      assert.equal(d[k][0]!.dag, '2026-08-05', 'starts 89 days earlier');
      for (let i = 1; i < d[k].length; i++) assert.ok(d[k][i - 1]!.dag < d[k][i]!.dag, 'oldest first, one per day');
      assert.ok(d[k].every((x) => /^\d{4}-\d\d-\d\d$/.test(x.dag) && (x.oppetid === null || (x.oppetid >= 0 && x.oppetid <= 100))));
    }
    const mail = Object.fromEntries(d.mail.map((x) => [x.dag, x.oppetid]));
    assert.equal(mail['2026-11-01'], 100, 'a fully ok day');
    assert.equal(mail['2026-10-31'], Math.round((1000 / 1440) * 10_000) / 100, 'a day with nede');
    assert.equal(mail['2026-10-30'], null, 'a day with no row is unknown to the series, never 100');
    assert.equal(mail['2026-10-29'], 50, 'a day with missing passes counts them against');
    assert.equal(mail['2026-11-02'], 50, 'today is live from the raw passes: 5 ok of 10');
    assert.equal(d.login.at(-1)!.oppetid, 100);
    assert.equal(d.login[0]!.oppetid, null);
    // oppetid90 still equals the uptime over the same rows.
    const o = await oppetid90(db, nu);
    assert.equal(o.mail, Math.round(((1440 + 1000 + 720 + 5) / (1440 + 1440 + 1440 + 10)) * 10_000) / 100);
  } finally { await db.close(); }
});

test('dage90: with no data at all every day is null', async () => {
  const db = await nyDb();
  try {
    const d = await dage90(db, new Date('2026-11-02T10:00:00.000Z'));
    for (const k of KOMPONENTER) { assert.equal(d[k].length, 90); assert.ok(d[k].every((x) => x.oppetid === null)); }
  } finally { await db.close(); }
});
