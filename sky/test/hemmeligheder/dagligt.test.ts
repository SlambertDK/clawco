// KC-0181: the daily purge — destroys every wrapped data key whose purge date has come (crypto-shredding
// of a deleted tenant's backups). Runs at start and then on an interval; a failure is logged, never fatal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destruktionsLoekke } from '../../src/hemmeligheder/dagligt.ts';
import { hentDataNoegle, markerSlettet, opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { migreretDb, ring } from './hjaelp.ts';

const DAG = 86_400_000;

test('a pass at start and one per interval destroys keys past their date, logging how many (never which key)', async () => {
  const db = await migreretDb();
  const r = ring();
  const t0 = new Date('2026-10-31T12:00:00Z');
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', t0);
  await opretTenantNoegle(db, r, 'hus-bbbbbbbb', t0);
  await markerSlettet(db, 'hus-aaaaaaaa', t0);
  let nu = new Date(t0.getTime() + 10 * DAG);
  const log: string[] = [];
  let tik: () => void = () => {};
  const l = destruktionsLoekke(db, { nu: () => nu, log: (s) => log.push(s), saetInterval: (fn) => { tik = fn; return () => {}; } });
  await l.foerste;
  assert.deepEqual(log, [], 'nothing due yet: quiet');
  nu = new Date(t0.getTime() + 31 * DAG);
  tik();
  await l.vent();
  assert.equal(log.length, 1);
  assert.match(log[0]!, /destruerede 1 /);
  await assert.rejects(hentDataNoegle(db, r, 'hus-aaaaaaaa'), /destrueret/);
  await hentDataNoegle(db, r, 'hus-bbbbbbbb');
  tik();
  await l.vent();
  assert.equal(log.length, 1, 'a pass with nothing due logs nothing');
  l.stop();
  await db.close();
});

test('a failing pass is logged once and the loop lives on', async () => {
  const db = await migreretDb();
  await db.query('DROP TABLE hemmeligheder.tenant_noegle');
  const log: string[] = [];
  let tik: () => void = () => {};
  const l = destruktionsLoekke(db, { nu: () => new Date(), log: (s) => log.push(s), saetInterval: (fn) => { tik = fn; return () => {}; } });
  await l.foerste;
  tik();
  await l.vent();
  assert.equal(log.length, 1);
  assert.match(log[0]!, /destruktion fejlede/);
  await db.close();
});
