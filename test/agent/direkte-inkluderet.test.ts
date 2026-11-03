// KC-0265: the built-in agent through Clawco's model proxy (the included AI of a Sky plan). The wire is Anthropic Messages
// with `authorization: Bearer <token>` (not x-api-key), the token read from its file at call time and closed while it is
// missing; 402 / 401 / 503 / a dead proxy each become one fixed sentence (the proxy's body only picks the kind), what the
// proxy said is noted for Start and Nu, and the token is in no URL, event, error or body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDirekte, UDEN_VAERKTOEJ, type DirekteFejlArt, type DirekteUdbyder } from '../../src/agent/direkte.ts';
import { createInkluderet, INKLUDERET_ID, medInkluderetToken, type Inkluderet } from '../../src/agent/inkluderet.ts';
import { envNoegleLager } from '../../src/agent/noeglelager.ts';
import { AgentError, type AgentEvent } from '../../src/agent/types.ts';
import { anthropicStream, startFalskUdbyder, type FalskSvar, type Modtaget } from '../helpers/falsk-udbyder.ts';

const TOKEN = 'kc-model-HEMMELIG-0265-abcdef';
const FEJL: Record<DirekteFejlArt, string> = {
  'model-noegle': 'F-MANGLER', 'kun-hermes': 'F-KUN', noegle: 'F-NOEGLE', kredit: 'F-KREDIT', model: 'F-MODEL', forbindelse: 'F-FORB', ukendt: 'F-UKENDT',
  kvote: 'F-KVOTE', 'inkluderet-ikke-klar': 'F-IKKEKLAR', 'inkluderet-utilgaengelig': 'F-UTILG',
};
const UDBYDERE: DirekteUdbyder[] = [
  { id: 'anthropic', envNavn: 'ANTHROPIC_API_KEY', hermesProvider: 'anthropic', kraeverNoegle: true, direkte: { api: 'anthropic-messages', url: 'http://127.0.0.1:1/v1/messages' } },
  { id: INKLUDERET_ID, envNavn: 'KC_MODEL_TOKEN_FIL', hermesProvider: 'clawco', kraeverNoegle: false, direkte: { api: 'anthropic-proxy' } },
];

type Sut = { agent: ReturnType<typeof createDirekte>; ink: Inkluderet; modtaget: Modtaget[]; fil: string; events: AgentEvent[]; testet: { udbyder: string; ok: boolean } };

async function med(svar: (m: Modtaget) => FalskSvar, fn: (s: Sut) => Promise<void>, o: { base?: string; utenToken?: boolean } = {}): Promise<void> {
  const f = await startFalskUdbyder(svar);
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-direkte-inkl-'));
  const fil = path.join(dir, 'model-token');
  if (!o.utenToken) await writeFile(fil, `${TOKEN}\n`);
  try {
    const ink = createInkluderet({ proxyUrl: o.base ?? f.url, tokenFil: fil });
    const testet = { udbyder: INKLUDERET_ID as string, ok: true };
    const lager = medInkluderetToken(envNoegleLager({ udbydere: ['anthropic'], env: {} }), ink);
    const agent = createDirekte({ udbydere: UDBYDERE, lager, fejl: FEJL, inkluderet: ink, testet: async () => testet });
    await fn({ agent, ink, modtaget: f.modtaget, fil, events: [], testet });
  } finally { await f.luk(); await rm(dir, { recursive: true, force: true }); }
}
const lyt = (s: Sut) => (e: AgentEvent): void => { s.events.push(e); };
const intetSted = (s: Sut, err?: unknown): void => {
  const alt = JSON.stringify(s.events) + (err instanceof Error ? err.message : '') + s.modtaget.map((m) => m.sti).join(' ') + JSON.stringify(s.modtaget.map((m) => m.body));
  assert.ok(!alt.includes(TOKEN) && !alt.includes('HEMMELIG'), 'the token is in no event, error, URL or body');
};
const koer = (s: Sut) => s.agent.run({ instructions: 'SYSTEM', input: 'INPUT', model: 'claude-haiku-5-5', provider: 'clawco', onEvent: lyt(s) });

test('included: one streamed Messages call to <proxy>/v1/messages with the bearer token, not x-api-key; the deltas, then run.completed', async () => {
  await med(() => ({ stream: anthropicStream(['Rolig ', 'hverdag']) }), async (s) => {
    const r = await koer(s);
    assert.equal(r.output, 'Rolig hverdag');
    assert.deepEqual(s.events.map((e) => e.type), ['message.delta', 'message.delta', 'run.completed']);
    const m = s.modtaget[0]!;
    assert.equal(m.metode, 'POST');
    assert.equal(m.sti, '/v1/messages');
    assert.equal(m.headers['authorization'], `Bearer ${TOKEN}`);
    assert.equal(m.headers['x-api-key'], undefined);
    assert.equal(m.body['model'], 'claude-haiku-5-5');
    assert.equal(m.body['stream'], true);
    assert.equal(m.body['system'], `SYSTEM\n\n${UDEN_VAERKTOEJ}`);
    assert.ok(!('tools' in m.body), 'no tools are offered');
    intetSted(s);
  });
});

test('included: the token file is read on every call (it may appear after boot, and a rotated token is used at once); missing = closed, nothing sent', async () => {
  await med(() => ({ stream: anthropicStream(['ok']) }), async (s) => {
    await rm(s.fil);
    const err = await koer(s).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, FEJL['inkluderet-ikke-klar']);
    assert.deepEqual(s.events.at(-1), { type: 'run.failed', error: FEJL['inkluderet-ikke-klar'] });
    assert.equal(s.modtaget.length, 0, 'no request without a token');
    await writeFile(s.fil, 'ny-token-9999999999');
    await koer(s);
    assert.equal(s.modtaget[0]!.headers['authorization'], 'Bearer ny-token-9999999999');
  });
});

for (const [navn, svar, art, noteret] of [
  ['402 with the date inside error', { status: 402, body: JSON.stringify({ error: { type: 'kvote_brugt', nulstilles: '2026-12-01' } }) }, 'kvote', { nulstilles: '2026-12-01' }],
  ['402 with the date beside error', { status: 402, body: JSON.stringify({ error: { type: 'kvote_brugt' }, nulstilles: '2026-12-01' }) }, 'kvote', { nulstilles: '2026-12-01' }],
  ['402 with no usable date (the body echoes the token)', { status: 402, body: JSON.stringify({ error: { type: 'kvote_brugt', message: `token ${TOKEN}` }, nulstilles: 'snart' }) }, 'kvote', {}],
  ['402 with a broken body', { status: 402, body: 'ikke json' }, 'kvote', {}],
] as [string, FalskSvar, DirekteFejlArt, { nulstilles?: string }][]) {
  test(`included: ${navn} → the fixed "used up" sentence; the allowance is noted as used up`, async () => {
    await med(() => svar, async (s) => {
      const err = await koer(s).catch((e: unknown) => e);
      assert.ok(err instanceof AgentError);
      assert.equal(err.message, FEJL[art]);
      assert.deepEqual(s.events.at(-1), { type: 'run.failed', error: FEJL[art] });
      assert.deepEqual(await s.ink.brugt(), noteret);
      intetSted(s, err);
    });
  });
}

test('included: 401 and 400 model_ikke_tilladt read as "not ready" (fail closed, never "check your key"); the allowance is not marked used up', async () => {
  for (const svar of [{ status: 401, body: '{"error":{"type":"ugyldig_noegle"}}' }, { status: 403, body: '{}' }, { status: 400, body: '{"error":{"type":"model_ikke_tilladt"}}' }] as FalskSvar[]) {
    await med(() => svar, async (s) => {
      const err = await koer(s).catch((e: unknown) => e);
      assert.ok(err instanceof AgentError);
      assert.equal(err.message, FEJL['inkluderet-ikke-klar']);
      assert.equal(s.ink.utilgaengelig(), false);
      intetSted(s, err);
    });
  }
});

test('included: 503, any 5xx and a proxy nobody answers for read as "not available" and are noted; status and health follow while Clawco\'s AI is the chosen one', async () => {
  await med(() => ({ status: 503, body: '{"error":{"type":"ikke_tilgaengelig"}}' }), async (s) => {
    assert.equal(await s.agent.status(), 'klar');
    assert.equal(await s.agent.health(), true);
    const err = await koer(s).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, FEJL['inkluderet-utilgaengelig']);
    assert.equal(s.ink.utilgaengelig(), true);
    assert.equal(await s.agent.status(), 'utilgaengelig', 'the existing agent-status machinery says it');
    assert.equal(await s.agent.health(), false);
    s.testet.udbyder = 'anthropic';
    assert.equal(await s.agent.status(), 'klar', 'another provider chosen: the proxy\'s trouble is not the agent\'s');
    intetSted(s, err);
  });
  await med(() => ({ status: 502 }), async (s) => {
    const err = await koer(s).catch((e: unknown) => e);
    assert.equal((err as Error).message, FEJL['inkluderet-utilgaengelig']);
  });
  await med(() => ({ status: 200 }), async (s) => {
    const err = await koer(s).catch((e: unknown) => e);
    assert.equal((err as Error).message, FEJL['inkluderet-utilgaengelig']);
    assert.equal(s.ink.utilgaengelig(), true);
  }, { base: 'http://127.0.0.1:1' });
});

test('included: a 429 is "not available" in words but is not noted as an outage', async () => {
  await med(() => ({ status: 429, body: '{"error":{"type":"for_mange_kald"}}' }), async (s) => {
    const err = await koer(s).catch((e: unknown) => e);
    assert.equal((err as Error).message, FEJL['inkluderet-utilgaengelig']);
    assert.equal(s.ink.utilgaengelig(), false);
  });
});

test('included: a run that goes through clears what was noted before', async () => {
  let antal = 0;
  await med(() => (++antal === 1 ? { status: 402, body: '{"error":{"type":"kvote_brugt"},"nulstilles":"2099-01-01"}' } : { stream: anthropicStream(['igen']) }), async (s) => {
    await koer(s).catch(() => undefined);
    assert.deepEqual(await s.ink.brugt(), { nulstilles: '2099-01-01' });
    await koer(s);
    assert.equal(await s.ink.brugt(), undefined);
  });
});

test('included: a stream that ends early or an error event fails with the neutral sentence, and a mid-stream error never counts as a good run', async () => {
  await med(() => ({ stream: anthropicStream(['halv'], { stop: false }) }), async (s) => {
    s.ink.noter({ art: 'utilgaengelig' });
    const err = await koer(s).catch((e: unknown) => e);
    assert.equal((err as Error).message, FEJL.ukendt);
    assert.equal(s.ink.utilgaengelig(), true, 'not cleared by a run that did not finish');
  });
});

test('included: the provider exists in the list but the agent was given no proxy: closed, a fixed sentence, nothing sent', async () => {
  const lager = envNoegleLager({ udbydere: ['anthropic'], env: {} });
  const agent = createDirekte({ udbydere: UDBYDERE, lager: { ...lager, hent: async () => TOKEN }, fejl: FEJL });
  const err = await agent.run({ instructions: 'S', input: 'I', model: 'claude-haiku-5-5', provider: 'clawco' }).catch((e: unknown) => e);
  assert.ok(err instanceof AgentError);
  assert.equal(err.message, FEJL['inkluderet-ikke-klar']);
});

test('included: the bearer token is never sent along a redirect (the request refuses to follow one)', async () => {
  const lager = envNoegleLager({ udbydere: ['anthropic'], env: {} });
  const set: RequestInit[] = [];
  const agent = createDirekte({
    udbydere: UDBYDERE, lager: { ...lager, hent: async () => TOKEN }, fejl: FEJL,
    inkluderet: { baseUrl: 'https://konto.example.test/model', noter: () => {}, utilgaengelig: () => false },
    fetchImpl: (async (_u: unknown, init?: RequestInit) => { set.push(init ?? {}); return new Response('{}', { status: 503 }); }) as typeof fetch,
  });
  await agent.run({ instructions: 'S', input: 'I', model: 'claude-haiku-5-5', provider: 'clawco' }).catch(() => undefined);
  assert.equal(set[0]?.redirect, 'error');
});
