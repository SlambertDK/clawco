// KC-0170 slice 3 (part B): the connectors' cards and health words, the limits' reasons and the trust pages in English or
// Danish. Danish (no language chosen, or da chosen) is what it was before, word for word: test/fixtures/sprog-kilder/da.json was
// captured from test/fixtures/sprog-golden-kilder.ts BEFORE the strings moved into the tekster.ts tables. English has no
// Danish word left in what a user reads, in any of the scenarios.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/store/sprog.ts';
import { SCENARIER } from '../fixtures/sprog-golden-kilder.ts';
import { DANSK, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(path.join(rod, '../fixtures/sprog-kilder/da.json'), 'utf8')) as Record<string, unknown>;
/** A scenario's answer as plain JSON (a Date or an Error would not survive a compare). */
const ren = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** What stays as it is in English on purpose: names and quoted words that are another product's or the file's own. */
const TILLADT: RegExp[] = [
  /Ugekalender|Kalendersynkronisering|Opret kalenderlink/, // Aula's own screens, quoted
  /SLET/, // the word Slet alt asks to be typed (the server checks it)
  /naeste-id/, // the rules file's own line
  /Om mig\.md|00-Indbakke|40-Mennesker/, // the vault's own folders and files
  /^The detail til is missing\.$/, // `til` is the name of the action's argument, an id
];

/** Every string in an answer (keys of the golden excluded: they are ids, not words). */
function blade(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(blade);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(blade);
  return [];
}
/** The lines of an answer that read as Danish; a string of markup is judged by what a browser would show. */
function danske(v: unknown): string[] {
  return blade(v).flatMap((s) => (s.startsWith('<') ? danskeLinjer(s) : s.split('\n').map((l) => l.trim()).filter((l) => l && DANSK.test(l))))
    .filter((l) => !TILLADT.some((re) => re.test(l)));
}

test('the golden has a case for every scenario and no case without one', () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(SCENARIER).sort());
});

for (const [navn, kor] of Object.entries(SCENARIER)) {
  test(`${navn}: Henrik's installation reads exactly as before (no language chosen, and da chosen)`, async () => {
    assert.deepEqual(ren(await kor()), GOLDEN[navn]);
    assert.deepEqual(ren(await medSprog('da', kor)), GOLDEN[navn]);
  });

  test(`${navn}: English has no Danish word in what the user reads`, async () => {
    const en = ren(await medSprog('en', kor));
    assert.deepEqual(danske(en), []);
    // And it is not the Danish answer under another name: something was said in English.
    assert.notDeepEqual(en, GOLDEN[navn]);
  });
}

test('the Danish detector works: the Danish answers are full of Danish lines', () => {
  assert.ok(danske(GOLDEN['kort-nyheder-rss']).length > 20);
  assert.ok(danske(GOLDEN['viden']).length > 20);
});
