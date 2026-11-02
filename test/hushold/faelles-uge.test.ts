// KC-0148: the shared week — a pure merge of what concerns the household:
// events from calendars in the husstand zone, resource bookings and accepted
// requests. Nothing from a privat or arbejde calendar ever enters (D2/E7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faellesUge, ugeDage, type FaellesForesp, type KalenderLaesning } from '../../src/hushold/uge.ts';
import { TOM_HUSSTAND, type Medlem, type Ressource } from '../../src/hushold/schema.ts';

const UGE = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const MEDLEMMER: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer', tailnetLogin: 'henrik@example.com' },
  { id: 'maja', navn: 'Maja', rolle: 'medlem', tailnetLogin: 'Maja@Example.com' },
  { id: 'ella', navn: 'Ella', rolle: 'barn' }, // no calendar of her own
];

type Raa = Record<string, unknown>;
const ev = (id: string, title: string, start: string, end: string, ekstra: Raa = {}): Raa => ({ id, title, start, end, all_day: false, calendar: 'Familie', location: null, creator: null, attendees: [], ...ekstra });
const kal = (zone: KalenderLaesning['zone'], ejer: string | null, events: Raa[]): KalenderLaesning => ({
  zone, ejer, data: { generated: '2026-11-02T06:00:00+01:00', days: UGE.map((date) => ({ date, events: events.filter((e) => String(e['start']).startsWith(date)) })), errors: [] },
});
const ingen = { ressourcer: [] as Ressource[], forespoergsler: [] as FaellesForesp[] };
const alle = (u: ReturnType<typeof faellesUge>) => u.flatMap((d) => d.poster);

test('a privat and an arbejde event never appear; a husstand one does', () => {
  const u = faellesUge(MEDLEMMER, {
    ...ingen,
    kalendere: [
      kal('privat', 'henrik', [ev('p1', 'Lægetid', '2026-11-03T09:00:00+01:00', '2026-11-03T09:30:00+01:00')]),
      kal('arbejde', 'henrik', [ev('a1', 'Styregruppe', '2026-11-03T10:00:00+01:00', '2026-11-03T11:00:00+01:00')]),
      kal('husstand', 'henrik', [ev('h1', 'Fællesspisning', '2026-11-03T18:00:00+01:00', '2026-11-03T19:30:00+01:00')]),
    ],
  }, UGE);
  const titler = alle(u).map((p) => p.titel);
  assert.deepEqual(titler, ['Fællesspisning']);
  assert.ok(!JSON.stringify(u).includes('Lægetid') && !JSON.stringify(u).includes('Styregruppe'));
});

test('one entry per day of the week, in order; within a day all-day first, then by start', () => {
  const u = faellesUge(MEDLEMMER, {
    ...ingen,
    kalendere: [kal('husstand', 'maja', [
      ev('s', 'Svømning', '2026-11-04T16:30:00+01:00', '2026-11-04T17:30:00+01:00'),
      ev('m', 'Morgenmad', '2026-11-04T07:00:00+01:00', '2026-11-04T07:30:00+01:00'),
      ev('h', 'Farmor på besøg', '2026-11-04', '2026-11-05', { all_day: true }),
    ])],
  }, UGE);
  assert.deepEqual(u.map((d) => d.dato), UGE);
  const onsdag = u.find((d) => d.dato === '2026-11-04')!;
  assert.deepEqual(onsdag.poster.map((p) => p.titel), ['Farmor på besøg', 'Morgenmad', 'Svømning']);
  assert.equal(onsdag.poster[0]!.heldag, true);
});

test('who an event belongs to: members among the attendees or the creator, else the calendar\'s owner, else everyone', () => {
  const u = faellesUge(MEDLEMMER, {
    ...ingen,
    kalendere: [
      kal('husstand', 'henrik', [
        ev('e1', 'Forældremøde', '2026-11-05T19:00:00+01:00', '2026-11-05T20:00:00+01:00', { attendees: [{ email: 'maja@example.com', self: false }, { email: 'laerer@skole.invalid' }] }),
        ev('e2', 'Indkøb', '2026-11-05T10:00:00+01:00', '2026-11-05T11:00:00+01:00', { creator: 'henrik@example.com' }),
        ev('e3', 'Rengøring', '2026-11-05T12:00:00+01:00', '2026-11-05T13:00:00+01:00'),
      ]),
      kal('husstand', null, [ev('e4', 'Juletræ', '2026-11-06T12:00:00+01:00', '2026-11-06T13:00:00+01:00')]),
    ],
  }, UGE);
  const hvem = Object.fromEntries(alle(u).map((p) => [p.titel, p.hvem]));
  assert.deepEqual(hvem['Forældremøde'], ['maja']);
  assert.deepEqual(hvem['Indkøb'], ['henrik']);
  assert.deepEqual(hvem['Rengøring'], ['henrik'], 'the owner of the calendar');
  assert.deepEqual(hvem['Juletræ'], [], 'no owner known: the whole household');
});

test('the same event in two members\' calendars is one entry with both names', () => {
  const faelles = (id: string) => ev(id, 'Ellas fødselsdag', '2026-11-07T14:00:00+01:00', '2026-11-07T17:00:00+01:00');
  const u = faellesUge(MEDLEMMER, { ...ingen, kalendere: [kal('husstand', 'henrik', [faelles('f1')]), kal('husstand', 'maja', [faelles('f1')])] }, UGE);
  const p = alle(u);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0]!.hvem, ['henrik', 'maja']);
});

test('a member without a calendar, and no calendars at all, break nothing', () => {
  const u = faellesUge(MEDLEMMER, { ...ingen, kalendere: [] }, UGE);
  assert.equal(u.length, 7);
  assert.equal(alle(u).length, 0);
  const odd = faellesUge(MEDLEMMER, { ...ingen, kalendere: [{ zone: 'husstand', ejer: 'ella', data: 'ikke json' }, { zone: 'husstand', ejer: 'ella', data: { days: [{ date: '2026-11-02', events: [null, { title: 'Uden tid' }, { start: '2026-11-02T10:00:00+01:00' }] }] } }] }, UGE);
  assert.equal(alle(odd).length, 0);
});

test('events outside the week are left out', () => {
  const u = faellesUge(MEDLEMMER, { ...ingen, kalendere: [kal('husstand', 'maja', [ev('x', 'Næste uge', '2026-11-09T10:00:00+01:00', '2026-11-09T11:00:00+01:00'), ev('y', 'Sidste uge', '2026-11-01T10:00:00+01:00', '2026-11-01T11:00:00+01:00')])] }, ['2026-11-02']);
  assert.equal(alle(u).length, 0);
});

test('bookings and accepted requests land; a request still asked does not', () => {
  const ressourcer: Ressource[] = [{ id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['maja'], kalender: [{ id: 'b1', ressourceId: 'stor-bil', af: 'maja', start: '2026-11-07T08:00:00.000Z', slut: '2026-11-07T16:00:00.000Z', titel: 'Til Odense' }] }];
  const forespoergsler: FaellesForesp[] = [
    { id: 'f1', fra: 'ella', til: 'henrik', titel: 'Kørsel til spejder', tid: { start: '2026-11-06T17:00:00.000Z', slut: '2026-11-06T18:00:00.000Z' }, tilstand: 'accepteret' },
    { id: 'f2', fra: 'maja', til: 'henrik', titel: 'Låne bilen søndag', tid: { start: '2026-11-08T08:00:00.000Z', slut: '2026-11-08T12:00:00.000Z' }, tilstand: 'spurgt' },
  ];
  const u = faellesUge(MEDLEMMER, { kalendere: [], ressourcer, forespoergsler }, UGE);
  const p = alle(u);
  assert.deepEqual(p.map((x) => [x.kilde, x.titel, x.hvem]), [
    ['aftale', 'Kørsel til spejder', ['ella', 'henrik']],
    ['booking', 'Den store bil: Til Odense', ['maja']],
  ]);
  assert.equal(TOM_HUSSTAND.ressourcer.length, 0);
});

test('ugeDage: seven Copenhagen dates from today (late evening UTC is already tomorrow there)', () => {
  assert.deepEqual(ugeDage(new Date('2026-11-01T23:30:00Z')), UGE);
  assert.equal(ugeDage(new Date('2026-11-02T08:00:00Z'), 2).length, 2);
});

// KC-0236: the calendar's name is the event's source label — for Aula it is the institution's name.
test('KC-0236: a calendar event carries its calendar\'s name as the institution label; a calendar without a name gives none, and the name is capped', () => {
  const u = faellesUge(MEDLEMMER, {
    ...ingen,
    kalendere: [kal('husstand', 'henrik', [
      ev('s1', 'Skole-hjem-samtale', '2026-11-03T16:30:00+01:00', '2026-11-03T17:15:00+01:00', { calendar: 'Kløvermarkskolen' }),
      ev('s2', 'Uden navn', '2026-11-03T18:00:00+01:00', '2026-11-03T19:00:00+01:00', { calendar: null }),
      ev('s3', 'Langt navn', '2026-11-03T20:00:00+01:00', '2026-11-03T21:00:00+01:00', { calendar: 'x'.repeat(300) }),
    ])],
  }, UGE);
  const p = alle(u);
  assert.equal(p.find((x) => x.titel === 'Skole-hjem-samtale')!.institution, 'Kløvermarkskolen');
  assert.equal(p.find((x) => x.titel === 'Uden navn')!.institution, undefined);
  assert.equal(p.find((x) => x.titel === 'Langt navn')!.institution!.length, 80);
});

test('KC-0236: a booking and an accepted request have no institution', () => {
  const forespoergsler: FaellesForesp[] = [{ id: 'f1', fra: 'ella', til: 'henrik', titel: 'Kørsel', tid: { start: '2026-11-06T17:00:00.000Z', slut: '2026-11-06T18:00:00.000Z' }, tilstand: 'accepteret' }];
  assert.equal(alle(faellesUge(MEDLEMMER, { kalendere: [], ressourcer: [], forespoergsler }, UGE))[0]!.institution, undefined);
});
