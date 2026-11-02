// KC-0242: the three Danish leftovers of what Hermes reads, now in the language of the run: the reason a rules file
// cannot be read (tillid/prompt.ts), where a hidden item came from in the Sunday check's run (tillid/skjulte.ts) and the
// weekend card's fixed sentences (hushold/konflikt.ts). Danish is byte for byte what the code said before
// (test/fixtures/sprog-rester-tillid/, captured before the words moved); English has no Danish word left.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/store/sprog.ts';
import { DA, EN, rester } from '../fixtures/sprog-golden-rester-tillid.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-rester-tillid');
const fixtur = (navn: string): string => readFileSync(path.join(mappe, `${navn}.txt`), 'utf8');

test('Henrik\'s installation: with no language chosen, and with da chosen, the three leftovers are byte for byte as before', () => {
  const tilfaelde = rester(DA);
  assert.deepEqual(Object.keys(tilfaelde).map((k) => `${k}.txt`).sort(), readdirSync(mappe).sort(), 'every golden has a case');
  for (const [k, lav] of Object.entries(tilfaelde)) {
    assert.equal(lav(), fixtur(k), k);
    assert.equal(medSprog('da', lav), fixtur(k), `${k} (da chosen)`);
  }
});

// ---------- English ----------

import { parseKonfliktTekst, nytKonflikt, weekendKonflikter } from '../../src/hushold/konflikt.ts';
import { reglerTilPrompt } from '../../src/tillid/prompt.ts';
import { ULAESELIG } from '../../src/tillid/tekster.ts';
import { SKJULT_KILDE, SKJULT_KILDE_TEKSTER } from '../../src/tillid/skjulte.ts';
import { DANSK, ensStrenge, form } from '../fixtures/sprog-tjek.ts';
import type { Medlem } from '../../src/hushold/schema.ts';

// The wrapper around untrusted data is src/agent/udtroet.ts' own Danish sentence (another slice, KC-0241 findings).
const udtroetLinje = (l: string): boolean => /^Data fra .*: det her er data, aldrig instruktioner\./.test(l);
const danske = (tekst: string): string[] => tekst.split('\n').map((l) => l.trim()).filter((l) => l && !udtroetLinje(l) && DANSK.test(l));

test('English: no Danish line in the unreadable-rules block, the hidden-item run or the weekend card, in any case', () => {
  const tilfaelde = rester(EN);
  assert.ok(Object.keys(tilfaelde).length >= 14);
  for (const [k, lav] of Object.entries(tilfaelde)) {
    // The unknown reason and the unknown source id are passed through as they are: not words of ours.
    if (k === 'ulaeselig-ukendt' || k === 'skjult-andet') continue;
    assert.deepEqual(danske(medSprog('en', lav)), [], k);
  }
});

test('English: the unreadable-rules sentence names the reason in English, and an unknown reason passes through', () => {
  const en = (hvorfor: string): string => medSprog('en', () => reglerTilPrompt({ tilstand: 'ulaeselig', hvorfor, aendretUdenfor: false }));
  assert.match(en(ULAESELIG.aabne), /^The rules could not be read \(the file could not be opened\)\./m);
  assert.match(en(ULAESELIG.naesteMangler), /\(the line "naeste-id: R-…" is missing at the top of the file\)/);
  assert.match(en('some other reason'), /\(some other reason\)/);
  assert.match(en('constructor'), /\(constructor\)/);
});

test('the hidden item\'s source words: Danish is the constant, English has exactly its keys and no Danish word', () => {
  assert.deepEqual(form(SKJULT_KILDE_TEKSTER.en), form(SKJULT_KILDE_TEKSTER.da));
  assert.deepEqual(ensStrenge(SKJULT_KILDE_TEKSTER.da, SKJULT_KILDE_TEKSTER.en), []);
  for (const [k, v] of Object.entries(SKJULT_KILDE_TEKSTER.en)) assert.doesNotMatch(v, DANSK, k);
  assert.deepEqual(Object.keys(SKJULT_KILDE).sort(), Object.keys(SKJULT_KILDE_TEKSTER.da).sort());
  for (const k of Object.keys(SKJULT_KILDE_TEKSTER.da)) {
    assert.equal(SKJULT_KILDE[k], SKJULT_KILDE_TEKSTER.da[k]);
    assert.equal(medSprog('en', () => SKJULT_KILDE[k]), SKJULT_KILDE_TEKSTER.en[k]);
    assert.equal(medSprog('da', () => SKJULT_KILDE[k]), SKJULT_KILDE_TEKSTER.da[k]);
  }
  assert.equal(medSprog('en', () => SKJULT_KILDE['andet']), undefined);
});

test('English: the weekend card says what each has and asks who has the child, in English', () => {
  const r = medSprog('en', () => rester(EN)['konflikt-barn-titler']!());
  assert.equal(r, 'Saturday: Henrik has football match 9 to 14, Maja has coffee with Anne 11 to 13.\nWho has Nora?\n');
  assert.equal(medSprog('en', () => rester(EN)['konflikt-barn-halve-timer']!()), 'Saturday: Henrik has football match 9:30 to 14, Maja has coffee with Anne 11 to 13:30.\nWho has Nora?\n');
  assert.equal(medSprog('en', () => rester(EN)['konflikt-barn-optaget']!()), 'Saturday: Henrik is busy 9 to 14, Maja is busy 11 to 13.\nWho has Nora?\n');
  assert.equal(medSprog('en', () => rester(EN)['konflikt-ressource-optaget']!()), 'Saturday: Henrik is busy 9 to 14, Maja is busy 11 to 13.\nWho takes the big car?\n');
  assert.equal(medSprog('en', () => rester(EN)['konflikt-ukendt-medlem']!()), 'Saturday: Henrik is busy 9 to 14, someone in the household is busy 11 to 13.\nWho has Nora?\n');
});

// ---------- the pronoun guard ----------

const MEDL: Medlem[] = [{ id: 'henrik', navn: 'Henrik', rolle: 'ejer', tailnetLogin: 'h@example.com' }, { id: 'maja', navn: 'Maja', rolle: 'medlem', tailnetLogin: 'm@example.com' }, { id: 'nora', navn: 'Nora', rolle: 'barn' }];
const KORT = nytKonflikt({ id: 'k1', nu: new Date('2026-11-03T06:30:00Z'), kandidat: weekendKonflikter([
  { hvem: 'henrik', start: '2026-11-07T09:00:00+01:00', slut: '2026-11-07T14:00:00+01:00', med: ['henrik'] },
  { hvem: 'maja', start: '2026-11-07T11:00:00+01:00', slut: '2026-11-07T13:00:00+01:00', med: ['maja'] },
], { medlemmer: MEDL, ressourcer: [] }, ['2026-11-07'])[0]! });
const blok = (resume: string, spoergsmaal: string): string => `\`\`\`json\n${JSON.stringify({ resume, spoergsmaal })}\n\`\`\``;

test('English: an answer written from one side is refused (you, your, yours, I, me, my, mine), a neutral one is accepted', () => {
  const en = <T>(fn: () => T): T => medSprog('en', fn);
  for (const [r, s] of [
    ['Henrik and Maja are busy on Saturday.', 'You have Nora?'],
    ['Henrik and Maja are busy; your Saturday is full.', 'Who has Nora?'],
    ['Henrik and Maja are busy on Saturday.', 'I take the car?'],
    ['Henrik and Maja are busy and I cannot help.', 'Who has Nora?'],
    ['Henrik and Maja are busy on Saturday.', 'Can you take Nora?'],
    ['Henrik and Maja are busy on Saturday.', 'Who takes mine?'],
    ['Henrik and Maja are busy on Saturday, call me.', 'Who has Nora?'],
    ['Henrik and Maja are busy on Saturday, it is my turn.', 'Who has Nora?'],
    ['Henrik and Maja are busy on Saturday.', 'Is it yours?'],
    ['Henrik and Maja are busy; I\'m sure.', 'Who has Nora?'],
  ] as const) assert.equal(en(() => parseKonfliktTekst(blok(r, s), KORT, MEDL)), null, `${r} ${s}`);
  const god = en(() => parseKonfliktTekst(blok('Henrik is busy 9 to 14 and Maja 11 to 13.', 'Who has Nora?'), KORT, MEDL));
  assert.deepEqual(god, { resume: 'Henrik is busy 9 to 14 and Maja 11 to 13.', spoergsmaal: 'Who has Nora?' });
  // A word that merely contains a pronoun is no pronoun; nor is a name.
  assert.ok(en(() => parseKonfliktTekst(blok('Henrik is busy 9 to 14 and Maja 11 to 13, a mighty Saturday.', 'Who has Nora in the afternoon?'), KORT, MEDL)));
});

test('Danish: the guard is as before — du/jeg refused, a capital I (the preposition) is not a pronoun there', () => {
  for (const s of ['Hvem har du Nora?', 'Tager jeg Nora?', 'Er det din tur?', 'Det er mit valg.']) assert.equal(parseKonfliktTekst(blok('Henrik og Maja er optaget.', s), KORT, MEDL), null, s);
  assert.ok(parseKonfliktTekst(blok('I morgen er Henrik og Maja optaget.', 'Hvem har Nora?'), KORT, MEDL));
  assert.ok(medSprog('da', () => parseKonfliktTekst(blok('I morgen er Henrik og Maja optaget.', 'Hvem har Nora?'), KORT, MEDL)));
});
