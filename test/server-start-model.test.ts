// KC-0127: Start's step 2 through the app. The pasted key goes to the agent
// (name + length back, never the value), both tiers are tested live through
// the same AgentClient real runs use, and the step is Klaret only when both
// tests passed. A failed or slow model shows a fixed Danish reason. The key is
// in no response, no console line and no file in the data dir. An install like
// kira-home (Done, tiers set, no test) never sees step 2 and nothing touches
// Hermes. From KC-0156: a keyless install starts, answers /health, and step 2
// asks for Clawco's key to Hermes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, lavAgent } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent, type ModelTestUdfald } from '../src/agent/fake.ts';
import { createHermesHttp } from '../src/agent/hermes-http.ts';
import type { AgentClient } from '../src/agent/types.ts';
import { MODEL_TEST } from '../src/agent/prompt.ts';
import { lavAgentNoegleSkriver } from '../src/kilder/hemmeligheder.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { forbiTil } from './helpers/start-forbi.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const NOEGLE = 'sk-ant-test-HEMMELIG-9f8e7d6c5b4a';

type Sut = ReturnType<typeof createApp> & { dir: string; svar: string[]; env: Record<string, string | undefined>; opdag: { url: string; headers: Headers }[] };

/** The discovery stub: Anthropic's model list, the key checked in its header. */
function opdagFetch(opdag: Sut['opdag']): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    opdag.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-4-1' }] }), { status: 200 });
  }) as typeof fetch;
}

async function medApp(o: { hermes?: AgentClient; udfald?: ModelTestUdfald; person?: Person; testMs?: number; env?: Record<string, string | undefined>; foer?: (dir: string) => Promise<void> }, fn: (s: Sut) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-model-'));
  try {
    await forbiTil(dir, 'velkommen'); // KC-0247: step 2 is the open step
    await o.foer?.(dir);
    const svar: string[] = [];
    const opdag: Sut['opdag'] = [];
    const env: Record<string, string | undefined> = o.env ?? {};
    const hermes = o.hermes ?? createFakeAgent({ modelTest: () => o.udfald ?? 'klar' });
    const app = createApp({
      store: createFileStore(dir), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: o.person ?? EJER },
      model: { fetchImpl: opdagFetch(opdag), testMs: o.testMs ?? 2000, miljoe: { fil: path.join(dir, 'clawco.env'), env } },
    });
    await fn({ ...app, dir, svar, env, opdag });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function post(s: Sut, url: string, body: unknown = {}): Promise<Response> {
  const res = await s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  s.svar.push(await res.clone().text());
  return res;
}
async function koer(s: Sut, aktion: string, body: unknown) {
  const res = await post(s, `/api/rum/start/aktion/${aktion}`, body);
  const tekst = await res.text();
  assert.equal(res.status, 202, tekst);
  const r = await s.runs.get((JSON.parse(tekst) as { runId: string }).runId)!.finished;
  s.svar.push(JSON.stringify(r));
  return r;
}
async function side(s: Sut, url: string): Promise<string> {
  const h = await (await s.app.request(url)).text();
  s.svar.push(h);
  return h;
}
const indstillinger = async (s: Sut) => (await (await s.app.request('/api/indstillinger')).json()) as { udbyder?: string; modeller: Record<string, string>; modelTest?: Record<string, { ok: boolean; ms: number; fejl?: string }> };
const modelKort = (h: string): string => /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

/** Everything written to the console while `fn` runs. */
async function konsol<T>(fn: () => Promise<T>): Promise<{ ud: string; svar: T }> {
  const linjer: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { linjer.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')); };
  try { return { svar: await fn(), ud: linjer.join('\n') }; } finally { Object.assign(console, gemt); }
}
async function alleFiler(dir: string): Promise<string> {
  const ud: string[] = [];
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) ud.push(await readFile(path.join(f.parentPath, f.name), 'utf8'));
  return ud.join('\n');
}

test('success: the key goes to the agent, both tiers pass live, the step is Klaret, and the key is nowhere', async () => {
  const hermes = createFakeAgent();
  await medApp({ hermes }, async (s) => {
    const { ud } = await konsol(async () => {
      const r = await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
      assert.match(r.result?.text ?? '', /Virker/);
    });
    assert.deepEqual(hermes.noegler, [{ envNavn: 'ANTHROPIC_API_KEY', laengde: NOEGLE.length }]);
    assert.equal(s.opdag[0]?.headers.get('x-api-key'), NOEGLE, 'discovery on the server, key in the header');
    const st = await indstillinger(s);
    assert.equal(st.udbyder, 'anthropic');
    assert.deepEqual(st.modeller, { lille: 'claude-haiku-5-5', taenker: 'claude-sonnet-5-5' });
    assert.equal(st.modelTest?.['lille']?.ok, true);
    assert.equal(st.modelTest?.['taenker']?.ok, true);
    const tests = hermes.calls.filter((c) => c.instructions === MODEL_TEST.instructions);
    assert.deepEqual(tests.map((c) => [c.model, c.provider]), [['claude-haiku-5-5', 'anthropic'], ['claude-sonnet-5-5', 'anthropic']]);
    const kort = modelKort(await side(s, '/rum/start'));
    assert.match(kort, /data-trin-status="klaret"/);
    assert.match(kort, /data-model-test="ok"/);
    assert.ok(kort.includes(`Gemt (${NOEGLE.length} tegn)`), 'only the length comes back');
    assert.match(kort, /<option value="claude-opus-4-1"/, 'the discovered names are offered');
    assert.ok(!/value="sk-ant/.test(kort), 'the field is write-only');
    for (const t of s.svar) assert.ok(!t.includes(NOEGLE), 'no response carries the key');
    assert.ok(!ud.includes(NOEGLE), 'no console line carries the key');
    assert.ok(!(await alleFiler(s.dir)).includes(NOEGLE), 'no file in the data dir carries the key');
  });
});

test('401: a rejected key leaves the step open and says so in Danish, without the provider text', async () => {
  await medApp({ udfald: '401' }, async (s) => {
    await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
    const st = await indstillinger(s);
    assert.equal(st.modelTest?.['lille']?.ok, false);
    assert.equal(st.modelTest?.['lille']?.fejl, 'noegle');
    const kort = modelKort(await side(s, '/rum/start'));
    assert.doesNotMatch(kort, /data-trin-status="klaret"/);
    assert.match(kort, /data-model-test="fejl"/);
    assert.match(kort, /Nøglen er afvist\./);
    assert.doesNotMatch(kort, /x-api-key|Error code/);
    for (const t of s.svar) assert.ok(!t.includes(NOEGLE));
  });
});

test('timeout: a model that never answers is stopped and reported as too slow', async () => {
  await medApp({ udfald: 'timeout', testMs: 40 }, async (s) => {
    await post(s, '/api/indstillinger', { modeller: { lille: 'qwen3:8b', taenker: 'qwen3:14b' } });
    const r = await koer(s, 'model-test', { tier: 'lille' });
    assert.equal(r.result?.text, 'Modellen svarede ikke inden for 20 sekunder.');
    const st = await indstillinger(s);
    assert.equal(st.modelTest?.['lille']?.fejl, 'tid');
    assert.match(modelKort(await side(s, '/rum/start')), /Modellen svarede ikke inden for 20 sekunder\./);
  });
});

test('model-test retests one tier; a changed model makes the old test stale', async () => {
  await medApp({}, async (s) => {
    await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
    assert.match(modelKort(await side(s, '/rum/start')), /data-trin-status="klaret"/);
    await post(s, '/api/indstillinger', { modeller: { lille: 'claude-haiku-5-5', taenker: 'claude-opus-4-1' } }); // the Kø panel, the same store
    const kort = modelKort(await side(s, '/rum/start'));
    assert.doesNotMatch(kort, /data-trin-status="klaret"/, 'another thorough model: tested again before Klaret');
    await koer(s, 'model-test', { tier: 'taenker' });
    assert.match(modelKort(await side(s, '/rum/start')), /data-trin-status="klaret"/);
    assert.equal((await post(s, '/api/rum/start/aktion/model-test', { tier: 'stor' })).status, 400);
    assert.equal((await post(s, '/api/rum/start/aktion/model-gem', { udbyder: 'ukendt', noegle: 'x' })).status, 400);
  });
});

test('a local model: no key, the address goes to the agent (normalised), discovery under it', async () => {
  const hermes = createFakeAgent();
  await medApp({ hermes }, async (s) => {
    await koer(s, 'model-gem', { udbyder: 'ollama', url: '' });
    assert.deepEqual(hermes.noegler, [{ envNavn: 'CUSTOM_BASE_URL', laengde: 'http://127.0.0.1:11434/v1'.length }]);
    assert.equal(s.opdag[0]?.url, 'http://127.0.0.1:11434/v1/models');
    assert.equal((await indstillinger(s)).udbyder, 'ollama');
  });
});

test('only the owner may set the model', async () => {
  await medApp({ person: MEDLEM }, async (s) => {
    assert.equal((await post(s, '/api/rum/start/aktion/model-gem', { udbyder: 'anthropic', noegle: NOEGLE })).status, 400);
  });
});

test('Hermes on another host: the card shows the one command to run there, with a copy button, never the key', async () => {
  const sund = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const hermes = createHermesHttp({ baseUrl: 'http://hermes', apiKey: 'k', fetchImpl: sund, noegler: {} });
  await medApp({ hermes }, async (s) => {
    await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
    const kort = modelKort(await side(s, '/rum/start'));
    assert.match(kort, /data-kopier="read -rsp/);
    assert.match(kort, /ANTHROPIC_API_KEY/);
    for (const t of s.svar) assert.ok(!t.includes(NOEGLE));
  });
});

test('kira-home: Done recorded, tiers set, no test — Start stays away and nothing touches Hermes', async () => {
  let genstart = 0;
  const hermesEnv = path.join(tmpdir(), `kc-hermes-env-${process.pid}-${Date.now()}`);
  const sund = (async () => new Response('{"status":"ok"}', { status: 200 })) as typeof fetch;
  const hermes = createHermesHttp({ baseUrl: 'http://hermes', apiKey: 'k', fetchImpl: sund, noegler: { skriv: lavAgentNoegleSkriver(hermesEnv, ['ANTHROPIC_API_KEY']), genstart: async () => { genstart += 1; } } });
  await medApp({
    hermes,
    foer: async (dir) => {
      await writeFile(path.join(dir, 'indstillinger.json'), JSON.stringify({ modeller: { lille: 'claude-haiku-5.5', taenker: 'claude-sonnet-5.5' }, stemme: {} }));
      const start = path.join(dir, 'rum', 'start');
      await import('node:fs/promises').then((f) => f.mkdir(start, { recursive: true }));
      await writeFile(path.join(start, 'state.json'), JSON.stringify({ startet: '2026-10-01T06:50:00.000Z', trin: {}, afvist: {}, faerdig: '2026-10-01T06:50:00.000Z' }));
    },
  }, async (s) => {
    assert.equal((await s.app.request('/')).headers.get('location'), '/rum/hjem');
    const hjem = await side(s, '/rum/hjem');
    assert.ok(!/<li><a href="\/rum\/start"/.test(hjem), 'Start not in the nav');
    assert.ok(!/Start: Vælg din model/.test(hjem), 'nothing of Start in Nu');
    await side(s, '/rum/start');
    await s.app.request('/health');
    assert.equal(genstart, 0);
    await assert.rejects(readFile(hermesEnv, 'utf8'), 'Hermes\' env file untouched');
    assert.deepEqual((await indstillinger(s)).modeller, { lille: 'claude-haiku-5.5', taenker: 'claude-sonnet-5.5' });
  });
});

test('keyless install (KC-0156): the agent is built, /health answers, step 2 asks for the key to Hermes', async () => {
  const agent = lavAgent({ KC_AGENT: 'hermes-http', KC_HERMES_URL: 'http://127.0.0.1:9' });
  assert.equal(await agent.status(), 'mangler-noegle');
  await medApp({ hermes: agent }, async (s) => {
    const res = await s.app.request('/health');
    assert.equal(res.status, 200);
    const h = (await res.json()) as { ok: boolean; agent: { reachable: boolean; status: string } };
    assert.deepEqual([h.ok, h.agent.reachable, h.agent.status], [true, false, 'mangler-noegle']);
    const kort = modelKort(await side(s, '/rum/start'));
    assert.match(kort, /data-trin-status="ikke-startet"/);
    assert.match(kort, /id="model-agent-form"/);
    assert.match(kort, /Clawco har ingen nøgle til Hermes endnu/);
  });
});

test('the key to Hermes entered in step 2 is saved (0600) and the same agent uses it without a restart', async () => {
  const env: Record<string, string | undefined> = {};
  const agent = lavAgent({ KC_AGENT: 'hermes-http', KC_HERMES_URL: 'http://127.0.0.1:9' }, { env });
  await medApp({ hermes: agent, env }, async (s) => {
    await koer(s, 'model-agent-noegle', { noegle: 'hermes-api-noegle-123' });
    assert.equal(await agent.status(), 'utilgaengelig', 'the same client now has a key (and nothing answers on port 9)');
    assert.equal(s.env['KC_HERMES_API_KEY'], 'hermes-api-noegle-123');
    assert.match(await readFile(path.join(s.dir, 'clawco.env'), 'utf8'), /^KC_HERMES_API_KEY=hermes-api-noegle-123$/m);
    assert.ok(!s.svar.some((t) => t.includes('hermes-api-noegle-123')));
  });
});
