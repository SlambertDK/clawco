// KC-0084: the "nu" marker on the day line follows the clock. The pure parts: where it sits,
// which Copenhagen day and time a moment is, and how a live page reads its server-anchored clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/nu.js';

type Nu = {
  position(fra: number, til: number, hh: number, mm: number): string | null;
  kbh(ms: number): { dag: string; hh: number; mm: number };
  opdater(linjer: Iterable<unknown>, ms: number): void;
};
const KC = (globalThis as unknown as { KCNu: Nu }).KCNu;

test('the position is a percentage of the line, and null outside it', () => {
  assert.equal(KC.position(6, 22, 14, 0), '50%');
  assert.equal(KC.position(6, 22, 13, 0), '43.75%');
  assert.equal(KC.position(6, 22, 6, 0), '0%');
  assert.equal(KC.position(6, 22, 22, 0), '100%');
  assert.equal(KC.position(6, 22, 5, 59), null);
  assert.equal(KC.position(6, 22, 22, 1), null);
});

test('a moment is read in Copenhagen: summer and winter time, and the day rolls over there', () => {
  assert.deepEqual(KC.kbh(Date.parse('2026-06-15T12:00:00Z')), { dag: '2026-06-15', hh: 14, mm: 0 });
  assert.deepEqual(KC.kbh(Date.parse('2026-12-15T12:30:00Z')), { dag: '2026-12-15', hh: 13, mm: 30 });
  assert.deepEqual(KC.kbh(Date.parse('2026-12-15T23:30:00Z')), { dag: '2026-12-16', hh: 0, mm: 30 });
});

type Spor = { hidden: boolean; style: { left: string } };
const linje = (dag: string, serverMs: number, fra = 6, til = 22) => {
  const nu: Spor = { hidden: true, style: { left: '' } };
  const attr: Record<string, string> = { 'data-fra': String(fra), 'data-til': String(til), 'data-dag': dag, 'data-nu-ms': String(serverMs) };
  return { nu, getAttribute: (n: string) => attr[n] ?? null, querySelector: () => nu };
};

test('the marker moves with the clock and is hidden outside the line or on another day', () => {
  const server = Date.parse('2026-06-15T05:05:00Z'); // 07:05 in Copenhagen when the page was built
  const l = linje('2026-06-15', server);
  KC.opdater([l], server);
  assert.equal(l.nu.hidden, false);
  assert.equal(l.nu.style.left, '6.77%'); // (7 + 5/60 - 6) / 16
  KC.opdater([l], server + 7 * 3600_000); // seven hours later, 14:05
  assert.equal(l.nu.style.left, '50.52%');
  KC.opdater([l], server + 16 * 3600_000); // 23:05, after the line
  assert.equal(l.nu.hidden, true);
  KC.opdater([l], server + 20 * 3600_000); // 03:05 the next day: not today's line
  assert.equal(l.nu.hidden, true);
});

test('the clock is anchored to the server moment the line was rendered at, so a skewed device clock still agrees', () => {
  const server = Date.parse('2026-06-15T12:00:00Z');
  const l = linje('2026-06-15', server);
  const device = server + 5 * 60_000; // the phone runs five minutes ahead
  KC.opdater([l], device); // first sight of this render: the device clock is read as the render moment
  assert.equal(l.nu.style.left, '50%');
  KC.opdater([l], device + 60_000 * 16); // sixteen minutes later: 14:16
  assert.equal(l.nu.style.left, '51.67%');
});
