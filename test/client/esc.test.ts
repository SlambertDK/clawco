// KC-0090: Esc closes what is open, the innermost first, one per press — and the keyboard focus
// is always visible. Native dialogs (Send til Claude Code, Genveje) close themselves; the rest is ours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../public/esc.js';

type Aabne = { senere: boolean; koe: boolean; samtale: boolean; chat: boolean; kontekst: boolean };
type Esc = { foerst(a: Aabne): keyof Aabne | null };
const KC = (globalThis as unknown as { KCEsc: Esc }).KCEsc;
const ingen: Aabne = { senere: false, koe: false, samtale: false, chat: false, kontekst: false };

test('KC-0096: the open Senere choice on a card is the innermost thing: it closes before anything else', () => {
  assert.equal(KC.foerst({ ...ingen, senere: true }), 'senere');
  assert.equal(KC.foerst({ ...ingen, senere: true, chat: true, kontekst: true }), 'senere');
});

test('nothing open: Esc does nothing', () => {
  assert.equal(KC.foerst(ingen), null);
});

test('a floating panel goes before the chat it sits over', () => {
  assert.equal(KC.foerst({ ...ingen, koe: true, chat: true }), 'koe');
  assert.equal(KC.foerst({ ...ingen, samtale: true, chat: true }), 'samtale');
});

test('the chat sheet goes before the element it is about', () => {
  assert.equal(KC.foerst({ ...ingen, chat: true, kontekst: true }), 'chat');
  assert.equal(KC.foerst({ ...ingen, kontekst: true }), 'kontekst');
});

test('every button and link shows where the keyboard is (a :focus-visible ring)', () => {
  const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--handling\)/);
  assert.doesNotMatch(css, /outline:\s*(none|0)\b/, 'nothing removes the focus ring');
});
