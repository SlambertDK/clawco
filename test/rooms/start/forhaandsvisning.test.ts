// KC-0128: the first value without the agent — a preview built purely from what
// the first read returned, per slags. No model call; every text escaped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggForhaandsvisning, forhaandsvisningId, renderForhaandsvisning } from '../../../src/rooms/start/forhaandsvisning.ts';

const NU = new Date('2026-10-31T09:30:00Z'); // 10.30 in Copenhagen
const KAL = { id: 'falsk-kalender', navn: 'Falsk kalender', slags: 'kalender' };
const MAIL = { id: 'falsk-mail', navn: 'Falsk mail', slags: 'mail' };
const aftale = (title: string, start: string, all_day = false) => ({ calendar: 'Arbejde', title, start, end: start, all_day, location: null });
const kalender = (events: Record<string, unknown>[]) => ({ slags: 'kalender', hentet: NU.toISOString(), data: { generated: NU.toISOString(), days: [{ date: '2026-10-31', events }, { date: '2026-11-01', events: [aftale('I morgen', '2026-11-01T08:00:00+01:00')] }], errors: [] } });
const kuvert = (id: string, fra: string, modtaget: string, laest = false) => ({ id, emne: 'x', fra, modtaget, laest, flag: false, vedhaeftning: false });
const mail = (data: unknown[]) => ({ slags: 'mail', hentet: NU.toISOString(), data });

test('calendar with no events today says so', () => {
  const f = byggForhaandsvisning(KAL, kalender([]), NU);
  assert.equal(f.titel, 'Ingen aftaler i dag');
  assert.equal(f.kildeId, 'falsk-kalender');
  assert.equal(f.hentet, NU.toISOString());
});

test('calendar with one timed event names its time and title', () => {
  const f = byggForhaandsvisning(KAL, kalender([aftale('Standup', '2026-10-31T09:00:00+01:00')]), NU);
  assert.equal(f.titel, '1 aftale i dag');
  assert.equal(f.linje, 'Første kl. 09.00: Standup');
});

test('calendar counts every event today and names the earliest timed one', () => {
  const f = byggForhaandsvisning(KAL, kalender([aftale('Frokost', '2026-10-31T12:00:00+01:00'), aftale('Nattevagt', '2026-10-31', true), aftale('Tog', '2026-10-31T07:42:00+01:00')]), NU);
  assert.equal(f.titel, '3 aftaler i dag');
  assert.equal(f.linje, 'Første kl. 07.42: Tog');
});

test('calendar with only all-day events has no clock time', () => {
  const f = byggForhaandsvisning(KAL, kalender([aftale('Maja: nattevagt', '2026-10-31', true)]), NU);
  assert.equal(f.titel, '1 aftale i dag');
  assert.equal(f.linje, 'Hele dagen: Maja: nattevagt');
});

test('mail with no unread says so and counts what was read', () => {
  const f = byggForhaandsvisning(MAIL, mail([kuvert('1', 'Clara', '2026-10-31T08:00:00Z', true)]), NU);
  assert.equal(f.titel, 'Ingen ulæste');
  assert.equal(f.linje, '1 mail læst, alle er læst.');
});

test('mail counts unread and names the newest distinct senders', () => {
  const f = byggForhaandsvisning(MAIL, mail([
    kuvert('1', 'Skolen', '2026-10-31T06:00:00Z'), kuvert('2', 'Clara', '2026-10-31T08:00:00Z'), kuvert('3', 'Clara', '2026-10-30T08:00:00Z'),
    kuvert('4', 'Banken', '2026-10-31T07:00:00Z'), kuvert('5', 'Avisen', '2026-10-29T07:00:00Z'), kuvert('6', 'Læst', '2026-10-31T09:00:00Z', true),
  ]), NU);
  assert.equal(f.titel, '5 ulæste');
  assert.equal(f.linje, 'De nyeste fra Clara, Banken og Skolen');
});

test('notes, news and messages each give a count from the read', () => {
  assert.equal(byggForhaandsvisning({ id: 'n', navn: 'Noter', slags: 'noter' }, { slags: 'noter', hentet: '', data: { personer: [{ navn: 'A', relation: '', mappe: '' }], noter: [{ titel: 'T', sti: 's', aendret: '' }, { titel: 'U', sti: 'u', aendret: '' }] } }, NU).titel, '2 noter og 1 menneske');
  assert.equal(byggForhaandsvisning({ id: 'y', navn: 'Nyheder', slags: 'nyheder' }, { slags: 'nyheder', hentet: '', data: { nyheder: [{ titel: 'Nyt', kilde: 'A' }], status: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] } } }, NU).linje, 'Den nyeste: Nyt');
  assert.equal(byggForhaandsvisning({ id: 'b', navn: 'Beskeder', slags: 'beskeder' }, { slags: 'beskeder', hentet: '', data: [{ kanal: 's', samtaleId: 'f', samtaleNavn: 'F', afsender: { navn: 'Maja' }, tid: '', tekst: 'hej', laest: false }] }, NU).titel, '1 ulæst besked');
});

test('a malformed read gives an empty preview, never a throw', () => {
  const f = byggForhaandsvisning(KAL, { slags: 'kalender', hentet: 'x', data: { days: 'nej' } }, NU);
  assert.equal(f.titel, 'Ingen aftaler i dag');
});

test('the card escapes the source text, carries its stable id, the source tag and the freshness line', () => {
  const f = byggForhaandsvisning(KAL, kalender([aftale('<img src=x onerror=alert(1)>', '2026-10-31T09:00:00+01:00')]), NU);
  const h = renderForhaandsvisning({ ...f, zone: 'privat', ejer: 'henrik' }, NU).s;
  assert.ok(!h.includes('<img'), h);
  assert.match(h, /&lt;img src=x/);
  assert.match(h, /data-forhaandsvisning="falsk-kalender"/);
  assert.match(h, /data-kilde="falsk-kalender"/);
  assert.match(h, /data-blok="kort"/);
  assert.match(h, /data-datazone="privat"/);
  assert.match(h, /opdateret 10\.30/);
  assert.match(h, /data-ask="Kortet: 1 aftale i dag"/);
  assert.equal(forhaandsvisningId('falsk-kalender'), 'forhaandsvisning-falsk-kalender');
});

test('the mail card escapes a sender', () => {
  const f = byggForhaandsvisning(MAIL, mail([kuvert('1', '<b>Ond</b>', '2026-10-31T08:00:00Z')]), NU);
  assert.match(renderForhaandsvisning(f, NU).s, /&lt;b&gt;Ond/);
});
