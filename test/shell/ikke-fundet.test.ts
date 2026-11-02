import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIkkeFundet } from '../../src/shell/ikkefundet.ts';

// KC-0089: the calm Danish main for an address that points nowhere.
test('the not-found main says what is missing, in Danish, with a clear way back to Hjem', () => {
  const out = String(renderIkkeFundet('rum'));
  assert.match(out, /<h1>Det rum findes ikke<\/h1>/);
  assert.match(out, /<a [^>]*href="\/rum\/hjem"[^>]*>Til Nu<\/a>/);
  assert.doesNotMatch(out, /tegnet|ikke bygget|Not Found/i);
});

test('each kind has its own heading and all of them lead back to Hjem', () => {
  assert.match(String(renderIkkeFundet('side')), /<h1>Siden findes ikke<\/h1>/);
  assert.match(String(renderIkkeFundet('dokument')), /<h1>Dokumentet findes ikke<\/h1>/);
  for (const k of ['rum', 'side', 'dokument'] as const) assert.match(String(renderIkkeFundet(k)), /href="\/rum\/hjem"/);
});
