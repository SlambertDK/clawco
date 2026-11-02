// KC-0073: on the phone "Spørg Hermes" floats over the room; while Henrik scrolls down to read and
// tap, it must not sit on the buttons he is reaching for. It tucks away on the way down and is
// back on the way up, at the top and at the bottom of the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../public/fab.js';

type Fab = { vedScroll(forrigeY: number, y: number, maxY: number): 'skjul' | 'vis' | null };
const KC = (globalThis as unknown as { KCFab: Fab }).KCFab;

test('scrolling down tucks the button away', () => {
  assert.equal(KC.vedScroll(100, 140, 2000), 'skjul');
});

test('scrolling up brings it back', () => {
  assert.equal(KC.vedScroll(600, 560, 2000), 'vis');
});

test('a jitter of a few pixels changes nothing', () => {
  assert.equal(KC.vedScroll(600, 603, 2000), null);
  assert.equal(KC.vedScroll(600, 597, 2000), null);
});

test('at the top and at the bottom of the room it is always there', () => {
  assert.equal(KC.vedScroll(10, 0, 2000), 'vis');
  assert.equal(KC.vedScroll(1960, 1998, 2000), 'vis');
});

test('the tucked-away button cannot be tapped and only the phone hides it', () => {
  const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
  const regel = /body\.fab-vaek #chat-toggle\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(regel, /pointer-events:\s*none/);
  assert.match(regel, /transform:/);
});
