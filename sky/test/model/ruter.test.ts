// KC-0264: the model proxy's two routes (POST /model/v1/messages, GET /model/v1/forbrug), through the real Hono app and
// ledger (PGlite) with a fake provider. The contract the tenant side codes against is asserted here word for word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import type { Database } from '../../src/db/pool.ts';
import { laesModelpriser } from '../../src/model/priser.ts';
import { modelRuter, type ModelDeps } from '../../src/model/ruter.ts';
import { UdbyderFejl, type ModelUdbyder } from '../../src/model/udbyder.ts';
import { noterKald } from '../../src/model/regnskab.ts';
import { SENTINEL, sseSvar, sseSvarTilLejer } from './hjaelp.ts';

const TOKEN = 'A'.repeat(43) + '=';
const TENANT = 'hus-aaaaaaaa';
const NU = new Date('2026-11-03T10:00:00Z');
const krop = { model: 'claude-haiku-5-5', max_tokens: 256, stream: true, messages: [{ role: 'user', content: `Opsummer ${SENTINEL}` }] };

type Sendt = Parameters<ModelUdbyder['send']>[0];

function falskUdbyder(o: { svar?: () => Response | Promise<Response>; fejl?: UdbyderFejl } = {}): ModelUdbyder & { sendt: Sendt[] } {
  const sendt: Sendt[] = [];
  return {
    navn: 'anthropic', sendt,
    async send(a) {
      sendt.push(a);
      if (o.fejl) throw o.fejl;
      return o.svar ? o.svar() : new Response(sseSvar({ input: 1000, output: 200, cacheLaes: 5000, tekst: SENTINEL }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'content-encoding': 'gzip', 'request-id': 'req_x' } });
    },
  };
}

async function app(o: Partial<ModelDeps> & { udbyder?: ModelUdbyder | null } = {}): Promise<{ a: Hono; db: Database; logs: string[] }> {
  const db = await pgliteDatabase();
  await migrer(db);
  const logs: string[] = [];
  const deps: ModelDeps = {
    db, priser: laesModelpriser(), udbyder: o.udbyder === undefined ? falskUdbyder() : o.udbyder,
    tenantForToken: async (t) => (t === TOKEN ? TENANT : null),
    inkluderet: async () => ({ loftMikroUsd: 4_000_000, modeller: ['claude-haiku-5-5'] }),
    nu: () => NU, log: (l) => logs.push(l),
    ...o,
  };
  const a = new Hono();
  a.route('/', modelRuter(deps));
  return { a, db, logs };
}

const post = (a: Hono, body: unknown, token: string | null = TOKEN, ekstra: Record<string, string> = {}) =>
  a.request('/model/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...ekstra }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function raekker(db: Database) {
  return db.query<Record<string, unknown>>('SELECT * FROM model.forbrug ORDER BY id');
}

/** The ledger row is written after the stream has ended; give the microtask a moment. */
async function vent(db: Database, n: number) {
  for (let i = 0; i < 100; i++) { if ((await raekker(db)).length >= n) return; await new Promise((r) => setTimeout(r, 5)); }
}

test('a valid token streams the provider\'s answer through (content unchanged, usage without the cache split, KC-0273), and ONE ledger row has the counts and price, no content', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, krop, TOKEN, { 'anthropic-version': '2023-06-01', 'x-andet': 'nej' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(r.headers.get('content-encoding'), null, 'the body is already decoded; the provider\'s encoding header is not passed on');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(await r.text(), sseSvarTilLejer({ input: 1000, output: 200, cacheLaes: 5000, tekst: SENTINEL }));
  assert.deepEqual(u.sendt[0]!.headers, { 'anthropic-version': '2023-06-01' }, 'only the wire headers go up');
  assert.deepEqual(u.sendt[0]!.krop, krop);
  await vent(db, 1);
  const rows = await raekker(db);
  assert.equal(rows.length, 1);
  const x = rows[0]!;
  assert.equal(x['tenant'], TENANT);
  assert.equal(x['model'], 'claude-haiku-5-5');
  assert.equal(x['udbyder'], 'anthropic');
  assert.deepEqual([x['input_tokens'], x['output_tokens'], x['cache_laes_tokens']].map(Number), [1000, 200, 5000]);
  assert.equal(Number(x['pris_mikro_usd']), 100 + 100 + 50, '1000×0.10 + 200×0.50 + 5000×0.01');
  assert.ok(!JSON.stringify(rows).includes(SENTINEL), 'no prompt or answer text in the ledger');
  await db.close();
});

test('the sentinel reaches neither the ledger nor the log, on success or on failure', async () => {
  const { a, db, logs } = await app({ udbyder: falskUdbyder({ fejl: new UdbyderFejl(400, 'invalid_request_error', 'nope') }) });
  await (await post(a, krop)).text();
  const ok = await app();
  await (await post(ok.a, krop)).text();
  await vent(ok.db, 1);
  assert.ok(![...logs, ...ok.logs].join('\n').includes(SENTINEL));
  assert.ok(!JSON.stringify(await raekker(ok.db)).includes(SENTINEL));
  await db.close(); await ok.db.close();
});

test('401 ugyldig_noegle: no token, an unknown token, a non-bearer header; nothing is forwarded', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u });
  for (const r of [await post(a, krop, null), await post(a, krop, 'B'.repeat(43) + '='), await a.request('/model/v1/messages', { method: 'POST', headers: { authorization: `Basic ${TOKEN}` }, body: '{}' })]) {
    assert.equal(r.status, 401);
    const j = await r.json() as { error: { type: string; message: string } };
    assert.equal(j.error.type, 'ugyldig_noegle');
    assert.ok(j.error.message);
  }
  assert.equal((await a.request('/model/v1/forbrug')).status, 401);
  assert.equal(u.sendt.length, 0);
  await db.close();
});

test('503 ikke_tilgaengelig: no provider (switch off, no key, not a listed subprocessor) or a plan without the model', async () => {
  for (const o of [{ udbyder: null }, { inkluderet: async () => null }] as Partial<ModelDeps>[]) {
    const { a, db } = await app(o);
    const r = await post(a, krop);
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { error: { type: string } }).error.type, 'ikke_tilgaengelig');
    assert.equal((await a.request('/model/v1/forbrug', { headers: { authorization: `Bearer ${TOKEN}` } })).status, 503);
    await db.close();
  }
});

test('400 model_ikke_tilladt: a model outside the plan\'s list (Sharp is not included yet); a bad body is 400 invalid_request_error', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, { ...krop, model: 'claude-sonnet-5-5' });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: { type: string } }).error.type, 'model_ikke_tilladt');
  for (const b of ['{ikke json', '[]', JSON.stringify({ ...krop, model: 42 })]) {
    const x = await post(a, b);
    assert.equal(x.status, 400, b);
    assert.equal(((await x.json()) as { error: { type: string } }).error.type, b.includes('42') ? 'model_ikke_tilladt' : 'invalid_request_error');
  }
  assert.equal(u.sendt.length, 0);
  await db.close();
});

test('402 kvote_brugt with the reset date once the month has reached the cap; the next month starts over', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u, inkluderet: async () => ({ loftMikroUsd: 1000, modeller: ['claude-haiku-5-5'] }) });
  await noterKald(db, { kaldId: crypto.randomUUID(), tenant: TENANT, tid: NU, model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, prisMikroUsd: 999 });
  // KC-0273: no call crosses the cap any more: its reservation must fit before it is forwarded.
  const r = await post(a, krop);
  assert.equal(r.status, 402);
  const j = await r.json() as { error: { type: string; message: string; nulstilles: string }; nulstilles: string };
  assert.equal(j.error.type, 'kvote_brugt');
  assert.equal(j.error.nulstilles, '2026-12-01');
  assert.equal(j.nulstilles, '2026-12-01');
  assert.equal(u.sendt.length, 0, 'refused before forwarding');
  const naeste = await app({ udbyder: falskUdbyder(), nu: () => new Date('2026-12-01T00:00:01Z'), inkluderet: async () => ({ loftMikroUsd: 1000, modeller: ['claude-haiku-5-5'] }) });
  await noterKald(naeste.db, { kaldId: crypto.randomUUID(), tenant: TENANT, tid: NU, model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, prisMikroUsd: 5000 });
  assert.equal((await post(naeste.a, krop)).status, 200);
  await db.close(); await naeste.db.close();
});

test('the provider\'s 429 passes through with Retry-After; its 400 passes through; our side is 503', async () => {
  for (const [f, status, type] of [[new UdbyderFejl(429, 'rate_limit_error', 'langsommere', '9'), 429, 'rate_limit_error'], [new UdbyderFejl(400, 'invalid_request_error', 'max_tokens'), 400, 'invalid_request_error'], [new UdbyderFejl(503, 'ikke_tilgaengelig', 'nede'), 503, 'ikke_tilgaengelig']] as const) {
    const { a, db } = await app({ udbyder: falskUdbyder({ fejl: f }) });
    const r = await post(a, krop);
    assert.equal(r.status, status);
    if (status === 429) assert.equal(r.headers.get('retry-after'), '9');
    assert.equal(((await r.json()) as { error: { type: string } }).error.type, type);
    // KC-0273: the reservation row was written before the call; no answer settles it to 0.
    for (let i = 0; i < 50 && Number((await raekker(db))[0]?.['pris_mikro_usd'] ?? -1) !== 0; i++) await new Promise((x) => setTimeout(x, 5));
    const rows = await raekker(db);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0]!['pris_mikro_usd']), 0, 'no answer, nothing billed');
    await db.close();
  }
});

test('GET /v1/forbrug: the month so far against the cap, the reset date and the included models', async () => {
  const { a, db } = await app();
  await noterKald(db, { kaldId: crypto.randomUUID(), tenant: TENANT, tid: NU, model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, prisMikroUsd: 1_000_000 });
  await noterKald(db, { kaldId: crypto.randomUUID(), tenant: 'hus-bbbbbbbb', tid: NU, model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, prisMikroUsd: 3_000_000 });
  const r = await a.request('/model/v1/forbrug', { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { brugtMikroUsd: 1_000_000, loftMikroUsd: 4_000_000, procent: 25, nulstilles: '2026-12-01', modeller: ['claude-haiku-5-5'] });
  await db.close();
});

test('the tenant hanging up mid-stream aborts the provider, and the tokens seen so far are still recorded once', async () => {
  let afbrudt = false;
  const svar = () => {
    const tekst = sseSvar({ input: 400, output: 1 });
    const start = tekst.slice(0, tekst.indexOf('event: content_block_delta'));
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(start)); },
      cancel() { afbrudt = true; },
    }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const u = falskUdbyder({ svar });
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, krop);
  const laeser = r.body!.getReader();
  await laeser.read();
  await laeser.cancel();
  for (let i = 0; i < 50 && !afbrudt; i++) await new Promise((x) => setTimeout(x, 5));
  assert.ok(afbrudt, 'the provider stream was cancelled');
  assert.ok(u.sendt[0]!.signal.aborted, 'and its request aborted');
  await vent(db, 1);
  const rows = await raekker(db);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0]!['input_tokens']), 400);
  await db.close();
});

test('a body over the limit is refused before anything is read further or forwarded', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u, maxKrop: 1024 });
  const r = await post(a, { ...krop, messages: [{ role: 'user', content: 'x'.repeat(5000) }] });
  assert.equal(r.status, 413);
  assert.equal(((await r.json()) as { error: { type: string } }).error.type, 'for_stor');
  assert.equal(u.sendt.length, 0);
  await db.close();
});

test('the provider call has a deadline: the signal it gets aborts after timeoutMs', async () => {
  const u = falskUdbyder({ svar: () => new Response(new ReadableStream({ start() { /* never sends */ } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const { a, db } = await app({ udbyder: u, timeoutMs: 50 });
  const r = await post(a, krop);
  await r.text().catch(() => '');
  assert.ok(u.sendt[0]!.signal.aborted);
  await db.close();
});

test('parallel calls per tenant are bounded (each in-flight call may cross the cap by at most one answer)', async () => {
  const slip: (() => void)[] = [];
  const u = falskUdbyder({ svar: () => new Response(new ReadableStream({ start(c) { slip.push(() => { c.enqueue(new TextEncoder().encode(sseSvar())); c.close(); }); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const { a, db } = await app({ udbyder: u, maxSamtidige: 2 });
  const r1 = await post(a, krop);
  const r2 = await post(a, krop);
  const r3 = await post(a, krop);
  assert.equal(r3.status, 429);
  assert.equal(((await r3.json()) as { error: { type: string } }).error.type, 'rate_limit_error');
  for (const s of slip.splice(0)) s();
  await r1.text(); await r2.text();
  await vent(db, 2);
  const r4 = await post(a, krop);
  assert.equal(r4.status, 200, 'a slot frees when a call ends');
  for (const s of slip.splice(0)) s();
  await r4.text();
  await db.close();
});

test('a non-streamed call (stream: false) is passed through as JSON and counted from its usage object', async () => {
  const json = JSON.stringify({ id: 'msg_1', type: 'message', content: [{ type: 'text', text: SENTINEL }], usage: { input_tokens: 500, output_tokens: 100 } });
  const u = falskUdbyder({ svar: () => new Response(json, { headers: { 'content-type': 'application/json' } }) });
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, { ...krop, stream: false });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), json);
  await vent(db, 1);
  const [x] = await raekker(db);
  assert.deepEqual([x!['input_tokens'], x!['output_tokens'], x!['pris_mikro_usd']].map(Number), [500, 100, 100]);
  await db.close();
});

test('KC-0273: the forwarded body is rebuilt from the allowlist; refused keys, an oversized max_tokens, a server tool and a beta header are 400 before anything is forwarded', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u });
  const fall: [unknown, Record<string, string>, RegExp][] = [
    [{ ...krop, mcp_servers: [{ type: 'url', url: 'https://x' }] }, {}, /"mcp_servers"/],
    [{ ...krop, container: 'c' }, {}, /"container"/],
    [{ ...krop, service_tier: 'priority' }, {}, /"service_tier"/],
    [{ ...krop, max_tokens: 64_000 }, {}, /max_tokens/],
    [{ ...krop, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, {}, /web_search_20250305/],
    [krop, { 'anthropic-beta': 'mcp-client-2025-04-04' }, /mcp-client-2025-04-04/],
  ];
  for (const [b, h, navn] of fall) {
    const r = await post(a, b, TOKEN, h);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
    const j = await r.json() as { error: { type: string; message: string } };
    assert.equal(j.error.type, 'invalid_request_error');
    assert.match(j.error.message, navn);
  }
  assert.equal(u.sendt.length, 0, 'nothing forwarded');
  const ok = await post(a, { ...krop, metadata: { user_id: 'u1', andet: 'nej' }, tools: [{ name: 'vejr', input_schema: { type: 'object' } }] });
  assert.equal(ok.status, 200);
  await ok.text();
  assert.deepEqual(u.sendt[0]!.krop, { ...krop, metadata: { user_id: 'u1' }, tools: [{ name: 'vejr', input_schema: { type: 'object' } }] });
  await vent(db, 1);
  await db.close();
});

/** KC-0273: a stream that has sent message_start and `deltas` content events, then waits (never message_delta). */
function haengendeStroem(o: { input?: number; deltas?: number; lukket?: () => void } = {}) {
  const tekst = sseSvar({ input: o.input ?? 400, output: 1 });
  const start = tekst.slice(0, tekst.indexOf('event: content_block_delta'));
  const delta = `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ord ' } })}\n\n`;
  return () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(start + delta.repeat(o.deltas ?? 0))); },
    cancel() { o.lukket?.(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

test('KC-0273 (D4 probe): 4000 streamed output tokens then a hang-up before message_delta is billed at max_tokens, not 1', async () => {
  const u = falskUdbyder({ svar: haengendeStroem({ input: 400, deltas: 4000 }) });
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, { ...krop, max_tokens: 8192 });
  const l = r.body!.getReader();
  await l.read();
  await l.cancel();
  await vent(db, 1);
  for (let i = 0; i < 50 && Number((await raekker(db))[0]!['output_tokens']) !== 8192; i++) await new Promise((x) => setTimeout(x, 5));
  const [x] = await raekker(db);
  assert.equal(Number(x!['input_tokens']), 400, 'the input side as message_start said');
  assert.equal(Number(x!['output_tokens']), 8192, 'the output side is the reservation: max_tokens');
  assert.equal(Number(x!['pris_mikro_usd']), 40 + 4096, '400×0.10 + 8192×0.50');
  await db.close();
});

test('KC-0273: the deadline ending a stream that never sent anything bills the whole reservation; a clean end with no message_start bills nothing', async () => {
  const stille = falskUdbyder({ svar: () => new Response(new ReadableStream({ start() { /* never sends */ } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const s = await app({ udbyder: stille, timeoutMs: 50 });
  await (await post(s.a, krop)).text().catch(() => '');
  await vent(s.db, 1);
  await new Promise((x) => setTimeout(x, 30));
  const [x] = await raekker(s.db);
  assert.equal(Number(x!['output_tokens']), 256);
  assert.ok(Number(x!['pris_mikro_usd']) >= 128, 'at least max_tokens × the output price');
  await s.db.close();

  const fejlet = falskUdbyder({ svar: () => new Response('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"x"}}\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  const f = await app({ udbyder: fejlet });
  await (await post(f.a, krop)).text();
  await vent(f.db, 1);
  for (let i = 0; i < 50 && Number((await raekker(f.db))[0]!['pris_mikro_usd']) !== 0; i++) await new Promise((y) => setTimeout(y, 5));
  assert.equal(Number((await raekker(f.db))[0]!['pris_mikro_usd']), 0, 'the provider answered nothing: settled to 0');
  await f.db.close();
});

test('KC-0273: the reservation (max_tokens × output price + the input estimate) must fit under the cap, or 402 before forwarding', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u, inkluderet: async () => ({ loftMikroUsd: 1000, modeller: ['claude-haiku-5-5'] }) });
  await noterKald(db, { kaldId: crypto.randomUUID(), tenant: TENANT, tid: NU, model: 'claude-haiku-5-5', udbyder: 'anthropic', forbrug: { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, prisMikroUsd: 900 });
  const r = await post(a, krop);
  assert.equal(r.status, 402, '900 spent + 256 × 0.50 reserved > 1000');
  assert.equal(((await r.json()) as { error: { type: string } }).error.type, 'kvote_brugt');
  assert.equal(u.sendt.length, 0);
  const lille = await post(a, { ...krop, max_tokens: 50 });
  assert.equal(lille.status, 200, 'a call whose reservation fits is forwarded');
  await lille.text();
  await db.close();
});

test('KC-0273: an in-flight call\'s reservation counts against the cap, and settles to the real usage when it ends', async () => {
  const slip: (() => void)[] = [];
  const u = falskUdbyder({ svar: () => new Response(new ReadableStream({ start(c) { slip.push(() => { c.enqueue(new TextEncoder().encode(sseSvar({ input: 10, output: 5 }))); c.close(); }); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const { a, db } = await app({ udbyder: u, inkluderet: async () => ({ loftMikroUsd: 250, modeller: ['claude-haiku-5-5'] }) });
  const r1 = await post(a, krop);
  assert.equal(r1.status, 200);
  const [res] = await raekker(db);
  assert.ok(Number(res!['pris_mikro_usd']) >= 128, 'the reservation is in the ledger before the provider answers');
  assert.equal((await post(a, krop)).status, 402, 'a second reservation does not fit beside the first');
  for (const s of slip.splice(0)) s();
  await r1.text();
  for (let i = 0; i < 50 && Number((await raekker(db))[0]!['pris_mikro_usd']) !== 4; i++) await new Promise((x) => setTimeout(x, 5));
  const [x] = await raekker(db);
  assert.deepEqual([x!['input_tokens'], x!['output_tokens'], x!['pris_mikro_usd']].map(Number), [10, 5, 4], 'settled: 10×0.10 + 5×0.50 rounded up');
  const r3 = await post(a, krop);
  assert.equal(r3.status, 200, 'after settling there is room again');
  for (const s of slip.splice(0)) s();
  await r3.text();
  await db.close();
});

test('KC-0273: a failed settle leaves the reservation standing (never a free call) and is logged; a failed reservation is 503, nothing forwarded', async () => {
  const u = falskUdbyder();
  const { a, db, logs } = await app({ udbyder: u, afregn: async () => { throw new Error('db nede'); } });
  await (await post(a, krop)).text();
  await vent(db, 1);
  for (let i = 0; i < 50 && !logs.some((l) => l.includes('REGNSKAB')); i++) await new Promise((x) => setTimeout(x, 5));
  const [x] = await raekker(db);
  assert.ok(Number(x!['pris_mikro_usd']) >= 128, 'the reservation stays as the price');
  assert.ok(logs.some((l) => /REGNSKAB FEJLEDE .*reservationen står/.test(l)), logs.join('\n'));

  const v = falskUdbyder();
  const b = await app({ udbyder: v, reserver: async () => { throw new Error('db nede'); } });
  const r = await post(b.a, krop);
  assert.equal(r.status, 503);
  assert.equal(v.sendt.length, 0, 'no reservation, no call');
  await db.close(); await b.db.close();
});

test('KC-0273: the tenant sees input_tokens (every prompt token) and output_tokens only; the cache counts are 0 (no prompt-cache oracle)', async () => {
  const { a, db } = await app();
  const tekst = await (await post(a, krop)).text();
  const usages = tekst.split('\n').filter((l) => l.startsWith('data: {"type":"message_')).map((l) => JSON.parse(l.slice(6)) as Record<string, any>)
    .filter((o) => o['type'] === 'message_start' || o['type'] === 'message_delta').map((o) => o['type'] === 'message_start' ? o['message']['usage'] : o['usage']);
  assert.deepEqual(usages, [{ input_tokens: 6000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }, { output_tokens: 200 }]);
  assert.ok(tekst.includes(SENTINEL), 'content passes untouched');
  const json = JSON.stringify({ id: 'msg_1', type: 'message', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 5, cache_read_input_tokens: 70, cache_creation_input_tokens: 3, cache_creation: { ephemeral_5m_input_tokens: 3 }, output_tokens: 2 } });
  const j = await app({ udbyder: falskUdbyder({ svar: () => new Response(json, { headers: { 'content-type': 'application/json' } }) }) });
  const svar = await (await post(j.a, { ...krop, stream: false })).json() as { usage: unknown };
  assert.deepEqual(svar.usage, { input_tokens: 78, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 2 });
  await vent(j.db, 1);
  const [x] = await raekker(j.db);
  assert.equal(Number(x!['cache_laes_tokens']), 70, 'the ledger keeps the real split');
  await db.close(); await j.db.close();
});
