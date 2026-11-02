import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNytRun, buildForslagRun, buildSkriveChatRun } from '../../src/rooms/skrive/prompt.ts';
import { GRAENSER } from '../../src/agent/prompt.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import type { Dokument } from '../../src/rooms/skrive/schema.ts';
import { golden, navneMed, PROMPTER, samlet } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { medSprog } from '../../src/store/sprog.ts';

const dok: Dokument = { id: 'dok-1', titel: 'Udkast', brief: 'Kort mail til driften om vinterberedskab', afsnit: [{ id: 'a1', tekst: 'Hej Tom.' }, { id: 'a2', tekst: 'Vi strammer reserverne.' }], kilder: [], oprettet: 'x', aendret: 'x' };

test('nyt run carries the brief and asks for the document schema in Danish', () => {
  const r = buildNytRun('Takkemail', 'Kort mail til driften om vinterberedskab');
  assert.match(r.instructions, /```json/);
  for (const k of ['titel', 'afsnit', 'kilder']) assert.ok(r.instructions.includes(`"${k}"`), k);
  assert.match(r.input, /Kort mail til driften om vinterberedskab/);
  assert.match(r.input, /Takkemail/);
});

test('KC-0118: the nyt run is built by the shared prompt builder: limits once, zone line', () => {
  const r = buildNytRun('Takkemail', 'Kort mail');
  assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
  assert.match(r.instructions, /Zone: privat/);
});

// KC-0123: the draft is Hermes' text — an afledt segment, never the instructions.
const udkast = (r: { input: string }): string => udpak(r.input).find((d) => d.kilde === 'udkast' && d.tillid === 'afledt')?.tekst ?? '';

test('forslag run numbers the paragraphs with their ids (as afledt data) and names the requested change', () => {
  const r = buildForslagRun(dok, 'a2', 'stram');
  assert.match(udkast(r), /\[a1\] Hej Tom\./);
  assert.ok(!r.instructions.includes('Hej Tom.'));
  assert.match(r.instructions, /"forslag"/);
  assert.match(r.instructions, /højst 3/i);
  assert.match(r.input, /a2/);
  assert.match(r.input, /stram/i);
  const hele = buildForslagRun(dok, null, 'konkret');
  assert.match(hele.input, /hele teksten/i);
});

test('chat run includes the document and the context and allows a forslag block', () => {
  const r = buildSkriveChatRun('Gør afslutningen varmere', 'Afsnit 2', dok);
  assert.ok(udpak(r.input).some((d) => d.kilde === 'element' && /Om: Afsnit 2/.test(d.tekst)));
  assert.match(udkast(r), /\[a2\] Vi strammer reserverne\./);
  assert.match(r.instructions, /"forslag"/);
  assert.equal(udenData(r.input), 'Gør afslutningen varmere');
});

test('Skrive: every prompt is Danish byte for byte as before, with no language chosen and with da chosen (KC-0241)', () => {
  const navne = navneMed('skrive-');
  assert.ok(navne.length >= 11, String(navne.length));
  for (const n of navne) {
    assert.equal(samlet(PROMPTER[n]!()), golden(n), n);
    assert.equal(samlet(medSprog('da', PROMPTER[n]!)), golden(n), `${n} (da chosen)`);
  }
});

// ---------- KC-0241: the language of the prompt ----------

import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';
import { egenTekst, egneDanskeLinjer, jsonNoegler, pak, struktur, utenData } from '../fixtures/sprog-golden-prompt-rum-b.ts';
import { SKRIVE_PROMPT } from '../../src/rooms/skrive/prompt-tekster.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
/** Strings that are the same in both languages on purpose (a name, or a word English borrows). */
const ENS = new Set<string>([]);
const en = (navn: string): { instructions: string; input: string } => medSprog('en', PROMPTER[navn]!);
const da = (navn: string): { instructions: string; input: string } => PROMPTER[navn]!();

test('Skrive: English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(SKRIVE_PROMPT.en), form(SKRIVE_PROMPT.da));
  for (const t of [SKRIVE_PROMPT.da, SKRIVE_PROMPT.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(SKRIVE_PROMPT.da), tabel(SKRIVE_PROMPT.en)).filter((k) => !ENS.has(k)), []);
});

test('Skrive: the Danish detector works: the Danish prompts are full of Danish lines', () => {
  for (const n of navneMed('skrive-')) assert.ok(da(n).instructions.split('\n').filter((l) => DANSK.test(l)).length >= 1, n);
});

test('Skrive: English has no Danish line in what the room itself writes, in any of its prompts', () => {
  assert.ok(navneMed('skrive-').length >= 11);
  for (const n of navneMed('skrive-')) assert.deepEqual(egneDanskeLinjer(n), [], n);
});

test('Skrive: English keeps what the app parses the answer by (JSON field names, fences, bullets, paragraphs) as in Danish', () => {
  for (const n of navneMed('skrive-')) {
    assert.deepEqual(jsonNoegler(en(n).instructions), jsonNoegler(da(n).instructions), n);
    assert.deepEqual(struktur(en(n).instructions), struktur(da(n).instructions), n);
  }
});

import { beskrivType } from '../../src/rooms/skrive/prompt.ts';

test('Skrive: English names the room as the nav does, says "the user", and keeps the ids and field names', () => {
  for (const n of navneMed('skrive-').filter((x) => x !== 'skrive-typer')) {
    const t = egenTekst(n);
    assert.ok(t.includes('write together with them in the room "Write" of their control centre'), n);
    assert.doesNotMatch(t, /Henrik|kontrolcenter/, n);
  }
  assert.match(en('skrive-nyt').input, /^Title: Thank-you mail\n\nBrief: A short mail to operations$/);
  assert.match(en('skrive-nyt-uden-titel').input, /^Title: \(pick one yourself\)\n\nBrief:/);
  assert.match(en('skrive-nyt').instructions, /Answer ONLY with one JSON object in a ```json block following this schema:/);
  const udkast = (n: string): string => pak(en(n).input).find((d) => d.kilde === 'udkast')?.tekst ?? '';
  assert.match(udkast('skrive-forslag-stram'), /^The draft "Winter plan" \(brief: A short mail to operations about the winter plan\), with paragraph ids in brackets:\n\n\[a1\] Hello Tom\.\n\n\[a2\] We tighten the reserves\.$/);
  assert.equal(udkast('skrive-chat-uden-udkast'), 'There is no active draft.');
  assert.match(utenData(en('skrive-forslag-stram').input), /^Paragraph a2: Tighten up: remove filler and repetition, shorter sentences, same content\. \(afsnitId: a2\)$/);
  assert.match(utenData(en('skrive-forslag-kortere-hele').input), /^The whole text: Make it shorter: halve the length and keep what matters most\. \(the whole text\)$/);
  assert.match(utenData(en('skrive-forslag-ukendt').input), /^Paragraph a1: something-else \(afsnitId: a1\)$/);
  assert.match(en('skrive-forslag-stram').instructions, /- Give at most 3 suggestions\./);
  assert.match(en('skrive-chat').instructions, /Rules for the chat:\n- Answer briefly in English/);
  assert.match(en('skrive-chat').instructions, /"afsnitId": "a2"/);
});

test('Skrive: beskrivType says each kind of change in the language of the run, and passes an unknown one on', () => {
  assert.match(medSprog('en', () => beskrivType('konkret')), /^Make it more concrete: replace vague words with numbers, names, dates and examples; if you lack facts, write \[INSERT: \.\.\.\] instead of inventing\.$/);
  assert.equal(medSprog('en', () => beskrivType('something-else')), 'something-else');
  assert.match(beskrivType('stram'), /^Stram op: /);
});
