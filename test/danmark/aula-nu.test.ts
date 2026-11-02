// KC-0236: Aula in Nu — the relevance rule (today and tomorrow show, next week and the past do not) and the element it
// gives: one per event, in the household zone, with the institution and the time, and no handling of any kind. Pure:
// the week as the connector reads it (KalenderData) in, markup out. Invented titles and institutions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aulaElementer, aulaHaendelser, AULA_MAKS, type AulaVisning } from '../../src/rooms/hjem/aula.ts';
import { hjemEgne, renderHjem, type HjemData } from '../../src/rooms/hjem/render.ts';
import type { Person } from '../../src/identitet/husstand.ts';

// 2026-11-02 11:00 in Copenhagen.
const NU = new Date('2026-11-02T10:00:00Z');
type Raa = Record<string, unknown>;
const ev = (titel: string, start: string, ekstra: Raa = {}): Raa => ({ id: `id-${titel}`, title: titel, start, end: null, all_day: false, calendar: 'Kløvermarkskolen', location: null, ...ekstra });
const uge = (...events: Raa[]): unknown => ({ generated: NU.toISOString(), days: [{ date: '2026-11-02', events }], errors: [] });
const titler = (data: unknown, nu = NU): string[] => aulaHaendelser(data, nu).map((h) => h.titel);

// ---------- the relevance rule: a table ----------

const TABEL: { navn: string; e: Raa; nu?: Date; vises: boolean; dag?: string }[] = [
  { navn: 'later today', e: ev('Idræt', '2026-11-02T13:00:00+01:00', { end: '2026-11-02T14:00:00+01:00' }), vises: true, dag: 'i-dag' },
  { navn: 'under way now', e: ev('Svømning', '2026-11-02T10:00:00+01:00', { end: '2026-11-02T12:00:00+01:00' }), vises: true, dag: 'i-dag' },
  { navn: 'ended this morning: gone from the screen', e: ev('Morgensang', '2026-11-02T08:00:00+01:00', { end: '2026-11-02T09:00:00+01:00' }), vises: false },
  { navn: 'no end, started 3 hours ago: over', e: ev('Samling', '2026-11-02T08:00:00+01:00'), vises: false },
  { navn: 'no end, starts later today', e: ev('Samling', '2026-11-02T15:00:00+01:00'), vises: true, dag: 'i-dag' },
  { navn: 'tomorrow', e: ev('Skolefoto', '2026-11-03T09:00:00+01:00', { end: '2026-11-03T10:00:00+01:00' }), vises: true, dag: 'i-morgen' },
  { navn: 'tomorrow, just after midnight in Copenhagen', e: ev('Tidlig bus', '2026-11-03T00:30:00+01:00'), vises: true, dag: 'i-morgen' },
  { navn: 'the day after tomorrow', e: ev('Udflugt', '2026-11-04T09:00:00+01:00'), vises: false },
  { navn: 'next week', e: ev('Forældremøde', '2026-11-09T17:00:00+01:00'), vises: false },
  { navn: 'yesterday', e: ev('Gårsdagens', '2026-11-01T17:00:00+01:00', { end: '2026-11-01T18:00:00+01:00' }), vises: false },
  { navn: 'all day today', e: ev('Skolen holder fri', '2026-11-02', { all_day: true, end: '2026-11-03' }), vises: true, dag: 'i-dag' },
  { navn: 'all day tomorrow', e: ev('Lærerkursus', '2026-11-03', { all_day: true, end: '2026-11-04' }), vises: true, dag: 'i-morgen' },
  { navn: 'all day, the day after tomorrow', e: ev('Lejrskole', '2026-11-04', { all_day: true, end: '2026-11-05' }), vises: false },
  { navn: 'all day, started last week and still going (a trip)', e: ev('Lejrskole', '2026-10-30', { all_day: true, end: '2026-11-04' }), vises: true, dag: 'i-dag' },
  { navn: 'all day, over since yesterday', e: ev('Temadag', '2026-10-31', { all_day: true, end: '2026-11-02' }), vises: false },
  { navn: 'late evening today (22:30) is still today', e: ev('Aftenfest', '2026-11-02T22:30:00+01:00'), vises: true, dag: 'i-dag' },
  { navn: 'a start that is not a time at all', e: ev('Rod', 'i morgen kl. otte'), vises: false },
  { navn: 'no title', e: ev('', '2026-11-02T15:00:00+01:00'), vises: false },
];
for (const r of TABEL) {
  test(`relevance: ${r.navn} → ${r.vises ? `shown ${r.dag}` : 'not shown'}`, () => {
    const h = aulaHaendelser(uge(r.e), r.nu ?? NU);
    assert.equal(h.length, r.vises ? 1 : 0);
    if (r.vises) assert.equal(aulaElementer({ haendelser: h }, r.nu ?? NU)[0]!.html.s.includes(`data-aula-dag="${r.dag}"`), true);
  });
}

test('relevance follows the clock: the same event leaves the screen once it is over, and is not there the day before it is tomorrow', () => {
  const e = ev('Skolefest', '2026-11-03T15:00:00+01:00', { end: '2026-11-03T17:00:00+01:00' });
  assert.deepEqual(titler(uge(e), new Date('2026-11-02T10:00:00Z')), ['Skolefest'], 'tomorrow, from the evening before');
  assert.deepEqual(titler(uge(e), new Date('2026-11-03T13:00:00Z')), ['Skolefest'], 'today, 14:00, not started');
  assert.deepEqual(titler(uge(e), new Date('2026-11-03T15:59:00Z')), ['Skolefest'], 'today, 16:59, still on');
  assert.deepEqual(titler(uge(e), new Date('2026-11-03T16:01:00Z')), [], 'today, 17:01, over: gone');
  assert.deepEqual(titler(uge(e), new Date('2026-11-01T10:00:00Z')), [], 'two days ahead: not yet');
});

test('the order is the day\'s: all-day first, then by start; and the same id twice is one event', () => {
  const d = uge(ev('Sent', '2026-11-02T18:00:00+01:00'), ev('Tidligt', '2026-11-02T12:00:00+01:00'), ev('Hele dagen', '2026-11-02', { all_day: true, end: '2026-11-03' }), ev('I morgen', '2026-11-03T08:00:00+01:00'), ev('Tidligt', '2026-11-02T12:00:00+01:00', { id: 'id-Tidligt' }));
  assert.deepEqual(titler(d), ['Hele dagen', 'Tidligt', 'Sent', 'I morgen']);
});

test('only what the week carries is kept: title, time, place, institution — any other field never reaches the element', () => {
  const d = uge(ev('Skolefest', '2026-11-02T15:00:00+01:00', { creator: 'laerer@skole.example', attendees: [{ email: 'ella@skole.example' }], description: 'HEMMELIG', location: 'Gymnastiksalen' }));
  const h = aulaHaendelser(d, NU);
  assert.deepEqual(Object.keys(h[0]!).sort(), ['heldag', 'id', 'institution', 'sted', 'slut', 'start', 'titel'].filter((k) => k !== 'slut').sort());
  const html = String(aulaElementer({ haendelser: h }, NU)[0]!.html);
  for (const forbudt of ['laerer@skole.example', 'ella@skole.example', 'HEMMELIG']) assert.ok(!html.includes(forbudt), forbudt);
});

test('data that is not a week is no events (never an error in Nu)', () => {
  for (const d of [null, undefined, 'x', 7, {}, { days: 'x' }, { days: [null, { events: 'x' }, { events: [null, 3, 'x'] }] }]) assert.deepEqual(aulaHaendelser(d, NU), []);
});

// ---------- the element ----------

const kort = (t: string, o: Raa = {}): AulaVisning => ({ haendelser: aulaHaendelser(uge(ev(t, '2026-11-02T16:30:00+01:00', { end: '2026-11-02T17:15:00+01:00', ...o })), NU) });

test('the element: "I dag: titel (institution, kl. tid)", the household zone, and the place as a note', () => {
  const [e] = aulaElementer(kort('Skole-hjem-samtale', { location: 'Klasselokale 2.B' }), NU);
  const h = String(e!.html);
  assert.match(h, /I dag: Skole-hjem-samtale \(Kløvermarkskolen, kl\. 16\.30\)/);
  assert.match(h, /data-datazone="husstand"/);
  assert.match(h, /data-aula-kort=/);
  assert.match(h, /Klasselokale 2\.B/);
  assert.match(h, /data-element="Aula: Skole-hjem-samtale"/);
});

test('tomorrow and all day read as such; no institution means just the time', () => {
  const morgen = aulaElementer({ haendelser: aulaHaendelser(uge(ev('Skolefoto', '2026-11-03T09:00:00+01:00')), NU) }, NU);
  assert.match(String(morgen[0]!.html), /I morgen: Skolefoto \(Kløvermarkskolen, kl\. 09\.00\)/);
  const hel = aulaElementer({ haendelser: aulaHaendelser(uge(ev('Skolen holder fri', '2026-11-02', { all_day: true, end: '2026-11-03', calendar: null })), NU) }, NU);
  assert.match(String(hel[0]!.html), /I dag: Skolen holder fri \(hele dagen\)/);
});

test('INVARIANT: no handling — no button, no data-handling, no instruction, no ask control, no link but the week', () => {
  const hs = aulaElementer(kort('Skole-hjem-samtale'), NU).map((e) => String(e.html)).join('');
  for (const forbudt of ['<button', 'data-handling', 'data-aktion', 'data-spoerg', 'data-instruktion', '<form', 'data-fortryd', 'data-kraever-ja']) assert.ok(!hs.includes(forbudt), forbudt);
  assert.equal((hs.match(/<a /g) ?? []).length, 0, 'one event: no link at all');
});

test('titles are untrusted text: markup in a title is escaped', () => {
  const h = String(aulaElementer(kort('<img src=x onerror=alert(1)>'), NU)[0]!.html);
  assert.ok(!h.includes('<img'));
  assert.match(h, /&lt;img/);
});

test(`more than ${AULA_MAKS} events: the first ${AULA_MAKS} and one line that says how many more and points at the week`, () => {
  const mange = uge(...Array.from({ length: 6 }, (_, i) => ev(`Aftale ${i}`, `2026-11-02T1${i + 2}:00:00+01:00`)));
  const els = aulaElementer({ haendelser: aulaHaendelser(mange, NU) }, NU);
  assert.equal(els.length, AULA_MAKS + 1);
  assert.match(String(els.at(-1)!.html), /3 flere/);
  assert.match(String(els.at(-1)!.html), /href="\/rum\/husstand"/);
  assert.equal(new Set(els.map((e) => e.id)).size, els.length, 'ids are unique');
});

test('nothing due: no element at all', () => {
  assert.deepEqual(aulaElementer(undefined, NU), []);
  assert.deepEqual(aulaElementer({ haendelser: [] }, NU), []);
});

// ---------- in the page ----------

const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const data = (o: Partial<HjemData> = {}): HjemData => ({ hilsen: 'Goddag, Henrik', venter: [], hermes: [], now: NU, person: henrik, ...o });

test('Nu: nothing due means no group and no marker; with an event there is one group "Aula", and it is not something that waits (the count stays)', () => {
  assert.doesNotMatch(String(renderHjem(data())), /data-aula|data-gruppe="Aula"/);
  const h = String(renderHjem(data({ aula: kort('Skole-hjem-samtale') })));
  assert.equal((h.match(/data-gruppe="Aula"/g) ?? []).length, 1);
  assert.match(h, /I dag: Skole-hjem-samtale/);
});

test('Nu: with something that does wait (a Digital Post card) the Aula element is still outside Kræver dig, and the count is the same with and without it', () => {
  const post: HjemData['digitalPost'] = { slags: 'kan-ikke-se', viser: { navn: 'mit.dk', url: 'https://mit.dk/' } };
  const h = String(renderHjem(data({ digitalPost: post, aula: kort('Skole-hjem-samtale') })));
  const k = h.indexOf('data-baand="kraever"');
  assert.ok(k > 0, 'the band exists (so this is not vacuous)');
  const band = h.slice(k, h.indexOf('<!--/baand-->', k));
  assert.match(band, /data-post-kort/);
  assert.doesNotMatch(band, /data-aula-kort/);
  assert.match(h, /data-aula-kort/);
  assert.equal(hjemEgne(data({ digitalPost: post, aula: kort('Skole-hjem-samtale') })), hjemEgne(data({ digitalPost: post })));
});
