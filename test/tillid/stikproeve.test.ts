// KC-0145: the Sunday sample. The number is counted from records the app itself wrote when it kept something off the
// screen; the five are drawn by a pure function seeded by the ISO week (a reload shows the same five), spread over rules.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { iUge, lavSkjulte, type Skjult } from '../../src/tillid/skjulte.ts';
import { besvar, boerTilbydeStop, lavStikbog, renUge, rentIRaekke, traekStikproeve, type Stikbog, type Stikuge } from '../../src/tillid/stikproeve.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-stikproeve-'));
after(() => rm(rod, { recursive: true, force: true }));

const UGE = '2026-10-26'; // Monday of ISO week 44
const post = (i: number, regelId?: string, tid = '2026-10-28T09:00:00.000Z'): Skjult => ({ id: `s-${i}`, tid, titel: `Ting ${i}`, kilde: 'kuratoren', ...(regelId ? { regelId } : {}) });

test('seeded by the week: the same week draws the same five, another week other ones', () => {
  const alle = Array.from({ length: 200 }, (_, i) => post(i));
  const a = traekStikproeve(alle, UGE).map((s) => s.id);
  assert.equal(a.length, 5);
  assert.deepEqual(traekStikproeve([...alle].reverse(), UGE).map((s) => s.id), a, 'order of the records does not matter');
  const andenUge = alle.map((s) => ({ ...s, tid: '2026-11-04T09:00:00.000Z' }));
  assert.notDeepEqual(traekStikproeve(andenUge, '2026-11-02').map((s) => s.id), a);
});

test('spread over rules: five from five different groups when there are that many, not five from one rule', () => {
  const alle = [
    ...Array.from({ length: 150 }, (_, i) => post(i, 'R-0001')),
    ...Array.from({ length: 30 }, (_, i) => post(200 + i, 'R-0002')),
    ...Array.from({ length: 10 }, (_, i) => post(300 + i, 'R-0003')),
    ...Array.from({ length: 5 }, (_, i) => post(400 + i, 'R-0004')),
    ...Array.from({ length: 5 }, (_, i) => post(500 + i)),
  ];
  const t = traekStikproeve(alle, UGE);
  assert.equal(new Set(t.map((s) => s.regelId ?? '')).size, 5);
  // Two groups only: still five, split between them.
  const to = traekStikproeve([...Array.from({ length: 50 }, (_, i) => post(i, 'R-0001')), post(99, 'R-0002')], UGE);
  assert.equal(to.length, 5);
  assert.equal(to.filter((s) => s.regelId === 'R-0002').length, 1);
});

test('fewer than five hidden → fewer drawn; zero → none (no card); only the week counts', () => {
  assert.equal(traekStikproeve([post(1), post(2)], UGE).length, 2);
  assert.deepEqual(traekStikproeve([], UGE), []);
  assert.deepEqual(traekStikproeve([post(1, undefined, '2026-10-20T09:00:00.000Z')], UGE), [], 'last week is not this week');
});

test('the count equals the records of the ISO week (Copenhagen days: Monday 00:00 to Sunday 24:00)', () => {
  const alle = [
    post(1, undefined, '2026-10-25T22:59:00.000Z'), // Sunday 23:59 Copenhagen (CET from 25 Oct): the week before
    post(2, undefined, '2026-10-25T23:00:00.000Z'), // Monday 00:00 Copenhagen
    post(3, undefined, '2026-11-01T22:59:00.000Z'), // Sunday 23:59
    post(4, undefined, '2026-11-01T23:00:00.000Z'), // next Monday
  ];
  assert.deepEqual(iUge(alle, UGE).map((s) => s.id), ['s-2', 's-3']);
});

test('the store: app-written records appended once per id, read back; a damaged line is skipped', async () => {
  const l = lavSkjulte({ dir: path.join(rod, 'a') });
  assert.equal(await l.noter([post(1), post(2)]), 2);
  assert.equal(await l.noter([post(2), post(3)]), 1, 'the same Ordnet post on the next rebuild counts once');
  assert.deepEqual((await l.alle()).map((s) => s.id), ['s-1', 's-2', 's-3']);
  const tekst = await readFile(path.join(rod, 'a', 'tillid', 'skjulte.jsonl'), 'utf8');
  assert.equal(tekst.trim().split('\n').length, 3);
  // A fresh store over the same file still knows the ids; a damaged line is skipped.
  await appendFile(path.join(rod, 'a', 'tillid', 'skjulte.jsonl'), '{ikke json\n{"id":"x"}\n', 'utf8');
  const igen = lavSkjulte({ dir: path.join(rod, 'a') });
  assert.equal(await igen.noter([post(3)]), 0);
  assert.equal((await igen.alle()).length, 3);
});

const uge = (u: string, svar: ('rigtigt' | 'forkert' | undefined)[]): Stikuge => ({
  uge: u, skjulte: 100, traek: svar.map((s, i) => ({ ...post(i), ...(s ? { svar: s, svaret: '2026-10-25T18:00:00.000Z' } : {}) })), forkerte: svar.filter((s) => s === 'forkert').length,
});
const R5 = ['rigtigt', 'rigtigt', 'rigtigt', 'rigtigt', 'rigtigt'] as const;

test('a clean week: no wrong and every drawn line answered', () => {
  assert.equal(renUge(uge('2026-10-05', [...R5])), true);
  assert.equal(renUge(uge('2026-10-05', ['rigtigt', 'rigtigt', undefined, 'rigtigt', 'rigtigt'])), false);
  assert.equal(renUge(uge('2026-10-05', ['rigtigt', 'forkert', 'rigtigt', 'rigtigt', 'rigtigt'])), false);
  assert.equal(renUge(uge('2026-10-05', [])), false, 'nothing drawn is not a clean week');
});

test('the streak: clean weeks in a row from the newest; a wrong resets it; the stop offer after three', () => {
  const bog: Stikbog = { uger: [uge('2026-10-05', ['forkert', ...R5.slice(1)]), uge('2026-10-12', [...R5]), uge('2026-10-19', [...R5])] };
  assert.equal(rentIRaekke(bog), 2);
  assert.equal(boerTilbydeStop(bog), false);
  const tre = { uger: [...bog.uger, uge('2026-10-26', [...R5])] };
  assert.equal(rentIRaekke(tre), 3);
  assert.equal(boerTilbydeStop(tre), true);
  assert.equal(boerTilbydeStop({ ...tre, stop: { uge: '2026-10-26', tid: 'x' } }), false, 'an offer is pending');
  // Nej → asked again only after three more clean weeks.
  const nej: Stikbog = { ...tre, stop: { uge: '2026-10-26', tid: 'x', svar: 'nej' } };
  assert.equal(rentIRaekke(nej), 0);
  const igen = { ...nej, uger: [...nej.uger, uge('2026-11-02', [...R5]), uge('2026-11-09', [...R5]), uge('2026-11-16', [...R5])] };
  assert.equal(boerTilbydeStop(igen), true);
  assert.equal(boerTilbydeStop({ ...igen, uger: [...igen.uger.slice(0, -1), uge('2026-11-16', ['forkert', ...R5.slice(1)])] }), false, 'a wrong resets');
});

test('besvar: each drawn line once; a wrong counts per rule; unknown is unknown', () => {
  const b0: Stikbog = { uger: [{ uge: UGE, skjulte: 7, traek: [post(1, 'R-0001'), post(2)], forkerte: 0 }] };
  const nu = new Date('2026-11-01T18:05:00Z');
  const a = besvar(b0, UGE, 's-1', 'forkert', nu);
  assert.equal(a.udfald, 'ok');
  assert.equal(a.bog.uger[0]!.forkerte, 1);
  assert.deepEqual(a.bog.uger[0]!.perRegel, { 'R-0001': 1 });
  assert.equal(a.bog.uger[0]!.traek[0]!.svar, 'forkert');
  assert.equal(besvar(a.bog, UGE, 's-1', 'rigtigt', nu).udfald, 'allerede');
  assert.equal(besvar(a.bog, UGE, 's-9', 'rigtigt', nu).udfald, 'ukendt');
  assert.equal(besvar(a.bog, '2026-10-19', 's-1', 'rigtigt', nu).udfald, 'ukendt');
  assert.equal(b0.uger[0]!.forkerte, 0, 'pure: the input is not changed');
});

test('the ledger file: atomic JSON, read back; a missing or damaged file is an empty ledger', async () => {
  const dir = path.join(rod, 'b');
  const bog = lavStikbog({ dir });
  assert.deepEqual(await bog.laes(), { uger: [] });
  await bog.endre((b) => ({ ...b, uger: [uge(UGE, [...R5])] }));
  const raa = JSON.parse(await readFile(path.join(dir, 'tillid', 'stikproever.json'), 'utf8')) as Stikbog;
  assert.equal(raa.uger[0]!.uge, UGE);
  assert.equal((await lavStikbog({ dir }).laes()).uger.length, 1);
});
