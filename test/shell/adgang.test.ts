// KC-0170: the page for someone Clawco does not know, in the request's language. Danish (no language, or da) is byte
// for byte what it was (test/fixtures/sprog-server/adgang.html, captured before the words moved); English has no Danish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIngenAdgang } from '../../src/shell/adgang.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';

const golden = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sprog-server/adgang.html'), 'utf8');
const HVORFOR = 'Du er ikke i <husstanden>.';

test('Danish, chosen or not: the refusal page is byte for byte what it was, the reason escaped', () => {
  assert.equal(renderIngenAdgang(HVORFOR), golden);
  assert.equal(medSprog('da', () => renderIngenAdgang(HVORFOR)), golden);
  assert.match(golden, /&lt;husstanden&gt;/);
});

test('English: lang, title and heading are English and nothing Danish is left but the caller\'s reason', () => {
  const doc = medSprog('en', () => renderIngenAdgang('You are not in this household.'));
  assert.match(doc, /<html lang="en">/);
  assert.match(doc, /<title>No access<\/title>/);
  assert.match(doc, /<h1>No access<\/h1>/);
  assert.deepEqual(danskeLinjer(doc), []);
});
