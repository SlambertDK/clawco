// KC-0080: on the laptop the keyboard is the fast way: a digit opens the n-th room in the menu,
// / goes to the chat field, ? shows the shortcuts. Never while Henrik types, never with a modifier
// (the browser's own shortcuts stay his).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/genveje.js';

type Tast = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; iFelt?: boolean };
type Genveje = { handling(t: Tast): { type: 'rum'; nr: number } | { type: 'chat' } | { type: 'hjaelp' } | null };
const KC = (globalThis as unknown as { KCGenveje: Genveje }).KCGenveje;

test('a digit opens the room with that number in the menu', () => {
  assert.deepEqual(KC.handling({ key: '1' }), { type: 'rum', nr: 1 });
  assert.deepEqual(KC.handling({ key: '5' }), { type: 'rum', nr: 5 });
  assert.equal(KC.handling({ key: '0' }), null);
});

test('/ goes to the chat and ? shows the shortcuts', () => {
  assert.deepEqual(KC.handling({ key: '/' }), { type: 'chat' });
  assert.deepEqual(KC.handling({ key: '?' }), { type: 'hjaelp' });
});

test('nothing happens while typing in a field', () => {
  for (const key of ['1', '/', '?']) assert.equal(KC.handling({ key, iFelt: true }), null, key);
});

test('with a modifier the key stays the browser\'s', () => {
  assert.equal(KC.handling({ key: '1', metaKey: true }), null);
  assert.equal(KC.handling({ key: '1', ctrlKey: true }), null);
  assert.equal(KC.handling({ key: '/', altKey: true }), null);
});

test('other keys are left alone', () => {
  assert.equal(KC.handling({ key: 'a' }), null);
  assert.equal(KC.handling({ key: 'Enter' }), null);
});
