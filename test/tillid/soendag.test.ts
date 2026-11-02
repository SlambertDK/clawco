// KC-0145: the Sunday job with an injected clock — Sunday 18:00 Copenhagen draws the week's sample once; the setting
// soendagstjek (default on) turns it off; three clean weeks in a row make the stop offer; a wrong resets the streak.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { soendagDue } from '../../src/scheduler.ts';
import { soendagsTjek } from '../../src/tillid/soendag.ts';
import { lavSkjulte, type Skjult } from '../../src/tillid/skjulte.ts';
import { besvar, lavStikbog, medStopTilbud, type Stikbog } from '../../src/tillid/stikproeve.ts';
import { createSettings } from '../../src/settings.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-soendag-'));
after(() => rm(rod, { recursive: true, force: true }));

test('soendagDue: Sunday from 18:00 Copenhagen, never on another day', () => {
  assert.equal(soendagDue(new Date('2026-11-01T16:59:00Z')), false, 'Sunday 17:59 CET');
  assert.equal(soendagDue(new Date('2026-11-01T17:00:00Z')), true, 'Sunday 18:00 CET');
  assert.equal(soendagDue(new Date('2026-11-01T22:30:00Z')), true, 'Sunday 23:30');
  assert.equal(soendagDue(new Date('2026-11-01T23:00:00Z')), false, 'Monday 00:00');
  assert.equal(soendagDue(new Date('2026-10-31T17:00:00Z')), false, 'Saturday 18:00');
  assert.equal(soendagDue(new Date('2026-10-25T16:00:00Z')), false, 'the day summer time ends: 17:00 CET');
  assert.equal(soendagDue(new Date('2026-10-25T17:00:00Z')), true, 'the day summer time ends: 18:00 CET');
  assert.equal(soendagDue(new Date('2026-03-29T16:00:00Z')), true, 'the day summer time starts: 18:00 CEST');
});

const hidden = (n: number, dag: string): Skjult[] => Array.from({ length: n }, (_, i) => ({ id: `${dag}-${i}`, tid: `${dag}T09:00:00.000Z`, titel: `Ting ${i}`, kilde: 'kuratoren', ...(i % 3 === 0 ? { regelId: 'R-0001' } : {}) }));

test('the job draws the week once at Sunday 18:00: the count is the records, five drawn; a later tick and a restart find it', async () => {
  const dir = path.join(rod, 'a');
  const skjulte = lavSkjulte({ dir });
  await skjulte.noter([...hidden(12, '2026-10-28'), ...hidden(3, '2026-10-20')]);
  const bog = lavStikbog({ dir });
  const til = async () => true;
  assert.equal(await soendagsTjek({ skjulte, bog, til, now: new Date('2026-11-01T16:00:00Z') }), 'ikke-tid');
  assert.equal(await soendagsTjek({ skjulte, bog, til, now: new Date('2026-11-01T17:00:00Z') }), 'oprettet');
  assert.equal(await soendagsTjek({ skjulte, bog, til, now: new Date('2026-11-01T17:01:00Z') }), 'findes');
  assert.equal(await soendagsTjek({ skjulte: lavSkjulte({ dir }), bog: lavStikbog({ dir }), til, now: new Date('2026-11-01T21:00:00Z') }), 'findes', 'after a restart');
  const b = await bog.laes();
  assert.equal(b.uger.length, 1);
  assert.deepEqual([b.uger[0]!.uge, b.uger[0]!.skjulte, b.uger[0]!.traek.length, b.uger[0]!.forkerte], ['2026-10-26', 12, 5, 0]);
  // Next Sunday: a new week.
  assert.equal(await soendagsTjek({ skjulte, bog, til, now: new Date('2026-11-08T17:30:00Z') }), 'oprettet');
  assert.deepEqual((await bog.laes()).uger.map((u) => [u.uge, u.skjulte, u.traek.length]), [['2026-10-26', 12, 5], ['2026-11-02', 0, 0]]);
});

test('the setting soendagstjek: default on, off stops the job', async () => {
  const dir = path.join(rod, 'b');
  const s = createSettings(dir);
  assert.equal((await s.read()).soendagstjek, undefined, 'unset = on');
  await s.setSoendagstjek(false);
  assert.equal((await s.read()).soendagstjek, false);
  await s.setModels({ lille: 'm' });
  assert.equal((await s.read()).soendagstjek, false, 'other settings keep it');
  const r = await soendagsTjek({ skjulte: lavSkjulte({ dir }), bog: lavStikbog({ dir }), til: async () => (await s.read()).soendagstjek !== false, now: new Date('2026-11-01T17:00:00Z') });
  assert.equal(r, 'fra');
  await s.setSoendagstjek(true);
  assert.equal((await s.read()).soendagstjek, true);
});

async function svarAlle(dir: string, sondag: string, forkert = false): Promise<Stikbog> {
  const skjulte = lavSkjulte({ dir });
  const mandag = new Date(Date.parse(`${sondag}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  await skjulte.noter(hidden(8, mandag));
  const bog = lavStikbog({ dir });
  const nu = new Date(`${sondag}T17:30:00Z`);
  assert.equal(await soendagsTjek({ skjulte, bog, til: async () => true, now: nu }), 'oprettet');
  return bog.endre((b) => {
    let x = b;
    const u = x.uger.at(-1)!;
    u.traek.forEach((t, i) => { x = besvar(x, u.uge, t.id, forkert && i === 0 ? 'forkert' : 'rigtigt', nu).bog; });
    return medStopTilbud(x, nu);
  });
}

test('three clean weeks in a row → the stop offer (once); Nej → asked again after three more; a wrong resets', async () => {
  const dir = path.join(rod, 'c');
  assert.equal((await svarAlle(dir, '2026-11-01')).stop, undefined);
  assert.equal((await svarAlle(dir, '2026-11-08')).stop, undefined);
  const tre = await svarAlle(dir, '2026-11-15');
  assert.deepEqual(tre.stop && [tre.stop.uge, tre.stop.svar], ['2026-11-09', undefined]);
  assert.equal(medStopTilbud(tre, new Date()), tre, 'a pending offer is not made again');
  await lavStikbog({ dir }).endre((b) => ({ ...b, stop: { ...b.stop!, svar: 'nej' } }));
  assert.equal((await svarAlle(dir, '2026-11-22')).stop?.svar, 'nej');
  assert.equal((await svarAlle(dir, '2026-11-29', true)).stop?.svar, 'nej', 'a wrong resets the streak');
  await svarAlle(dir, '2026-12-06');
  assert.equal((await svarAlle(dir, '2026-12-13')).stop?.svar, 'nej', 'two clean after the wrong is not three');
  const igen = await svarAlle(dir, '2026-12-20');
  assert.deepEqual(igen.stop && [igen.stop.uge, igen.stop.svar], ['2026-12-14', undefined], 'three clean after the wrong: asked again');
});
