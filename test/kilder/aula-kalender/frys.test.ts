// KC-0274 (finding C1): a calendar file cannot freeze the server — the e-mail scrub works on a short head, and the
// repeat expansion has ONE step budget per file. Timings are asserted generously (500 ms); before the fix 50 KB took seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAKS_TRIN_PER_FIL, parseIcs } from '../../../src/kilder/aula-kalender/ics.ts';

const VINDUE = { fra: '2026-11-02', til: '2026-11-09' };
const cal = (...h: string[]): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${h.join('')}END:VCALENDAR\r\n`;
const ev = (...l: string[]): string => `BEGIN:VEVENT\r\nUID:u-${l.join('').length}-${l.length}\r\n${l.join('\r\n')}\r\nEND:VEVENT\r\n`;

test('50 KB in one SUMMARY line parses fast, 50 KB in LOCATION and in the calendar name too', () => {
  for (const [navn, tekst] of [['SUMMARY', 'a'.repeat(50_000)], ['LOCATION', `${'x@'.repeat(25_000)}`], ['SUMMARY', 'a.'.repeat(25_000)]] as const) {
    const t0 = performance.now();
    const r = parseIcs(`BEGIN:VCALENDAR\r\nX-WR-CALNAME:${tekst}\r\n${ev('DTSTART:20261103T070000Z', `${navn}:${tekst}`)}END:VCALENDAR\r\n`, VINDUE);
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${navn}: ${ms.toFixed(0)} ms`);
    assert.equal(r.haendelser.length, 1);
    assert.ok((r.haendelser[0]?.titel.length ?? 0) <= 200);
  }
});

test('an e-mail address is still removed from the text, and a cut cannot leave half an address behind', () => {
  const r = parseIcs(cal(ev('DTSTART:20261103T070000Z', 'SUMMARY:Ring til mig på ole@x.example nu')), VINDUE);
  assert.equal(r.haendelser[0]?.titel, 'Ring til mig på nu');
  const lang = parseIcs(cal(ev('DTSTART:20261103T070000Z', `SUMMARY:${'ord '.repeat(2000)}hemmelig@x.example`)), VINDUE);
  assert.equal(lang.haendelser[0]?.titel.includes('@'), false);
});

test('500 daily series starting years back stop at the per-file step budget', () => {
  const dem = Array.from({ length: 500 }, (_, i) => ev(`SUMMARY:Serie ${i}`, 'DTSTART:19900101T070000Z', 'RRULE:FREQ=DAILY'));
  const t0 = performance.now();
  const r = parseIcs(cal(...dem), VINDUE);
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
  // The window is 36 years away from the start: one series alone needs ~13 000 steps, so the budget ends the file early.
  assert.ok(r.haendelser.length < 500 * 7, `got ${r.haendelser.length}`);
  assert.ok(r.afkortet, 'the file is marked cut');
  assert.equal(MAKS_TRIN_PER_FIL, 20_000);
});

test('an ordinary calendar is not touched by the budget', () => {
  const r = parseIcs(cal(ev('SUMMARY:Ugentlig', 'DTSTART:20261026T070000Z', 'RRULE:FREQ=WEEKLY')), VINDUE);
  assert.equal(r.haendelser.length, 1);
  assert.equal(r.afkortet, false);
});
