// KC-0064 phase 3: the seen-set behind the "new" dot (public/morph.js, kcMorph.SeteIds).
// A browser without a seen-set records a baseline (no dots); without storage nothing is ever new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Lager = { getItem(k: string): string | null; setItem(k: string, v: string): void };
type Sete = { baseline: boolean; har(id: string): boolean; tilfoej(ids: string[]): void };
type SeteIds = (storage: Lager | null, cap?: number, noegle?: string) => Sete;

const SRC = readFileSync(new URL('../../public/morph.js', import.meta.url), 'utf8');
function SeteIds(): SeteIds {
  const win: { kcMorph?: { SeteIds?: SeteIds } } = {};
  new Function('window', SRC)(win);
  assert.equal(typeof win.kcMorph?.SeteIds, 'function', 'kcMorph.SeteIds exists');
  return win.kcMorph!.SeteIds!;
}
function lager(): Lager & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
const kaster: Lager = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('an empty storage is a baseline; what was added is seen by the next page load', () => {
  const S = SeteIds();
  const l = lager();
  const s = S(l);
  assert.equal(s.baseline, true);
  assert.equal(s.har('a'), false);
  s.tilfoej(['a']);
  assert.equal(s.baseline, false, 'after the baseline is written, later ids can be new');
  assert.equal(s.har('a'), true);
  const igen = S(l);
  assert.equal(igen.baseline, false);
  assert.equal(igen.har('a'), true);
  assert.equal(igen.har('b'), false);
  assert.deepEqual(JSON.parse(l.data.get('kc-sete')!), ['a']);
});

test('the seen-set is capped; the oldest ids are dropped, and ids are not stored twice', () => {
  const S = SeteIds();
  const l = lager();
  const s = S(l, 3);
  s.tilfoej(['a', 'b']);
  s.tilfoej(['b', 'c', 'd', 'e']);
  assert.deepEqual(JSON.parse(l.data.get('kc-sete')!), ['c', 'd', 'e']);
  const igen = S(l, 3);
  assert.equal(igen.har('a'), false);
  assert.equal(igen.har('e'), true);
});

test('a storage that throws stays a baseline and never throws', () => {
  const s = SeteIds()(kaster);
  assert.equal(s.baseline, true);
  assert.doesNotThrow(() => s.tilfoej(['a']));
  assert.equal(s.baseline, true, 'without storage nothing is ever marked new');
});

test('no storage at all behaves the same', () => {
  const s = SeteIds()(null);
  assert.equal(s.baseline, true);
  assert.doesNotThrow(() => s.tilfoej(['a']));
  assert.equal(s.baseline, true);
});

test('a garbled seen-set is a baseline, not an error', () => {
  const l = lager();
  l.data.set('kc-sete', '{nope');
  const s = SeteIds()(l);
  assert.equal(s.baseline, true);
  s.tilfoej(['a']);
  assert.deepEqual(JSON.parse(l.data.get('kc-sete')!), ['a']);
});

test('each room has its own seen-set, so the first visit to a room is a baseline too', () => {
  const S = SeteIds();
  const l = lager();
  S(l, 1000, 'kc-sete:hjem').tilfoej(['kort:a']);
  const mail = S(l, 1000, 'kc-sete:mail');
  assert.equal(mail.baseline, true);
  assert.equal(mail.har('kort:a'), false);
  mail.tilfoej(['mail:1']);
  assert.deepEqual(JSON.parse(l.data.get('kc-sete:mail')!), ['mail:1']);
  assert.deepEqual(JSON.parse(l.data.get('kc-sete:hjem')!), ['kort:a']);
});
