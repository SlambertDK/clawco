import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/ark.js';

// KC-0065: on iOS 26 Safari the bar above the keyboard (arrows + checkmark)
// floats over the page inside the visual viewport, so the chat sheet must end
// above it — otherwise the field Henrik types in sits behind the bar.
type Ind = { vvH: number; fuldH: number; feltFokus: boolean; ios: boolean };
const KC = (globalThis as unknown as { KCArk: { synligHoejde(o: Ind): number; tastaturAaben(o: Ind): boolean; BJAELKE: number } }).KCArk;

// With the keyboard open the sheet takes the whole visible height (no 85 % sheet), so its
// content fits and only the messages scroll — never the sheet as well (double scroll).
test('keyboard open: a focused field and a visible height well below the full height, on any phone', () => {
  assert.equal(KC.tastaturAaben({ vvH: 410, fuldH: 748, feltFokus: true, ios: true }), true);
  assert.equal(KC.tastaturAaben({ vvH: 410, fuldH: 748, feltFokus: true, ios: false }), true);
  assert.equal(KC.tastaturAaben({ vvH: 740, fuldH: 748, feltFokus: true, ios: true }), false);
  assert.equal(KC.tastaturAaben({ vvH: 410, fuldH: 748, feltFokus: false, ios: true }), false);
});

test('iOS with the keyboard open: the sheet ends above the floating bar', () => {
  assert.equal(KC.synligHoejde({ vvH: 536, fuldH: 874, feltFokus: true, ios: true }), 536 - KC.BJAELKE);
});

test('the bar reservation covers the bar measured on Henrik\'s iPhone (59 pt incl. its gap)', () => {
  assert.ok(KC.BJAELKE >= 59 && KC.BJAELKE <= 72, `BJAELKE ${KC.BJAELKE}`);
});

test('no keyboard: the whole visible height', () => {
  assert.equal(KC.synligHoejde({ vvH: 874, fuldH: 874, feltFokus: false, ios: true }), 874);
});

test('a focused field without the on-screen keyboard (height unchanged) reserves nothing', () => {
  assert.equal(KC.synligHoejde({ vvH: 870, fuldH: 874, feltFokus: true, ios: true }), 870);
});

test('a field lost focus while the keyboard closes: nothing reserved', () => {
  assert.equal(KC.synligHoejde({ vvH: 536, fuldH: 874, feltFokus: false, ios: true }), 536);
});

test('not iOS (Android, laptop): the visible height as reported', () => {
  assert.equal(KC.synligHoejde({ vvH: 536, fuldH: 874, feltFokus: true, ios: false }), 536);
});
