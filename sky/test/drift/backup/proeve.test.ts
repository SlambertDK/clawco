// KC-0185: the restore drill. Once a month Sky restores a few tenants (always the internal test tenant) into
// scratch containers with no gateway route, waits for /health, compares the restored files with the manifest
// taken at backup time, and destroys the scratch — whatever happened. The database's newest dump is opened,
// checked against its digest and read by pg_restore. Every result is stored; a failure raises an alert
// (counts only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migreretDb } from '../../hemmeligheder/hjaelp.ts';
import { falskKopiLager } from '../../../src/drift/backup/lager.ts';
import { kopierDb, kopierTenant } from '../../../src/drift/backup/koer.ts';
import { proev, proevDb, proevMaaned, proeveSkyldig, vaelg, type ProeveDeps } from '../../../src/drift/backup/proeve.ts';
import { proeverSiden } from '../../../src/drift/backup/tilstand.ts';
import { falskDump, falskNode, falskeNoegler } from './hjaelp.ts';

const A = 'hus-aaaaaaaa';
const TEST = 'hus-testtest';

async function opsaet(o: { sund?: boolean } = {}) {
  const db = await migreretDb();
  const node = falskNode({ [A]: { 'husstand.json': '{"v":1}', 'rum/x/state.json': '{}' }, [TEST]: { 'husstand.json': '{"t":1}' } });
  let n = 0;
  const log: string[] = [];
  const sundKald: string[] = [];
  const d: ProeveDeps = {
    db, lager: falskKopiLager(), node, noegler: falskeNoegler(), dump: falskDump(),
    tenanter: async () => [{ slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }, { slug: TEST, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }],
    slettedeNoegler: async () => [], nu: () => new Date('2026-11-01T03:00:00.000Z'), tilfaeldig: () => (n++).toString(16).padStart(8, '0'),
    log: (s) => log.push(s),
    sundhed: async (adresse) => { sundKald.push(adresse); return { ok: o.sund ?? true }; },
    vent: async () => {},
    sundFrist: { forsoeg: 3, ms: 1 },
    testTenant: TEST,
    tal: () => 0,
  };
  return { d, node, log, sundKald };
}

test('a good drill restores into a scratch clawco-p- container, waits for /health, matches the manifest and destroys the scratch', async () => {
  const s = await opsaet();
  const k = await kopierTenant(s.d, A);
  const r = await proev(s.d, A);
  assert.deepEqual({ ok: r.ok, trin: r.trin, snapshot: r.snapshot }, { ok: true, trin: 'sammenlignet', snapshot: k.id });
  assert.equal(s.sundKald.length, 1);
  const scratch = s.node.kald.find((x) => x.startsWith('udpak '))!.split(' ')[1]!;
  assert.match(scratch, /^clawco-p-hus-aaaaaaaa-[0-9a-f]{8}$/);
  assert.equal(s.node.gendannede.size, 0, 'scratch volume destroyed');
  assert.equal(s.node.containere.size, 0, 'scratch container destroyed');
  const [row] = await proeverSiden(s.d.db, new Date(0));
  assert.deepEqual({ ok: row!.ok, trin: row!.trin, omfang: row!.omfang }, { ok: true, trin: 'sammenlignet', omfang: A });
});

test('a restored volume that differs from the manifest fails the drill, alerts (no names), and the scratch still goes', async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  s.node.aendreGendannet = (f) => ({ ...f, 'rum/x/state.json': '{"aendret":true}' });
  const r = await proev(s.d, A);
  assert.equal(r.ok, false);
  assert.equal(r.trin, 'sund');
  assert.match(r.fejl!, /manifest/);
  assert.equal(s.node.gendannede.size, 0);
  assert.ok(s.log.some((l) => /ADVARSEL: gendannelsesprøven fejlede/.test(l)));
  for (const l of s.log) assert.ok(!/hus-/.test(l), l);
  const [row] = await proeverSiden(s.d.db, new Date(0));
  assert.equal(row!.ok, false);
});

test('a scratch container that never answers /health fails the drill and is destroyed', async () => {
  const s = await opsaet({ sund: false });
  await kopierTenant(s.d, A);
  const r = await proev(s.d, A);
  assert.deepEqual({ ok: r.ok, trin: r.trin }, { ok: false, trin: 'gendannet' });
  assert.equal(s.sundKald.length, 3);
  assert.equal(s.node.containere.size, 0);
});

test('a tenant without any copy fails the drill at the first step', async () => {
  const s = await opsaet();
  const r = await proev(s.d, A);
  assert.deepEqual({ ok: r.ok, trin: r.trin }, { ok: false, trin: 'start' });
  assert.equal(s.node.kald.length, 0);
});

test("the database drill opens the newest dump with its master-key version, checks its digest and pg_restore's reading", async () => {
  const s = await opsaet();
  await kopierDb(s.d);
  const r = await proevDb(s.d);
  assert.deepEqual({ ok: r.ok, trin: r.trin }, { ok: true, trin: 'sammenlignet' });
  assert.ok((s.d.dump as ReturnType<typeof falskDump>).kald.includes('tjek'));
});

test('the drill is due once per calendar month (UTC)', async () => {
  const s = await opsaet();
  assert.equal(await proeveSkyldig(s.d.db, new Date('2026-11-01T03:00:00Z')), true);
  await kopierTenant(s.d, A);
  await proev(s.d, A);
  assert.equal(await proeveSkyldig(s.d.db, new Date('2026-11-30T23:00:00Z')), false);
  assert.equal(await proeveSkyldig(s.d.db, new Date('2026-12-01T00:00:00Z')), true);
});

test('the pick always includes the internal test tenant, then random others with a copy, never more than asked', () => {
  assert.deepEqual(vaelg(['hus-a', 'hus-b', 'hus-c'], 'hus-c', 1, () => 0), ['hus-c', 'hus-a']);
  assert.deepEqual(vaelg(['hus-a', 'hus-b'], null, 1, () => 0.99), ['hus-b']);
  assert.deepEqual(vaelg(['hus-a'], 'hus-x', 2, () => 0), ['hus-a'], 'a test tenant without a copy cannot be drilled');
});

test('the monthly drill runs the picks and the database, logs counts only', async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  await kopierTenant(s.d, TEST);
  await kopierDb(s.d);
  const r = await proevMaaned(s.d);
  assert.deepEqual(r, { ok: 3, fejlede: 0 });
  assert.equal((await proeverSiden(s.d.db, new Date(0))).length, 3);
  assert.ok(s.log.some((l) => /gendannelsesprøve: 3 ok, 0 fejlede/.test(l)), s.log.join('\n'));
  for (const l of s.log) assert.ok(!/hus-/.test(l), l);
});

test('a database dump that no longer matches its recorded checksum fails the drill and alerts', async () => {
  const s = await opsaet();
  const k = await kopierDb(s.d);
  await s.d.db.query("UPDATE drift.snapshot SET manifest = repeat('0', 64) WHERE id = $1", [k.id]);
  const r = await proevDb(s.d);
  assert.deepEqual({ ok: r.ok, trin: r.trin }, { ok: false, trin: 'aabnet' });
  assert.match(r.fejl!, /kontrolsum/);
  assert.ok(s.log.some((l) => /ADVARSEL: gendannelsesprøven fejlede efter trinnet aabnet \(databasen\)/.test(l)));
});
