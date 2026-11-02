// KC-0127: the providers of step 2 are data. Their env names are the only ones
// Clawco may write into the agent's env file; model discovery runs on the
// server with the pasted key in a header (never in the URL) and fails quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envVaerdi, hentModelNavne, MODEL_ENV_NOEGLER, udbyderAf, UDBYDERE } from '../../../src/rooms/start/udbydere.ts';

const NOEGLE = 'sk-test-HEMMELIG-42';

test('the list: Anthropic, OpenAI, GitHub Copilot, OpenRouter, LM Studio and Ollama, each with two default models', () => {
  assert.deepEqual(UDBYDERE.map((u) => u.id), ['anthropic', 'openai', 'copilot', 'openrouter', 'lmstudio', 'ollama']);
  for (const u of UDBYDERE) {
    assert.ok(u.standardModeller.lille && u.standardModeller.taenker, u.id);
    assert.match(u.envNavn, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(u.kraeverNoegle, !u.standardUrl, 'a local model takes an address, not a key');
  }
  assert.equal(udbyderAf('lmstudio')?.standardUrl, 'http://127.0.0.1:1234');
  assert.equal(udbyderAf('ollama')?.standardUrl, 'http://127.0.0.1:11434');
  assert.equal(udbyderAf('ukendt'), undefined);
  assert.deepEqual(MODEL_ENV_NOEGLER, UDBYDERE.map((u) => u.envNavn), 'the allowlist is derived from the list');
});

test('envVaerdi: a key trimmed; a local address normalised to its OpenAI-compatible /v1; junk refused', () => {
  const a = udbyderAf('anthropic')!;
  const l = udbyderAf('lmstudio')!;
  assert.equal(envVaerdi(a, `  ${NOEGLE} `), NOEGLE);
  assert.equal(envVaerdi(a, ''), null);
  assert.equal(envVaerdi(l, ''), 'http://127.0.0.1:1234/v1', 'empty = the default address');
  assert.equal(envVaerdi(l, 'http://192.168.1.5:1234/'), 'http://192.168.1.5:1234/v1');
  assert.equal(envVaerdi(l, 'http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
  assert.equal(envVaerdi(l, 'file:///etc/passwd'), null);
  assert.equal(envVaerdi(l, 'ikke en adresse'), null);
});

test('hentModelNavne sends the key in a header only and reads data[].id', async () => {
  const kald: { url: string; headers: Headers }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    kald.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5' }, { id: 'ugyldigt navn med mellemrum' }] }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await hentModelNavne(udbyderAf('anthropic')!, { noegle: NOEGLE, fetchImpl }), ['claude-haiku-4-5', 'claude-sonnet-4-5']);
  assert.equal(kald[0]?.url, 'https://api.anthropic.com/v1/models');
  assert.equal(kald[0]?.headers.get('x-api-key'), NOEGLE);
  assert.ok(!kald[0]?.url.includes(NOEGLE));
  await hentModelNavne(udbyderAf('openai')!, { noegle: NOEGLE, fetchImpl });
  assert.equal(kald[1]?.headers.get('authorization'), `Bearer ${NOEGLE}`);
  await hentModelNavne(udbyderAf('ollama')!, { baseUrl: 'http://127.0.0.1:11434/v1', fetchImpl });
  assert.equal(kald[2]?.url, 'http://127.0.0.1:11434/v1/models');
  assert.equal(kald[2]?.headers.get('authorization'), null);
});

test('hentModelNavne gives [] on any failure, and nothing for a provider without discovery', async () => {
  const boom = (async () => { throw new Error(`connect ECONNREFUSED ${NOEGLE}`); }) as typeof fetch;
  const nej = (async () => new Response('{"error":"bad key"}', { status: 401 })) as typeof fetch;
  const rod = (async () => new Response('ikke json', { status: 200 })) as typeof fetch;
  for (const f of [boom, nej, rod]) assert.deepEqual(await hentModelNavne(udbyderAf('openai')!, { noegle: NOEGLE, fetchImpl: f }), []);
  let kaldt = false;
  assert.deepEqual(await hentModelNavne(udbyderAf('copilot')!, { noegle: NOEGLE, fetchImpl: (async () => { kaldt = true; return new Response('{}'); }) as typeof fetch }), []);
  assert.equal(kaldt, false);
});

test('KC-0180: how the direct agent calls each provider (one list knows providers)', () => {
  assert.deepEqual(udbyderAf('anthropic')?.direkte, { api: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' });
  assert.deepEqual(udbyderAf('openai')?.direkte, { api: 'openai-chat', url: 'https://api.openai.com/v1/chat/completions' });
  assert.deepEqual(udbyderAf('openrouter')?.direkte, { api: 'openai-chat', url: 'https://openrouter.ai/api/v1/chat/completions' });
  assert.deepEqual(udbyderAf('lmstudio')?.direkte, { api: 'openai-chat' }, 'a local model: the saved address');
  assert.deepEqual(udbyderAf('ollama')?.direkte, { api: 'openai-chat' });
  assert.equal(udbyderAf('copilot')?.direkte, undefined, 'no public direct API: only through Hermes');
});
