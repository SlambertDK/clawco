// KC-0083: a handling whose connection drops is picked up again. The run goes on at the server
// whatever the page does; when the connection is back, the page follows it again and shows the
// result instead of saying that Hermes failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/foelg.js';

type Foelg = {
  ventOm(forsoeg: number): number | null;
  skridt(koe: { id: string }[], runId: string): 'foelg' | 'vaek';
  MAX: number;
};
const KC = (globalThis as unknown as { KCFoelg: Foelg }).KCFoelg;

test('a dropped stream is looked at again after a growing wait, capped at 30 s', () => {
  assert.equal(KC.ventOm(0), 1000);
  assert.equal(KC.ventOm(1), 2000);
  assert.equal(KC.ventOm(5), 30000);
});

test('after MAX tries the page stops waiting on its own', () => {
  assert.equal(KC.ventOm(KC.MAX), null);
  assert.ok(KC.MAX >= 6, 'about two minutes of tries before giving up');
});

test('a run the server still knows is followed again (its events replay to the end)', () => {
  assert.equal(KC.skridt([{ id: 'kc_a' }, { id: 'kc_b' }], 'kc_b'), 'foelg');
});

test('a run the server no longer knows is gone: the room is fetched instead', () => {
  assert.equal(KC.skridt([{ id: 'kc_a' }], 'kc_b'), 'vaek');
  assert.equal(KC.skridt([], 'kc_b'), 'vaek');
});
