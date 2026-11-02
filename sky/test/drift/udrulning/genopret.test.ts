// KC-0186: an upgrade's restore point is the same sealed tenant copy as the nightly backup (KC-0185: the volume's
// tar, gzip'd, AES-GCM under the tenant's own backup key), stored through the KopiLager seam — in R2 when it is set
// up, else in a local directory store (not offsite, and said so). One code path, tested here with both stores. It is
// never recorded as a nightly copy, and it is pruned 7 days after its rollout ended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { aabn } from '../../../src/drift/backup/krypto.ts';
import { falskKopiLager, lokalKopiLager, type KopiLager } from '../../../src/drift/backup/lager.ts';
import { manifestFraTar } from '../../../src/drift/backup/manifest.ts';
import { genopretNoegle, genopretningspunkt, rydGenopretning } from '../../../src/drift/udrulning/genopret.ts';
import { migreretDb } from '../../hemmeligheder/hjaelp.ts';
import { falskNode, falskeNoegler, tar } from '../backup/hjaelp.ts';

const A = 'hus-aaaaaaaa';
const FILER = { 'husstand.json': '{"personer":[]}', 'rum/dagen/state.json': '{"a":1}' };

function lagre(art: 'falsk' | 'lokal'): { lager: KopiLager; ryd(): void } {
  if (art === 'falsk') return { lager: falskKopiLager(), ryd() {} };
  const rod = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-genopret-'));
  return { lager: lokalKopiLager(path.join(rod, 'kopier')), ryd() { fs.rmSync(rod, { recursive: true, force: true }); } };
}

for (const art of ['falsk', 'lokal'] as const) {
  test(`a restore point (${art} store) opens with the tenant's own key and holds exactly its volume`, async () => {
    const l = lagre(art);
    try {
      const noegler = falskeNoegler();
      const db = await migreretDb();
      const d = { db, kopi: { node: falskNode({ [A]: FILER }), noegler }, lagre: { r2: null, lokal: l.lager }, nu: () => new Date('2026-11-01T03:00:00Z'), tilfaeldig: () => '0000000a' };
      const p = await genopretningspunkt(d, A);
      assert.deepEqual({ id: p.id, lager: p.lager }, { id: '20261101T030000Z-0000000a', lager: 'lokal' });
      assert.equal(genopretNoegle(A, p.id), `genopret/${A}/20261101T030000Z-0000000a.ckb`);
      const blob = (await l.lager.hent(genopretNoegle(A, p.id)))!;
      const t = gunzipSync(aabn(await noegler.tenant(A), { omfang: A, id: p.id }, blob));
      assert.deepEqual(manifestFraTar(t), manifestFraTar(tar(FILER)));
      assert.deepEqual(p.manifest, manifestFraTar(tar(FILER)));
      // Not a nightly copy: the backup state is untouched (the nightly schedule must not count it).
      assert.equal((await db.query('SELECT * FROM drift.snapshot')).length, 0);
      assert.equal((await db.query('SELECT * FROM drift.kopi')).length, 0);
      await db.close();
    } finally { l.ryd(); }
  });
}

test('R2 is used when it is set up; otherwise the local store, and the result says which', async () => {
  const r2 = falskKopiLager();
  const lokal = falskKopiLager();
  const db = await migreretDb();
  const d = { db, kopi: { node: falskNode({ [A]: FILER }), noegler: falskeNoegler() }, lagre: { r2, lokal }, nu: () => new Date('2026-11-01T03:00:00Z'), tilfaeldig: () => '0000000b' };
  const p = await genopretningspunkt(d, A);
  assert.equal(p.lager, 'r2');
  assert.equal(r2.objekter.size, 1);
  assert.equal(lokal.objekter.size, 0);
  await db.close();
});

test('no restore point when the volume cannot be read or the key is gone (the caller skips the tenant)', async () => {
  const db = await migreretDb();
  const noegler = falskeNoegler();
  noegler.destruer(A);
  const d = { db, kopi: { node: falskNode({ [A]: FILER }), noegler }, lagre: { r2: null, lokal: falskKopiLager() }, nu: () => new Date('2026-11-01T03:00:00Z') };
  await assert.rejects(genopretningspunkt(d, A), /destrueret/);
  await assert.rejects(genopretningspunkt({ ...d, kopi: { ...d.kopi, node: falskNode({}) } }, A), /findes ikke/);
  await db.close();
});

test('restore points are pruned 7 days after their rollout ended, from the store they are in, once', async () => {
  const db = await migreretDb();
  const r2 = falskKopiLager();
  const lokal = falskKopiLager();
  await db.query("INSERT INTO drift.udgave (tag, sha, billede_id, oprettet) VALUES ('clawco:bbbbbbb', 'bbbbbbb', $1, now())", [`sha256:${'b'.repeat(64)}`]);
  const [u] = await db.query<{ id: number }>("INSERT INTO drift.udrulning (udgave, tilstand, hold, startet, opdateret, slut) VALUES ('clawco:bbbbbbb', 'faerdig', 'alle', $1, $1, $1) RETURNING id", ['2026-11-01T00:00:00Z']);
  const id1 = '20261101T000000Z-00000001';
  const id2 = '20261101T000000Z-00000002';
  await lokal.put(genopretNoegle(A, id1), Buffer.from('x'));
  await r2.put(genopretNoegle('hus-bbbbbbbb', id2), Buffer.from('y'));
  await db.query("INSERT INTO drift.udrulning_tenant (udrulning, slug, hold, nr, tilstand, genopret, genopret_lager) VALUES ($1, $2, 'alle', 1, 'opgraderet', $3, 'lokal'), ($1, 'hus-bbbbbbbb', 'alle', 2, 'opgraderet', $4, 'r2')", [u!.id, A, id1, id2]);
  let nu = new Date('2026-11-07T23:00:00Z');
  const d = { db, lagre: { r2, lokal }, nu: () => nu };
  assert.equal(await rydGenopretning(d), 0);
  assert.equal(lokal.objekter.size, 1);
  nu = new Date('2026-11-08T00:00:01Z');
  assert.equal(await rydGenopretning(d), 2);
  assert.equal(lokal.objekter.size + r2.objekter.size, 0);
  assert.equal(await rydGenopretning(d), 0);
  await db.close();
});

test('a restore point in R2 is left for later when R2 is no longer set up (never a wrong store, never an error)', async () => {
  const db = await migreretDb();
  await db.query("INSERT INTO drift.udgave (tag, sha, billede_id, oprettet) VALUES ('clawco:bbbbbbb', 'bbbbbbb', $1, now())", [`sha256:${'b'.repeat(64)}`]);
  const [u] = await db.query<{ id: number }>("INSERT INTO drift.udrulning (udgave, tilstand, hold, startet, opdateret, slut) VALUES ('clawco:bbbbbbb', 'faerdig', 'alle', $1, $1, $1) RETURNING id", ['2026-11-01T00:00:00Z']);
  await db.query("INSERT INTO drift.udrulning_tenant (udrulning, slug, hold, nr, tilstand, genopret, genopret_lager) VALUES ($1, $2, 'alle', 1, 'opgraderet', '20261101T000000Z-00000001', 'r2')", [u!.id, A]);
  assert.equal(await rydGenopretning({ db, lagre: { r2: null, lokal: falskKopiLager() }, nu: () => new Date('2026-12-01T00:00:00Z') }), 0);
  await db.close();
});
