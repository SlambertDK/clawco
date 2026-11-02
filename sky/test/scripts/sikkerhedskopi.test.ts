// KC-0185: the operator script for one backup, restore or drill by hand (the live proof on kira-home). It prints
// counts and ids only — never a key — and refuses unknown commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migreretDb, former } from '../hemmeligheder/hjaelp.ts';
import { falskKopiLager } from '../../src/drift/backup/lager.ts';
import type { ProeveDeps } from '../../src/drift/backup/proeve.ts';
import { kommando } from '../../scripts/sikkerhedskopi.ts';
import { falskDump, falskNode, falskeNoegler } from '../drift/backup/hjaelp.ts';

const A = 'hus-aaaaaaaa';

async function opsaet() {
  const db = await migreretDb();
  let n = 0;
  const node = falskNode({ [A]: { 'husstand.json': '{"v":1}', 'rum/x/state.json': '{}' } });
  const noegler = falskeNoegler();
  const dump = falskDump();
  const d: ProeveDeps = {
    db, lager: falskKopiLager(), node, noegler, dump,
    tenanter: async () => [{ slug: A, tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }],
    slettedeNoegler: async () => [], nu: () => new Date('2026-11-01T12:00:00.000Z'), tilfaeldig: () => (n++).toString(16).padStart(8, '0'),
    sundhed: async () => ({ ok: true }), vent: async () => {}, testTenant: null, tal: () => 0,
  };
  const ud: string[] = [];
  const koer = (...argv: string[]) => kommando(argv, d, (l) => ud.push(l));
  return { d, ud, koer, node, noegler, dump };
}

test('koer alle copies every live tenant and the database now, and prints ids, bytes and file counts', async () => {
  const s = await opsaet();
  assert.equal(await s.koer('koer', 'alle'), 0);
  assert.ok(s.ud.some((l) => l.startsWith(`${A}: 20261101T120000Z-`) && /\d+ bytes, 2 filer/.test(l)), s.ud.join('\n'));
  assert.ok(s.ud.some((l) => l.startsWith('db: 20261101T120000Z-')), s.ud.join('\n'));
});

test('liste, gendan, fjern and proeve by hand', async () => {
  const s = await opsaet();
  await s.koer('koer', A);
  s.ud.length = 0;
  assert.equal(await s.koer('liste', A), 0);
  assert.match(s.ud[0]!, /^20261101T120000Z-00000000 {2}2026-11-01T12:00:00.000Z {2}\d+ bytes {2}2 filer$/);
  s.ud.length = 0;
  assert.equal(await s.koer('gendan', A), 0);
  const navn = /navn (clawco-g-[^\s,]+)/.exec(s.ud.join('\n'))![1]!;
  assert.ok(s.node.containere.has(navn));
  assert.equal(await s.koer('fjern', navn), 0);
  assert.ok(!s.node.containere.has(navn));
  s.ud.length = 0;
  assert.equal(await s.koer('proeve', A), 0);
  assert.match(s.ud.join('\n'), /prøve ok/);
});

test('db-gendan restores the newest dump into another named database', async () => {
  const s = await opsaet();
  await s.koer('koer', 'db');
  assert.equal(await s.koer('db-gendan', 'sky_proeve'), 0);
  assert.ok(s.dump.kald.includes('gendan sky_proeve'));
});

test('status prints counts only; a failing command exits 1; an unknown one prints usage and exits 2', async () => {
  const s = await opsaet();
  await s.koer('koer', 'alle');
  s.ud.length = 0;
  assert.equal(await s.koer('status'), 0);
  const tekst = s.ud.join('\n');
  assert.match(tekst, /2 omfang \(1 kunder \+ databasen\): 2 med en kopi inden for 36 timer, 0 forsinkede/);
  assert.ok(!tekst.includes('hus-'), 'status names no tenant');
  assert.equal(await s.koer('gendan', 'hus-bbbbbbbb'), 1);
  assert.equal(await s.koer('noget'), 2);
  const alt = s.ud.join('\n');
  for (const k of [...s.noegler.tenantNoegler.values(), ...s.noegler.dbNoegler.values()]) for (const f of former(k)) assert.ok(!alt.includes(f));
});
