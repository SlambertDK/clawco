import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAENSER } from '../../src/agent/prompt.ts';
import { buildNyhederRefreshRun, buildNyhederHentRun } from '../../src/rooms/nyheder/prompt.ts';
import { golden, navneMed, PROMPTER, samlet } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { medSprog } from '../../src/store/sprog.ts';

test('refresh run names the schema keys and rules and passes the items', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [{ titel: 'GPT-6.1 Terra', kilde: 'Simon Willison', url: 'https://example.org/gpt', resume: 'r' }], kilder: { antal: 25, medNyheder: 9, nyheder: 1, fejlede: [] } }, new Date('2026-10-27T07:10:00Z'));
  for (const k of ['femLinjer', 'baner', 'navn', 'nyheder', 'hvorfor', 'forslag', 'hermesStatus']) assert.ok(r.instructions.includes(`"${k}"`), k);
  // KC-0228: the owner's work comes from what Hermes knows about him (as the family does, KC-0023), never from code.
  assert.match(r.instructions, /det, du ved om Henrik/);
  assert.doesNotMatch(r.instructions, /product manager|hos [A-ZÆØÅ]\w+ \(/);
  assert.match(r.instructions, /url.*uændret|præcis som|nøjagtigt/i);
  assert.match(r.instructions, /titel.*rent/i);
  assert.ok(r.input.includes('GPT-6.1 Terra'));
  assert.match(buildNyhederHentRun(new Date()).input, /morgenavis_cron\.py/);
});

test('KC-0118: the refresh run is built by the shared prompt builder: limits once, zone line', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [], kilder: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }, new Date());
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
});

test('refresh run asks for relevans notes with the fixed keys and tells Hermes to use what it knows about Henrik', () => {
  const r = buildNyhederRefreshRun({ dato: '2026-10-27', nyheder: [], kilder: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }, new Date());
  assert.match(r.instructions, /"relevans"/);
  for (const k of ['mig', 'familie', 'arbejde', 'danmark', 'holdning', 'projekter']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.instructions, /det, du ved om Henrik|din viden om Henrik/i);
});

test('Nyheder: every prompt is Danish byte for byte as before, with no language chosen and with da chosen (KC-0241)', () => {
  const navne = navneMed('nyheder-');
  assert.ok(navne.length >= 9, String(navne.length));
  for (const n of navne) {
    assert.equal(samlet(PROMPTER[n]!()), golden(n), n);
    assert.equal(samlet(medSprog('da', PROMPTER[n]!)), golden(n), `${n} (da chosen)`);
  }
});

// ---------- KC-0241: the language of the prompt ----------

import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';
import { egenTekst, egneDanskeLinjer, jsonNoegler, struktur } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { NYHEDER_PROMPT } from '../../src/rooms/nyheder/prompt-tekster.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
/** Strings that are the same in both languages on purpose (a name, or a word English borrows). */
const ENS = new Set<string>([]);
const en = (navn: string): { instructions: string; input: string } => medSprog('en', PROMPTER[navn]!);
const da = (navn: string): { instructions: string; input: string } => PROMPTER[navn]!();

test('Nyheder: English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(NYHEDER_PROMPT.en), form(NYHEDER_PROMPT.da));
  for (const t of [NYHEDER_PROMPT.da, NYHEDER_PROMPT.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(NYHEDER_PROMPT.da), tabel(NYHEDER_PROMPT.en)).filter((k) => !ENS.has(k)), []);
});

test('Nyheder: the Danish detector works: the Danish prompts are full of Danish lines', () => {
  for (const n of navneMed('nyheder-')) assert.ok(da(n).instructions.split('\n').filter((l) => DANSK.test(l)).length >= 1, n);
});

test('Nyheder: English has no Danish line in what the room itself writes, in any of its prompts', () => {
  assert.ok(navneMed('nyheder-').length >= 9);
  for (const n of navneMed('nyheder-')) assert.deepEqual(egneDanskeLinjer(n), [], n);
});

test('Nyheder: English keeps what the app parses the answer by (JSON field names, fences, bullets, paragraphs) as in Danish', () => {
  for (const n of navneMed('nyheder-')) {
    assert.deepEqual(jsonNoegler(en(n).instructions), jsonNoegler(da(n).instructions), n);
    assert.deepEqual(struktur(en(n).instructions), struktur(da(n).instructions), n);
  }
});

test('Nyheder: English names the room as the nav does, says "the user", and keeps the schema words', () => {
  for (const n of ['nyheder-refresh', 'nyheder-hent', 'nyheder-handling', 'nyheder-fortryd', 'nyheder-chat']) {
    const t = egenTekst(n);
    assert.ok(t.includes('inside the room "News" of their control centre'), n);
    assert.ok(t.includes('use what you know about the user'), n);
    assert.doesNotMatch(t, /Henrik|kontrolcenter/, n);
  }
  const r = en('nyheder-refresh');
  assert.match(r.instructions, /\(1 news items from 9 of 25 sources\)\. Pick and order them\. Answer with exactly this schema:/);
  assert.match(r.instructions, /Rules:\n- Write in English, short and concrete\./);
  for (const k of ['mig', 'familie', 'arbejde', 'danmark', 'holdning', 'projekter']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.input, /It is now 2026-10-27 at 08:10 \(Europe\/Copenhagen\)\./);
  assert.match(r.input, /Today's news:/);
  assert.match(en('nyheder-refresh-fejlede').instructions, /2 sources failed today, they are listed in the message/);
  assert.match(en('nyheder-refresh-fejlede').input, /Sources that failed today: Alpha Feed, Beta Feed/);
  assert.match(en('nyheder-hent').input, /build the room News\./);
  assert.match(en('nyheder-handling').input, /The button: "Save for later"/);
  assert.match(en('nyheder-handling').input, /The room's five lines today:\n- Reserves are tightening\./);
  assert.match(en('nyheder-handling').instructions, /The room's five lines for today are also in the message\./);
  assert.match(en('nyheder-handling').instructions, /Answer with at most three short sentences in English/);
  assert.match(en('nyheder-chat').input, /The room's content:/);
  assert.match(en('nyheder-chat-tom').input, /The room has no data yet\./);
  assert.match(en('nyheder-chat').instructions, /Answer briefly in English, as in a conversation\./);
});
