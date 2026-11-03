// KC-0264: the two providers behind one seam, through the official SDKs (Anthropic's own API; Claude in Amazon Bedrock's
// bedrock-runtime endpoint with SigV4 and the EU inference profile), against a fake upstream on loopback or a fake SDK
// client. Never a real provider, never a real key.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { laesModelpriser } from '../../src/model/priser.ts';
import { UdbyderFejl, laesUdbyder, sdkUdbyder, udbyderVaert, juridiskGodkendt } from '../../src/model/udbyder.ts';
import { sseSvar } from './hjaelp.ts';

const NOEGLE = 'sk-ant-falsk-NOEGLE-9c1d';
const AWS_ID = 'AKIAFALSKFALSKFALSK1';
const AWS_HEMMELIG = 'falsk/HEMMELIG/aws+nogle0000000000000000';

/** Every fake still open is closed after the file, so a failed assertion never leaves the run hanging. */
const aabne = new Set<http.Server>();
after(() => { for (const s of aabne) { s.closeAllConnections(); s.close(); } });

type Modtaget = { metode: string; sti: string; headers: IncomingMessage['headers']; krop: any };

async function falskUpstream(svar: (m: Modtaget, res: ServerResponse) => void): Promise<{ url: string; modtaget: Modtaget[]; lukkede: number; stop(): Promise<void> }> {
  const modtaget: Modtaget[] = [];
  const s = { lukkede: 0 } as { lukkede: number };
  const server = http.createServer((req, res) => {
    let b = '';
    req.setEncoding('utf8').on('data', (d: string) => { b += d; });
    req.on('end', () => {
      const m = { metode: req.method ?? '', sti: req.url ?? '', headers: req.headers, krop: b ? JSON.parse(b) : null };
      modtaget.push(m);
      res.on('close', () => { if (!res.writableFinished) s.lukkede++; });
      svar(m, res);
    });
  });
  aabne.add(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`, modtaget, get lukkede() { return s.lukkede; },
    stop: () => new Promise<void>((r) => { aabne.delete(server); server.closeAllConnections(); server.close(() => r()); }),
  };
}

const sse = (res: ServerResponse, tekst = sseSvar({ input: 12, output: 7 })) => { res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'request-id': 'req_falsk' }); res.end(tekst); };
const krop = { model: 'claude-haiku-5-5', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'Hej' }] };

test('anthropic: the tenant body goes up with Clawco\'s key and the provider\'s model id; the stream comes back byte for byte', async () => {
  const up = await falskUpstream((_m, res) => sse(res));
  const p = laesModelpriser();
  const u = sdkUdbyder({ art: 'anthropic', noegle: NOEGLE, priser: p, url: up.url });
  const svar = await u.send({ krop, model: 'claude-haiku-5-5', headers: { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'x-beta-1' }, signal: AbortSignal.timeout(5000) });
  assert.equal(svar.status, 200);
  assert.match(svar.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(await svar.text(), sseSvar({ input: 12, output: 7 }));
  const m = up.modtaget[0]!;
  assert.equal(m.metode, 'POST');
  assert.equal(m.sti, '/v1/messages');
  // The 1.x SDK sends the API key as a bearer token.
  assert.equal(m.headers['authorization'], `Bearer ${NOEGLE}`);
  assert.equal(m.headers['anthropic-version'], '2023-06-01', 'the tenant\'s API version is kept');
  assert.equal(m.headers['anthropic-beta'], 'x-beta-1');
  assert.deepEqual(m.krop, krop);
  await up.stop();
});

test('provider errors: 429 and 400 pass through; a refused key, a missing model, overload and no connection are 503; no key in any message', async () => {
  const tilfaelde: [number, Record<string, string>, unknown, number, string][] = [
    [429, { 'retry-after': '17' }, { type: 'error', error: { type: 'rate_limit_error', message: 'langsommere' } }, 429, 'rate_limit_error'],
    [400, {}, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens mangler' } }, 400, 'invalid_request_error'],
    [401, {}, { type: 'error', error: { type: 'authentication_error', message: `bad key ${NOEGLE}` } }, 503, 'ikke_tilgaengelig'],
    [403, {}, { type: 'error', error: { type: 'permission_error', message: 'nej' } }, 503, 'ikke_tilgaengelig'],
    [404, {}, { type: 'error', error: { type: 'not_found_error', message: 'model' } }, 503, 'ikke_tilgaengelig'],
    [529, {}, { type: 'error', error: { type: 'overloaded_error', message: 'travlt' } }, 503, 'ikke_tilgaengelig'],
    [500, {}, { type: 'error', error: { type: 'api_error', message: 'øv' } }, 503, 'ikke_tilgaengelig'],
  ];
  for (const [status, h, body, forventet, type] of tilfaelde) {
    const up = await falskUpstream((_m, res) => { res.writeHead(status, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(body)); });
    const u = sdkUdbyder({ art: 'anthropic', noegle: NOEGLE, priser: laesModelpriser(), url: up.url });
    const e = await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) }).then(() => null, (x: unknown) => x);
    assert.ok(e instanceof UdbyderFejl, `${status}`);
    assert.equal(e.status, forventet, `${status}`);
    assert.equal(e.type, type, `${status}`);
    if (status === 429) assert.equal(e.retryAfter, '17');
    assert.ok(!JSON.stringify({ m: e.message, b: e.besked }).includes(NOEGLE), `${status}: never the key`);
    assert.equal(up.modtaget.length, 1, `${status}: no retries (a retry would be a second charge)`);
    await up.stop();
  }
  const u = sdkUdbyder({ art: 'anthropic', noegle: NOEGLE, priser: laesModelpriser(), url: 'http://127.0.0.1:9' });
  const e = await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: AbortSignal.timeout(5000) }).then(() => null, (x: unknown) => x);
  assert.ok(e instanceof UdbyderFejl && e.status === 503 && e.type === 'ikke_tilgaengelig');
});

test('an abort mid-stream closes the connection to the provider', async () => {
  const up = await falskUpstream((_m, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(sseSvar().slice(0, 200)); });
  const u = sdkUdbyder({ art: 'anthropic', noegle: NOEGLE, priser: laesModelpriser(), url: up.url });
  const ac = new AbortController();
  const svar = await u.send({ krop, model: 'claude-haiku-5-5', headers: {}, signal: ac.signal });
  const r = svar.body!.getReader();
  await r.read();
  ac.abort();
  await r.cancel().catch(() => {});
  for (let i = 0; i < 50 && up.lukkede === 0; i++) await new Promise((x) => setTimeout(x, 10));
  assert.equal(up.lukkede, 1);
  await up.stop();
});

test('laesUdbyder: off unless SKY_MODEL_UDBYDER names a provider whose keys are all set; reading removes the keys from env', () => {
  const p = laesModelpriser();
  assert.deepEqual(laesUdbyder({}, p), { udbyder: null, grund: 'SKY_MODEL_UDBYDER er ikke sat' });
  assert.match(laesUdbyder({ SKY_MODEL_UDBYDER: 'vertex' }, p).grund!, /SKY_MODEL_UDBYDER/);
  const env: Record<string, string | undefined> = { SKY_MODEL_UDBYDER: 'anthropic', SKY_ANTHROPIC_API_KEY: NOEGLE, SKY_AWS_SECRET_ACCESS_KEY: AWS_HEMMELIG, SKY_AWS_ACCESS_KEY_ID: AWS_ID };
  const a = laesUdbyder(env, p);
  assert.equal(a.udbyder?.navn, 'anthropic');
  assert.equal(a.vaert, 'api.anthropic.com');
  for (const k of ['SKY_ANTHROPIC_API_KEY', 'SKY_AWS_ACCESS_KEY_ID', 'SKY_AWS_SECRET_ACCESS_KEY']) assert.equal(env[k], undefined, `${k} is gone from env`);
  assert.ok(!JSON.stringify(a).includes(NOEGLE));
  const b = laesUdbyder({ SKY_MODEL_UDBYDER: 'bedrock', SKY_AWS_ACCESS_KEY_ID: AWS_ID }, p);
  assert.equal(b.udbyder, null);
  assert.match(b.grund!, /SKY_AWS_SECRET_ACCESS_KEY/);
  assert.ok(!b.grund!.includes(AWS_ID));
  const c = laesUdbyder({ SKY_MODEL_UDBYDER: 'bedrock', SKY_AWS_ACCESS_KEY_ID: AWS_ID, SKY_AWS_SECRET_ACCESS_KEY: AWS_HEMMELIG, SKY_AWS_REGION: 'eu-west-1' }, p);
  assert.equal(c.udbyder?.navn, 'bedrock');
  assert.equal(c.vaert, 'bedrock-runtime.eu-west-1.amazonaws.com');
  assert.match(laesUdbyder({ SKY_MODEL_UDBYDER: 'anthropic' }, p).grund!, /SKY_ANTHROPIC_API_KEY/);
});

test('the legal gate: a provider host is allowed only when docs/legal/behandlinger.json lists a subprocessor covering it', () => {
  const data = { underdatabehandlere: [{ id: 'cloudflare', vaerter: ['*.r2.cloudflarestorage.com'] }, { id: 'anthropic', vaerter: ['api.anthropic.com'] }, { id: 'aws', vaerter: ['bedrock-runtime.eu-north-1.amazonaws.com'] }] };
  assert.equal(juridiskGodkendt('api.anthropic.com', data), true);
  assert.equal(juridiskGodkendt('bedrock-runtime.eu-north-1.amazonaws.com', data), true);
  assert.equal(juridiskGodkendt('bedrock-runtime.us-east-1.amazonaws.com', data), false, 'another region is another host');
  assert.equal(juridiskGodkendt('api.anthropic.com.evil.com', data), false);
  assert.equal(juridiskGodkendt('api.anthropic.com', { underdatabehandlere: [] }), false);
  assert.equal(juridiskGodkendt('api.anthropic.com', null), false, 'unreadable legal data = not allowed');
  assert.equal(udbyderVaert('https://bedrock-runtime.{region}.amazonaws.com', 'eu-north-1'), 'bedrock-runtime.eu-north-1.amazonaws.com');
  const p = laesModelpriser();
  assert.equal(udbyderVaert(p.udbydere['bedrock']!.url, p.udbydere['bedrock']!.region), 'bedrock-runtime.eu-north-1.amazonaws.com', 'the configured Bedrock host');
});

test('today\'s legal data lists Bedrock (AWS, KC-0266) and not Anthropic direct: only Henrik\'s choice can switch on', async () => {
  const { laesBehandlingsdata } = await import('../../src/model/udbyder.ts');
  const d = laesBehandlingsdata();
  assert.ok(d && d.underdatabehandlere.length >= 4, 'the real file is read');
  const p = laesModelpriser();
  const listet = Object.fromEntries(Object.entries(p.udbydere).map(([navn, u]) => [navn, juridiskGodkendt(udbyderVaert(u.url, u.region), d)]));
  assert.deepEqual(listet, { anthropic: false, bedrock: true });
});

