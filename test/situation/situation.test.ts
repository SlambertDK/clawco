import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORBERED_MINUTTER, vaelgSituation, type KalenderMoede } from '../../src/situation/situation.ts';
import { SITUATIONER, SITUATION_IDER } from '../../src/situation/regler.ts';
import { koebenhavnTilIso } from '../../src/shell/tid.ts';

const kbh = (lokal: string): Date => new Date(koebenhavnTilIso(lokal) ?? 'invalid');
const ur = (lokal: string, moeder: readonly unknown[] = []): string => vaelgSituation({ now: kbh(lokal), moeder }).situation;

test('KC-0114: the clock in Copenhagen — morgen until 10.00, dagen until 17.00, aften from 17.00', () => {
  for (const dag of ['2026-10-27', '2026-03-29', '2026-10-25', '2026-06-21']) {
    assert.equal(ur(`${dag}T00:30`), 'morgen', `${dag} 00:30`);
    assert.equal(ur(`${dag}T09:59`), 'morgen', `${dag} 09:59`);
    assert.equal(ur(`${dag}T10:00`), 'dagen', `${dag} 10:00`);
    assert.equal(ur(`${dag}T16:59`), 'dagen', `${dag} 16:59`);
    assert.equal(ur(`${dag}T17:00`), 'aften', `${dag} 17:00`);
    assert.equal(ur(`${dag}T23:59`), 'aften', `${dag} 23:59`);
  }
});

const MOEDE: KalenderMoede = { id: 'm1', start: '2026-10-27T10:00:00.000Z', slut: '2026-10-27T11:00:00.000Z', univers: 'arena' }; // 11.00–12.00 Copenhagen

test('KC-0114: a meeting beats the clock from ten minutes before its start until its end (end exclusive)', () => {
  assert.equal(FORBERED_MINUTTER, 10);
  const ved = (iso: string) => vaelgSituation({ now: new Date(iso), moeder: [MOEDE] });
  assert.deepEqual(ved('2026-10-27T09:49:59.999Z'), { situation: 'dagen', moede: null });
  assert.deepEqual(ved('2026-10-27T09:50:00.000Z'), { situation: 'moede', moede: MOEDE });
  assert.equal(ved('2026-10-27T10:59:59.999Z').situation, 'moede');
  assert.deepEqual(ved('2026-10-27T11:00:00.000Z'), { situation: 'dagen', moede: null });
  // A morning meeting still beats morgen; when it ends the clock takes over again.
  const tidlig = { ...MOEDE, start: '2026-10-27T07:00:00.000Z', slut: '2026-10-27T07:30:00.000Z' };
  assert.equal(vaelgSituation({ now: new Date('2026-10-27T07:10:00.000Z'), moeder: [tidlig] }).situation, 'moede');
  assert.equal(vaelgSituation({ now: new Date('2026-10-27T07:30:00.000Z'), moeder: [tidlig] }).situation, 'morgen');
});

test('KC-0114: of overlapping meetings the earliest start wins', () => {
  const sent = { ...MOEDE, id: 'sent', univers: 'a', start: '2026-10-27T10:05:00.000Z' };
  const tidligt = { ...MOEDE, id: 'tidligt', univers: 'b', start: '2026-10-27T09:55:00.000Z' };
  assert.equal(vaelgSituation({ now: new Date('2026-10-27T10:06:00.000Z'), moeder: [sent, tidligt] }).moede?.id, 'tidligt');
});

test('KC-0114: garbled calendar data degrades to the clock and never throws', () => {
  const skrald: unknown[] = [null, 7, 'x', {}, { id: 'a', start: 'junk', slut: 'junk', univers: 'u' }, { id: 'b', start: MOEDE.start, univers: 'u' }, { ...MOEDE, id: 3 }];
  assert.deepEqual(vaelgSituation({ now: new Date('2026-10-27T10:30:00.000Z'), moeder: skrald }), { situation: 'dagen', moede: null });
  assert.deepEqual(vaelgSituation({ now: new Date('2026-10-27T10:30:00.000Z'), moeder: null as unknown as unknown[] }), { situation: 'dagen', moede: null });
  assert.doesNotThrow(() => vaelgSituation({ now: new Date('invalid'), moeder: [MOEDE] }));
  assert.equal(vaelgSituation({ now: new Date('invalid'), moeder: [] }).situation, 'dagen');
});

test('KC-0114: same input, same answer', () => {
  const i = { now: new Date('2026-10-27T09:55:00.000Z'), moeder: [MOEDE] };
  assert.deepEqual(vaelgSituation(i), vaelgSituation(i));
});

test('KC-0114: the table has one row per situation, each with elementer, rum and stemme', () => {
  assert.deepEqual([...SITUATION_IDER].sort(), ['aften', 'dagen', 'moede', 'morgen']);
  for (const s of SITUATION_IDER) {
    const r = SITUATIONER[s];
    assert.ok(Array.isArray(r.elementer) && r.elementer.length > 0, `${s} elementer`);
    assert.ok(Array.isArray(r.rum), `${s} rum`);
    assert.ok(Array.isArray(r.stemme) && r.stemme.length > 0, `${s} stemme`);
  }
  assert.deepEqual(SITUATIONER.dagen.stemme, ['mail', 'dagen', 'nyheder', 'skrive', 'univers'], 'dagen keeps the order the voice had before KC-0114');
});
