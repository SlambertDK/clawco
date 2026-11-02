// KC-0117: zones on Nyheder — schema, filter, render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNyhederState, type NyhederState } from '../../src/rooms/nyheder/schema.ts';
import { synligNyheder, synligNyhederLog } from '../../src/rooms/nyheder/room.ts';
import { renderNyheder } from '../../src/rooms/nyheder/render.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { LogEntry } from '../../src/store/types.ts';

const NOW = new Date('2026-10-27T07:10:00Z');
const facts = { nyhedsbreve: [], kilder: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] } };
const svar = (nyhed: Record<string, unknown>) => ({ femLinjer: ['L1'], baner: [{ navn: 'B', nyheder: [{ titel: 'T', hvorfor: 'h', ...nyhed }] }] });
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const medlem: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };

test('a news item without zone is stored privat', () => {
  assert.equal(parseNyhederState(svar({}), facts, NOW).baner[0]?.nyheder[0]?.zone, 'privat');
  assert.equal(parseNyhederState(svar({ zone: 'privat' }), facts, NOW).baner[0]?.nyheder[0]?.zone, 'privat');
});

test('a news item with an unknown zone, or another zone than the run read, is rejected as a schema error', () => {
  assert.throws(() => parseNyhederState(svar({ zone: 'firma' }), facts, NOW), SchemaError);
  assert.throws(() => parseNyhederState(svar({ zone: 'arbejde' }), facts, NOW), SchemaError);
});

const base: NyhederState = {
  dato: '2026-10-27', genereret: '2026-10-27T07:10:00Z', femLinjer: ['L1'],
  baner: [{ navn: 'B', nyheder: [
    { id: 'n1', titel: 'Min nyhed', hvorfor: 'h', zone: 'privat' },
    { id: 'n2', titel: 'Andens nyhed', hvorfor: 'h', zone: 'privat', ejer: 'anden' },
    { id: 'n3', titel: 'Fælles nyhed', hvorfor: 'h', zone: 'husstand' },
    { id: 'n4', titel: 'Gammel nyhed uden zone', hvorfor: 'h' },
  ] }],
  forslag: [], nyhedsbreve: [], kilder: { antal: 1, medNyheder: 1, nyheder: 4, fejlede: [] }, gemt: [], hermesStatus: 'x',
};
const titler = (s: NyhederState): string[] => s.baner.flatMap((b) => b.nyheder.map((n) => n.titel));

test('synligNyheder drops what the person may not see; old items without zone read as privat (the owner)', () => {
  assert.deepEqual(titler(synligNyheder(base, henrik)), ['Min nyhed', 'Fælles nyhed', 'Gammel nyhed uden zone']);
  assert.deepEqual(titler(synligNyheder(base, medlem)), ['Fælles nyhed']);
  assert.deepEqual(titler(synligNyheder(base, gaest)), []);
});

test('a foreign privat news item is absent from the rendered view; a husstand item shows for a member only', () => {
  const vis = (p: Person): string => String(renderNyheder(synligNyheder(base, p), [], NOW));
  assert.doesNotMatch(vis(henrik), /Andens nyhed/);
  assert.match(vis(medlem), /Fælles nyhed/);
  assert.doesNotMatch(vis(gaest), /Fælles nyhed/);
});

test('the summary lines and suggestions, derived from every item, are withheld once any item is hidden', () => {
  const s = synligNyheder({ ...base, forslag: [{ id: 'f1', tekst: 'Forslag' }] }, medlem);
  assert.deepEqual(s.femLinjer, []);
  assert.deepEqual(s.forslag, []);
});

test('a news item row carries data-datazone and a zone chip; a log line carries data-datazone', () => {
  const log: LogEntry[] = [{ id: 'l1', tid: NOW.toISOString(), kilde: 'hermes', tekst: 'Hermes udvalgte', zone: 'privat' }];
  const out = String(renderNyheder(synligNyheder(base, henrik), log, NOW));
  assert.match(out, /<article[^>]*class="row nyhed"[^>]* data-datazone="privat"/);
  assert.match(out, /<article[^>]*class="row nyhed"[^>]* data-datazone="husstand"/);
  assert.match(out, /zone-chip/);
  assert.match(out, /class="row log-row"[^>]* data-datazone="privat"/);
});

test('nothing is withheld when nothing is hidden', () => {
  const kun: NyhederState = { ...base, baner: [{ navn: 'B', nyheder: [{ id: 'n1', titel: 'Min', hvorfor: 'h', zone: 'privat' }] }] };
  assert.deepEqual(synligNyheder(kun, henrik).femLinjer, ['L1']);
});

test('a log line of another person is dropped from the view', () => {
  const log: LogEntry[] = [{ id: 'l2', tid: NOW.toISOString(), kilde: 'hermes', tekst: 'Fremmed linje', zone: 'privat', ejer: 'anden' }];
  assert.doesNotMatch(String(renderNyheder(synligNyheder(base, henrik), synligNyhederLog(log, henrik), NOW)), /Fremmed linje/);
});
