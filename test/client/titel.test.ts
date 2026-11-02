// KC-0079: one glance at the browser tab or the home-screen icon says whether something waits.
// The number is what waits on Henrik — his own unfinished work (Skrive drafts, a univers' pile) is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/titel.js';
import { antalVenter } from '../../src/shell/synlig.ts';

type Titel = { antal(venter: Record<string, number>, erEget: (id: string) => boolean): number; titel(base: string, n: number): string };
const KC = (globalThis as unknown as { KCTitel: Titel }).KCTitel;
const eget = (id: string) => id === 'skrive' || id.startsWith('univers-');

test('the count is everything waiting except own unfinished work', () => {
  assert.equal(KC.antal({ dagen: 1, mail: 7, skrive: 4, univers: 1, 'univers-havvind': 3 }, eget), 9);
});

test('the browser count and the server count agree', () => {
  for (const v of [{}, { mail: 2 }, { skrive: 5 }, { dagen: 1, mail: 7, skrive: 4, univers: 1, 'univers-havvind': 3 }]) {
    assert.equal(KC.antal(v, eget), antalVenter(v), JSON.stringify(v));
  }
});

test('the title starts with the count, and is plain when nothing waits', () => {
  assert.equal(KC.titel('Mail · Clawco', 9), '(9) Mail · Clawco');
  assert.equal(KC.titel('Mail · Clawco', 0), 'Mail · Clawco');
});
