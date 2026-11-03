import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHermesHttp } from '../../src/agent/hermes-http.ts';
import { AgentError } from '../../src/agent/types.ts';
import type { AgentEvent } from '../../src/agent/types.ts';

type Call = { url: string; init: RequestInit | undefined };

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function ev(o: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ run_id: 'run_1', timestamp: 1, ...o })}\n\n`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Routes by method+path; records every call. */
function fakeFetch(routes: {
  post?: () => Response;
  events?: () => Response;
  status?: () => Response;
  health?: () => Response;
}): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/v1/runs')) return (routes.post ?? (() => json({ run_id: 'run_1' }, 202)))();
    if (url.endsWith('/events')) return routes.events!();
    if (url.endsWith('/health')) return routes.health!();
    if (/\/v1\/runs\/[^/]+$/.test(url)) return routes.status!();
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const REQ = { input: 'hej', instructions: 'vær kort' };

// KC-0127 (from KC-0156): a fresh install has no key yet. The client is created, says so, and fails closed.
test('missing or blank api key: created, status mangler-noegle, runs reject, nothing sent', async () => {
  for (const apiKey of ['', '   ', () => undefined]) {
    const { fetchImpl, calls } = fakeFetch({ health: () => json({ status: 'ok' }) });
    const h = createHermesHttp({ baseUrl: 'http://h', apiKey, fetchImpl });
    assert.equal(await h.status(), 'mangler-noegle');
    assert.equal(await h.health(), false);
    await assert.rejects(h.run(REQ), (e: unknown) => e instanceof AgentError && e.message === 'Clawco har ingen nøgle til Hermes endnu');
    assert.equal(calls.length, 0, 'no request without a key');
  }
});

test('a key read lazily: once it is set, the same client is klar and runs', async () => {
  const env: Record<string, string | undefined> = {};
  const { fetchImpl, calls } = fakeFetch({ health: () => json({ status: 'ok' }), events: () => sseResponse([ev({ event: 'run.completed', output: 'ok' })]) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: () => env['KC_HERMES_API_KEY'], fetchImpl });
  assert.equal(await h.status(), 'mangler-noegle');
  env['KC_HERMES_API_KEY'] = 'ny-noegle';
  assert.equal(await h.status(), 'klar');
  assert.equal((await h.run(REQ)).output, 'ok');
  assert.equal(new Headers(calls.at(-2)?.init?.headers).get('authorization'), 'Bearer ny-noegle');
});

test('status is utilgaengelig when Hermes does not answer its health check', async () => {
  const { fetchImpl } = fakeFetch({ health: () => json({}, 503) });
  assert.equal(await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl }).status(), 'utilgaengelig');
});

test('POST /v1/runs sends bearer header and JSON body; trailing slash trimmed', async () => {
  const { fetchImpl, calls } = fakeFetch({
    events: () => sseResponse([ev({ event: 'run.completed', output: 'ok' })]),
  });
  const h = createHermesHttp({ baseUrl: 'http://hermes:8642/', apiKey: 'sekret', fetchImpl });
  assert.equal(h.mode, 'hermes-http');
  await h.run({ ...REQ, sessionId: 'room-1' });
  const post = calls[0]!;
  assert.equal(post.url, 'http://hermes:8642/v1/runs');
  assert.equal(post.init?.method, 'POST');
  const headers = new Headers(post.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer sekret');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(post.init?.body)), {
    input: 'hej',
    instructions: 'vær kort',
    session_id: 'room-1',
  });
  const evCall = calls[1]!;
  assert.equal(evCall.url, 'http://hermes:8642/v1/runs/run_1/events');
  assert.equal(new Headers(evCall.init?.headers).get('authorization'), 'Bearer sekret');
});

test('session_id omitted when no sessionId', async () => {
  const { fetchImpl, calls } = fakeFetch({
    events: () => sseResponse([ev({ event: 'run.completed', output: 'ok' })]),
  });
  await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl }).run(REQ);
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { input: 'hej', instructions: 'vær kort' });
});

test('401 on POST rejects with AgentError including status and message', async () => {
  const { fetchImpl } = fakeFetch({
    post: () => json({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }, 401),
  });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), (err: unknown) => {
    assert.ok(err instanceof AgentError);
    assert.match(err.message, /401/);
    assert.match(err.message, /Invalid API key/);
    return true;
  });
});

test('5xx with non-JSON body still rejects with AgentError', async () => {
  const { fetchImpl } = fakeFetch({ post: () => new Response('kaboom', { status: 502 }) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), (err: unknown) => err instanceof AgentError && /502/.test(err.message));
});

test('2xx without run_id rejects', async () => {
  const { fetchImpl } = fakeFetch({ post: () => json({ nope: true }, 202) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), AgentError);
});

test('events are mapped in order, onEvent called, output from run.completed', async () => {
  const wire =
    ': keepalive\n\n' +
    ev({ event: 'tool.started', tool: 'terminal', preview: 'python3 x.py' }) +
    ev({ event: 'reasoning.available', text: 'hmm' }) +
    ev({ event: 'tool.completed', tool: 'terminal', duration: 1.2, error: false }) +
    ev({ event: 'message.delta', delta: 'Hel' }) +
    ev({ event: 'message.delta', delta: 'lo' }) +
    ev({ event: 'run.completed', output: 'Hello', usage: { total_tokens: 3 } }) +
    ': stream closed\n\n';
  // split mid-line to prove the parser buffers
  const cut = 37;
  const { fetchImpl } = fakeFetch({ events: () => sseResponse([wire.slice(0, cut), wire.slice(cut, cut + 50), wire.slice(cut + 50)]) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  const seen: AgentEvent[] = [];
  const res = await h.run({ ...REQ, onEvent: (e) => seen.push(e) });
  assert.deepEqual(res, { runId: 'run_1', output: 'Hello' });
  assert.deepEqual(seen, [
    { type: 'tool.started', tool: 'terminal', preview: 'python3 x.py' },
    { type: 'tool.completed', tool: 'terminal', error: false },
    { type: 'message.delta', text: 'Hel' },
    { type: 'message.delta', text: 'lo' },
    { type: 'run.completed', output: 'Hello' },
  ]);
});

test('tool.started without preview omits the field', async () => {
  const { fetchImpl } = fakeFetch({
    events: () =>
      sseResponse([ev({ event: 'tool.started', tool: 'web' }), ev({ event: 'run.completed', output: 'x' })]),
  });
  const seen: AgentEvent[] = [];
  await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl }).run({ ...REQ, onEvent: (e) => seen.push(e) });
  assert.deepEqual(seen[0], { type: 'tool.started', tool: 'web' });
});

test('empty run.completed output falls back to concatenated deltas', async () => {
  const { fetchImpl } = fakeFetch({
    events: () =>
      sseResponse([
        ev({ event: 'message.delta', delta: 'Hej ' }),
        ev({ event: 'message.delta', delta: 'verden' }),
        ev({ event: 'run.completed', output: '' }),
      ]),
  });
  const res = await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl }).run(REQ);
  assert.equal(res.output, 'Hej verden');
});

test('run.failed rejects with AgentError(error, runId) and emits the event', async () => {
  const { fetchImpl } = fakeFetch({
    events: () => sseResponse([ev({ event: 'run.failed', error: 'model overloaded' })]),
  });
  const seen: AgentEvent[] = [];
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run({ ...REQ, onEvent: (e) => seen.push(e) }), (err: unknown) => {
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, 'model overloaded');
    assert.equal(err.runId, 'run_1');
    return true;
  });
  assert.deepEqual(seen, [{ type: 'run.failed', error: 'model overloaded' }]);
});

test('run.cancelled rejects with AgentError', async () => {
  const { fetchImpl } = fakeFetch({ events: () => sseResponse([ev({ event: 'run.cancelled' })]) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), (err: unknown) => err instanceof AgentError && err.runId === 'run_1');
});

test('events endpoint non-2xx rejects with AgentError', async () => {
  const { fetchImpl } = fakeFetch({ events: () => json({ error: { message: 'gone' } }, 404) });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), (err: unknown) => err instanceof AgentError && /404/.test(err.message));
});

test('stream ending without terminal event falls back to GET status (completed)', async () => {
  const { fetchImpl, calls } = fakeFetch({
    events: () => sseResponse([ev({ event: 'message.delta', delta: 'del' }), ': stream closed\n\n']),
    status: () => json({ run_id: 'run_1', status: 'completed', output: 'endeligt svar' }),
  });
  const seen: AgentEvent[] = [];
  const res = await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl }).run({
    ...REQ,
    onEvent: (e) => seen.push(e),
  });
  assert.deepEqual(res, { runId: 'run_1', output: 'endeligt svar' });
  assert.equal(calls.at(-1)!.url, 'http://h/v1/runs/run_1');
  assert.deepEqual(seen.at(-1), { type: 'run.completed', output: 'endeligt svar' });
});

test('stream ending without terminal event and status failed rejects', async () => {
  const { fetchImpl } = fakeFetch({
    events: () => sseResponse([]),
    status: () => json({ run_id: 'run_1', status: 'failed', error: 'tabt' }),
  });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), (err: unknown) => err instanceof AgentError && err.message === 'tabt' && err.runId === 'run_1');
});

test('stream ending and status still running rejects', async () => {
  const { fetchImpl } = fakeFetch({
    events: () => sseResponse([]),
    status: () => json({ run_id: 'run_1', status: 'running' }),
  });
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  await assert.rejects(h.run(REQ), AgentError);
});

test('timeout aborts the run with a Danish AgentError', async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return json({ run_id: 'run_1' }, 202);
    // events: a stream that never produces data and errors on abort
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason ?? new Error('aborted')));
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl, timeoutMs: 30 });
  await assert.rejects(h.run(REQ), (err: unknown) => {
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, 'Hermes svarede ikke i tide');
    return true;
  });
});

test('health true on 2xx, false on non-2xx and on thrown errors, sends bearer', async () => {
  const ok = fakeFetch({ health: () => new Response('ok', { status: 200 }) });
  const h1 = createHermesHttp({ baseUrl: 'http://h/', apiKey: 'k', fetchImpl: ok.fetchImpl });
  assert.equal(await h1.health(), true);
  assert.equal(ok.calls[0]!.url, 'http://h/health');
  assert.equal(new Headers(ok.calls[0]!.init?.headers).get('authorization'), 'Bearer k');

  const bad = fakeFetch({ health: () => new Response('no', { status: 503 }) });
  assert.equal(await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl: bad.fetchImpl }).health(), false);

  const boom = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  assert.equal(await createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl: boom }).health(), false);
});

test('run passes model and provider to POST /v1/runs when given', async () => {
  const { createHermesHttp } = await import('../../src/agent/hermes-http.ts');
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/v1/runs')) { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ run_id: 'run_1' }), { status: 202 }); }
    return new Response('data: {"event":"run.completed","run_id":"run_1","output":"ok"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const h = createHermesHttp({ baseUrl: 'http://x', apiKey: 'k', fetchImpl });
  await h.run({ input: 'i', instructions: 's', model: 'claude-haiku-5.5', provider: 'copilot' });
  assert.equal(body['model'], 'claude-haiku-5.5');
  assert.equal(body['provider'], 'copilot');
  await h.run({ input: 'i', instructions: 's' });
  assert.equal('model' in body, false);
});

// KC-0270 (B2): when the detective control (or the kill switch) aborts a run, Hermes is told to stop it too —
// POST /v1/runs/{id}/stop (hermes-agent api_server) — instead of only closing Clawco's side of the stream.
test('an aborted run is stopped at Hermes with POST /v1/runs/{id}/stop', async () => {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === 'POST' && url.endsWith('/v1/runs')) return json({ run_id: 'run_9' }, 202);
    if (init?.method === 'POST' && url.endsWith('/stop')) return json({ run_id: 'run_9', status: 'stopping' });
    return new Response(new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new Error('aborted'))); } }), { status: 200 });
  }) as typeof fetch;
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  const stop = new AbortController();
  const p = h.run({ ...REQ, signal: stop.signal });
  for (let i = 0; i < 50 && !calls.some((c) => c.url.includes('/events')); i++) await new Promise((r) => setTimeout(r, 2));
  stop.abort();
  await assert.rejects(p, AgentError);
  for (let i = 0; i < 50 && !calls.some((c) => c.url.endsWith('/stop')); i++) await new Promise((r) => setTimeout(r, 2));
  const s = calls.find((c) => c.url === 'http://h/v1/runs/run_9/stop');
  assert.ok(s, 'the stop call went out');
  assert.equal(s.init?.method, 'POST');
  assert.equal(new Headers(s.init?.headers).get('authorization'), 'Bearer k');
});

test('cancel(runId) is on the seam: http posts the stop, and a Hermes without it is logged once, never thrown', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => { calls.push(String(input)); return new Response('nej', { status: 404 }); }) as typeof fetch;
  const h = createHermesHttp({ baseUrl: 'http://h', apiKey: 'k', fetchImpl });
  const advarsler: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { advarsler.push(a.join(' ')); };
  try {
    await h.cancel!('run_x');
    await h.cancel!('run_y');
  } finally { console.warn = warn; }
  assert.deepEqual(calls, ['http://h/v1/runs/run_x/stop', 'http://h/v1/runs/run_y/stop']);
  assert.equal(advarsler.filter((a) => /cancel ikke understøttet af Hermes/.test(a)).length, 1);
});
