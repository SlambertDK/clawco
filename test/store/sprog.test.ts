// KC-0170: the language of the request lives below the shell, so kilder/, graenser/, tillid/ and hushold/ can read it
// without importing shell/ (AGENTS §1). The shell re-exports the very same functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medSprog, sprogNu, STANDARD_SPROG } from '../../src/store/sprog.ts';
import * as shell from '../../src/shell/tekster.ts';

test('no language set reads as the standard (Danish, the installation from before Start)', () => {
  assert.equal(STANDARD_SPROG, 'da');
  assert.equal(sprogNu(), 'da');
});

test('medSprog sets the language for what runs inside it, nested and async', async () => {
  assert.equal(medSprog('en', () => sprogNu()), 'en');
  assert.equal(medSprog('en', () => medSprog('da', () => sprogNu())), 'da');
  assert.equal(await medSprog('en', async () => { await new Promise((r) => setTimeout(r, 1)); return sprogNu(); }), 'en');
  assert.equal(sprogNu(), 'da');
});

test('the shell re-exports the same seam, so one request has one language everywhere', () => {
  assert.equal(shell.medSprog, medSprog);
  assert.equal(shell.sprogNu, sprogNu);
  assert.equal(shell.STANDARD_SPROG, STANDARD_SPROG);
  assert.equal(medSprog('en', () => shell.tekst().lang), 'en');
});
