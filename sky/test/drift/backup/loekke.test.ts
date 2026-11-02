// KC-0185: the backup loop inside the Sky process — a pass at start and then every interval (default 5 min):
// the night run, and the monthly drill when it is due. A failed pass is logged once and never kills the loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migreretDb } from '../../hemmeligheder/hjaelp.ts';
import { falskKopiLager } from '../../../src/drift/backup/lager.ts';
import { kopiLoekke, FEM_MINUTTER } from '../../../src/drift/backup/loekke.ts';
import { proeverSiden } from '../../../src/drift/backup/tilstand.ts';
import type { ProeveDeps } from '../../../src/drift/backup/proeve.ts';
import { falskDump, falskNode, falskeNoegler } from './hjaelp.ts';

test('a pass copies what is due and runs the drill once in the month; a failing pass is logged once and the loop lives on', async () => {
  const db = await migreretDb();
  const log: string[] = [];
  let nu = new Date('2026-11-01T03:00:00.000Z');
  let n = 0;
  let nede = false;
  const d: ProeveDeps = {
    db, lager: falskKopiLager(), node: falskNode({ 'hus-aaaaaaaa': { 'husstand.json': '{}' } }), noegler: falskeNoegler(), dump: falskDump(),
    tenanter: async () => { if (nede) throw new Error('databasen svarer ikke'); return [{ slug: 'hus-aaaaaaaa', tilstand: 'klar', siden: new Date('2026-10-01T00:00:00Z') }]; },
    slettedeNoegler: async () => [], nu: () => nu, tilfaeldig: () => (n++).toString(16).padStart(8, '0'), log: (s) => log.push(s),
    sundhed: async () => ({ ok: true }), vent: async () => {}, testTenant: null, tal: () => 0,
  };
  let tik: () => void = () => {};
  let interval = 0;
  const l = kopiLoekke(d, { saetInterval: (fn, ms) => { tik = fn; interval = ms; return () => {}; } });
  await l.foerste;
  assert.equal(interval, FEM_MINUTTER);
  assert.ok(log.some((x) => /sikkerhedskopier: 2 ok/.test(x)), log.join('\n'));
  assert.equal((await proeverSiden(db, new Date(0))).length, 2, 'the tenant and the database');
  const foer = log.length;
  nu = new Date('2026-11-01T03:05:00.000Z');
  tik();
  await l.vent();
  assert.equal(log.length, foer, 'nothing due: quiet, and no second drill this month');
  nede = true;
  tik(); await l.vent();
  tik(); await l.vent();
  assert.equal(log.filter((x) => /sikkerhedskopiering fejlede: databasen svarer ikke/.test(x)).length, 1);
});
