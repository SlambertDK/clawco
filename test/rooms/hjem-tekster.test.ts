// KC-0170: Nu (the room Hjem) in English or Danish. The table has exactly Danish's keys in English; with no language
// chosen the room renders byte for byte as before (test/fixtures/sprog-hjem/, captured before the strings moved);
// with English chosen no Danish word is left in what the user reads. What Nu takes from shared files is not counted
// here: the connection card (src/shell/kilde-helbred.ts) has its own case in the goldens and no English check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HJEM_TEKSTER, hjemTekst } from '../../src/rooms/hjem/tekster.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { SKJULT_KILDE } from '../../src/tillid/skjulte.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import { HJEM, HJEM_RENE } from '../fixtures/sprog-golden-hjem.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-hjem', navn), 'utf8');
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

test('English has exactly Danish\'s keys and shapes, no string is empty', () => {
  assert.deepEqual(form(HJEM_TEKSTER.en), form(HJEM_TEKSTER.da));
  for (const t of [HJEM_TEKSTER.da, HJEM_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
});

/** Strings that are the same in both languages on purpose (a product name). */
const ENS = new Set(['hvorKnap.shelfatlas']);

test('English is actually English: no Danish string copied over', () => {
  assert.deepEqual(ensStrenge(tabel(HJEM_TEKSTER.da), tabel(HJEM_TEKSTER.en)).filter((k) => !ENS.has(k)), []);
});

test('the Danish tables of Nu derive from the registry and the trust ladder: nothing is mirrored by hand', () => {
  for (const r of ROOMS) assert.equal(HJEM_TEKSTER.da.flise[r.id], r.beskrivelse);
  assert.deepEqual(Object.keys(HJEM_TEKSTER.en.skjultKilde).sort(), Object.keys(SKJULT_KILDE).sort());
  for (const [k, v] of Object.entries(SKJULT_KILDE)) assert.equal(HJEM_TEKSTER.da.skjultKilde[k], v);
  for (const r of ROOMS.filter((x) => x.id !== 'hjem')) assert.ok(HJEM_TEKSTER.en.flise[r.id], r.id);
});

test('hjemTekst() follows the language being rendered', () => {
  assert.equal(hjemTekst(), HJEM_TEKSTER.da);
  assert.equal(medSprog('en', () => hjemTekst()), HJEM_TEKSTER.en);
});

test('Henrik\'s installation: with no language chosen, and with Danish chosen, Nu renders byte for byte as before', () => {
  assert.deepEqual(readdirSync(path.join(rod, '../fixtures/sprog-hjem')).sort(), Object.keys(HJEM).map((k) => `${k}.html`).sort(), 'every golden has a case');
  for (const [k, f] of Object.entries(HJEM)) {
    assert.equal(f(), fixtur(`${k}.html`), `${k}: no language`);
    assert.equal(medSprog('da', f), fixtur(`${k}.html`), `${k}: da`);
  }
});

test('English chosen: no Danish word is left in what Nu\'s screens show', () => {
  for (const k of HJEM_RENE) assert.deepEqual(danskeLinjer(medSprog('en', HJEM[k]!)), [], k);
});

test('English chosen: the room reads as English, with the words of the shell', () => {
  const fuld = medSprog('en', HJEM['fuld']!);
  for (const w of [/Waiting for you/, /Right now/, /Sunday check/, /Needs you|Waiting for others/, /Undo/, /Done/, /Send to Claude Code/, /With Claude Code/, /Show it again/, /Why\?/, /Message from Nora on WhatsApp/]) assert.match(fuld, w);
  assert.doesNotMatch(fuld, /Fortryd|Gjort/);
  assert.match(medSprog('en', HJEM['tomt']!), /Everything is sorted[\s\S]*Next today is Planning meeting at 1\d:50/);
  assert.match(medSprog('en', HJEM['moede']!), /Open the meeting/);
  assert.match(medSprog('en', HJEM['plads']!), /Drawn, not built yet/);
  assert.match(medSprog('en', HJEM['fuld']!), /<h1>Good day, Henrik<\/h1>/);
});

test('English chosen: times read 24-hour with a colon, Danish keeps the dot', () => {
  assert.match(medSprog('en', HJEM['fuld']!), /class="mono time">10:30</);
  assert.match(HJEM['fuld']!(), /class="mono time">10\.30</);
});
