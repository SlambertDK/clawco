// KC-0096: Senere — a Hjem card put away until tonight (18.00) or tomorrow (07.00), Copenhagen time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aftenMulig, senereTid, synligeKort, udsatNu } from '../../src/kurator/senere.ts';
import { mergeKort, type Kort, type KuratorState } from '../../src/rooms/hjem/kort.ts';

const kort = (over: Partial<Kort> = {}): Kort => ({ id: 'k:a', type: 'tjeneste', titel: 'Kort A', betyder: 'Betyder.', grundlag: [], kilder: [], anbefaling: 'Intet.', prioritet: 3, ...over });
const tom = (over: Partial<KuratorState> = {}): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [], ...over });
// 13.00 Copenhagen (CET, UTC+1): before 17.00.
const NU = new Date('2026-10-27T12:00:00Z');

test('senereTid: tonight is 18.00 and tomorrow is 07.00 in Copenhagen time, across the DST change', () => {
  assert.equal(senereTid('aften', NU), '2026-10-27T17:00:00.000Z');
  assert.equal(senereTid('morgen', NU), '2026-10-28T06:00:00.000Z');
  // Summer time (CEST, UTC+2) on 2026-07-10.
  assert.equal(senereTid('morgen', new Date('2026-07-10T10:00:00Z')), '2026-07-11T05:00:00.000Z');
  // The night the clocks go back (2026-10-24 → 25): "tomorrow 07.00" is already winter time.
  assert.equal(senereTid('morgen', new Date('2026-10-24T20:00:00Z')), '2026-10-25T06:00:00.000Z');
  // Just after midnight Copenhagen is still "today" there, not UTC's date.
  assert.equal(senereTid('morgen', new Date('2026-10-26T23:30:00Z')), '2026-10-28T06:00:00.000Z');
});

test('"I aften" is only offered before 17.00 local time', () => {
  assert.equal(aftenMulig(new Date('2026-10-27T15:59:00Z')), true, '16.59');
  assert.equal(aftenMulig(new Date('2026-10-27T16:00:00Z')), false, '17.00');
  assert.equal(senereTid('aften', new Date('2026-10-27T16:00:00Z')), null);
  assert.equal(senereTid('morgen', new Date('2026-10-27T16:00:00Z')), '2026-10-28T06:00:00.000Z', 'tomorrow always works');
});

test('synligeKort hides an expired card and a snoozed one until the time; then it is back by itself', () => {
  const alle = [kort({ id: 'k:aaben' }), kort({ id: 'k:udsat', udsatTil: '2026-10-28T06:00:00.000Z' }), kort({ id: 'k:gammel', gyldigTil: '2026-10-26' })];
  assert.deepEqual(synligeKort(alle, NU).map((k) => k.id), ['k:aaben']);
  assert.deepEqual(synligeKort(alle, new Date('2026-10-28T05:59:59Z')).map((k) => k.id), ['k:aaben'], 'one second before');
  assert.deepEqual(synligeKort(alle, new Date('2026-10-28T06:00:00Z')).map((k) => k.id), ['k:aaben', 'k:udsat'], 'at the time it is back');
  assert.equal(udsatNu(alle[1]!, NU), true);
  assert.equal(udsatNu(alle[0]!, NU), false);
});

test('a Kuratoren run that stands by or re-emits a snoozed card does not wake it', () => {
  const udsat = kort({ id: 'k:a', udsatTil: '2026-10-28T06:00:00.000Z' });
  const s = tom({ kort: [udsat] });
  const behold = mergeKort(s, { nye: [], behold: ['k:a'], opdater: [], fjern: [], intet: [] }, NU, 'privat');
  assert.equal(behold.kort[0]?.udsatTil, '2026-10-28T06:00:00.000Z', 'behold');
  const nyt = mergeKort(s, { nye: [kort({ id: 'k:a', titel: 'Ny titel' })], behold: [], opdater: [], fjern: [], intet: [] }, NU, 'privat');
  assert.equal(nyt.kort[0]?.titel, 'Ny titel');
  assert.equal(nyt.kort[0]?.udsatTil, '2026-10-28T06:00:00.000Z', 'the same id as a new card');
  const opdater = mergeKort(s, { nye: [], behold: [], opdater: [kort({ id: 'k:a', titel: 'Opdateret' })], fjern: [], intet: [] }, NU, 'privat');
  assert.equal(opdater.kort[0]?.udsatTil, '2026-10-28T06:00:00.000Z', 'opdater');
});

test('a snooze whose time has passed is dropped by the merge (the card is simply open again)', () => {
  const s = tom({ kort: [kort({ id: 'k:a', udsatTil: '2026-10-27T05:00:00.000Z' })] });
  const m = mergeKort(s, { nye: [kort({ id: 'k:a' })], behold: [], opdater: [], fjern: [], intet: [] }, NU, 'privat');
  assert.equal(m.kort[0]?.udsatTil, undefined);
});
