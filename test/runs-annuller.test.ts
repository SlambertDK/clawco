// KC-0069: the run registry's two seams for the test world's jump between moments.
// annuller(grund) settles every queued and running agent run at once (a jump must not wait for the old moment's
// queue), and tomgang() resolves only when no answer or local run is mid-write (a jump must not wipe under one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunRegistry } from '../src/runs.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

const spec = { input: 'x', instructions: 'y' };
const sov = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('annuller settles the queued and the running run at once with the reason, and the queued one never reaches Hermes', async () => {
  const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 5_000 });
  const runs = createRunRegistry(hermes, { maxParallel: 1 });
  const a = runs.start({ kind: 'opdater', room: 'mail', spec, onDone: async () => ({ text: 'a' }) });
  const b = runs.start({ kind: 'opdater', room: 'nyheder', spec, onDone: async () => ({ text: 'b' }) });
  await sov(10);
  assert.equal(a.status, 'running');
  assert.equal(b.status, 'queued');
  assert.deepEqual(runs.igang(null).map((r) => r.status), ['queued', 'running'], 'the Kø panel and Nu show "i kø" for the second');

  const n = runs.annuller('Sprunget til et andet tidspunkt');
  assert.equal(n, 2);
  assert.equal(a.status, 'failed');
  assert.equal(b.status, 'failed');
  assert.equal(a.error, 'Sprunget til et andet tidspunkt');
  assert.deepEqual(runs.list().filter((r) => r.status === 'queued' || r.status === 'running'), []);
  assert.equal((await b.finished).status, 'failed');
  assert.equal(hermes.calls.length, 1, 'the queued run never reached Hermes');
  assert.equal(hermes.calls[0]?.signal?.aborted, true, 'the running one got the abort');
});

test('after annuller the queue works again: a new run takes the slot', async () => {
  const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 20 });
  const runs = createRunRegistry(hermes, { maxParallel: 1 });
  runs.start({ kind: 'opdater', spec, onDone: async () => ({}) });
  runs.start({ kind: 'opdater', spec, onDone: async () => ({}) });
  runs.annuller('væk');
  const c = runs.start({ kind: 'opdater', spec, onDone: async () => ({ text: 'c' }) });
  assert.equal((await c.finished).status, 'done');
});

test('annuller is not the kill switch: it does not pause', async () => {
  const runs = createRunRegistry(createFakeAgent({ answer: () => 'svar', delayMs: 5 }), { maxParallel: 1 });
  runs.annuller('væk');
  assert.equal(runs.paaPause(), false);
  assert.equal((await runs.start({ kind: 'opdater', spec, onDone: async () => ({}) }).finished).status, 'done');
});

test('tomgang waits for an answer that is being written (onDone) and a local run mid-write', async () => {
  const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 0 });
  const runs = createRunRegistry(hermes, { maxParallel: 1 });
  let slipOnDone!: () => void;
  const onDoneVent = new Promise<void>((r) => { slipOnDone = r; });
  let paaStart = false;
  const a = runs.start({ kind: 'opdater', spec, onDone: async () => { paaStart = true; await onDoneVent; return { text: 'skrevet' }; } });
  let slipLokal!: () => void;
  const lokalVent = new Promise<void>((r) => { slipLokal = r; });
  runs.local('gem', async () => { await lokalVent; return { text: 'gemt' }; });
  for (let i = 0; i < 100 && !paaStart; i++) await sov(2);
  assert.equal(paaStart, true, 'the answer is being written');

  let ledig = false;
  const t = runs.tomgang().then(() => { ledig = true; });
  await sov(20);
  assert.equal(ledig, false, 'a write is in flight');
  slipOnDone();
  await sov(20);
  assert.equal(ledig, false, 'the local run is still writing');
  slipLokal();
  await t;
  assert.equal(ledig, true);
  assert.equal((await a.finished).status, 'done');
});

test('tomgang resolves at once when nothing is being written, and also when a write throws', async () => {
  const runs = createRunRegistry(createFakeAgent({ answer: () => 'svar', delayMs: 0 }), { maxParallel: 1 });
  await runs.tomgang();
  const r = runs.local('gem', async () => { throw new Error('skrivefejl'); });
  await runs.tomgang();
  assert.equal((await r.finished).status, 'failed');
});
