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
import { SENTINEL, sseSvar } from './hjaelp.ts';

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

test('a valid token streams the provider\'s answer through unchanged, and ONE ledger row has the counts and price, no content', async () => {
  const u = falskUdbyder();
  const { a, db } = await app({ udbyder: u });
  const r = await post(a, krop, TOKEN, { 'anthropic-version': '2023-06-01', 'x-andet': 'nej' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(r.headers.get('content-encoding'), null, 'the body is already decoded; the provider\'s encoding header is not passed on');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(await r.text(), sseSvar({ input: 1000, output: 200, cacheLaes: 5000, tekst: SENTINEL }));
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
  const foer = await post(a, krop);
  assert.equal(foer.status, 200, 'under the cap: forwarded (the call that crosses it is the last one)');
  await foer.text();
  await vent(db, 2);
  const r = await post(a, krop);
  assert.equal(r.status, 402);
  const j = await r.json() as { error: { type: string; message: string; nulstilles: string }; nulstilles: string };
  assert.equal(j.error.type, 'kvote_brugt');
  assert.equal(j.error.nulstilles, '2026-12-01');
  assert.equal(j.nulstilles, '2026-12-01');
  assert.equal(u.sendt.length, 1, 'refused before forwarding');
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
    assert.equal((await raekker(db)).length, 0, 'no answer, no ledger row');
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
