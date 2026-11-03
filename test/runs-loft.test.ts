// KC-0275 (B7): a cap on queued runs per person — the one past it is refused with a fixed text (the server answers 429).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunRegistry } from '../src/runs.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { KoeFuld } from '../src/graenser/nodstop.ts';

const spec = { input: 'x', instructions: 'y' };
const start = (runs: ReturnType<typeof createRunRegistry>, ejer?: string) => runs.start({ kind: 'opdater', spec, ...(ejer ? { ejer } : {}), onDone: async () => ({ text: 'gjort' }) });

test('the 21st waiting run is refused with KoeFuld; a slot taken by a run that starts lets the next in', async () => {
  const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 60 });
  const runs = createRunRegistry(hermes, { maxParallel: 1 });
  const alle = Array.from({ length: 20 }, () => start(runs)); // all 20 wait for a slot until the queue turns over
  assert.throws(() => start(runs), (e: unknown) => e instanceof KoeFuld && /venter|waiting/i.test(e.message));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(alle.filter((r) => r.status === 'queued').length, 19, 'one has a slot, 19 wait');
  assert.doesNotThrow(() => start(runs));
  assert.throws(() => start(runs), KoeFuld);
  await runs.stopAlle('ejer');
});

test('the cap is per person: another person still gets in', async () => {
  const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 60 });
  const runs = createRunRegistry(hermes, { maxParallel: 1, maksKoe: 3 });
  for (let i = 0; i < 3; i++) start(runs, 'maja');
  assert.throws(() => start(runs, 'maja'), KoeFuld);
  assert.doesNotThrow(() => start(runs, 'henrik'));
  await runs.stopAlle('henrik');
});
