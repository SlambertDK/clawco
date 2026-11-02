// KC-0170: the Univers room's screens in the profile's language. Danish when no language is chosen (Henrik's
// installation: byte for byte as before, test/fixtures/sprog-univers/), English when the profile says so, with no
// Danish word left in what the user reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/shell/tekster.ts';
import { UNIVERS_TEKSTER } from '../../src/rooms/univers/tekster.ts';
import { universOversigt } from '../../src/rooms/univers/room.ts';
import { tomtIndeks, type UniversIndeks } from '../../src/rooms/univers/schema.ts';
import { UNIVERS } from '../fixtures/sprog-golden-univers.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-univers', navn), 'utf8');

/** Strings that are the same in both languages on purpose (names, and words English borrows). */
const ENS = new Set<string>([]);

test('English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(UNIVERS_TEKSTER.en), form(UNIVERS_TEKSTER.da));
  for (const t of [UNIVERS_TEKSTER.da, UNIVERS_TEKSTER.en]) assert.deepEqual(tomme(t as unknown as Record<string, unknown>), []);
  const ens = ensStrenge(UNIVERS_TEKSTER.da as unknown as Record<string, unknown>, UNIVERS_TEKSTER.en as unknown as Record<string, unknown>);
  assert.deepEqual(ens.filter((k) => !ENS.has(k)), []);
});

test('Henrik\'s installation: with no language chosen, and with Danish chosen, every Univers screen renders byte for byte as before', () => {
  const filer = readdirSync(path.join(rod, '../fixtures/sprog-univers')).sort();
  assert.deepEqual(Object.keys(UNIVERS).map((k) => `${k}.html`).sort(), filer, 'every golden has a case');
  // One difference is allowed, as in the shell's goldens: a quotation mark that was literal markup now comes through
  // the escaper as &quot;, which the browser shows as the same character.
  const samme = (s: string): string => s.replaceAll('&quot;', '"');
  for (const [k, lav] of Object.entries(UNIVERS)) {
    assert.equal(samme(lav()), samme(fixtur(`${k}.html`)), k);
    assert.equal(samme(medSprog('da', lav)), samme(fixtur(`${k}.html`)), `${k} (da chosen)`);
  }
});

/** data-element is the context handed to Hermes with "Spørg"/"Skriv om" (prompt.ts and room.ts match its Danish prefixes), not what the user reads. */
const udenElement = (doc: string): string => doc.replace(/ data-element="[^"]*"/g, '');

test('English: no Danish word on any Univers screen', () => {
  for (const [k, lav] of Object.entries(UNIVERS)) assert.deepEqual(danskeLinjer(udenElement(medSprog('en', lav))), [], k);
});

test('English: the room speaks English, with times, counts and plurals in English too', () => {
  const en = (k: string): string => medSprog('en', UNIVERS[k]!);
  const oversigt = en('oversigt');
  assert.match(oversigt, /Your universes/);
  assert.match(oversigt, /New meetings/);
  assert.match(oversigt, /2 meetings · 3 open tasks/);
  assert.match(oversigt, /1 meeting · 1 open task</);
  assert.match(oversigt, /tomorrow 09:30–10:30/);
  assert.match(oversigt, />New universe</);
  assert.match(oversigt, /placeholder="E\.g\. /);
  assert.match(en('oversigt-uden-univers'), /Create a universe first/);
  assert.match(en('oversigt-tom'), /No universes yet/);
  const univers = en('univers-fuld');
  assert.match(univers, />All universes</);
  assert.match(univers, /changed today 10:00 · 2 versions/);
  assert.match(univers, /changed yesterday 10:00 · 1 version</);
  assert.match(univers, /Sat 24 Oct 10:00/);
  assert.match(univers, />Undo</);
  assert.match(univers, /Undone at 09:30/);
  assert.match(univers, />Done</);
  assert.match(en('univers-tom'), /No documents yet/);
  const moede = en('moede-forberedt');
  assert.match(moede, /Talking points/);
  assert.match(moede, /Tasks for the meeting/);
  assert.match(en('moede-koerende'), /45 min left/);
  assert.match(en('moede-lang'), /in 3 h/);
  assert.match(en('moede-ufoert'), /Not prepared yet/);
});

test('English: the Nu line for meetings waiting on a universe', async () => {
  const indeks = (n: number): UniversIndeks => ({ ...tomtIndeks(), nyeMoeder: Array.from({ length: n }, (_, i) => ({ eventId: `e${i}`, titel: 'x', start: '2026-10-28T08:00:00Z', slut: '2026-10-28T09:00:00Z', deltagere: [] })) });
  const linje = async (n: number): Promise<string | undefined> => (await universOversigt.hjemVenter({ store: { readState: async () => indeks(n) } } as never))[0]?.tekst;
  assert.equal(await linje(1), '1 nyt møde venter på et univers');
  assert.equal(await linje(3), '3 nye møder venter på et univers');
  assert.equal(await medSprog('en', () => linje(1)), '1 new meeting is waiting for a universe');
  assert.equal(await medSprog('en', () => linje(3)), '3 new meetings are waiting for a universe');
});
