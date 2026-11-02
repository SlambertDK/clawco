// KC-0241: the voice layer in English or Danish. Danish (no language chosen, or da chosen) is byte for byte what it was
// (test/fixtures/sprog-stemme/, captured before the strings moved); English has no Danish word left in what the voice
// layer itself says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog, sprogNu } from '../../src/shell/tekster.ts';
import { PRODUKT } from '../../src/shell/navn.ts';
import { STEMME_TEKSTER } from '../../src/stemme/tekster.ts';
import { AGENT_CONFIG, KEYTERMS, agentConfig, antalTekst, keyterms } from '../../src/stemme/agent.ts';
import { medKildeHelbred, medKuratorKort, oversigtAf } from '../../src/stemme/oversigt.ts';
import { saetning, taleAfsender, taleDato, taleKlokken } from '../../src/stemme/tale.ts';
import { NU, PERSON, STEMME, kort } from '../fixtures/sprog-golden-stemme.ts';
import { form, tomme, ensStrenge, DANSK } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-stemme', navn), 'utf8');

test('Henrik\'s installation: with no language chosen, and with da chosen, the voice layer is byte for byte as before', () => {
  const filer = readdirSync(path.join(rod, '../fixtures/sprog-stemme')).sort();
  assert.deepEqual(Object.keys(STEMME).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(STEMME)) {
    assert.equal(lav(), fixtur(k), k);
    assert.equal(medSprog('da', lav), fixtur(k), `${k} (da chosen)`);
  }
});

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
/** Strings that are the same in both languages on purpose: the agent's fixed words that are names. */
const ENS = new Set<string>(['keyterms.0', 'keyterms.7']);
const dansk = (tekst: string): string[] => tekst.split('\n').map((l) => l.trim()).filter((l) => l && DANSK.test(l));
const en = <T>(fn: () => T): T => medSprog('en', fn);

test('English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(STEMME_TEKSTER.en), form(STEMME_TEKSTER.da));
  for (const t of [STEMME_TEKSTER.da, STEMME_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(STEMME_TEKSTER.da), tabel(STEMME_TEKSTER.en)).filter((k) => !ENS.has(k)), []);
});

test('the Danish detector works on the Danish agent', () => {
  assert.ok(dansk(AGENT_CONFIG.prompt).length > 8);
});

/** Every sentence the agent is given in one language, one per line. */
function agentLinjer(c: ReturnType<typeof agentConfig>): string {
  return [c.name, c.prompt, c.firstMessage, ...Object.values(c.dynamicVariablePlaceholders), ...c.tools.flatMap((t) => [t.description, ...Object.values(t.parameters.properties).map((p) => p.description)])].join('\n');
}

test('English: the agent has no Danish word in its prompt, first message, placeholders or tools', () => {
  assert.deepEqual(dansk(agentLinjer(agentConfig('en'))), []);
  assert.deepEqual(dansk(agentLinjer(agentConfig('da'))).length > 15, true);
});

test('agentConfig(da) is the config Henrik\'s installation syncs; agentConfig(en) differs only in words, name and language', () => {
  assert.deepEqual(agentConfig('da'), AGENT_CONFIG);
  const e = agentConfig('en');
  assert.equal(e.language, 'en');
  assert.equal(e.name, `${PRODUKT} (English)`);
  assert.notEqual(e.name, AGENT_CONFIG.name);
  for (const k of ['llm', 'ttsModelId', 'turnTimeout', 'turnEagerness', 'maxDurationSeconds'] as const) assert.equal(e[k], AGENT_CONFIG[k], k);
  // The browser calls the tools and passes the variables by name: those stay identical.
  assert.deepEqual(e.tools.map((t) => t.name), AGENT_CONFIG.tools.map((t) => t.name));
  assert.deepEqual(e.tools.map((t) => [Object.keys(t.parameters.properties), t.parameters.required, t.expectsResponse, t.responseTimeoutSecs, t.preToolSpeech]), AGENT_CONFIG.tools.map((t) => [Object.keys(t.parameters.properties), t.parameters.required, t.expectsResponse, t.responseTimeoutSecs, t.preToolSpeech]));
});

test('both prompts use the same variables, and the placeholders name exactly the app\'s own', () => {
  const vars = (c: ReturnType<typeof agentConfig>): string[] => [...new Set([...`${c.prompt}\n${c.firstMessage}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
  for (const sprog of ['da', 'en'] as const) {
    const c = agentConfig(sprog);
    assert.deepEqual(vars(c), ['antal_tekst', 'oversigt', 'rum', 'system__time'], sprog);
    assert.deepEqual(Object.keys(c.dynamicVariablePlaceholders).sort(), ['antal_tekst', 'oversigt', 'rum'], sprog);
  }
});

test('English: the prompt keeps every rule of the Danish one', () => {
  const p = agentConfig('en').prompt;
  for (const re of [/one thing at a time/i, /never say the ids/i, /udfoer/, /spoerg_hermes/, /hent_oversigt/, /one sentence/i, /next/i, /skip/i, /later/i, /stop/i, /that's it/i, /never send mail/i, /never pay/i, /never delete/i, /do not guess/i, /no lists, no markdown/i, /like a person/i]) assert.match(p, re);
  assert.ok(!/Henrik/.test(p), 'the English installation is not Henrik\'s');
});

test('keyterms: the Danish ones are KEYTERMS; English has its own words, in the same order and count', () => {
  assert.deepEqual(keyterms('da'), KEYTERMS);
  assert.deepEqual(en(() => keyterms()), keyterms('en'));
  assert.deepEqual(keyterms(), KEYTERMS);
  assert.equal(keyterms('en').length, KEYTERMS.length);
  assert.deepEqual(dansk(keyterms('en').join('\n')), []);
  assert.ok(keyterms('en').includes('Hermes') && keyterms('en').includes(PRODUKT));
});

test('English: the spoken count, the overview lines and the curator lead have no Danish word', () => {
  assert.deepEqual(en(() => [0, 1, 2, 5].map(antalTekst)), ['Nothing is waiting for you right now.', 'One thing is waiting for you.', '2 things are waiting for you.', '5 things are waiting for you.']);
  for (const k of ['oversigt-fuld.txt', 'oversigt-orden.txt', 'oversigt-en.txt', 'oversigt-tom.txt', 'kurator-et.txt', 'kurator-flere.txt', 'helbred.txt', 'tale-saetning.txt', 'tale-afsender.txt']) {
    assert.deepEqual(dansk(en(STEMME[k]!)), [], k);
  }
  assert.deepEqual(en(() => oversigtAf([]).tekst), 'Nothing is waiting for you right now.');
});

test('English: the overview in full, with the shell\'s English room names and "Choices"', () => {
  assert.deepEqual(en(STEMME['oversigt-orden.txt']!).split('\n'), [
    '3 things are waiting.', 'Mail: Two mails wait for your decision.', 'Today: Four meetings today.', 'News: The paper.', 'Write: No draft in progress.', 'Bank: Balance.', 'Now: Nothing special.', 'Household: A quiet week.',
    '1. Mail from Anne: Offer. Choices: Call (id mail:xyz-call), Done (id mail:aktion:faerdig:xyz).',
    '2. Mail from Bo: Invoice. Choices: Done (id mail:aktion:faerdig:abc).',
    '3. My recommendation: move the meeting. Choices: Move the meeting (id dagen:anb).',
  ]);
  assert.equal(en(STEMME['oversigt-en.txt']!).split('\n')[0], 'One thing is waiting.');
  assert.deepEqual(en(() => medKuratorKort({ tekst: 'x', punkter: [] }, [kort({ id: 'a', titel: 'T' })], PERSON, NU).tekst.split('\n')[0]), 'The curator has one card for you.');
  assert.deepEqual(en(() => medKuratorKort({ tekst: 'x', punkter: [] }, [kort({ id: 'a', titel: 'T' }), kort({ id: 'b', titel: 'U' })], PERSON, NU).tekst.split('\n')[0]), 'The curator has 2 cards for you.');
  assert.equal(en(() => medKildeHelbred({ tekst: 'x', punkter: [] }, ['A.']).tekst), 'A.\nx');
});

test('English: an unknown room falls back to its capitalised id', () => {
  assert.match(en(() => oversigtAf([{ rum: 'bank', resume: 'r', punkter: [] }]).tekst), /\nBank: r/);
});

test('English clock and date phrasing: "at 10", "at 10:30", "Thursday 29 October (at 10)"', () => {
  assert.deepEqual(en(() => ['10:00', '10:30', '9.05', '  7:45 ', 'noon', ''].map(taleKlokken)), ['at 10', 'at 10:30', 'at 9:05', 'at 7:45', 'noon', '']);
  assert.deepEqual(en(() => ['2026-10-29', '2026-10-29T10:00', '2026-01-01 09:30', '2026-02-30', 'tomorrow'].map(taleDato)), ['Thursday 29 October', 'Thursday 29 October at 10', 'Thursday 1 January at 9:30', '2026-02-30', 'tomorrow']);
  assert.equal(en(() => saetning('Hello')), 'Hello.');
  assert.equal(en(() => taleAfsender('Anne <a@x.example>')), 'Anne');
  assert.equal(sprogNu(), 'da');
});
