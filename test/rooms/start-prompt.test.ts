// KC-0126 / KC-0241: what we ask Hermes in Start. The Danish prompt is byte for byte what it was before the words
// moved into the table; every golden of the six files has a case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/store/sprog.ts';
import { golden, navneMed, PROMPTER, samlet } from '../fixtures/sprog-golden-prompt-rum-b.ts';

test('Start: every prompt is Danish byte for byte as before, with no language chosen and with da chosen (KC-0241)', () => {
  const navne = navneMed('start-');
  assert.equal(navne.length, 3);
  for (const n of navne) {
    assert.equal(samlet(PROMPTER[n]!()), golden(n), n);
    assert.equal(samlet(medSprog('da', PROMPTER[n]!)), golden(n), `${n} (da chosen)`);
  }
});

test('every golden file has a case and every case has a golden', () => {
  const filer = readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sprog-prompt-rum-b')).sort();
  assert.deepEqual(Object.keys(PROMPTER).map((n) => `${n}.txt`).sort(), filer);
});

// ---------- KC-0241: the language of the prompt ----------

import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';
import { egneDanskeLinjer, jsonNoegler, struktur } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { START_PROMPT } from '../../src/rooms/start/prompt-tekster.ts';
import { TRIN_STATUS } from '../../src/rooms/start/schema.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const en = (navn: string): { instructions: string; input: string } => medSprog('en', PROMPTER[navn]!);
const da = (navn: string): { instructions: string; input: string } => PROMPTER[navn]!();

test('Start: English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(START_PROMPT.en), form(START_PROMPT.da));
  for (const t of [START_PROMPT.da, START_PROMPT.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(START_PROMPT.da), tabel(START_PROMPT.en)), []);
  assert.deepEqual(Object.keys(START_PROMPT.en.status).sort(), [...TRIN_STATUS].sort());
});

test('Start: the Danish detector works: the Danish prompts are full of Danish lines', () => {
  for (const n of navneMed('start-')) assert.ok(da(n).instructions.split('\n').filter((l) => DANSK.test(l)).length >= 1, n);
});

test('Start: English has no Danish line in what the room itself writes, in any of its prompts', () => {
  for (const n of navneMed('start-')) assert.deepEqual(egneDanskeLinjer(n), [], n);
});

test('Start: English keeps the structure of the Danish prompt', () => {
  for (const n of navneMed('start-')) {
    assert.deepEqual(jsonNoegler(en(n).instructions), jsonNoegler(da(n).instructions), n);
    assert.deepEqual(struktur(en(n).instructions), struktur(da(n).instructions), n);
  }
});

test('Start: English names the room as the nav does and says the status of each step in words', () => {
  const r = en('start-chat');
  assert.ok(r.instructions.includes('work inside the room "Start": the journey from a new installation to a Clawco that knows the user.'));
  assert.match(r.instructions, /The steps and their status:\n- Your name: done\n- Your sources: in progress\n- Your people: not started\n- Your voice: skipped\n\nRules for the chat:/);
  assert.match(en('start-chat-ingen-trin').instructions, /The steps and their status:\n- \(no steps\)/);
  assert.match(da('start-chat').instructions, /Trinnene og deres status:\n- Your name: klaret\n- Your sources: i-gang\n- Your people: ikke-startet\n- Your voice: sprunget-over/);
});
