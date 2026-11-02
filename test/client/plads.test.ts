// KC-0101: going to another room and back within ten minutes puts Henrik at the same place
// in the room, not at the top. A stale place, a #fragment, browser back/forward or a blocked
// storage all mean "start at the top as usual".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/plads.js';

type Lager = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type Valg = { hash?: string; navType?: string };
type Plads = {
  gem(l: Lager | null, sti: string, y: number, nu: number): void;
  hent(l: Lager | null, sti: string, nu: number, valg?: Valg): number | null;
  UDLOEB: number;
};
const KC = (globalThis as unknown as { KCPlads: Plads }).KCPlads;

function lager(): Lager & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}
const T0 = 1_000_000;
const MIN = 60_000;

test('the place is kept per room path and read back', () => {
  const l = lager();
  KC.gem(l, '/rum/mail', 1200, T0);
  KC.gem(l, '/rum/dagen', 340, T0);
  assert.equal(KC.hent(l, '/rum/mail', T0 + MIN), 1200);
  assert.equal(KC.hent(l, '/rum/dagen', T0 + MIN), 340);
  assert.equal(KC.hent(l, '/rum/skrive', T0 + MIN), null);
});

test('the place expires after ten minutes, not before', () => {
  const l = lager();
  KC.gem(l, '/rum/mail', 900, T0);
  assert.equal(KC.UDLOEB, 10 * MIN);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 10 * MIN - 1), 900);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 10 * MIN), null);
});

test('a place at the very top is not stored (nothing to restore)', () => {
  const l = lager();
  KC.gem(l, '/rum/mail', 1200, T0);
  KC.gem(l, '/rum/mail', 0, T0 + 1);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 2), null);
  assert.equal(l.m.size, 0);
});

test('a #fragment in the URL means the room starts where the fragment points', () => {
  const l = lager();
  KC.gem(l, '/rum/mail', 1200, T0);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 1, { hash: '#mail-3' }), null);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 1, { hash: '' }), 1200);
});

test('browser back/forward keeps its native scroll restoration', () => {
  const l = lager();
  KC.gem(l, '/rum/mail', 1200, T0);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 1, { navType: 'back_forward' }), null);
  assert.equal(KC.hent(l, '/rum/mail', T0 + 1, { navType: 'navigate' }), 1200);
});

test('garbage or a bad value in the storage reads as no place', () => {
  const l = lager();
  l.setItem('kc-plads:/rum/mail', '{nope');
  assert.equal(KC.hent(l, '/rum/mail', T0), null);
  l.setItem('kc-plads:/rum/mail', JSON.stringify({ y: -5, t: T0 }));
  assert.equal(KC.hent(l, '/rum/mail', T0), null);
  l.setItem('kc-plads:/rum/mail', JSON.stringify({ y: 'ned', t: T0 }));
  assert.equal(KC.hent(l, '/rum/mail', T0), null);
  l.setItem('kc-plads:/rum/mail', JSON.stringify({ y: 100, t: T0 + 5 * MIN }));
  assert.equal(KC.hent(l, '/rum/mail', T0), null, 'a time in the future is not trusted');
});

test('a missing or blocked storage never throws — there is just no place', () => {
  const kaster: Lager = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => KC.gem(kaster, '/rum/mail', 500, T0));
  assert.equal(KC.hent(kaster, '/rum/mail', T0), null);
  assert.doesNotThrow(() => KC.gem(null, '/rum/mail', 500, T0));
  assert.equal(KC.hent(null, '/rum/mail', T0), null);
});
