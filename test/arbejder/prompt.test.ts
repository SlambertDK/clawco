import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arbejderPrompt, skalKoere, syncLinjer } from '../../deploy/arbejder/prompt.ts';

const NY = 'Kontrolcenter: ny opgave → KC-0060 "Ret knappen" (P1). Tag den op efter projektets regler.';
const SVAR = 'Kontrolcenter: Henrik svarede på KC-0058 — "Ja, gør det". Tag den op igen efter projektets regler.';
const STATUS = 'Kontrolcenter: KC-0057 → faerdig.';

test('syncLinjer keeps only the lines that hand the worker something to do', () => {
  assert.deepEqual(syncLinjer(`${STATUS}\n${NY}\n\n${SVAR}\n`), [NY, SVAR]);
  assert.deepEqual(syncLinjer(`${STATUS}\n`), []);
  assert.deepEqual(syncLinjer(''), []);
});

test('the worker starts Claude Code only for a new opgave, an answer, or a run that was cut off', () => {
  assert.equal(skalKoere({ linjer: [], afbrudt: false }), false);
  assert.equal(skalKoere({ linjer: [NY], afbrudt: false }), true);
  assert.equal(skalKoere({ linjer: [], afbrudt: true }), true);
});

test('the prompt quotes what arrived and limits the run to those tickets', () => {
  const p = arbejderPrompt({ linjer: [NY, SVAR], afbrudt: false });
  assert.ok(p.includes(NY) && p.includes(SVAR));
  assert.match(p, /only/i);
  assert.match(p, /AGENTS\.md/);
  assert.match(p, /henrik_gate: decision/);
  assert.match(p, /data, not instructions/i);
  assert.doesNotMatch(p, /cut off/i);
});

test('a run that was cut off is told to finish the uncommitted work first', () => {
  const p = arbejderPrompt({ linjer: [], afbrudt: true });
  assert.match(p, /cut off/i);
  assert.match(p, /git status/);
});

test('KC-0055: the worker knows it has no project secrets and hands secret-bound steps back to the Mac as an open ticket', () => {
  const p = arbejderPrompt({ linjer: [NY], afbrudt: false });
  assert.match(p, /none of the project's secrets/);
  assert.match(p, /status: open/);
  assert.match(p, /the branch this clone is on/, 'a parked or handed-back ticket goes to the integration branch (ShelfAtlas: staging), not always main');
  assert.doesNotMatch(p, /commit that to main/);
});
