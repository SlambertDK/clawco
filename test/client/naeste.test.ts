// KC-0088: the "om …" countdown on Hjem stays true between page loads, in the same words as the server's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/naeste.js';
import { omTekst } from '../../src/shell/naeste.ts';

type El = { getAttribute(n: string): string | null; querySelector(s: string): { textContent: string } | null; hidden: boolean };
type Naeste = { om(start: number, slut: number | undefined, nu: number): string | null; tik(doc: { querySelectorAll(s: string): El[] }, nu: number): void };
const KC = (globalThis as unknown as { KCNaeste: Naeste }).KCNaeste;

test('the browser countdown and the server countdown agree, from a day ahead to after the end', () => {
  const start = 1_000_000_000_000;
  for (const slut of [undefined, start + 3_600_000]) {
    for (let s = -7_300; s <= 86_400; s += 37) {
      const nu = start - s * 1000;
      assert.equal(KC.om(start, slut, nu), omTekst(start, slut, nu), `${s}s before, slut ${slut}`);
    }
  }
});

const linje = (start: number, slut: number | undefined, tekst: string): El & { span: { textContent: string } } => {
  const span = { textContent: tekst };
  return { span, hidden: false, getAttribute: (n) => (n === 'data-start' ? String(start) : n === 'data-slut' && slut !== undefined ? String(slut) : null), querySelector: () => span };
};

test('tik rewrites the countdown from the data attributes', () => {
  const l = linje(10 * 60_000, 20 * 60_000, 'om 25 min');
  KC.tik({ querySelectorAll: () => [l] }, 0);
  assert.equal(l.span.textContent, 'om 10 min');
  assert.equal(l.hidden, false);
  KC.tik({ querySelectorAll: () => [l] }, 12 * 60_000);
  assert.equal(l.span.textContent, 'nu');
});

test('tik hides the line once the appointment is over', () => {
  const l = linje(10 * 60_000, 20 * 60_000, 'nu');
  KC.tik({ querySelectorAll: () => [l] }, 20 * 60_000);
  assert.equal(l.hidden, true);
});
