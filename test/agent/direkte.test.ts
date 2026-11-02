// KC-0180: the direct-model agent against an in-process fake provider. One
// streamed call per run (Anthropic Messages or OpenAI-compatible chat), the
// deltas as message.delta, no tools ever, every failure one fixed sentence,
// the caller's signal aborts the HTTP request, and the key is in no URL, no
// event and no error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirekte, TID, UDEN_VAERKTOEJ, type DirekteFejlArt, type DirekteUdbyder } from '../../src/agent/direkte.ts';
import { envNoegleLager, type NoegleLager } from '../../src/agent/noeglelager.ts';
import { AFBRUDT, AgentError, type AgentEvent } from '../../src/agent/types.ts';
import { anthropicStream, openaiStream, startFalskUdbyder, type FalskSvar, type Modtaget } from '../helpers/falsk-udbyder.ts';

const NOEGLE = 'sk-ant-test-HEMMELIG-0180abcdef';
const FEJL: Record<DirekteFejlArt, string> = {
  'model-noegle': 'F-MANGLER', 'kun-hermes': 'F-KUN', noegle: 'F-NOEGLE', kredit: 'F-KREDIT', model: 'F-MODEL', forbindelse: 'F-FORB', ukendt: 'F-UKENDT',
};

function udbydere(base: string): DirekteUdbyder[] {
  return [
    { id: 'anthropic', envNavn: 'ANTHROPIC_API_KEY', hermesProvider: 'anthropic', kraeverNoegle: true, direkte: { api: 'anthropic-messages', url: `${base}/v1/messages` } },
    { id: 'openai', envNavn: 'OPENAI_API_KEY', hermesProvider: 'openai-api', kraeverNoegle: true, direkte: { api: 'openai-chat', url: `${base}/v1/chat/completions` } },
    { id: 'copilot', envNavn: 'COPILOT_GITHUB_TOKEN', hermesProvider: 'copilot', kraeverNoegle: true },
    { id: 'lmstudio', envNavn: 'LM_BASE_URL', hermesProvider: 'lmstudio', kraeverNoegle: false, direkte: { api: 'openai-chat' } },
  ];
}

type Sut = { agent: ReturnType<typeof createDirekte>; lager: NoegleLager; modtaget: Modtaget[]; base: string; events: AgentEvent[] };

async function med(svar: (m: Modtaget) => FalskSvar, fn: (s: Sut) => Promise<void>, o: { timeoutMs?: number; testet?: () => Promise<{ udbyder?: string; ok: boolean }>; base?: string } = {}): Promise<void> {
  const f = await startFalskUdbyder(svar);
  const base = o.base ?? f.url;
  const lager = envNoegleLager({ udbydere: ['anthropic', 'openai', 'copilot', 'lmstudio'], env: {} });
  try {
    const agent = createDirekte({ udbydere: udbydere(base), lager, fejl: FEJL, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.testet ? { testet: o.testet } : {}) });
    await fn({ agent, lager, modtaget: f.modtaget, base, events: [] });
  } finally { await f.luk(); }
}

const lyt = (s: Sut) => (e: AgentEvent): void => { s.events.push(e); };
const intetSted = (s: Sut, err?: unknown): void => {
  const alt = JSON.stringify(s.events) + (err instanceof Error ? err.message : '') + s.modtaget.map((m) => m.sti).join(' ');
  assert.ok(!alt.includes(NOEGLE) && !alt.includes('HEMMELIG'), 'the key is in no event, error or URL');
};

test('Anthropic: one streamed Messages call; deltas, then run.completed with the whole text', async () => {
  await med(() => ({ stream: anthropicStream(['Hej ', 'med ', 'dig']) }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    const r = await s.agent.run({ instructions: 'SYSTEM', input: 'INPUT', model: 'claude-haiku-4-5', provider: 'anthropic', sessionId: 'x', onEvent: lyt(s) });
    assert.equal(r.output, 'Hej med dig');
    assert.deepEqual(s.events, [
      { type: 'message.delta', text: 'Hej ' }, { type: 'message.delta', text: 'med ' }, { type: 'message.delta', text: 'dig' },
      { type: 'run.completed', output: 'Hej med dig' },
    ]);
    const m = s.modtaget[0]!;
    assert.equal(m.metode, 'POST');
    assert.equal(m.sti, '/v1/messages');
    assert.equal(m.headers['x-api-key'], NOEGLE);
    assert.equal(m.headers['anthropic-version'], '2023-06-01');
    assert.equal(m.headers['authorization'], undefined);
    assert.equal(m.body['model'], 'claude-haiku-4-5');
    assert.equal(m.body['stream'], true);
    assert.equal(typeof m.body['max_tokens'], 'number');
    assert.equal(m.body['system'], `SYSTEM\n\n${UDEN_VAERKTOEJ}`);
    assert.deepEqual(m.body['messages'], [{ role: 'user', content: 'INPUT' }]);
    assert.ok(!('tools' in m.body), 'no tools are offered');
    intetSted(s);
  });
});

test('OpenAI-compatible: Bearer, a system message, deltas until [DONE]; comment lines are skipped', async () => {
  await med(() => ({ stream: openaiStream(['klar']) }), async (s) => {
    await s.lager.saet('openai', NOEGLE);
    const r = await s.agent.run({ instructions: 'SYS', input: 'IN', model: 'gpt-5-mini', provider: 'openai-api', onEvent: lyt(s) });
    assert.equal(r.output, 'klar');
    const m = s.modtaget[0]!;
    assert.equal(m.sti, '/v1/chat/completions');
    assert.equal(m.headers['authorization'], `Bearer ${NOEGLE}`);
    assert.equal(m.body['stream'], true);
    assert.deepEqual(m.body['messages'], [{ role: 'system', content: `SYS\n\n${UDEN_VAERKTOEJ}` }, { role: 'user', content: 'IN' }]);
    assert.ok(!('max_tokens' in m.body), 'max_tokens is deprecated at OpenAI; left out');
    assert.deepEqual(s.events.map((e) => e.type), ['message.delta', 'run.completed']);
    intetSted(s);
  });
});

test('a local model: the saved address is the base, no auth header is sent', async () => {
  await med(() => ({ stream: openaiStream(['lokal']) }), async (s) => {
    await s.lager.saet('lmstudio', `${s.base}/v1`);
    const r = await s.agent.run({ instructions: 'S', input: 'I', model: 'qwen/qwen3-8b', provider: 'lmstudio' });
    assert.equal(r.output, 'lokal');
    assert.equal(s.modtaget[0]!.sti, '/v1/chat/completions');
    assert.equal(s.modtaget[0]!.headers['authorization'], undefined);
  });
});

test('never a tool event: the policy watcher has nothing to catch', async () => {
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic', onEvent: lyt(s) });
    assert.ok(s.events.every((e) => !e.type.startsWith('tool.')));
  });
});

const FEJLSAG: { navn: string; svar: FalskSvar; art: DirekteFejlArt }[] = [
  { navn: '401 (the body echoes the key)', svar: { status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${NOEGLE}` } }) }, art: 'noegle' },
  { navn: '403', svar: { status: 403, body: '{"type":"error","error":{"type":"permission_error","message":"nope"}}' }, art: 'noegle' },
  { navn: '402', svar: { status: 402, body: '{"type":"error","error":{"type":"billing_error","message":"pay"}}' }, art: 'kredit' },
  { navn: '400 credit balance too low', svar: { status: 400, body: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}' }, art: 'kredit' },
  { navn: '429 insufficient_quota', svar: { status: 429, body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' }, art: 'kredit' },
  { navn: '404', svar: { status: 404, body: '{"type":"error","error":{"type":"not_found_error","message":"model: x"}}' }, art: 'model' },
  { navn: '429 rate limit', svar: { status: 429, body: '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' }, art: 'ukendt' },
  { navn: '529 overloaded', svar: { status: 529, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }, art: 'ukendt' },
  { navn: 'a mid-stream error event', svar: { stream: [...anthropicStream(['delvis'], { stop: false }).slice(0, 4), 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'] }, art: 'ukendt' },
  { navn: 'a stream that ends without message_stop', svar: { stream: anthropicStream(['halv'], { stop: false }) }, art: 'ukendt' },
];

for (const c of FEJLSAG) {
  test(`Anthropic ${c.navn} → the fixed sentence for ${c.art}, run.failed, no key anywhere`, async () => {
    await med(() => c.svar, async (s) => {
      await s.lager.saet('anthropic', NOEGLE);
      const err = await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic', onEvent: lyt(s) }).catch((e: unknown) => e);
      assert.ok(err instanceof AgentError);
      assert.equal(err.message, FEJL[c.art]);
      assert.deepEqual(s.events.at(-1), { type: 'run.failed', error: FEJL[c.art] });
      intetSted(s, err);
    });
  });
}

test('OpenRouter-style mid-stream error (finish_reason "error") fails, not completes', async () => {
  const fejlChunk = `data: ${JSON.stringify({ error: { code: 502, message: 'upstream' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`;
  await med(() => ({ stream: [openaiStream(['del'], { done: false })[2]!, fejlChunk, 'data: [DONE]\n\n'] }), async (s) => {
    await s.lager.saet('openai', NOEGLE);
    const err = await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'openai-api' }).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, FEJL.ukendt);
  });
});

test('nothing answers at the address → forbindelse', async () => {
  await med(() => ({ status: 200 }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    const err = await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic' }).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, FEJL.forbindelse);
  }, { base: 'http://127.0.0.1:1' });
});

test("the agent's own timer stops a model that never finishes: the Danish time sentence", async () => {
  await med(() => ({ stream: anthropicStream(['a'], { stop: false }), aaben: true }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    const err = await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic' }).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, TID);
  }, { timeoutMs: 150 });
});

test("the caller's signal aborts the HTTP request mid-stream (kill switch): AFBRUDT", async () => {
  await med(() => ({ stream: anthropicStream(['a'], { stop: false }), aaben: true }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    const ac = new AbortController();
    const p = s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic', signal: ac.signal, onEvent: (e) => { if (e.type === 'message.delta') ac.abort(); } });
    const err = await p.catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, AFBRUDT);
  });
});

test('an already aborted signal sends nothing', async () => {
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    await s.lager.saet('anthropic', NOEGLE);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'anthropic', signal: ac.signal }), (e: Error) => e.message === AFBRUDT);
    assert.equal(s.modtaget.length, 0);
  });
});

test('no provider chosen, an unknown one, or no key yet: the Danish "no key" sentence, nothing sent', async () => {
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    for (const req of [{}, { provider: 'anthropic', model: 'm' }, { provider: 'ukendt', model: 'm' }, { provider: 'anthropic' }]) {
      const err = await s.agent.run({ instructions: 'S', input: 'I', ...req, onEvent: lyt(s) }).catch((e: unknown) => e);
      assert.ok(err instanceof AgentError);
      assert.equal(err.message, FEJL['model-noegle']);
    }
    assert.equal(s.modtaget.length, 0);
  });
});

test('a provider with no direct API (Copilot) says it works only through Hermes', async () => {
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    await s.lager.saet('copilot', 'ghu_x');
    const err = await s.agent.run({ instructions: 'S', input: 'I', model: 'm', provider: 'copilot' }).catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, FEJL['kun-hermes']);
    assert.equal(s.modtaget.length, 0);
  });
});

test('saetModelNoegle keeps the key in the lager by the env name; answers name + length', async () => {
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    assert.deepEqual(await s.agent.saetModelNoegle({ envNavn: 'ANTHROPIC_API_KEY' }, NOEGLE), { slags: 'gemt', noegle: 'ANTHROPIC_API_KEY', laengde: NOEGLE.length });
    assert.equal(await s.lager.hent('anthropic'), NOEGLE);
    await assert.rejects(() => s.agent.saetModelNoegle({ envNavn: 'NOGET_ANDET' }, 'x'), /ukendt/);
  });
});

test('status is klar (there is no key to an agent); health needs a key and a passed live test, and calls nothing', async () => {
  let testet = { udbyder: 'anthropic', ok: true } as { udbyder?: string; ok: boolean };
  await med(() => ({ stream: anthropicStream(['a']) }), async (s) => {
    assert.equal(s.agent.mode, 'direkte');
    assert.equal(await s.agent.status(), 'klar');
    assert.equal(await s.agent.health(), false, 'no key yet');
    await s.lager.saet('anthropic', NOEGLE);
    assert.equal(await s.agent.health(), true);
    testet = { udbyder: 'anthropic', ok: false };
    assert.equal(await s.agent.health(), false, 'the live test did not pass');
    testet = { ok: true };
    assert.equal(await s.agent.health(), false, 'no provider chosen');
    assert.equal(s.modtaget.length, 0, 'health never calls the provider');
  }, { testet: async () => testet });
});
