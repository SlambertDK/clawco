import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRunRegistry, type RunEvent } from '../src/runs.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { MASKE, nulstilRegistrerede, registrerHemmelighed } from '../src/graenser/redaktion.ts';

// KC-0125: runs.ts is the choke point between Clawco and Hermes — nothing secret goes out, nothing secret comes back.
const HEMMELIG = 'sk-dummy-0123456789abcdef';
beforeEach(() => { nulstilRegistrerede(); registrerHemmelighed(HEMMELIG); });

test('a secret in the input or the instructions never reaches Hermes', async () => {
  const hermes = createFakeAgent({ answer: () => 'ok' });
  const runs = createRunRegistry(hermes);
  await runs.start({ kind: 'chat', spec: { input: `min nøgle er ${HEMMELIG}`, instructions: `brug ${HEMMELIG}` }, onDone: async () => ({}) }).finished;
  const kald = hermes.calls.at(-1)!;
  assert.ok(!kald.input.includes(HEMMELIG) && !kald.instructions.includes(HEMMELIG));
  assert.ok(kald.input.includes(`min nøgle er ${MASKE}`));
});

test('the answer is masked before the room handler sees it (so it cannot land in state or a log)', async () => {
  const hermes = createFakeAgent({ answer: () => `Her er nøglen: ${HEMMELIG}` });
  const runs = createRunRegistry(hermes);
  let set = '';
  const done = await runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'y' }, onDone: async (output) => { set = output; return { text: output }; } }).finished;
  assert.ok(!set.includes(HEMMELIG));
  assert.equal(done.result?.text, `Her er nøglen: ${MASKE}`);
});

test('a failed run shows an error text without the secret, in the record and in the event', async () => {
  const hermes = createFakeAgent({ answer: () => { throw new Error(`401 for ${HEMMELIG}`); } });
  const runs = createRunRegistry(hermes);
  const run = runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({}) });
  const done = await run.finished;
  assert.equal(done.status, 'failed');
  assert.equal(done.error, `401 for ${MASKE}`);
  assert.ok(!JSON.stringify(runs.list()).includes(HEMMELIG), 'the queue listing');
  const seen: RunEvent[] = [];
  runs.subscribe(run.id, (e) => seen.push(e));
  assert.ok(!JSON.stringify(seen).includes(HEMMELIG));
});

test('streamed text and status lines are masked', async () => {
  const hermes = createFakeAgent({ answer: () => ({ output: 'færdig', events: [{ type: 'message.delta', text: `nøglen ${HEMMELIG}` }] }) });
  const runs = createRunRegistry(hermes);
  const run = runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({}) });
  await run.finished;
  const seen: RunEvent[] = [];
  runs.subscribe(run.id, (e) => seen.push(e));
  assert.ok(seen.some((e) => e.type === 'delta'), 'a delta was streamed');
  assert.ok(!JSON.stringify(seen).includes(HEMMELIG));
});

test('a local run (no Hermes) that fails is masked too', async () => {
  const runs = createRunRegistry(createFakeAgent());
  const done = await runs.local('lokal', async () => { throw new Error(`kunne ikke logge ind med ${HEMMELIG}`); }).finished;
  assert.equal(done.error, `kunne ikke logge ind med ${MASKE}`);
});

// KC-0270 (B7): Start's model test is a one-off call outside the queue, but it goes through the run registry: masked
// both ways, refused while paused, and "Stop alt" aborts it.
test('proeve: a one-off agent call is masked both ways, refused on pause and aborted by Stop alt', async () => {
  const { lavPause, PauseFejl } = await import('../src/graenser/nodstop.ts');
  const hermes = createFakeAgent({ answer: () => `svar ${HEMMELIG}` });
  const pause = lavPause();
  const runs = createRunRegistry(hermes, { pause });
  const r = await runs.proeve({ input: `x ${HEMMELIG}`, instructions: `y ${HEMMELIG}` });
  assert.ok(!hermes.calls.at(-1)!.input.includes(HEMMELIG) && !hermes.calls.at(-1)!.instructions.includes(HEMMELIG));
  assert.ok(!r.output.includes(HEMMELIG));
  const lang = createFakeAgent({ delayMs: 200, answer: () => 'ok' });
  const runs2 = createRunRegistry(lang, { pause: lavPause() });
  const p = runs2.proeve({ input: 'x', instructions: 'y' });
  await new Promise((res) => setTimeout(res, 5));
  await runs2.stopAlle('henrik');
  await assert.rejects(p);
  assert.equal(lang.cancellerede.length, 1);
  await assert.rejects(runs2.proeve({ input: 'x', instructions: 'y' }), PauseFejl, 'paused after Stop alt');
});

test("Start's model test while paused records nothing (the pause is not a failed model)", async () => {
  const { lavPause, PauseFejl } = await import('../src/graenser/nodstop.ts');
  const src = (await import('node:fs')).readFileSync(new URL('../src/rooms/start/room.ts', import.meta.url), 'utf8');
  assert.match(src, /deps\.runs\.proeve\(/, 'the model test goes through the run registry');
  assert.doesNotMatch(src, /deps\.hermes\.run\(/);
  assert.match(src, /if \(err instanceof PauseFejl\) throw err;/);
  void lavPause; void PauseFejl;
});
