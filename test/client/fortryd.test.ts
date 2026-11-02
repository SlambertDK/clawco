// KC-0085: right after a handling that can be undone, the message itself offers "Fortryd".
// The page compares the log's undo buttons before and after the press: exactly one new one is
// the handling just done; none (nothing to undo) or several (other changes landed too) offer nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/fortryd.js';

type Fortryd = { ny(foer: string[], efter: string[]): string | null; VIS_MS: number };
const KC = (globalThis as unknown as { KCFortryd: Fortryd }).KCFortryd;

test('one new undoable entry after the press is the one offered', () => {
  assert.equal(KC.ny(['a', 'b'], ['c', 'a', 'b']), 'c');
});

test('nothing new to undo offers nothing', () => {
  assert.equal(KC.ny(['a'], ['a']), null);
  assert.equal(KC.ny([], []), null);
});

test('several new entries are ambiguous: offer nothing rather than the wrong one', () => {
  assert.equal(KC.ny(['a'], ['c', 'd', 'a']), null);
});

test('the offer stays long enough to read and reach (at least 6 s)', () => {
  assert.ok(KC.VIS_MS >= 6000);
});
