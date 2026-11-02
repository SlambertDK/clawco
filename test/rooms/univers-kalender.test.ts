import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moederFraKalender } from '../../src/rooms/univers/kalender.ts';

const ev = (o: Record<string, unknown>) => ({
  start: '2026-10-28T10:00:00+01:00', end: '2026-10-28T11:00:00+01:00', all_day: false,
  title: 'Arena-møde', calendar: 'henrik@example.com', location: null, creator: null, id: 'e1',
  attendees: [{ name: null, email: 'henrik@example.com', self: true }, { name: 'Lars Holm', email: 'lars@example.com', self: false }],
  ...o,
});
const raw = (events: unknown[]) => ({ generated: 'x', days: [{ date: '2026-10-28', events }], errors: [] });

test('keeps timed events with someone besides Henrik, without Henrik in deltagere', () => {
  const m = moederFraKalender(raw([ev({})]));
  assert.deepEqual(m, [{ eventId: 'e1', titel: 'Arena-møde', start: '2026-10-28T10:00:00+01:00', slut: '2026-10-28T11:00:00+01:00', deltagere: [{ navn: 'Lars Holm', email: 'lars@example.com' }] }]);
});

test('drops all-day events, events without others, and events without id', () => {
  const m = moederFraKalender(raw([
    ev({ id: 'a', all_day: true, start: '2026-10-28', end: '2026-10-29' }),
    ev({ id: 'b', attendees: [{ name: null, email: 'henrik@example.com', self: true }] }),
    ev({ id: 'c', attendees: [] }),
    ev({ id: null }),
  ]));
  assert.deepEqual(m, []);
});

test('the same event seen in two calendars appears once; sted is kept', () => {
  const m = moederFraKalender(raw([ev({ location: 'Teams' }), ev({ calendar: 'Familie', location: 'Teams' })]));
  assert.equal(m.length, 1);
  assert.equal(m[0]!.sted, 'Teams');
});

test('a participant without a display name gets a name from the address, never the address itself', () => {
  const m = moederFraKalender(raw([ev({ attendees: [{ name: null, email: 'anne-marie.berg@example.com', self: false }] })]));
  assert.equal(m[0]!.deltagere[0]!.navn, 'Anne-Marie Berg');
  assert.equal(m[0]!.deltagere[0]!.email, 'anne-marie.berg@example.com');
});

test('garbage in gives an empty list', () => {
  assert.deepEqual(moederFraKalender(null), []);
  assert.deepEqual(moederFraKalender({ days: 'x' }), []);
});
