// KC-0185: one night's run. A tenant's volume is read (read-only), sealed under its own backup key and
// uploaded; the state is recorded; only after a success are copies older than 30 days pruned. A failed run
// deletes nothing and records the attempt. Deprovisioned tenants are skipped; a deleted tenant's copies go on
// its key's purge date. Logs and alerts carry counts only — never a key, never a tenant name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { migreretDb, former } from '../../hemmeligheder/hjaelp.ts';
import { falskKopiLager } from '../../../src/drift/backup/lager.ts';
import { aabn, kekVersion } from '../../../src/drift/backup/krypto.ts';
import { manifestFraTar } from '../../../src/drift/backup/manifest.ts';
import { kopierDb, kopierTenant, koerNat, objektNoegle } from '../../../src/drift/backup/koer.ts';
import { kopiTilstand, snapshotsFor } from '../../../src/drift/backup/tilstand.ts';
import { snapshotId } from '../../../src/drift/backup/opbevaring.ts';
import type { KopiDeps } from '../../../src/drift/backup/typer.ts';
import { falskDump, falskNode, falskeNoegler } from './hjaelp.ts';

const DAG = 86_400_000;
const A = 'hus-aaaaaaaa';
const B = 'hus-bbbbbbbb';

async function opsaet(o: { nu?: string; tenanter?: { slug: string; tilstand: string; siden: Date }[] } = {}) {
  const db = await migreretDb();
  const lager = falskKopiLager();
  const node = falskNode({ [A]: { 'husstand.json': '{"personer":[]}', 'rum/dagen/state.json': '{"a":1}' }, [B]: { 'husstand.json': '{}' } });
  const noegler = falskeNoegler();
  const dump = falskDump();
  let nu = new Date(o.nu ?? '2026-11-01T03:00:00.000Z');
  let n = 0;
  const log: string[] = [];
  const slettede: { tenant: string; destrueres: Date | null; destrueret: boolean }[] = [];
  const d: KopiDeps = {
    db, lager, node, noegler, dump,
    tenanter: async () => o.tenanter ?? [{ slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }],
    slettedeNoegler: async () => slettede,
    nu: () => nu,
    tilfaeldig: () => (n++).toString(16).padStart(8, '0'),
    log: (s) => log.push(s),
  };
  return { d, db, lager, node, noegler, dump, log, slettede, saetNu: (s: Date) => { nu = s; } };
}

test("a tenant's copy is its volume as a gzip'd tar, sealed under its own key, at tenant/<slug>/<id>.ckb", async () => {
  const s = await opsaet();
  const r = await kopierTenant(s.d, A);
  assert.equal(r.id, '20261101T030000Z-00000000');
  const noegle = objektNoegle(A, r.id);
  assert.equal(noegle, `tenant/${A}/20261101T030000Z-00000000.ckb`);
  const blob = (await s.lager.hent(noegle))!;
  const tar = gunzipSync(aabn({ aaben: () => s.noegler.tenantNoegler.get(A)! }, { omfang: A, id: r.id }, blob));
  assert.deepEqual(manifestFraTar(tar), { antal: 2, digest: r.manifest.digest });
  assert.deepEqual(s.node.kald, [`pak ${A}`], 'read only: nothing else asked of the node');
  const t = (await kopiTilstand(s.db)).get(A)!;
  assert.deepEqual(t.sidsteSucces, new Date('2026-11-01T03:00:00Z'));
  assert.equal(t.snapshot, r.id);
  assert.equal(t.bytes, blob.length);
  assert.deepEqual((await snapshotsFor(s.db, A)).map((x) => [x.id, x.antalFiler, x.manifest]), [[r.id, 2, r.manifest.digest]]);
});

test("one tenant's copy does not open with another tenant's key", async () => {
  const s = await opsaet();
  const r = await kopierTenant(s.d, A);
  await s.noegler.tenant(B);
  const blob = (await s.lager.hent(objektNoegle(A, r.id)))!;
  assert.throws(() => aabn({ aaben: () => s.noegler.tenantNoegler.get(B)! }, { omfang: A, id: r.id }, blob), /kopien kunne ikke åbnes/);
});

test('a failed run deletes nothing: the old copies stay, the attempt and its error are recorded', async () => {
  const s = await opsaet();
  const gammel = snapshotId(new Date(Date.parse('2026-11-01T03:00:00Z') - 40 * DAG), 'aaaaaaaa');
  await s.lager.put(objektNoegle(A, gammel), Buffer.from('gammel kopi'));
  s.node.fejlNaeste('pak');
  await assert.rejects(kopierTenant(s.d, A), /falsk pak-fejl/);
  assert.deepEqual((await s.lager.liste(`tenant/${A}/`)).map((x) => x.noegle), [objektNoegle(A, gammel)]);
  const t = (await kopiTilstand(s.db)).get(A)!;
  assert.equal(t.sidsteSucces, null);
  assert.deepEqual(t.sidsteForsoeg, new Date('2026-11-01T03:00:00Z'));
  assert.match(t.sidsteFejl!, /falsk pak-fejl/);
});

test('an upload that fails records no snapshot and prunes nothing', async () => {
  const s = await opsaet();
  const gammel = snapshotId(new Date(Date.parse('2026-11-01T03:00:00Z') - 40 * DAG), 'aaaaaaaa');
  await s.lager.put(objektNoegle(A, gammel), Buffer.from('gammel kopi'));
  const put = s.lager.put;
  s.lager.put = async () => { throw new Error('R2 upload fejlede: 503'); };
  await assert.rejects(kopierTenant(s.d, A), /503/);
  s.lager.put = put;
  assert.deepEqual(await snapshotsFor(s.db, A), []);
  assert.equal((await s.lager.liste(`tenant/${A}/`)).length, 1);
});

test('after a success, copies older than 30 days go (object and row); younger ones stay', async () => {
  const s = await opsaet();
  const t0 = Date.parse('2026-11-01T03:00:00Z');
  const gammel = snapshotId(new Date(t0 - 30 * DAG - 1000), 'aaaaaaaa');
  const ung = snapshotId(new Date(t0 - 29 * DAG), 'bbbbbbbb');
  await s.lager.put(objektNoegle(A, gammel), Buffer.from('1'));
  await s.lager.put(objektNoegle(A, ung), Buffer.from('2'));
  const r = await kopierTenant(s.d, A);
  assert.deepEqual((await s.lager.liste(`tenant/${A}/`)).map((x) => x.noegle), [objektNoegle(A, ung), objektNoegle(A, r.id)]);
});

test('the control-plane dump is sealed under the master-derived key with its version, at db/<id>.ckb', async () => {
  const s = await opsaet();
  const r = await kopierDb(s.d);
  const blob = (await s.lager.hent(objektNoegle('db', r.id)))!;
  assert.equal(kekVersion(blob), 1);
  const dump = gunzipSync(aabn(s.noegler.db(1).noegle, { omfang: 'db', id: r.id }, blob));
  assert.equal(dump.toString(), 'PGDMP falsk dump');
  assert.equal(r.manifest.digest, createHash('sha256').update(dump).digest('hex'));
  assert.ok((await kopiTilstand(s.db)).get('db')!.sidsteSucces);
});

test('the night run copies the due live tenants and the database, skips deprovisioned ones, logs counts only', async () => {
  const s = await opsaet({
    nu: '2026-11-01T12:00:00.000Z',
    tenanter: [
      { slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') },
      { slug: B, tilstand: 'afvikles', siden: new Date('2026-10-01T00:00:00Z') },
      { slug: 'hus-cccccccc', tilstand: 'bestilt', siden: new Date('2026-10-01T00:00:00Z') },
    ],
  });
  const r = await koerNat(s.d);
  assert.deepEqual({ ok: r.ok, fejlede: r.fejlede }, { ok: 2, fejlede: 0 });
  assert.deepEqual(s.node.kald, [`pak ${A}`]);
  assert.deepEqual(s.dump.kald, ['dump']);
  const igen = await koerNat(s.d);
  assert.deepEqual({ ok: igen.ok, fejlede: igen.fejlede }, { ok: 0, fejlede: 0 }, 'done for tonight');
  for (const l of s.log) assert.ok(!/hus-/.test(l), `a log line names a tenant: ${l}`);
});

test('a failing tenant does not stop the others; a scope late for 36 hours raises a count-only alert', async () => {
  const s = await opsaet({
    nu: '2026-11-03T12:00:00.000Z',
    tenanter: [
      { slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') },
      { slug: 'hus-dddddddd', tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') },
    ],
  });
  const r = await koerNat(s.d);
  assert.deepEqual({ ok: r.ok, fejlede: r.fejlede, forsinkede: r.forsinkede }, { ok: 2, fejlede: 1, forsinkede: 1 });
  assert.ok(s.log.some((l) => /ADVARSEL: 1 sikkerhedskopi uden succes i over 36 timer/.test(l)), s.log.join('\n'));
  for (const l of s.log) assert.ok(!/hus-/.test(l), `a log line names a tenant: ${l}`);
});

test("a deleted tenant's copies stay until its key's purge date, then all of them go (objects and rows)", async () => {
  const s = await opsaet();
  const r = await kopierTenant(s.d, A);
  const purge = new Date(Date.parse('2026-11-01T03:00:00Z') + 30 * DAG);
  s.slettede.push({ tenant: A, destrueres: purge, destrueret: false });
  const tenanter = async () => [{ slug: A, tilstand: 'slettet', siden: new Date('2026-10-01T00:00:00Z') }];
  s.d.tenanter = tenanter;
  s.saetNu(new Date(purge.getTime() - 1));
  assert.equal((await koerNat(s.d)).purget, 0);
  assert.ok(await s.lager.hent(objektNoegle(A, r.id)));
  s.saetNu(purge);
  assert.equal((await koerNat(s.d)).purget, 1);
  assert.equal(await s.lager.hent(objektNoegle(A, r.id)), null);
  assert.deepEqual(await snapshotsFor(s.db, A), []);
});

test('no key in any form reaches a log line or a stored row', async () => {
  const s = await opsaet({ nu: '2026-11-03T12:00:00.000Z' });
  s.node.fejlNaeste('pak');
  await koerNat(s.d);
  await koerNat({ ...s.d, nu: () => new Date('2026-11-03T14:00:00Z') });
  const rows = JSON.stringify([...(await s.db.query('SELECT * FROM drift.kopi')), ...(await s.db.query('SELECT * FROM drift.snapshot'))]);
  const alt = `${s.log.join('\n')}\n${rows}`;
  for (const k of [...s.noegler.tenantNoegler.values(), ...s.noegler.dbNoegler.values()]) {
    for (const f of former(k)) assert.ok(!alt.includes(f), 'a key form leaked');
  }
});
