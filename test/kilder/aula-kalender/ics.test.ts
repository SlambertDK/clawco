// KC-0235: the small iCalendar reader — a table of what a calendar file can hold. Every file here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IcsFejl, MAKS_BYTES, MAKS_HAENDELSER, parseIcs } from '../../../src/kilder/aula-kalender/ics.ts';

const VINDUE = { fra: '2026-11-02', til: '2026-11-09' };
const cal = (...haendelser: string[]): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//DA\r\n${haendelser.join('')}END:VCALENDAR\r\n`;
const ev = (...linjer: string[]): string => `BEGIN:VEVENT\r\nUID:u-${Math.abs(linjer.join('').length)}-${linjer.length}\r\n${linjer.join('\r\n')}\r\nEND:VEVENT\r\n`;
const les = (tekst: string, vindue = VINDUE) => parseIcs(tekst, vindue);
const starter = (tekst: string, vindue = VINDUE): string[] => les(tekst, vindue).haendelser.map((h) => h.start);

test('times: UTC, a named zone and a floating time all land on Copenhagen wall time with its offset', () => {
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261103T070000Z', 'DTEND:20261103T080000Z'))), ['2026-11-03T08:00:00+01:00']);
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART;TZID=Europe/Copenhagen:20261103T080000'))), ['2026-11-03T08:00:00+01:00']);
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261103T080000'))), ['2026-11-03T08:00:00+01:00']);
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART;TZID=Europe/London:20261103T070000'))), ['2026-11-03T08:00:00+01:00'], 'another zone is converted, not read as local');
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART;TZID=Findes/Ikke:20261103T080000'))), ['2026-11-03T08:00:00+01:00'], 'an unknown zone name reads as Copenhagen');
});

test('summer time: the same wall time carries +02:00 in June, and a weekly series keeps its wall time across the change', () => {
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART;TZID=Europe/Copenhagen:20260602T080000')), { fra: '2026-06-01', til: '2026-06-08' }), ['2026-06-02T08:00:00+02:00']);
  const serie = cal(ev('SUMMARY:A', 'DTSTART;TZID=Europe/Copenhagen:20261019T080000', 'DTEND;TZID=Europe/Copenhagen:20261019T090000', 'RRULE:FREQ=WEEKLY'));
  assert.deepEqual(starter(serie, { fra: '2026-10-19', til: '2026-11-02' }), ['2026-10-19T08:00:00+02:00', '2026-10-26T08:00:00+01:00']);
});

test('the end, a duration and a missing end', () => {
  assert.equal(les(cal(ev('SUMMARY:A', 'DTSTART:20261103T070000Z', 'DTEND:20261103T080000Z'))).haendelser[0]?.slut, '2026-11-03T09:00:00+01:00');
  assert.equal(les(cal(ev('SUMMARY:A', 'DTSTART:20261103T070000Z', 'DURATION:PT1H30M'))).haendelser[0]?.slut, '2026-11-03T09:30:00+01:00');
  assert.equal(les(cal(ev('SUMMARY:A', 'DTSTART:20261103T070000Z'))).haendelser[0]?.slut, null);
});

test('all-day: a date, the end day is exclusive, no end means one day, one that began before the window stands in it', () => {
  const [a] = les(cal(ev('SUMMARY:Fridag', 'DTSTART;VALUE=DATE:20261104', 'DTEND;VALUE=DATE:20261105'))).haendelser;
  assert.deepEqual([a?.start, a?.slut, a?.heldag], ['2026-11-04', '2026-11-05', true]);
  assert.equal(les(cal(ev('SUMMARY:Fridag', 'DTSTART;VALUE=DATE:20261104'))).haendelser[0]?.slut, '2026-11-05');
  assert.deepEqual(starter(cal(ev('SUMMARY:Tur', 'DTSTART;VALUE=DATE:20261031', 'DTEND;VALUE=DATE:20261104'))), ['2026-10-31']);
  assert.deepEqual(starter(cal(ev('SUMMARY:Fer', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261102'))), [], 'ends the day the window starts: not in it');
});

test('the window: outside is left out, the edges follow Copenhagen days', () => {
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261109T000000'))), [], 'the end day is exclusive');
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261108T233000'))), ['2026-11-08T23:30:00+01:00']);
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261101T200000Z'))), [], 'Sunday evening: before the window');
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'DTSTART:20261101T233000Z'))), ['2026-11-02T00:30:00+01:00'], 'a UTC evening that is already Monday in Copenhagen');
});

test('text: folded lines are joined, escapes undone, control characters and e-mail addresses removed', () => {
  const [h] = les(cal(ev('SUMMARY:Foræl', ' drem\u00f8de\\, 2.B\; velkommen\\nkl. 17 skriv til lærer@skole.example', 'DTSTART:20261103T150000Z', 'LOCATION:Sal\\, 1. sal\u0007'))).haendelser;
  assert.equal(h?.titel, 'Forældremøde, 2.B; velkommen kl. 17 skriv til');
  assert.equal(h?.sted, 'Sal, 1. sal');
  const lang = les(cal(ev(`SUMMARY:${'x'.repeat(500)}`, 'DTSTART:20261103T150000Z'))).haendelser[0];
  assert.equal(lang?.titel.length, 200);
  assert.equal(les(cal(ev('DTSTART:20261103T150000Z'))).haendelser[0]?.titel, '(uden titel)');
});

test('parameters with a quoted colon do not break a line', () => {
  assert.deepEqual(starter(cal(ev('SUMMARY;LANGUAGE="da:DK":Gymnastik', 'DTSTART;TZID="Europe/Copenhagen":20261103T080000'))), ['2026-11-03T08:00:00+01:00']);
});

test('cancelled events are dropped', () => {
  assert.deepEqual(starter(cal(ev('SUMMARY:A', 'STATUS:CANCELLED', 'DTSTART:20261103T070000Z'), ev('SUMMARY:B', 'STATUS:CONFIRMED', 'DTSTART:20261104T070000Z'))), ['2026-11-04T08:00:00+01:00']);
});

test('RRULE DAILY: COUNT counts from the first day even before the window; UNTIL ends it; INTERVAL steps', () => {
  const dag = (rrule: string, start = '20261030T070000Z'): string[] => starter(cal(ev('SUMMARY:A', `DTSTART:${start}`, `RRULE:${rrule}`)));
  assert.deepEqual(dag('FREQ=DAILY;COUNT=5'), ['2026-11-02T08:00:00+01:00', '2026-11-03T08:00:00+01:00'], '30.10, 31.10, 1.11, 2.11, 3.11');
  assert.deepEqual(dag('FREQ=DAILY;UNTIL=20261104T235959Z', '20261102T070000Z'), ['2026-11-02T08:00:00+01:00', '2026-11-03T08:00:00+01:00', '2026-11-04T08:00:00+01:00']);
  assert.deepEqual(dag('FREQ=DAILY;INTERVAL=3', '20261102T070000Z'), ['2026-11-02T08:00:00+01:00', '2026-11-05T08:00:00+01:00', '2026-11-08T08:00:00+01:00']);
});

test('RRULE WEEKLY: BYDAY, INTERVAL, UNTIL and COUNT', () => {
  const uge = (rrule: string, start = '20261102T070000Z'): string[] => starter(cal(ev('SUMMARY:A', `DTSTART:${start}`, `RRULE:${rrule}`)), { fra: '2026-11-02', til: '2026-11-23' }).map((s) => s.slice(0, 10));
  assert.deepEqual(uge('FREQ=WEEKLY;BYDAY=MO,WE'), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18']);
  assert.deepEqual(uge('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'), ['2026-11-03', '2026-11-17'], 'a start on Monday with BYDAY=TU: first Tuesday of the first week, then every second week');
  assert.deepEqual(uge('FREQ=WEEKLY;COUNT=2'), ['2026-11-02', '2026-11-09']);
  assert.deepEqual(uge('FREQ=WEEKLY;UNTIL=20261109T235959Z;BYDAY=MO'), ['2026-11-02', '2026-11-09']);
  assert.deepEqual(uge('FREQ=WEEKLY'), ['2026-11-02', '2026-11-09', '2026-11-16']);
});

test('EXDATE removes one occurrence (a zone, UTC and a date value alike); a changed occurrence (RECURRENCE-ID) replaces it', () => {
  const serie = (...ekstra: string[]): string => cal(ev('SUMMARY:Serie', 'DTSTART;TZID=Europe/Copenhagen:20261102T080000', 'RRULE:FREQ=DAILY;COUNT=4', ...ekstra));
  assert.deepEqual(starter(serie('EXDATE;TZID=Europe/Copenhagen:20261103T080000')).map((s) => s.slice(5, 10)), ['11-02', '11-04', '11-05']);
  assert.deepEqual(starter(serie('EXDATE:20261103T070000Z,20261104T070000Z')).map((s) => s.slice(5, 10)), ['11-02', '11-05']);
  const flyttet = cal(
    `BEGIN:VEVENT\r\nUID:serie\r\nSUMMARY:Serie\r\nDTSTART;TZID=Europe/Copenhagen:20261102T080000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\n`,
    `BEGIN:VEVENT\r\nUID:serie\r\nRECURRENCE-ID;TZID=Europe/Copenhagen:20261103T080000\r\nSUMMARY:Serie flyttet\r\nDTSTART;TZID=Europe/Copenhagen:20261103T130000\r\nEND:VEVENT\r\n`,
  );
  const h = [...les(flyttet).haendelser].sort((a, b) => a.start.localeCompare(b.start)); // the reader does not sort; the connector does
  assert.deepEqual(h.map((x) => [x.titel, x.start.slice(5, 16)]), [['Serie', '11-02T08:00'], ['Serie flyttet', '11-03T13:00'], ['Serie', '11-04T08:00']]);
});

test('a rule it does not expand gives the first occurrence only, and says so', () => {
  const r = les(cal(ev('SUMMARY:Månedlig', 'DTSTART:20261103T070000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=3')));
  assert.deepEqual(r.haendelser.map((h) => h.start), ['2026-11-03T08:00:00+01:00']);
  assert.equal(r.ustoettet, 1);
  for (const regel of ['FREQ=YEARLY', 'FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=DAILY;BYDAY=MO', 'FREQ=HOURLY', 'GIBBERISH']) {
    const x = les(cal(ev('SUMMARY:X', 'DTSTART:20261103T070000Z', `RRULE:${regel}`)));
    assert.equal(x.haendelser.length, 1, regel);
    assert.equal(x.ustoettet, 1, regel);
  }
});

test('malformed input is skipped, never thrown', () => {
  const r = les(cal(
    'BEGIN:VEVENT\r\nSUMMARY:uden start\r\nEND:VEVENT\r\n',
    ev('SUMMARY:Dårlig dato', 'DTSTART:20261342T250000Z'),
    ev('SUMMARY:Ingen tid', 'DTSTART;VALUE=DATE:2026-11-03'),
    'GARBAGE WITHOUT A COLON\r\n:\r\n\u0000\u0001\r\n',
    ev('SUMMARY:God', 'DTSTART:20261103T070000Z'),
    'BEGIN:VEVENT\r\nSUMMARY:aldrig afsluttet\r\nDTSTART:20261104T070000Z\r\n',
  ));
  assert.deepEqual(r.haendelser.map((h) => h.titel), ['God']);
  assert.ok(r.sprunget >= 3);
});

test('not a calendar, and too large, are refused; more than 500 events are cut', () => {
  assert.throws(() => les('<html>Log ind</html>'), (e: unknown) => e instanceof IcsFejl && e.kode === 'ikke-kalender');
  assert.throws(() => les(''), IcsFejl);
  assert.throws(() => les(`BEGIN:VCALENDAR\r\n${'X-PAD:x\r\n'.repeat(Math.ceil(MAKS_BYTES / 9) + 10)}END:VCALENDAR`), (e: unknown) => e instanceof IcsFejl && e.kode === 'stor');
  const mange = cal(...Array.from({ length: MAKS_HAENDELSER + 25 }, (_, i) => `BEGIN:VEVENT\r\nUID:e${i}\r\nSUMMARY:E${i}\r\nDTSTART:20261103T070000Z\r\nEND:VEVENT\r\n`));
  const r = les(mange);
  assert.equal(r.haendelser.length, MAKS_HAENDELSER);
  assert.equal(r.afkortet, true);
});

test('the calendar name is kept as the institution label; nothing else of the file reaches the result', () => {
  const tekst = `BEGIN:VCALENDAR\r\nX-WR-CALNAME:Kløvermarkskolen\r\nBEGIN:VEVENT\r\nUID:hemmelig-uid-1\r\nSUMMARY:Tur\r\nDTSTART:20261103T070000Z\r\nORGANIZER;CN=Lærer Lund:mailto:lund@skole.example\r\nATTENDEE;CN=Barn Et:mailto:barn@skole.example\r\nDESCRIPTION:Lang tekst om børn\r\nURL:https://aula.example/x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const r = les(tekst);
  assert.equal(r.kalenderNavn, 'Kløvermarkskolen');
  assert.deepEqual(Object.keys(r.haendelser[0] ?? {}).sort(), ['heldag', 'sted', 'slut', 'start', 'titel', 'uid'].sort());
  const ud = JSON.stringify(r.haendelser.map(({ uid: _uid, ...rest }) => rest));
  for (const forbudt of ['lund', 'barn@', 'Lang tekst', 'aula.example', 'hemmelig-uid']) assert.ok(!ud.includes(forbudt), forbudt);
});
