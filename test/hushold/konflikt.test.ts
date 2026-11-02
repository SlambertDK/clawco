// KC-0152: the pure part of the Saturday conflict — busy blocks from calendars (titles only when allowed), the
// candidate (two adults busy at the same time and something to cover), the card's wording, its status and the
// validation of Hermes' phrasing. No I/O.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blokkeFraKalendere, konfliktResume, konfliktStatus, nytKonflikt, parseKonfliktTekst, valgTitel, weekendKonflikter,
  type Blok, type Konflikt, type OptagetKalender,
} from '../../src/hushold/konflikt.ts';
import type { Medlem, Ressource } from '../../src/hushold/schema.ts';
import { nyForespoergsel, anvend } from '../../src/hushold/foresp.ts';

const HENRIK: Medlem = { id: 'henrik', navn: 'Henrik', rolle: 'ejer', tailnetLogin: 'henrik@example.com' };
const RIKKE: Medlem = { id: 'rikke', navn: 'Rikke', rolle: 'medlem', tailnetLogin: 'rikke@example.com' };
const NORA: Medlem = { id: 'nora', navn: 'Nora', rolle: 'barn' };
const MEDLEMMER = [HENRIK, RIKKE, NORA];
const LOERDAG = '2026-11-07';
const SOENDAG = '2026-11-08';
const t = (dag: string, hhmm: string): string => `${dag}T${hhmm}:00+01:00`;
const blok = (hvem: string, dag: string, fra: string, til: string, titel?: string, med: string[] = [hvem]): Blok =>
  ({ hvem, start: t(dag, fra), slut: t(dag, til), med, ...(titel ? { titel } : {}) });
const H = (fra = '09:00', til = '14:00', titel?: string) => blok('henrik', LOERDAG, fra, til, titel);
const I = (fra = '11:00', til = '13:00', titel?: string) => blok('rikke', LOERDAG, fra, til, titel);
const husstand = (medlemmer: Medlem[] = MEDLEMMER, ressourcer: Ressource[] = []) => ({ medlemmer, ressourcer });
const DAGE = [LOERDAG, SOENDAG];

test('two adults busy at once with a child at home is one candidate, names in alphabetical order', () => {
  const k = weekendKonflikter([H('09:00', '14:00', 'Cykeltur'), I('11:00', '13:00', 'Kaffe')], husstand(), DAGE);
  assert.equal(k.length, 1);
  assert.equal(k[0]!.dag, LOERDAG);
  assert.deepEqual(k[0]!.parter, ['henrik', 'rikke']);
  assert.deepEqual(k[0]!.behov, { slags: 'barn', id: 'nora', navn: 'Nora' });
  assert.deepEqual(k[0]!.tid, { start: new Date(t(LOERDAG, '11:00')).toISOString(), slut: new Date(t(LOERDAG, '13:00')).toISOString() });
  assert.deepEqual(k[0]!.blokke.map((b) => b.hvem), ['henrik', 'rikke']);
});

test('no child and no booking: no candidate (nothing to cover)', () => {
  assert.deepEqual(weekendKonflikter([H(), I()], husstand([HENRIK, RIKKE]), DAGE), []);
});

test('busy at different times: no candidate; touching edges do not overlap', () => {
  assert.deepEqual(weekendKonflikter([H('09:00', '11:00'), I('11:00', '13:00')], husstand(), DAGE), []);
  assert.deepEqual(weekendKonflikter([H('09:00', '10:00'), I('15:00', '16:00')], husstand(), DAGE), []);
});

test('only one adult busy: no candidate', () => {
  assert.deepEqual(weekendKonflikter([H()], husstand(), DAGE), []);
});

test('a household with three adults gets no candidate (out of scope)', () => {
  const tredje: Medlem = { id: 'maja', navn: 'Maja', rolle: 'medlem' };
  assert.deepEqual(weekendKonflikter([H(), I()], husstand([...MEDLEMMER, tredje]), DAGE), []);
});

test('a guest is not an adult', () => {
  const gaest: Medlem = { id: 'farmor', navn: 'Farmor', rolle: 'gaest' };
  assert.equal(weekendKonflikter([H(), I()], husstand([...MEDLEMMER, gaest]), DAGE).length, 1);
});

test('a child who is at the same event as the adults is not a need', () => {
  const sammen = [blok('henrik', LOERDAG, '14:00', '17:00', 'Fødselsdag', ['henrik', 'rikke', 'nora']), blok('rikke', LOERDAG, '14:00', '17:00', 'Fødselsdag', ['henrik', 'rikke', 'nora'])];
  assert.deepEqual(weekendKonflikter(sammen, husstand(), DAGE), []);
});

test('Sunday is checked too, one candidate per day and need', () => {
  const k = weekendKonflikter([H(), I(), blok('henrik', SOENDAG, '10:00', '12:00'), blok('rikke', SOENDAG, '10:30', '11:30')], husstand(), DAGE);
  assert.deepEqual(k.map((x) => x.dag), [LOERDAG, SOENDAG]);
  assert.equal(new Set(k.map((x) => x.noegle)).size, 2);
});

test('blocks on other days (a Monday) are ignored', () => {
  assert.deepEqual(weekendKonflikter([blok('henrik', '2026-11-09', '09:00', '14:00'), blok('rikke', '2026-11-09', '11:00', '13:00')], husstand(), DAGE), []);
});

test('a household resource booked in the window is a shared need even without a child', () => {
  const bil: Ressource = { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [{ id: 'b1', ressourceId: 'stor-bil', af: 'henrik', start: t(LOERDAG, '12:00'), slut: t(LOERDAG, '16:00'), titel: 'Tur' }] };
  const k = weekendKonflikter([H(), I()], husstand([HENRIK, RIKKE], [bil]), DAGE);
  assert.equal(k.length, 1);
  assert.deepEqual(k[0]!.behov, { slags: 'ressource', id: 'stor-bil', navn: 'Den store bil' });
  assert.deepEqual(k[0]!.tid, { start: new Date(t(LOERDAG, '12:00')).toISOString(), slut: new Date(t(LOERDAG, '13:00')).toISOString() });
});

test('a resource booked outside the window is no need', () => {
  const bil: Ressource = { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik'], kalender: [{ id: 'b1', ressourceId: 'stor-bil', af: 'henrik', start: t(LOERDAG, '15:00'), slut: t(LOERDAG, '16:00'), titel: 'Tur' }] };
  assert.deepEqual(weekendKonflikter([H(), I()], husstand([HENRIK, RIKKE], [bil]), DAGE), []);
});

test('symmetry: swapping the order of members and blocks gives the same candidate', () => {
  const a = weekendKonflikter([H(), I()], husstand([HENRIK, RIKKE, NORA]), DAGE);
  const b = weekendKonflikter([I(), H()], husstand([NORA, RIKKE, HENRIK]), DAGE);
  assert.deepEqual(a, b);
  assert.deepEqual(a[0]!.parter, ['henrik', 'rikke']);
});

test('order of the parties follows the name, not the id', () => {
  const anna: Medlem = { id: 'z-anna', navn: 'Anna', rolle: 'medlem' };
  const k = weekendKonflikter([H(), blok('z-anna', LOERDAG, '11:00', '13:00')], husstand([HENRIK, anna, NORA]), DAGE);
  assert.deepEqual(k[0]!.parter, ['z-anna', 'henrik']);
});

// ---------- busy blocks from calendars ----------

const dagData = (events: Record<string, unknown>[]) => ({ generated: t(LOERDAG, '06:00'), days: [{ date: LOERDAG, events }], errors: [] });
const event = (o: Record<string, unknown> = {}) => ({ id: 'e1', title: 'Cykeltur', start: t(LOERDAG, '09:00'), end: t(LOERDAG, '14:00'), all_day: false, description: 'HEMMELIG BRØDTEKST', ...o });
const kal = (zone: OptagetKalender['zone'], ejer: string | null, events: Record<string, unknown>[], delerTitel = false): OptagetKalender => ({ zone, ejer, data: dagData(events), delerTitel });

test('busy-only by default: a private or work title never leaves the calendar', () => {
  const b = blokkeFraKalendere([kal('privat', 'henrik', [event()]), kal('arbejde', 'rikke', [event({ id: 'e2', title: 'Styregruppe' })])], MEDLEMMER);
  assert.equal(b.length, 2);
  assert.ok(b.every((x) => x.titel === undefined));
  assert.deepEqual(b.map((x) => x.hvem).sort(), ['henrik', 'rikke']);
  assert.doesNotMatch(JSON.stringify(b), /Cykeltur|Styregruppe|HEMMELIG/);
});

test('the title-sharing rule reveals the title of that owner’s calendar only', () => {
  const b = blokkeFraKalendere([kal('privat', 'henrik', [event()], true), kal('privat', 'rikke', [event({ id: 'e2', title: 'Kaffe med Signe' })], false)], MEDLEMMER);
  assert.equal(b.find((x) => x.hvem === 'henrik')?.titel, 'Cykeltur');
  assert.equal(b.find((x) => x.hvem === 'rikke')?.titel, undefined);
});

test('an event in zone husstand shows its title, and belongs to its attendees', () => {
  const b = blokkeFraKalendere([kal('husstand', 'henrik', [event({ title: 'Ellas fødselsdag', attendees: [{ email: 'henrik@example.com' }, { email: 'rikke@example.com' }] })])], MEDLEMMER);
  assert.deepEqual(b.map((x) => x.hvem).sort(), ['henrik', 'rikke']);
  assert.ok(b.every((x) => x.titel === 'Ellas fødselsdag' && x.med.length === 2));
});

test('bodies are never read; all-day entries and unreadable times are not busy blocks', () => {
  const b = blokkeFraKalendere([kal('privat', 'henrik', [event({ all_day: true }), event({ id: 'x', start: 'ikke en tid' }), event({ id: 'y', end: undefined })])], MEDLEMMER);
  assert.equal(b.length, 1);
  assert.equal(Date.parse(b[0]!.slut) - Date.parse(b[0]!.start), 3600_000, 'no end = one hour');
  assert.doesNotMatch(JSON.stringify(b), /HEMMELIG/);
});

test('a calendar of nobody known adds nothing', () => {
  assert.deepEqual(blokkeFraKalendere([kal('privat', null, [event()]), kal('privat', 'ukendt', [event()])], MEDLEMMER), []);
});

// ---------- the card ----------

const NU = new Date('2026-11-03T06:30:00Z');
const kandidat = () => weekendKonflikter([H('09:00', '14:00', 'cykeltur'), I('11:00', '13:00', 'kaffe med Anne')], husstand(), DAGE)[0]!;
const kort = (): Konflikt => nytKonflikt({ id: 'k-1', kandidat: kandidat(), nu: NU });

test('the card has the options A tager, B tager, find en tredje, in that order', () => {
  const k = kort();
  assert.deepEqual(k.valg.map((v) => [v.id, v.slags, 'hvem' in v ? v.hvem : null]), [['v1', 'tager', 'henrik'], ['v2', 'tager', 'rikke'], ['v3', 'tredje', null]]);
  assert.deepEqual(k.parter, ['henrik', 'rikke']);
});

test('the summary says what each has, with the titles that were shared, and asks who has Nora', () => {
  const r = konfliktResume(kort(), MEDLEMMER);
  assert.equal(r.resume, 'Lørdag: Henrik har cykeltur 9 til 14, Rikke har kaffe med Anne 11 til 13.');
  assert.equal(r.spoergsmaal, 'Hvem har Nora?');
});

test('without shared titles the summary says optaget; and it never says du', () => {
  const k = nytKonflikt({ id: 'k-2', kandidat: weekendKonflikter([H(), I()], husstand(), DAGE)[0]!, nu: NU });
  const r = konfliktResume(k, MEDLEMMER);
  assert.equal(r.resume, 'Lørdag: Henrik er optaget 9 til 14, Rikke er optaget 11 til 13.');
  assert.doesNotMatch(`${r.resume} ${r.spoergsmaal}`, /\bdu\b|\bdig\b|\bdin\b/i);
});

test('Hermes’ phrasing replaces the fixed words only when it names both and is neutral', () => {
  const k = kort();
  const god = parseKonfliktTekst('```json\n{"resume":"Lørdag er Henrik på cykeltur 9 til 14 og Rikke til kaffe 11 til 13.","spoergsmaal":"Hvem er hos Nora?"}\n```', k, MEDLEMMER);
  assert.deepEqual(god, { resume: 'Lørdag er Henrik på cykeltur 9 til 14 og Rikke til kaffe 11 til 13.', spoergsmaal: 'Hvem er hos Nora?' });
  assert.deepEqual(konfliktResume({ ...k, tekst: god! }, MEDLEMMER), god);
});

test('a bad Hermes block is refused: garbage, a missing name, "du", too long, control characters', () => {
  const k = kort();
  const blok = (o: unknown) => `\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
  assert.equal(parseKonfliktTekst('ingen blok', k, MEDLEMMER), null);
  assert.equal(parseKonfliktTekst('```json\n{ikke json\n```', k, MEDLEMMER), null);
  assert.equal(parseKonfliktTekst(blok({ resume: 'Henrik er væk.', spoergsmaal: 'Hvem har Nora?' }), k, MEDLEMMER), null, 'Rikke missing');
  assert.equal(parseKonfliktTekst(blok({ resume: 'Henrik og Rikke er væk.', spoergsmaal: 'Hvem har du Nora?' }), k, MEDLEMMER), null, 'du');
  assert.equal(parseKonfliktTekst(blok({ resume: `Henrik og Rikke ${'x'.repeat(400)}`, spoergsmaal: 'Hvem?' }), k, MEDLEMMER), null, 'too long');
  assert.equal(parseKonfliktTekst(blok({ resume: 'Henrik og Rikke\u0007 er væk.', spoergsmaal: 'Hvem?' }), k, MEDLEMMER), null, 'control char');
  assert.equal(parseKonfliktTekst(blok({ resume: 'Henrik og Rikke er væk.' }), k, MEDLEMMER), null, 'no question');
});

test('every option’s request title, from the asker’s side', () => {
  const k = kort();
  const titel = (id: string, asker: string) => valgTitel(k, k.valg.find((v) => v.id === id)!, asker);
  assert.equal(titel('v1', 'henrik'), 'Jeg tager Nora lørdag kl. 11.00–13.00. Passer det?');
  assert.equal(titel('v2', 'henrik'), 'Kan du tage Nora lørdag kl. 11.00–13.00?');
  assert.equal(titel('v1', 'rikke'), 'Kan du tage Nora lørdag kl. 11.00–13.00?');
  assert.equal(titel('v3', 'rikke'), 'Kan vi finde en tredje til Nora lørdag kl. 11.00–13.00?');
});

test('status: open, waiting on a request, settled by an accepted one, open again after a no', () => {
  const k = { ...kort(), forespId: 'f1', forespValg: 'v2' };
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'rikke', titel: 'x' }, NU);
  assert.equal(konfliktStatus(kort(), [], NU), 'aaben');
  assert.equal(konfliktStatus(k, [f], NU), 'venter');
  const ja = anvend(f, { slags: 'ja', af: 'rikke' }, NU);
  const nej = anvend(f, { slags: 'nej', af: 'rikke' }, NU);
  assert.ok(ja.ok && nej.ok);
  assert.equal(konfliktStatus(k, [ja.f], NU), 'afgjort');
  assert.equal(konfliktStatus(k, [nej.f], NU), 'aaben');
  assert.equal(konfliktStatus(kort(), [], new Date(kort().tid.slut)), 'forbi');
});

test('the title-sharing rule is an active rule for kalender / del titel i husstanden, nothing else', async () => {
  const { delerTitelRegel } = await import('../../src/hushold/konflikt.ts');
  const r = (kilde: string, slags: string | undefined, status = 'aktiv') => ({ gaelder: { kilde, ...(slags ? { slags } : {}) }, status });
  assert.equal(delerTitelRegel([r('kalender', 'del titel i husstanden')]), true);
  assert.equal(delerTitelRegel([r('kalender', 'del titel i husstanden', 'pause')]), false, 'a paused rule is not followed');
  assert.equal(delerTitelRegel([r('kalender', undefined)]), false);
  assert.equal(delerTitelRegel([r('mail', 'del titel i husstanden')]), false);
  assert.equal(delerTitelRegel([]), false);
});
