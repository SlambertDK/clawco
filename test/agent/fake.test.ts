import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { AgentError } from '../../src/agent/types.ts';
import type { AgentEvent } from '../../src/agent/types.ts';

test('fake has mode "fake", healthy, and records calls', async () => {
  const h = createFakeAgent();
  assert.equal(h.mode, 'fake');
  assert.equal(await h.health(), true);
  const req = { input: 'hej', instructions: 'vær kort' };
  const res = await h.run(req);
  assert.equal(res.output, 'Fake svar fra Hermes.');
  assert.equal(res.runId, 'fake_1');
  assert.deepEqual(h.calls, [req]);
  const res2 = await h.run({ input: 'igen', instructions: '' });
  assert.equal(res2.runId, 'fake_2');
  assert.equal(h.calls.length, 2);
});

test('fake emits tool events, answer events, then run.completed in order', async () => {
  const extra: AgentEvent = { type: 'message.delta', text: 'hej' };
  const h = createFakeAgent({ answer: () => ({ output: 'færdig', events: [extra] }) });
  const seen: AgentEvent[] = [];
  const res = await h.run({ input: 'x', instructions: '', onEvent: (e) => seen.push(e) });
  assert.equal(res.output, 'færdig');
  assert.deepEqual(seen, [
    { type: 'tool.started', tool: 'terminal', preview: 'fake' },
    { type: 'tool.completed', tool: 'terminal', error: false },
    extra,
    { type: 'run.completed', output: 'færdig' },
  ]);
});

test('fake answer may be a plain string and receives the request', async () => {
  const h = createFakeAgent({ answer: (r) => `echo:${r.input}` });
  const res = await h.run({ input: 'ping', instructions: '' });
  assert.equal(res.output, 'echo:ping');
});

test('fake answer throwing emits run.failed and rejects with AgentError', async () => {
  const h = createFakeAgent({
    answer: () => {
      throw new Error('boom');
    },
  });
  const seen: AgentEvent[] = [];
  await assert.rejects(
    h.run({ input: 'x', instructions: '', onEvent: (e) => seen.push(e) }),
    (err: unknown) => {
      assert.ok(err instanceof AgentError);
      assert.equal(err.message, 'boom');
      assert.equal(err.runId, 'fake_1');
      return true;
    },
  );
  assert.deepEqual(seen.at(-1), { type: 'run.failed', error: 'boom' });
  assert.equal(h.calls.length, 1);
});

test('fake honours delayMs', async () => {
  const h = createFakeAgent({ delayMs: 30 });
  const t0 = Date.now();
  await h.run({ input: 'x', instructions: '' });
  assert.ok(Date.now() - t0 >= 25);
});
