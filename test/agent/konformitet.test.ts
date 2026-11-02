// KC-0118: one contract for every AgentClient. The same suite runs against
// hermes-http (a real stub server speaking Hermes' api_server protocol) and the
// fake, so swapping the implementation changes nothing the app relies on.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHermesHttp } from '../../src/agent/hermes-http.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { AFBRUDT, AgentError, type AgentClient, type AgentEvent } from '../../src/agent/types.ts';

// The stub: input "fejl" fails, "langsom" keeps the stream open until the client goes away, anything else answers "svar: <input>".
const aabne = new Set<http.ServerResponse>();
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('{"status":"ok"}'); return; }
  if (req.method === 'POST' && req.url === '/v1/runs') {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const input = (JSON.parse(b) as { input: string }).input;
      res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ run_id: `run_${encodeURIComponent(input)}` }));
    });
    return;
  }
  const m = /^\/v1\/runs\/run_([^/]+)\/events$/.exec(req.url ?? '');
  if (m) {
    const input = decodeURIComponent(m[1]!);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o: Record<string, unknown>): void => { res.write(`data: ${JSON.stringify({ run_id: `run_${input}`, timestamp: 1, ...o })}\n\n`); };
    if (input === 'langsom') { aabne.add(res); res.on('close', () => aabne.delete(res)); send({ event: 'tool.started', tool: 'terminal', preview: 'x' }); return; }
    send({ event: 'tool.started', tool: 'terminal', preview: 'x' });
    send({ event: 'tool.completed', tool: 'terminal', error: false });
    if (input === 'fejl') { send({ event: 'run.failed', error: 'gik galt' }); res.end(); return; }
    send({ event: 'run.completed', output: `svar: ${input}` });
    res.end();
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { for (const r of aabne) r.destroy(); server.close(); });

const IMPL: [string, () => AgentClient][] = [
  ['hermes-http', () => createHermesHttp({ baseUrl: url, apiKey: 'test' })],
  ['fake', () => createFakeAgent({
    delayMs: 30,
    answer: (req) => {
      if (req.input === 'fejl') throw new Error('gik galt');
      if (req.input === 'langsom') return { output: 'for sent' };
      return `svar: ${req.input}`;
    },
  })],
];

for (const [navn, lav] of IMPL) {
  describe(`AgentClient contract: ${navn}`, () => {
    test('a run resolves with the final text; run.completed is the last event', async () => {
      const set: AgentEvent['type'][] = [];
      const r = await lav().run({ input: 'hej', instructions: 'x', onEvent: (e) => set.push(e.type) });
      assert.equal(r.output, 'svar: hej');
      assert.ok(r.runId);
      assert.equal(set.at(-1), 'run.completed');
      assert.ok(set.indexOf('tool.started') < set.indexOf('run.completed'));
    });

    test('run.failed rejects with AgentError', async () => {
      await assert.rejects(lav().run({ input: 'fejl', instructions: 'x' }), (e: unknown) => e instanceof AgentError && /gik galt/.test(e.message));
    });

    test('an abort signal stops the run with AgentError(afbrudt)', async () => {
      const ac = new AbortController();
      const p = lav().run({ input: 'langsom', instructions: 'x', signal: ac.signal });
      setTimeout(() => ac.abort(), 10);
      await assert.rejects(p, (e: unknown) => e instanceof AgentError && e.message === AFBRUDT);
    });

    test('an already aborted signal never starts the run', async () => {
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(lav().run({ input: 'hej', instructions: 'x', signal: ac.signal }), (e: unknown) => e instanceof AgentError && e.message === AFBRUDT);
    });

    test('an abort after the run finished changes nothing', async () => {
      const ac = new AbortController();
      const r = await lav().run({ input: 'hej', instructions: 'x', signal: ac.signal });
      ac.abort();
      assert.equal(r.output, 'svar: hej');
    });

    test('health() resolves to a boolean and never throws', async () => {
      assert.equal(typeof (await lav().health()), 'boolean');
    });

    test('status() is klar while the agent answers (KC-0127)', async () => {
      assert.equal(await lav().status(), 'klar');
    });
  });
}

test('hermes-http health() is false, not a throw, when the agent is down', async () => {
  assert.equal(await createHermesHttp({ baseUrl: 'http://127.0.0.1:9', apiKey: 'test' }).health(), false);
});
