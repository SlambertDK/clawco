// KC-0130: the one card that explains the trust ladder in plain Danish (spec §4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTillidskort, TILLID_NIVEAUER } from '../../../src/rooms/start/tillidskort.ts';

const tekstAf = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const ord = (t: string): number => t.split(' ').filter(Boolean).length;

test('the card shows all six levels in order, as one kort block', () => {
  const h = String(renderTillidskort());
  assert.match(h, /data-blok="kort"/);
  assert.match(h, /data-tillidskort/);
  const ider = [...h.matchAll(/data-niveau="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ider, ['0', '1', '2', '3', '4', 'graense']);
  assert.deepEqual(TILLID_NIVEAUER.map((n) => n.id), ['0', '1', '2', '3', '4', 'graense']);
});

test('the copy stays within about seventy words', () => {
  const t = tekstAf(String(renderTillidskort()));
  assert.ok(ord(t) <= 70, `${ord(t)} words: ${t}`);
  assert.ok(ord(t) >= 30, 'and says something');
});

test('the limit names what Hermes never does', () => {
  const graense = TILLID_NIVEAUER.find((n) => n.id === 'graense')!.tekst.toLowerCase();
  for (const hvad of ['betale', 'skrive til andre', 'slette', 'kopiere']) assert.ok(graense.includes(hvad), hvad);
});

test('the levels use plain words, not the ladder\'s jargon', () => {
  const t = tekstAf(String(renderTillidskort())).toLowerCase();
  for (const jargon of ['verb', 'trin 0', 'regelsæt', 'token', 'api']) assert.ok(!t.includes(jargon), jargon);
});

test('every piece of text goes through the escaper', () => {
  const h = String(renderTillidskort());
  assert.ok(!/<script/i.test(h));
  assert.ok(!h.includes('undefined'));
});
