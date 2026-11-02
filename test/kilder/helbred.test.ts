// KC-0139: the health state machine. Pure: a stream of real health/read outcomes
// in, one debounced visible state out. A transient failure (nede, langsomt) becomes
// visible only after 3 in a row spanning at least an hour; an auth failure at once;
// a known expiry within 48 h raises snart-udloebet; one ok clears everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iagttag, type Maaling, type Post } from '../../src/kilder/helbred.ts';

const T0 = Date.parse('2026-11-01T08:00:00Z');
const kl = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const m = (min: number, status: Maaling['status'], extra: Partial<Maaling> = {}): Maaling => ({ tid: kl(min), status, ...extra });

function koer(...serie: Maaling[]): Post {
  let p: Post | undefined;
  for (const x of serie) p = iagttag(p, x);
  return p as Post;
}

test('a first ok is ok and remembers when', () => {
  const p = koer(m(0, 'ok'));
  assert.equal(p.vist, 'ok');
  assert.equal(p.sidstOk, kl(0));
  assert.equal(p.fejl, 0);
});

test('transient failure x1 and x2 stay silent', () => {
  assert.equal(koer(m(0, 'ok'), m(30, 'nede')).vist, 'ok');
  assert.equal(koer(m(0, 'ok'), m(30, 'nede'), m(60, 'nede')).vist, 'ok');
});

test('transient x3 within less than an hour stays silent (many failed reads in a minute are one hiccup)', () => {
  const p = koer(m(0, 'ok'), m(1, 'nede'), m(2, 'nede'), m(3, 'nede'), m(40, 'nede'));
  assert.equal(p.vist, 'ok');
  assert.equal(p.fejl, 4);
});

test('transient x3 spanning at least an hour becomes nede, with when it began', () => {
  const p = koer(m(0, 'ok'), m(10, 'nede'), m(40, 'nede'), m(70, 'nede'));
  assert.equal(p.vist, 'nede');
  assert.equal(p.siden, kl(70));
  assert.equal(p.sidstOk, kl(0));
});

test('exactly one hour is enough', () => {
  assert.equal(koer(m(0, 'nede'), m(30, 'nede'), m(60, 'nede')).vist, 'nede');
});

test('langsomt is transient too and becomes langsomt, not nede', () => {
  assert.equal(koer(m(0, 'langsomt'), m(30, 'langsomt'), m(60, 'langsomt')).vist, 'langsomt');
});

test('an auth failure is visible at once', () => {
  const p = koer(m(0, 'ok'), m(30, 'log-ind-igen'));
  assert.equal(p.vist, 'log-ind-igen');
  assert.equal(p.siden, kl(30));
});

test('a transient failure never downgrades a visible log-ind-igen, and siden stays', () => {
  const p = koer(m(0, 'log-ind-igen'), m(30, 'nede'), m(60, 'nede'), m(120, 'nede'));
  assert.equal(p.vist, 'log-ind-igen');
  assert.equal(p.siden, kl(0));
});

test('an ok clears the streak and the visible state', () => {
  const p = koer(m(0, 'log-ind-igen'), m(10, 'ok'));
  assert.equal(p.vist, 'ok');
  assert.equal(p.fejl, 0);
  assert.equal(p.foersteFejl, undefined);
  assert.equal(p.siden, kl(10));
  const q = koer(m(0, 'nede'), m(30, 'nede'), m(60, 'nede'), m(90, 'ok'), m(100, 'nede'));
  assert.equal(q.vist, 'ok', 'a new streak starts from zero');
  assert.equal(q.fejl, 1);
});

test('a successful read sets sidstLaest and counts as ok', () => {
  const p = koer(m(0, 'nede'), m(5, 'ok', { laest: true }));
  assert.equal(p.sidstLaest, kl(5));
  assert.equal(p.vist, 'ok');
  assert.equal(koer(m(0, 'ok')).sidstLaest, undefined, 'a health check alone is not a read');
});

test('a known expiry within 48 h raises snart-udloebet; further away does not', () => {
  const inden = new Date(T0 + 47 * 3600_000).toISOString();
  const senere = new Date(T0 + 49 * 3600_000).toISOString();
  const p = koer(m(0, 'ok', { udloeber: inden }));
  assert.equal(p.vist, 'snart-udloebet');
  assert.equal(p.udloeber, inden);
  assert.equal(koer(m(0, 'ok', { udloeber: senere })).vist, 'ok');
});

test('an expiry that has already passed still reads snart-udloebet while the source works', () => {
  assert.equal(koer(m(0, 'ok', { udloeber: kl(-60) })).vist, 'snart-udloebet');
});

test('a connector that reports snart-udloebet itself is kept, and it is not a failure', () => {
  const p = koer(m(0, 'snart-udloebet'));
  assert.equal(p.vist, 'snart-udloebet');
  assert.equal(p.fejl, 0);
  assert.equal(p.sidstOk, kl(0));
});

test('snart-udloebet goes back to ok when the expiry is renewed', () => {
  const inden = new Date(T0 + 24 * 3600_000).toISOString();
  const p = koer(m(0, 'ok', { udloeber: inden }), m(10, 'ok'));
  assert.equal(p.vist, 'ok');
  assert.equal(p.udloeber, undefined);
});

test('a transient failure while snart-udloebet keeps that state until debounced', () => {
  const inden = new Date(T0 + 24 * 3600_000).toISOString();
  const p = koer(m(0, 'ok', { udloeber: inden }), m(10, 'nede'));
  assert.equal(p.vist, 'snart-udloebet');
});

test('siden changes only when the visible state changes', () => {
  const p = koer(m(0, 'ok'), m(10, 'ok'), m(20, 'ok'));
  assert.equal(p.siden, kl(0));
});

test('an unreadable time is ignored, never a throw', () => {
  const foer = koer(m(0, 'ok'));
  assert.deepEqual(iagttag(foer, { tid: 'ikke en tid', status: 'nede' }), foer);
});
