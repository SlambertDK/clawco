// KC-0170 slice 3, Husstanden (part E), the actions through the app: every answer, refusal and log line of the room, in
// the language of the install. test/fixtures/sprog-handlinger-husstand.ts runs one scenario per area (requests, things
// and clashes, the chat's cards, the weekend card, roles/invitations/the go-between) and returns what the person would
// read, one line per text.
//
// - Danish (no language chosen, or `da`): the lines in test/fixtures/sprog-husstand-handlinger/da.json were captured
//   from the code BEFORE the strings moved, so the Danish is byte for byte what it was. The file may not change unless
//   the Danish copy changes on purpose.
// - English: en.json is the same run in English, reviewed by hand; and nothing the person reads in it is Danish
//   (Hermes' words are scripted in English here). Where the composition root does not yet wrap the clock in the
//   install's language (server.ts), the run wraps it itself, as the root should.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kor } from '../fixtures/sprog-handlinger-husstand.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';

const fixtur = (sprog: 'da' | 'en'): string[] => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/sprog-husstand-handlinger/${sprog}.json`, import.meta.url)), 'utf8')) as string[];
const forskel = (faktisk: string[], forventet: string[]): string[] => {
  const ud: string[] = [];
  for (let i = 0; i < Math.max(faktisk.length, forventet.length); i++) if (faktisk[i] !== forventet[i]) ud.push(`#${i}\n  now: ${faktisk[i]}\n  was: ${forventet[i]}`);
  return ud.slice(0, 5);
};

test('Danish: every text of the room is byte for byte what it was before the strings moved', async () => {
  const nu = await kor('da');
  assert.deepEqual(forskel(nu, fixtur('da')), []);
  assert.equal(nu.length, fixtur('da').length);
});

test('English: the same run, in English, reviewed', async () => {
  const nu = await kor('en');
  assert.deepEqual(forskel(nu, fixtur('en')), []);
  assert.equal(nu.length, fixtur('en').length);
});

test('English: no text of the room is Danish', async () => {
  // The words in front of each step are the test's own labels; only what the person reads is checked.
  const tekst = (l: string): string => (l.includes(' | ') ? l.slice(l.indexOf(' | ') + 3).replace(/^(?:log \S+(?: \(\w+\))*|run \S+): /, '') : l.slice(l.indexOf(': ') + 2));
  const dansk = (await kor('en')).filter((l) => DANSK.test(tekst(l)));
  assert.deepEqual(dansk, []);
});

test('both languages say the same things: the same steps in the same order with the same status, only the words differ', () => {
  const [da, en] = [fixtur('da'), fixtur('en')];
  assert.equal(da.length, en.length);
  // Log lines and notes sort by their words, so only the answered steps (`<scenario> :: <step> | <status> <text>`) are compared one by one.
  const svar = (liste: string[]): string[] => liste.flatMap((l) => { const m = /^([^|]+?) \| (\d{3}) /.exec(l); return m ? [`${m[1]} ${m[2]}`] : []; });
  assert.deepEqual(svar(en), svar(da));
  assert.ok(svar(da).length > 100, 'a run with many answered steps');
  assert.equal(da.filter((l) => / \| log /.test(l)).length, en.filter((l) => / \| log /.test(l)).length, 'one log line for one log line');
});
