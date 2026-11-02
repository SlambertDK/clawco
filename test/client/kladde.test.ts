// KC-0087: what Henrik is writing in the chat survives a reload or a trip to another room,
// one draft per room, and it goes once it is sent. A blocked storage never breaks the chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/kladde.js';

type Lager = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type Kladde = { gem(l: Lager | null, rum: string, tekst: string): void; hent(l: Lager | null, rum: string): string };
const KC = (globalThis as unknown as { KCKladde: Kladde }).KCKladde;

function lager(): Lager & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

test('a draft is kept per room and read back', () => {
  const l = lager();
  KC.gem(l, 'mail', 'Svar Clara at');
  KC.gem(l, 'dagen', 'Flyt løbet');
  assert.equal(KC.hent(l, 'mail'), 'Svar Clara at');
  assert.equal(KC.hent(l, 'dagen'), 'Flyt løbet');
  assert.equal(KC.hent(l, 'hjem'), '');
});

test('an empty or blank field removes the draft (sent, or erased by hand)', () => {
  const l = lager();
  KC.gem(l, 'mail', 'noget');
  KC.gem(l, 'mail', '   ');
  assert.equal(KC.hent(l, 'mail'), '');
  assert.equal(l.m.size, 0);
});

test('no storage, or a storage that throws, gives no draft and no error', () => {
  const kaster: Lager = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => KC.gem(kaster, 'mail', 'x'));
  assert.equal(KC.hent(kaster, 'mail'), '');
  assert.doesNotThrow(() => KC.gem(null, 'mail', 'x'));
  assert.equal(KC.hent(null, 'mail'), '');
});

test('a very long draft is kept whole up to a sane cap', () => {
  const l = lager();
  KC.gem(l, 'skrive', 'a'.repeat(5000));
  assert.equal(KC.hent(l, 'skrive').length, 5000);
});
