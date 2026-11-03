// KC-0264: Claude in Amazon Bedrock behind the proxy. Haiku 5.5 is served in eu-central-1 only through bedrock-runtime
// with the EU cross-region inference profile, whose stream is AWS's binary event-stream, not Anthropic's SSE. The SDK
// decodes it; sdkUdbyder re-encodes the decoded events as Anthropic SSE so the proxy and the tenant see the Anthropic
// wire. Tests use a fake SDK client (bedrockKlient's seam) or the real client against a loopback fake; never AWS.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { APIError } from '@anthropic-ai/sdk';
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { Hono } from 'hono';
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import { laesModelpriser, prisMikroUsd } from '../../src/model/priser.ts';
import { modelRuter } from '../../src/model/ruter.ts';
import { UdbyderFejl, bedrockKlient, sdkUdbyder, type BedrockKlient } from '../../src/model/udbyder.ts';
import { SENTINEL, sseSvar } from './hjaelp.ts';

const AWS_ID = 'AKIAFALSKFALSKFALSK1';
const AWS_HEMMELIG = 'falsk/HEMMELIG/aws+nogle0000000000000000';
const AWS_RAA = 'arn:aws:bedrock:eu-central-1:123456789012 is not authorized (raw AWS text)';
const AWS = { id: AWS_ID, hemmelighed: AWS_HEMMELIG, region: 'eu-central-1' };
const PROFIL = 'eu.anthropic.claude-haiku-5-5';
const krop = { model: 'claude-haiku-5-5', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'Hej' }] };

/** The decoded events of an SSE text, as the SDK's stream yields them. */
const haendelser = (sse: string): { type: string }[] => sse.split('\n\n').filter(Boolean).map((r) => JSON.parse(r.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));

type Kald = { krop: Record<string, unknown>; opts: { headers: Record<string, string>; signal: AbortSignal } };

/** A fake of what the SDK's messages.create returns: a promise of a Stream (async iterable + controller) with asResponse(). */
function falskKlient(o: { events?: { type: string }[]; foer?: unknown; ved?: { efter: number; fejl: unknown }; haeng?: boolean; json?: unknown } = {}): BedrockKlient & { kald: Kald[]; controller: AbortController } {
  const kald: Kald[] = [];
  const controller = new AbortController();
  return {
    kald, controller,
    messages: {
      create(body, opts) {
        kald.push({ krop: body as Record<string, unknown>, opts });
        // Like the SDK: the caller's signal aborts the request's controller.
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
        const evs = o.events ?? haendelser(sseSvar({ input: 12, output: 7 }));
        const stroem = {
          controller,
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < evs.length; i++) {
              if (o.ved && i === o.ved.efter) throw o.ved.fejl;
              if (controller.signal.aborted) return;
              yield evs[i]!;
            }
            if (o.haeng && !controller.signal.aborted) await new Promise<void>((r) => controller.signal.addEventListener('abort', () => r(), { once: true }));
          },
        };
        const p = o.foer ? Promise.reject(o.foer) : Promise.resolve(stroem);
        p.catch(() => {});
        return Object.assign(p, { asResponse: async () => { if (o.foer) throw o.foer; return new Response(JSON.stringify(o.json ?? {}), { headers: { 'content-type': 'application/json' } }); } });
      },
    },
  };
}

const udbyder = (k: BedrockKlient, log?: (l: string) => void) => sdkUdbyder({ art: 'bedrock', aws: AWS, priser: laesModelpriser(), url: 'https://bedrock-runtime.eu-central-1.amazonaws.com', lagBedrock: () => k, ...(log ? { log } : {}) });

test('the real client: region eu-central-1, the bedrock-runtime URL, explicit credentials, no retries, nothing from env', () => {
  const gemt = { r: process.env['AWS_REGION'], b: process.env['AWS_BEARER_TOKEN_BEDROCK'], u: process.env['ANTHROPIC_BEDROCK_BASE_URL'] };
  process.env['AWS_REGION'] = 'us-west-2';
  process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'falsk-bearer-fra-env';
  process.env['ANTHROPIC_BEDROCK_BASE_URL'] = 'https://evil.example';
  try {
    const k = bedrockKlient({ url: 'https://bedrock-runtime.eu-central-1.amazonaws.com', aws: AWS, timeoutMs: 1234 });
    assert.equal(k.awsRegion, 'eu-central-1');
    assert.equal(k.baseURL, 'https://bedrock-runtime.eu-central-1.amazonaws.com');
    assert.equal(k.maxRetries, 0);
    assert.equal(k.timeout, 1234);
    assert.equal(k.awsAccessKey, AWS_ID);
    assert.equal(k.awsSecretKey, AWS_HEMMELIG);
    assert.equal(k.awsSessionToken, null);
    assert.equal(k.apiKey, null, 'SigV4 with our keys, never a bearer token from env');
    assert.equal(k.providerChainResolver, null);
  } finally {
    for (const [n, v] of [['AWS_REGION', gemt.r], ['AWS_BEARER_TOKEN_BEDROCK', gemt.b], ['ANTHROPIC_BEDROCK_BASE_URL', gemt.u]] as const) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
  }
});

test('bedrock: the EU inference profile id goes up with stream on, and the decoded events come out as Anthropic SSE byte for byte', async () => {
  const k = falskKlient();
  const svar = await udbyder(k).send({ krop, model: 'claude-haiku-5-5', headers: { 'anthropic-version': '2023-06-01', 'x-andet': 'nej' }, signal: AbortSignal.timeout(5000) });
  assert.equal(svar.status, 200);
  assert.equal(svar.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(await svar.text(), sseSvar({ input: 12, output: 7 }), 'message_start, content_block_*, ping, message_delta, message_stop');
  assert.equal(k.kald.length, 1);
  assert.equal(k.kald[0]!.krop['model'], PROFIL);
  assert.equal(k.kald[0]!.krop['stream'], true);
  assert.deepEqual({ ...k.kald[0]!.krop, model: krop.model }, krop);
  assert.deepEqual(k.kald[0]!.opts.headers, { 'anthropic-version': '2023-06-01' }, 'only the wire headers go up');
});

test('bedrock through the proxy: the tenant gets the Anthropic SSE and ONE ledger row has the counts at the +10 % price', async () => {
  const k = falskKlient({ events: haendelser(sseSvar({ input: 1000, output: 200, cacheLaes: 5000, tekst: SENTINEL })) });
  const db = await pgliteDatabase();
  await migrer(db);
  const p = laesModelpriser();
  const a = new Hono();
  a.route('/', modelRuter({ db, priser: p, udbyder: udbyder(k), tenantForToken: async () => 'hus-bbbbbbbb', inkluderet: async () => ({ loftMikroUsd: 4_000_000, modeller: ['claude-haiku-5-5'] }), nu: () => new Date('2026-11-03T10:00:00Z'), log: () => {} }));
  const r = await a.request('/model/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${'A'.repeat(43)}=`, 'content-type': 'application/json' }, body: JSON.stringify(krop) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(await r.text(), sseSvar({ input: 1000, output: 200, cacheLaes: 5000, tekst: SENTINEL }));
  let rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 100 && rows.length === 0; i++) { rows = await db.query('SELECT * FROM model.forbrug'); if (!rows.length) await new Promise((x) => setTimeout(x, 5)); }
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!['udbyder'], 'bedrock');
  assert.deepEqual([rows[0]!['input_tokens'], rows[0]!['output_tokens'], rows[0]!['cache_laes_tokens']].map(Number), [1000, 200, 5000]);
  assert.equal(Number(rows[0]!['pris_mikro_usd']), prisMikroUsd(p, 'claude-haiku-5-5', 'bedrock', { input: 1000, output: 200, cacheLaes: 5000, cacheSkriv5m: 0, cacheSkriv1t: 0 }));
  assert.equal(Number(rows[0]!['pris_mikro_usd']), 275, '(100 + 100 + 50) × 1.10');
  assert.ok(!JSON.stringify(rows).includes(SENTINEL));
  await db.close();
});

test('bedrock: cancelling the answer or aborting the proxy signal aborts the upstream request', async () => {
  const evs = haendelser(sseSvar()).slice(0, 2);
  const k1 = falskKlient({ events: evs, haeng: true });
  const s1 = await udbyder(k1).send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: new AbortController().signal });
  const r1 = s1.body!.getReader();
  await r1.read();
  await r1.cancel();
  assert.ok(k1.controller.signal.aborted, 'the tenant hung up: upstream aborted');

  const k2 = falskKlient({ events: evs, haeng: true });
  const ac = new AbortController();
  const s2 = await udbyder(k2).send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: ac.signal });
  const r2 = s2.body!.getReader();
  await r2.read(); await r2.read();
  const venter = r2.read();
  ac.abort(new Error('timeout'));
  const sidst = await venter.then((x) => x, () => ({ done: true }));
  assert.ok(k2.controller.signal.aborted, 'the deadline: upstream aborted');
  assert.equal(sidst.done, true, 'and the answer ends');
});

test('bedrock: an error mid-stream becomes ONE generic SSE error event and the stream ends; no key, no AWS text', async () => {
  const logs: string[] = [];
  const fejl = new APIError(undefined, { type: 'error', error: { type: 'throttlingException', message: `${AWS_RAA} ${AWS_HEMMELIG}` } }, undefined, new Headers());
  const k = falskKlient({ ved: { efter: 2, fejl } });
  const svar = await udbyder(k, (l) => logs.push(l)).send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) });
  const tekst = await svar.text();
  const forventetStart = sseSvar({ input: 12, output: 7 }).split('\n\n').slice(0, 2).map((x) => `${x}\n\n`).join('');
  assert.ok(tekst.startsWith(forventetStart), 'the events before the error are passed on');
  const rest = tekst.slice(forventetStart.length);
  assert.equal(rest, `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Modellen er ikke tilgængelig lige nu.' } })}\n\n`);
  for (const x of [tekst, logs.join('\n')]) { assert.ok(!x.includes(AWS_HEMMELIG)); assert.ok(!x.includes(AWS_ID)); assert.ok(!x.includes(AWS_RAA)); }
  assert.equal(logs.length, 1, 'the break is logged once, by name');
});

test('bedrock: errors before the first event keep the mapping: 429 and 400 pass through, a refused key is 503 with no key text', async () => {
  const api = (status: number, type: string, message: string, h: Record<string, string> = {}) => new APIError(status, { type: 'error', error: { type, message } }, undefined, new Headers(h));
  const tilfaelde: [unknown, number, string][] = [
    [api(429, 'rate_limit_error', 'langsommere', { 'retry-after': '3' }), 429, 'rate_limit_error'],
    [api(400, 'invalid_request_error', 'max_tokens mangler'), 400, 'invalid_request_error'],
    [api(403, 'access_denied', `${AWS_RAA} ${AWS_ID}`), 503, 'ikke_tilgaengelig'],
    [api(500, 'api_error', AWS_RAA), 503, 'ikke_tilgaengelig'],
    [new Error(AWS_HEMMELIG), 503, 'ikke_tilgaengelig'],
  ];
  for (const [fejl, status, type] of tilfaelde) {
    for (const k of [falskKlient({ foer: fejl }), falskKlient({ ved: { efter: 0, fejl } })]) {
      const logs: string[] = [];
      const e = await udbyder(k, (l) => logs.push(l)).send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) }).then(() => null, (x: unknown) => x);
      assert.ok(e instanceof UdbyderFejl, `${status}`);
      assert.equal(e.status, status);
      assert.equal(e.type, type);
      if (status === 429) assert.equal(e.retryAfter, '3');
      const alt = JSON.stringify({ m: e.message, b: e.besked, logs });
      for (const s of [AWS_HEMMELIG, AWS_ID, ...(status === 503 ? [AWS_RAA] : [])]) assert.ok(!alt.includes(s), `${status}: never ${s.slice(0, 12)}`);
    }
  }
});

test('bedrock: a non-streamed call (stream: false) is passed through as the provider\'s JSON', async () => {
  const k = falskKlient({ json: { id: 'msg_x', type: 'message', usage: { input_tokens: 3, output_tokens: 4 } } });
  const svar = await udbyder(k).send({ krop: { ...krop, stream: false }, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) });
  assert.match(svar.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(((await svar.json()) as { id: string }).id, 'msg_x');
  assert.equal(k.kald[0]!.krop['stream'], false);
  assert.equal(k.kald[0]!.krop['model'], PROFIL);
});

// The real SDK client end to end against a loopback bedrock-runtime fake: SigV4 for service bedrock in eu-central-1, the
// profile in the invoke-with-response-stream path, AWS's binary event-stream decoded and re-encoded as Anthropic SSE.
const aabne = new Set<http.Server>();
after(() => { for (const s of aabne) { s.closeAllConnections(); s.close(); } });

async function falskRuntime(svar: (req: IncomingMessage, krop: any, res: ServerResponse) => void): Promise<{ url: string; modtaget: { sti: string; headers: IncomingMessage['headers']; krop: any }[] }> {
  const modtaget: { sti: string; headers: IncomingMessage['headers']; krop: any }[] = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.setEncoding('utf8').on('data', (d: string) => { b += d; });
    req.on('end', () => { const k = b ? JSON.parse(b) : null; modtaget.push({ sti: req.url ?? '', headers: req.headers, krop: k }); svar(req, k, res); });
  });
  aabne.add(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, modtaget };
}

const kodek = new EventStreamCodec((b: Uint8Array) => new TextDecoder().decode(b), (s: string) => new TextEncoder().encode(s));
const ramme = (ev: unknown) => kodek.encode({
  headers: { ':event-type': { type: 'string', value: 'chunk' }, ':message-type': { type: 'string', value: 'event' }, ':content-type': { type: 'string', value: 'application/json' } },
  body: new TextEncoder().encode(JSON.stringify({ bytes: Buffer.from(JSON.stringify(ev)).toString('base64') })),
});

test('the real client against a loopback bedrock-runtime: signed for eu-central-1, the profile in the path, event-stream out as SSE', async () => {
  const evs = haendelser(sseSvar({ input: 12, output: 7 })).filter((e) => e.type !== 'ping');
  const up = await falskRuntime((_req, _k, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream', 'x-amzn-requestid': 'falsk' });
    for (const e of evs) res.write(ramme(e));
    res.end();
  });
  const u = sdkUdbyder({ art: 'bedrock', aws: AWS, priser: laesModelpriser(), url: up.url });
  const svar = await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) });
  const forventet = evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  assert.equal(await svar.text(), forventet);
  const m = up.modtaget[0]!;
  assert.equal(m.sti, `/model/${PROFIL}/invoke-with-response-stream`);
  assert.match(String(m.headers['authorization']), new RegExp(`^AWS4-HMAC-SHA256 Credential=${AWS_ID}/\\d{8}/eu-central-1/bedrock/aws4_request`));
  assert.ok(!JSON.stringify(m.headers).includes(AWS_HEMMELIG), 'the secret signs, it is never sent');
  assert.equal(m.krop.model, undefined, 'the model is in the path on bedrock-runtime');
  assert.equal(m.krop.max_tokens, 64);
});

test('the real client: an AWS exception frame mid-stream becomes the one generic error event, not AWS\'s text', async () => {
  const evs = haendelser(sseSvar({ input: 12, output: 7 })).slice(0, 2);
  const undtagelse = kodek.encode({
    headers: { ':message-type': { type: 'string', value: 'exception' }, ':exception-type': { type: 'string', value: 'modelStreamErrorException' }, ':content-type': { type: 'string', value: 'application/json' } },
    body: new TextEncoder().encode(JSON.stringify({ message: AWS_RAA })),
  });
  const up = await falskRuntime((_req, _k, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
    for (const e of evs) res.write(ramme(e));
    res.end(undtagelse);
  });
  const logs: string[] = [];
  const u = sdkUdbyder({ art: 'bedrock', aws: AWS, priser: laesModelpriser(), url: up.url, log: (l) => logs.push(l) });
  const tekst = await (await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) })).text();
  const forventet = evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  assert.equal(tekst, `${forventet}event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Modellen er ikke tilgængelig lige nu.' } })}\n\n`);
  assert.ok(!`${tekst}${logs.join('')}`.includes(AWS_RAA));
});

test('the real client: a 429 from bedrock-runtime passes through once (no retry), a 403 is 503', async () => {
  for (const [status, forventet] of [[429, 429], [403, 503]] as const) {
    const up = await falskRuntime((_req, _k, res) => { res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '4' }); res.end(JSON.stringify({ message: AWS_RAA })); });
    const u = sdkUdbyder({ art: 'bedrock', aws: AWS, priser: laesModelpriser(), url: up.url, log: () => {} });
    const e = await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) }).then(() => null, (x: unknown) => x);
    assert.ok(e instanceof UdbyderFejl);
    assert.equal(e.status, forventet);
    assert.equal(up.modtaget.length, 1, `${status}: no retries`);
    if (forventet === 503) assert.ok(!JSON.stringify({ m: e.message, b: e.besked }).includes(AWS_RAA));
  }
});
