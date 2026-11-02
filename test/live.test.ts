import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBus } from '../src/live.ts';

test('subscribers get a changed event with a rising version for their room only', () => {
  const bus = createLiveBus();
  const seen: number[] = [];
  const off = bus.subscribe('dagen', (v) => seen.push(v));
  bus.notify('dagen');
  bus.notify('mail');
  bus.notify('dagen');
  off();
  bus.notify('dagen');
  assert.deepEqual(seen, [1, 2]);
  assert.equal(bus.version('dagen'), 3);
  assert.equal(bus.version('nyheder'), 0);
});

// KC-0071: a restarted server must never repeat a version an open page already saw,
// or the page would take the new state for the one it shows.
test('versions start at the given start, so a later process never repeats an earlier one', () => {
  const foer = createLiveBus(1_000);
  foer.notify('dagen');
  const efter = createLiveBus(2_000);
  assert.equal(foer.version('dagen'), 1_001);
  assert.equal(efter.version('dagen'), 2_000);
  efter.notify('dagen');
  assert.equal(efter.version('dagen'), 2_001);
});
