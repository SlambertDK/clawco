// KC-0152: the Saturday card. The same card (same words, same options in the same order) for both adults, only a
// status line is personal; red buttons (a pick goes to another person); nothing for a third member, a settled or
// past card; every name and title escaped (§4 r9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { konfliktKort, konfliktSektion } from '../../src/hushold/konflikt-render.ts';
import { nytKonflikt, weekendKonflikter, type Blok, type Konflikt } from '../../src/hushold/konflikt.ts';
import { anvend, nyForespoergsel, type Forespoergsel } from '../../src/hushold/foresp.ts';
import type { Medlem } from '../../src/hushold/schema.ts';

const NU = new Date('2026-11-03T06:30:00Z'); // Tuesday 07.30
const MEDLEMMER: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer' }, { id: 'rikke', navn: 'Rikke', rolle: 'medlem' },
  { id: 'nora', navn: 'Nora', rolle: 'barn' }, { id: 'maja', navn: 'Maja', rolle: 'gaest' },
];
const blok = (hvem: string, fra: string, til: string, titel?: string): Blok => ({ hvem, start: `2026-11-07T${fra}:00+01:00`, slut: `2026-11-07T${til}:00+01:00`, med: [hvem], ...(titel ? { titel } : {}) });
const kort = (id = 'k-1', titelH = 'Cykeltur', titelI = 'Kaffe med Anne'): Konflikt =>
  nytKonflikt({ id, kandidat: weekendKonflikter([blok('henrik', '09:00', '14:00', titelH), blok('rikke', '11:00', '13:00', titelI)], { medlemmer: MEDLEMMER, ressourcer: [] }, ['2026-11-07'])[0]!, nu: NU });
const sek = (person: string, konflikter: Konflikt[], forespoergsler: Forespoergsel[] = [], now = NU) => String(konfliktSektion({ konflikter, forespoergsler, person, medlemmer: MEDLEMMER, now }));
const kortHtml = (person: string, k = kort(), f: Forespoergsel[] = []) => String(konfliktKort({ k, forespoergsler: f, person, medlemmer: MEDLEMMER, now: NU }));
const PERSONLIG = /<p class="row-note" data-konflikt-venter>[\s\S]*?<\/p>/;

test('both adults see the same words: the question, what each has, and the three options in order', () => {
  const h = kortHtml('henrik');
  assert.match(h, /data-konflikt="k-1"/);
  assert.match(h, /data-blok="beslutning"/);
  assert.match(h, /Hvem har Nora\?/);
  assert.match(h, /Lørdag: Henrik har Cykeltur 9 til 14, Rikke har Kaffe med Anne 11 til 13\./);
  const ordner = [...h.matchAll(/data-konflikt-valg="(v\d)"/g)].map((m) => m[1]);
  assert.deepEqual(ordner, ['v1', 'v2', 'v3']);
  assert.match(h, />Henrik tager Nora</);
  assert.match(h, />Rikke tager Nora</);
  assert.match(h, />Find en tredje</);
});

test('symmetry: the card for Henrik and the card for Rikke are the same markup', () => {
  assert.equal(kortHtml('henrik'), kortHtml('rikke'));
  assert.equal(sek('henrik', [kort()]), sek('rikke', [kort()]));
});

test('every option goes to another person: red buttons, no blue one, none favoured', () => {
  const h = kortHtml('rikke');
  assert.equal((h.match(/class="btn btn-graense"/g) ?? []).length, 3);
  assert.doesNotMatch(h, /btn-primary/);
  assert.match(h, /data-aktion="konflikt-valg"/);
});

test('busy-only titles read "er optaget"', () => {
  const k = nytKonflikt({ id: 'k-2', kandidat: weekendKonflikter([blok('henrik', '09:00', '14:00'), blok('rikke', '11:00', '13:00')], { medlemmer: MEDLEMMER, ressourcer: [] }, ['2026-11-07'])[0]!, nu: NU });
  assert.match(kortHtml('henrik', k), /Henrik er optaget 9 til 14, Rikke er optaget 11 til 13\./);
});

test('a third member and a guest get nothing', () => {
  assert.equal(sek('maja', [kort()]), '');
  assert.equal(sek('nora', [kort()]), '');
});

test('while a request waits the options are gone and each side reads its own line', () => {
  const k = { ...kort(), forespId: 'f1', forespValg: 'v2' };
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'rikke', titel: 'Kan du tage Nora lørdag?' }, NU);
  const h = kortHtml('henrik', k, [f]), i = kortHtml('rikke', k, [f]);
  assert.doesNotMatch(h, /data-konflikt-valg/);
  assert.match(h.match(PERSONLIG)![0], /Du har spurgt Rikke/);
  assert.match(i.match(PERSONLIG)![0], /Henrik har spurgt dig/);
  assert.equal(h.replace(PERSONLIG, ''), i.replace(PERSONLIG, ''), 'only the status line differs');
});

test('after a no the options are back; after a yes, or when the time has come, the card is gone', () => {
  const k = { ...kort(), forespId: 'f1', forespValg: 'v2' };
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'rikke', titel: 'x' }, NU);
  const nej = anvend(f, { slags: 'nej', af: 'rikke' }, NU), ja = anvend(f, { slags: 'ja', af: 'rikke' }, NU);
  assert.ok(nej.ok && ja.ok);
  assert.match(sek('henrik', [k], [nej.f]), /data-konflikt-valg="v1"/);
  assert.equal(sek('henrik', [k], [ja.f]), '');
  assert.equal(sek('henrik', [kort()], [], new Date('2026-11-07T13:00:00Z')), '');
});

test('titles from a calendar are escaped', () => {
  const h = kortHtml('henrik', kort('k-3', '<img src=x onerror=alert(1)>', 'a&b'));
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
  assert.match(h, /a&amp;b/);
});

test('the section is its own group with a count, and several cards stack', () => {
  const h = sek('henrik', [kort('k-1'), { ...kort('k-2'), noegle: '2026-11-08|barn:nora' }]);
  assert.match(h, /data-gruppe="Weekend"/);
  assert.equal((h.match(/data-konflikt="/g) ?? []).length, 2);
  assert.equal(sek('henrik', []), '');
});
