import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GRAENSER, SPROG, byggPrompt, fortrydOpgave, handlingsOpgave } from '../../src/agent/prompt.ts';
import { VERBER } from '../../src/graenser/verber.ts';
import { visuelRegler } from '../../src/shell/visuel.ts';
import { medSprog } from '../../src/store/sprog.ts';

const antal = (h: string, n: string): number => h.split(n).length - 1;

test('sections come in fixed order: limits, catalog, language, zone, task', () => {
  const { instructions } = byggPrompt({ rum: 'mail', zone: 'privat', opgave: 'OPGAVEN', katalog: true, data: [] });
  const pos = [GRAENSER, visuelRegler(), SPROG, 'Zone: privat', 'OPGAVEN'].map((s) => instructions.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), `every section present: ${pos.join(',')}`);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(instructions.startsWith(GRAENSER));
});

test('the limits text is there exactly once; the catalog only when asked for', () => {
  const med = byggPrompt({ rum: 'x', zone: 'arbejde', opgave: 'o', katalog: true, data: [] }).instructions;
  const uden = byggPrompt({ rum: 'x', zone: 'arbejde', opgave: 'o', data: [] }).instructions;
  assert.equal(antal(med, GRAENSER), 1);
  assert.equal(antal(uden, GRAENSER), 1);
  assert.ok(med.includes(visuelRegler()));
  assert.ok(!uden.includes(visuelRegler()));
  assert.match(uden, /Zone: arbejde/);
});

test('the limits name pay, write to others, delete and cross-zone, and allow only Henrik\'s explicit yes', () => {
  for (const ord of ['betaler aldrig', 'skriver aldrig til andre', 'sletter aldrig', 'mellem zonerne', 'udtrykkelige ja']) assert.ok(GRAENSER.includes(ord), ord);
});

// KC-0123: only betroet segments are the input byte for byte; the wrapped ones are tested in udtroet.test.ts.
test('one betroet data segment is the input byte for byte; several are joined by a blank line', () => {
  assert.equal(byggPrompt({ rum: 'x', zone: 'privat', opgave: 'o', data: [{ kilde: 'henrik', zone: 'privat', tillid: 'betroet', tekst: 'Hej\n  med dig' }] }).input, 'Hej\n  med dig');
  assert.equal(byggPrompt({ rum: 'x', zone: 'privat', opgave: 'o', data: [
    { kilde: 'a', zone: 'privat', tillid: 'betroet', tekst: 'A' }, { kilde: 'b', zone: 'privat', tillid: 'betroet', tekst: 'B' },
  ] }).input, 'A\n\nB');
  assert.equal(byggPrompt({ rum: 'x', zone: 'privat', opgave: 'o', data: [] }).input, '');
});

// KC-0123: a handling's run gets the app's own sentence for its verb; what the button does is quoted data.
test('handlingsOpgave: a fixed sentence per verb, saying the handling text is derived data inside the verb', () => {
  const tekster = VERBER.map((v) => handlingsOpgave(v));
  for (const t of tekster) assert.match(t, /Henrik har trykket på knappen/);
  assert.equal(new Set(tekster).size, VERBER.length, 'each verb has its own sentence');
  for (const v of ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd'] as const) assert.match(handlingsOpgave(v), /afledt data/);
  assert.match(handlingsOpgave('forbered'), /udkast/);
  assert.match(handlingsOpgave('send-til-andre'), /udkast[^.]*Henrik sender selv/);
  for (const v of ['betal', 'kopier-paa-tvaers', 'ukendt-verb', '']) assert.match(handlingsOpgave(v), /gør du intet/, v);
  assert.match(fortrydOpgave(), /Henrik har trykket "Fortryd"/);
  assert.match(fortrydOpgave(), /afledt data/);
});

// Structural: no prompt under src/rooms or src/kurator writes `instructions` by hand — they all go through byggPrompt.
async function filer(dir: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p)));
    else if (e.name.endsWith('.ts')) ud.push(p);
  }
  return ud;
}

test('no file under src/rooms or src/kurator builds `instructions` by hand', async () => {
  const src = new URL('../../src/', import.meta.url).pathname;
  const fund: string[] = [];
  for (const dir of ['rooms', 'kurator']) {
    for (const f of await filer(path.join(src, dir))) {
      const linjer = (await readFile(f, 'utf8')).split('\n');
      linjer.forEach((l, i) => { if (/\binstructions\s*:/.test(l) && !/^\s*(\/\/|\*)/.test(l)) fund.push(`${path.relative(src, f)}:${i + 1}`); });
    }
  }
  assert.deepEqual(fund, []);
});

// KC-0241: the shared builder in English; the verbs, zone ids and the delimiter shape are the contract.
test('English: the builder\'s sections come in the same order, in English, and every verb has its own sentence', () => {
  medSprog('en', () => {
    const { instructions } = byggPrompt({ rum: 'mail', zone: 'privat', opgave: 'TASK', katalog: true, data: [{ kilde: 'x', zone: 'privat', tillid: 'utroet', tekst: 'T' }], graense: 'a'.repeat(24) });
    const pos = ['Limits that always apply', 'The building blocks', 'Language: English', 'Zone: privat.', 'Data: What stands between', 'TASK'].map((s) => instructions.indexOf(s));
    assert.ok(pos.every((p) => p >= 0), pos.join(','));
    assert.deepEqual([...pos].sort((a, b) => a - b), pos);
    const tekster = VERBER.map((v) => handlingsOpgave(v));
    for (const t of tekster) assert.match(t, /The user has pressed the button/);
    assert.equal(new Set(tekster).size, VERBER.length);
    assert.match(handlingsOpgave('send-til-andre'), /draft; the user sends it themselves/);
    for (const v of ['betal', 'kopier-paa-tvaers', 'ukendt-verb']) assert.match(handlingsOpgave(v), /you do nothing/, v);
    assert.match(handlingsOpgave('ukendt-verb'), /verb "unknown"/);
    assert.match(fortrydOpgave(), /The user has pressed "Undo"/);
  });
});
