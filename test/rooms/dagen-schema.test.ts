import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, kraevJson, parseDagenState, SchemaError } from '../../src/rooms/dagen/schema.ts';
import { SvarFejl } from '../../src/svarfejl.ts';

const valid = {
  dato: '2026-10-26',
  treLinjer: ['Vigtigste møde kl. 10.', 'Kl. 13 er ledig.', 'Regn fra kl. 11.'],
  anbefaling: { tekst: 'Brug kl. 13 på udkastet.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret en kalenderblok 13-14 "Udkast".', fortryd: 'Slet kalenderblokken 13-14 "Udkast".' } },
  kalender: [{ tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', note: 'Materialet er klar.', status: 'klar' }],
  morgenavis: [{ titel: 'Eksempel Energi strammer reserver', hvorfor: 'Relevant for mødet kl. 10.', kilde: 'Eksempel Energi', url: 'https://example.org/a' }],
  hermesStatus: 'Holder øje med kalenderen',
};

test('extractJson finds the first fenced json block', () => {
  const text = 'Her er dagen:\n```json\n{"a": 1}\n```\nMere tekst.';
  assert.deepEqual(extractJson(text), { a: 1 });
});

test('extractJson falls back to the first top-level object when there is no fence', () => {
  assert.deepEqual(extractJson('Svar: {"a": {"b": 2}} slut'), { a: { b: 2 } });
});

test('kraevJson returns the JSON, and an answer without readable JSON is an unusable answer (KC-0050)', () => {
  assert.deepEqual(kraevJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => kraevJson('bare tekst'), SvarFejl);
  assert.throws(() => kraevJson('```json\n{ikke json\n```'), /ikke kan læses/);
});

test('extractJson returns null when there is no JSON', () => {
  assert.equal(extractJson('bare tekst'), null);
});

test('parseDagenState accepts a valid state and fills genereret', () => {
  const s = parseDagenState(valid, new Date('2026-10-26T07:00:00Z'));
  assert.equal(s.dato, '2026-10-26');
  assert.equal(s.genereret, '2026-10-26T07:00:00.000Z');
  assert.equal(s.treLinjer.length, 3);
  assert.equal(s.anbefaling.handling?.id, 'blok-13');
  assert.equal(s.kalender[0]?.status, 'klar');
});

test('parseDagenState trims treLinjer to three and drops empty lines', () => {
  const s = parseDagenState({ ...valid, treLinjer: ['a', '', 'b', 'c', 'd'] }, new Date());
  assert.deepEqual(s.treLinjer, ['a', 'b', 'c']);
});

test('parseDagenState rejects a missing anbefaling', () => {
  assert.throws(() => parseDagenState({ ...valid, anbefaling: undefined }, new Date()), SchemaError);
});

test('parseDagenState rejects a handling without instruktion', () => {
  const bad = { ...valid, anbefaling: { tekst: 'x', handling: { id: 'h', label: 'Gør' } } };
  assert.throws(() => parseDagenState(bad, new Date()), SchemaError);
});

test('parseDagenState gives handlinger a stable id when Hermes omits one', () => {
  const s = parseDagenState({ ...valid, kalender: [{ tid: '10.00', titel: 'Møde', handling: { label: 'Forbered', instruktion: 'Saml materialet.' } }] }, new Date());
  assert.match(s.kalender[0]?.handling?.id ?? '', /^kal-1-/);
});

test('parseDagenState keeps at most eight morgenavis items and unknown status becomes undefined', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ titel: `T${i}`, hvorfor: 'h' }));
  const s = parseDagenState({ ...valid, morgenavis: many, kalender: [{ tid: '09.00', titel: 'x', status: 'weird' }] }, new Date());
  assert.equal(s.morgenavis.length, 8);
  assert.equal(s.kalender[0]?.status, undefined);
});

test('parseDagenState rejects non-http urls in morgenavis', () => {
  const s = parseDagenState({ ...valid, morgenavis: [{ titel: 'x', hvorfor: 'y', url: 'javascript:alert(1)' }] }, new Date());
  assert.equal(s.morgenavis[0]?.url, undefined);
});

test('KC-0059: visuel, the anbefaling pictogram and the kalender pictograms are kept; invalid ones are dropped', () => {
  const s = parseDagenState({
    ...valid,
    visuel: { ikon: 'sun', billede: { art: 'dagslinje', fra: 7, til: 19, zoner: [{ fra: '11:00', til: '14:00', slags: 'regn' }], punkter: [{ tid: '10:00', ikon: 'calendar', tekst: 'Driften' }] } },
    anbefaling: { ...valid.anbefaling, ikon: 'clock' },
    kalender: [{ tid: '10.00', titel: 'A', ikon: 'users' }, { tid: '11.00', titel: 'B', ikon: 'findes-ikke' }, { tid: '12.00', titel: 'C' }],
  }, new Date('2026-10-26T06:00:00Z'));
  assert.equal(s.visuel?.ikon, 'sun');
  assert.equal(s.visuel?.billede?.art, 'dagslinje');
  assert.equal(s.anbefaling.ikon, 'clock');
  assert.equal(s.kalender[0]?.ikon, 'users');
  assert.equal(s.kalender[1]?.ikon, undefined);
  assert.equal('ikon' in s.kalender[2]!, false);
});

test('KC-0059: a bad visuel or anbefaling pictogram is dropped, the state still parses', () => {
  const s = parseDagenState({ ...valid, visuel: { ikon: 'findes-ikke' }, anbefaling: { ...valid.anbefaling, ikon: 42 } }, new Date('2026-10-26T06:00:00Z'));
  assert.equal(s.visuel, undefined);
  assert.equal(s.anbefaling.ikon, undefined);
  assert.equal('visuel' in s, false);
  assert.equal('ikon' in s.anbefaling, false);
});

test('KC-0066: a handling that goes to other people keeps tilAndre: true; anything else leaves the flag out', () => {
  const s = parseDagenState({
    ...valid,
    anbefaling: { tekst: 'Send dagsordenen i dag.', handling: { id: 'dags', label: 'Send dagsorden', instruktion: 'Lav et udkast til dagsorden.', tilAndre: true } },
    kalender: [{ tid: '10.00', titel: 'Driften', handling: { id: 'k', label: 'Forbered', instruktion: 'i', tilAndre: 'ja' } }],
  }, new Date('2026-10-26T06:00:00Z'));
  assert.equal(s.anbefaling.handling?.tilAndre, true);
  assert.equal('tilAndre' in s.kalender[0]!.handling!, false, 'only a literal true counts');
});
