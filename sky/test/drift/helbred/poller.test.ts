// KC-0189: the poller asks every klar tenant's /health over the private network, bounded in parallel, each with a
// short timeout of its own; a hung tenant holds one slot until its timeout and never blocks the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maalAlle, poller, type PollerDeps } from '../../../src/drift/helbred/poller.ts';
import { gemUdgave, gribTenant, opretUdrulning } from '../../../src/drift/udrulning/tilstand.ts';
import { nyDb } from '../../konto/hjaelp.ts';
import { komponentDeps, slugNr } from './hjaelp.ts';

const SHA = 'abc1234';
const maal = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: slugNr(i), adresse: `http://10.0.0.${i + 2}:8750`, forventetSha: SHA }));

test('bounded parallel: never more than `parallel` calls at once, and every tenant is measured', async () => {
  let samtidig = 0;
  let hoejest = 0;
  const sundhed = async () => {
    samtidig++;
    hoejest = Math.max(hoejest, samtidig);
    await new Promise((r) => setTimeout(r, 5));
    samtidig--;
    return { ok: true, sha: SHA };
  };
  const m = await maalAlle(maal(20), { sundhed, opdaterer: new Set(), tid: new Date(), parallel: 4, timeoutMs: 1_000 });
  assert.equal(m.length, 20);
  assert.equal(hoejest, 4);
  assert.ok(m.every((x) => x.tilstand === 'sund' && x.ok && x.sha === SHA && x.ms !== null));
});

test('a hung tenant times out as syg and does not block the others', async () => {
  const alle = maal(10);
  const haengt = alle[3]!;
  const sundhed = (adresse: string) => (adresse === haengt.adresse ? new Promise<never>(() => {}) : Promise.resolve({ ok: true, sha: SHA }));
  const start = performance.now();
  const m = await maalAlle(alle, { sundhed, opdaterer: new Set(), tid: new Date(), parallel: 2, timeoutMs: 60 });
  const varighed = performance.now() - start;
  assert.ok(varighed < 1_000, `took ${varighed} ms`);
  const h = m.find((x) => x.slug === haengt.slug)!;
  assert.deepEqual({ ok: h.ok, ms: h.ms, sha: h.sha, tilstand: h.tilstand }, { ok: false, ms: null, sha: null, tilstand: 'syg' });
  assert.equal(m.filter((x) => x.tilstand === 'sund').length, 9);
});

test('a throwing health call, a wrong sha and an upgrading tenant', async () => {
  const [a, b, c] = maal(3);
  const sundhed = async (adresse: string) => {
    if (adresse === a!.adresse) throw new Error('ECONNREFUSED 10.0.0.2');
    return { ok: true, sha: 'fff0000' };
  };
  const m = await maalAlle([a!, b!, c!], { sundhed, opdaterer: new Set([c!.slug]), tid: new Date(), timeoutMs: 1_000 });
  assert.deepEqual(m.map((x) => x.tilstand), ['syg', 'syg', 'opdaterer']);
});

test('a pass stores one row per tenant and one per component under one time; opdaterer comes from an active rollout step', async () => {
  const db = await nyDb();
  try {
    const nu = new Date('2026-11-02T10:00:00.000Z');
    // A rollout with one tenant mid-step.
    await gemUdgave(db, { tag: 'clawco:abc1234', sha: SHA, billedeId: `sha256:${'b'.repeat(64)}` }, nu);
    const id = await opretUdrulning(db, { udgave: 'clawco:abc1234', hold: 'alle', tenanter: [{ slug: 'hus-cccccccc', hold: 'alle' }], nu });
    assert.ok(await gribTenant(db, id, 'hus-cccccccc', nu));
    const d: PollerDeps = {
      db,
      tenanter: async () => [
        { slug: 'hus-aaaaaaaa', adresse: 'http://10.0.0.2:8750', release: SHA },
        { slug: 'hus-bbbbbbbb', adresse: 'http://10.0.0.3:8750', release: SHA },
        { slug: 'hus-cccccccc', adresse: 'http://10.0.0.4:8750', release: SHA },
        { slug: 'hus-dddddddd', adresse: null, release: SHA },
      ],
      sundhed: async (adresse) => (adresse.endsWith('.3:8750') ? { ok: false, sha: null } : { ok: true, sha: SHA }),
      komponenter: komponentDeps(db),
      nu: () => nu,
      log: () => {},
    };
    const r = await poller(d).gennemloeb();
    // A klar tenant without an address cannot be reached at all: syg, and no call is made.
    assert.deepEqual(r.antal, { sund: 1, traeg: 0, syg: 2, opdaterer: 1 });
    const rows = await db.query<{ tenant: string; tilstand: string; tid: Date | string }>('SELECT tenant, tilstand, tid FROM drift.helbred_maaling ORDER BY tenant');
    assert.deepEqual(rows.map((x) => [x.tenant, x.tilstand]), [['hus-aaaaaaaa', 'sund'], ['hus-bbbbbbbb', 'syg'], ['hus-cccccccc', 'opdaterer'], ['hus-dddddddd', 'syg']]);
    assert.ok(rows.every((x) => new Date(x.tid).getTime() === nu.getTime()));
    const [k] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM drift.helbred_komponent WHERE tid = $1', [nu.toISOString()]);
    assert.equal(k?.n, 6);
  } finally { await db.close(); }
});

test('a failing tenant list stores nothing and throws (the loop reports it; the feed then goes stale, never ok)', async () => {
  const db = await nyDb();
  try {
    const d: PollerDeps = { db, tenanter: async () => { throw new Error('db nede'); }, sundhed: async () => ({ ok: true, sha: SHA }), komponenter: komponentDeps(db), nu: () => new Date(), log: () => {} };
    await assert.rejects(poller(d).gennemloeb());
    const [k] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM drift.helbred_komponent');
    assert.equal(k?.n, 0);
  } finally { await db.close(); }
});
