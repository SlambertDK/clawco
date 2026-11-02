// KC-0185: restore. A chosen (default: the newest) copy is opened with the tenant's own key, checked against the
// manifest taken at backup time, unpacked into a NEW volume and started in a NEW container from the same image.
// The tenant's own volume and container are never written; a failed restore leaves nothing behind. A deleted
// tenant can be restored until its key's purge date (by Henrik's explicit action: the script), never after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { migreretDb } from '../../hemmeligheder/hjaelp.ts';
import { falskKopiLager } from '../../../src/drift/backup/lager.ts';
import { kopierTenant } from '../../../src/drift/backup/koer.ts';
import { gendan } from '../../../src/drift/backup/gendan.ts';
import type { KopiDeps } from '../../../src/drift/backup/typer.ts';
import { falskDump, falskNode, falskeNoegler } from './hjaelp.ts';

const A = 'hus-aaaaaaaa';

async function opsaet() {
  const db = await migreretDb();
  const node = falskNode({ [A]: { 'husstand.json': '{"v":1}', 'rum/dagen/state.json': '{"dag":"mandag"}' } });
  const noegler = falskeNoegler();
  let nu = new Date('2026-11-01T03:00:00.000Z');
  let n = 0;
  const d: KopiDeps = {
    db, lager: falskKopiLager(), node, noegler, dump: falskDump(),
    tenanter: async () => [{ slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }],
    slettedeNoegler: async () => [], nu: () => nu, tilfaeldig: () => (n++).toString(16).padStart(8, '0'),
  };
  return { d, node, noegler, frem: (ms: number) => { nu = new Date(nu.getTime() + ms); } };
}

test('the newest copy goes into a new volume and a new container; the original is never named in a write', async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  s.node.levende.get(A)!['rum/dagen/state.json'] = '{"dag":"tirsdag"}';
  s.node.kald.length = 0;
  const g = await gendan(s.d, A);
  assert.match(g.navn, /^clawco-g-hus-aaaaaaaa-[0-9a-f]{8}$/);
  assert.equal(g.adresse, 'http://172.18.9.9:8750');
  assert.deepEqual(s.node.gendannede.get(g.navn), { 'husstand.json': '{"v":1}', 'rum/dagen/state.json': '{"dag":"mandag"}' });
  assert.equal(s.node.levende.get(A)!['rum/dagen/state.json'], '{"dag":"tirsdag"}', 'the original is untouched');
  assert.deepEqual(s.node.kald, [`udpak ${g.navn} ${A}`, `start ${g.navn} ${A}`]);
  for (const k of s.node.kald) assert.ok(!k.includes(`clawco-t-${A}`));
});

test('an older copy can be chosen by id', async () => {
  const s = await opsaet();
  const foerste = await kopierTenant(s.d, A);
  s.node.levende.get(A)!['husstand.json'] = '{"v":2}';
  s.frem(86_400_000);
  await kopierTenant(s.d, A);
  const g = await gendan(s.d, A, foerste.id);
  assert.equal(g.snapshot, foerste.id);
  assert.equal(s.node.gendannede.get(g.navn)!['husstand.json'], '{"v":1}');
});

test('a copy that does not open with the tenant key creates nothing', async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  s.noegler.tenantNoegler.set(A, randomBytes(32));
  s.node.kald.length = 0;
  await assert.rejects(gendan(s.d, A), /kopien kunne ikke åbnes/);
  assert.deepEqual(s.node.kald, []);
});

test('a copy whose files no longer match the manifest taken at backup time is refused before anything is created', async () => {
  const s = await opsaet();
  const k = await kopierTenant(s.d, A);
  await s.d.db.query("UPDATE drift.snapshot SET manifest = repeat('0', 64) WHERE id = $1", [k.id]);
  s.node.kald.length = 0;
  await assert.rejects(gendan(s.d, A), /manifest/);
  assert.deepEqual(s.node.kald, []);
});

test('a restore that fails to start removes the new volume again', async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  s.node.fejlNaeste('start');
  await assert.rejects(gendan(s.d, A), /falsk start-fejl/);
  assert.equal(s.node.gendannede.size, 0);
  assert.ok(s.node.kald.at(-1)!.startsWith('fjern clawco-g-'));
});

test("a deleted tenant restores until its key is destroyed, and never after (the purge is pinned)", async () => {
  const s = await opsaet();
  await kopierTenant(s.d, A);
  s.node.levende.delete(A); // deprovisioned: the volume is wiped
  const g = await gendan(s.d, A);
  assert.equal(s.node.gendannede.get(g.navn)!['husstand.json'], '{"v":1}');
  s.noegler.destruer(A);
  await assert.rejects(gendan(s.d, A), /destrueret/);
});

test('no copy at all: a plain refusal', async () => {
  const s = await opsaet();
  await assert.rejects(gendan(s.d, A), /ingen kopi/);
  await assert.rejects(gendan(s.d, A, '20261101T030000Z-0000000f'), /ingen kopi/);
  await assert.rejects(gendan(s.d, A, '../x'), /snapshot-id/);
});
