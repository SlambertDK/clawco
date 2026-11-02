import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naesteAftale } from '../../src/rooms/dagen/naeste.ts';
import type { DagenState, KalenderPost } from '../../src/rooms/dagen/schema.ts';

// KC-0088: Hjem's "Næste" line comes from Dagen's kalender (today's appointments with real times).
const state = (kalender: KalenderPost[], dato = '2026-10-30'): DagenState => ({
  dato, genereret: '2026-10-30T06:05:00Z', treLinjer: ['x'], anbefaling: { tekst: 'y' }, kalender, morgenavis: [], hermesStatus: 'Klar',
});
const KAL: KalenderPost[] = [
  { tid: '07.42', slut: '08.20', titel: 'Tog til kontoret' },
  { tid: '11.00', slut: '12.00', titel: 'Havvind Nord' },
  { tid: '14.00', slut: '15.00', titel: 'Opfølgning' },
];
const kl = (hhmm: string): Date => new Date(`2026-10-30T${hhmm}:00+01:00`); // CET

test('picks the first appointment that has not ended, as instants', () => {
  assert.deepEqual(naesteAftale(state(KAL), kl('09:00')), { titel: 'Havvind Nord', start: '2026-10-30T10:00:00.000Z', slut: '2026-10-30T11:00:00.000Z' });
});

test('an appointment that is running now is the one shown', () => {
  assert.equal(naesteAftale(state(KAL), kl('11:30'))?.titel, 'Havvind Nord');
});

test('nothing left today gives null: no filler', () => {
  assert.equal(naesteAftale(state(KAL), kl('15:00')), null);
  assert.equal(naesteAftale(state([]), kl('09:00')), null);
});

test('a cancelled appointment is skipped', () => {
  const k = [{ tid: '11.00', slut: '12.00', titel: 'Aflyst møde', status: 'aflyst' as const }, ...KAL.slice(2)];
  assert.equal(naesteAftale(state(k), kl('09:00'))?.titel, 'Opfølgning');
});

test('a Dagen built for another day says nothing about today', () => {
  assert.equal(naesteAftale(state(KAL, '2026-10-29'), kl('09:00')), null);
});

test('colon times and unsorted lists work; unreadable times such as "hele dagen" are skipped', () => {
  const k: KalenderPost[] = [{ tid: 'hele dagen', titel: 'Fridag' }, { tid: '14:00', titel: 'Senere' }, { tid: '9:30', titel: 'Tidligere' }];
  assert.deepEqual(naesteAftale(state(k), kl('08:00')), { titel: 'Tidligere', start: '2026-10-30T08:30:00.000Z' });
});

test('an end before the start (a night shift) is dropped, so the appointment is a point in time', () => {
  const k: KalenderPost[] = [{ tid: '21.00', slut: '07.00', titel: 'Nattevagt' }];
  assert.deepEqual(naesteAftale(state(k), kl('20:00')), { titel: 'Nattevagt', start: '2026-10-30T20:00:00.000Z' });
  assert.equal(naesteAftale(state(k), kl('21:30')), null);
});

test('summer time: 14.00 in July is 12:00 UTC', () => {
  const s = { ...state([{ tid: '14.00', titel: 'Sommer' }], '2026-07-01') };
  assert.equal(naesteAftale(s, new Date('2026-07-01T08:00:00Z'))?.start, '2026-07-01T12:00:00.000Z');
});

test('the Copenhagen date decides: 23.30 UTC is already tomorrow', () => {
  const s = state([{ tid: '08.00', titel: 'I morgen' }], '2026-10-31');
  assert.equal(naesteAftale(s, new Date('2026-10-30T23:30:00Z'))?.start, '2026-10-31T07:00:00.000Z');
});
