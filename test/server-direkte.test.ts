// KC-0180: the whole flow with the direct-model agent (KC_AGENT=direkte) and
// no Hermes: before a key, a room run fails with a Danish sentence (never
// silently); Start's step 2 saves the key ("Gemt (n tegn)"), both tiers pass
// live against a local fake provider, /health turns reachable, and a room run
// answers through the provider. Then every console line, response, run event,
// URL and file in the data dir is searched for the key: it is in none of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, lavAgent } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { MODEL_TEST } from '../src/agent/prompt.ts';
import { MODEL_FEJL } from '../src/rooms/start/modelfejl.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { anthropicStream, startFalskUdbyder } from './helpers/falsk-udbyder.ts';

const NOEGLE = 'sk-ant-test-HEMMELIG-direkte-0180';
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };

test('direkte end to end: no key → a Danish failure; key in Start → live test green, a room run answers; the key is nowhere', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-direkte-'));
  const f = await startFalskUdbyder((m) => {
    if (m.metode === 'GET') return { status: 200, body: JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5' }] }) };
    const system = String(m.body['system'] ?? '');
    return { stream: anthropicStream(system.startsWith(MODEL_TEST.instructions) ? ['klar'] : ['Hej ', 'Henrik.']) };
  });
  // No real provider is ever called: the provider's address is this test's server.
  const omdiriger = ((input: string | URL | Request, init?: RequestInit) => fetch(String(input).replace('https://api.anthropic.com', f.url), init)) as typeof fetch;
  const linjer: string[] = [];
  const svar: string[] = [];
  const events: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { linjer.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')); };
  try {
    const hermes = lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: dir }, { env: {}, fetchImpl: omdiriger });
    assert.equal(hermes.mode, 'direkte');
    const store = createFileStore(dir);
    const s = createApp({
      store, hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: EJER },
      model: { fetchImpl: omdiriger, testMs: 5000, miljoe: { fil: path.join(dir, 'clawco.env'), env: {} } },
    });
    const post = async (url: string, b: unknown): Promise<Response> => {
      const res = await s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      svar.push(await res.clone().text());
      return res;
    };
    const vent = async (res: Response) => {
      const { runId } = (await res.json()) as { runId: string };
      s.runs.subscribe(runId, (e) => events.push(JSON.stringify(e)));
      const r = await s.runs.get(runId)!.finished;
      svar.push(JSON.stringify(r));
      return r;
    };
    const health = async () => {
      const h = (await (await s.app.request('/health')).json()) as { agent: { mode: string; reachable: boolean; status: string } };
      svar.push(JSON.stringify(h));
      return h.agent;
    };

    // Before any key: not reachable, and a room run says why in Danish.
    assert.deepEqual(await health(), { mode: 'direkte', reachable: false, status: 'klar' });
    const foer = await vent(await post('/api/rum/dagen/chat', { besked: 'hej' }));
    assert.equal(foer.status, 'failed');
    assert.equal(foer.error, MODEL_FEJL['model-noegle']);
    assert.equal(f.modtaget.length, 0, 'nothing reached a provider');

    // Start step 2: the key is saved by the agent, both tiers tested live.
    const gem = await vent(await post('/api/rum/start/aktion/model-gem', { udbyder: 'anthropic', noegle: NOEGLE }));
    assert.match(gem.result?.text ?? '', /^Virker/);
    const side = await (await s.app.request('/rum/start')).text();
    svar.push(side);
    const kort = /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(side)?.[0] ?? '';
    assert.match(kort, /data-trin-status="klaret"/);
    assert.ok(kort.includes(`Gemt (${NOEGLE.length} tegn)`));
    const tests = f.modtaget.filter((m) => String(m.body['system'] ?? '').startsWith(MODEL_TEST.instructions));
    assert.deepEqual(tests.map((m) => m.body['model']), ['claude-haiku-4-5', 'claude-sonnet-4-5']);
    assert.equal(tests[0]!.headers['x-api-key'], NOEGLE, 'the key went to the provider, in its header');
    assert.deepEqual(await health(), { mode: 'direkte', reachable: true, status: 'klar' });

    // A room run answers through the provider, streamed.
    const efter = await vent(await post('/api/rum/dagen/chat', { besked: 'hvad nu?' }));
    assert.equal(efter.status, 'done', efter.error);
    assert.ok(events.some((e) => e.includes('"delta"') && e.includes('Henrik.')), 'the answer streamed');
    assert.ok((await store.readChat('dagen', 10)).some((c) => c.fra === 'hermes' && c.tekst.includes('Hej Henrik.')));

    // The invariant: the key is in no log line, response, event, URL or file.
    const filer: string[] = [];
    for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) filer.push(await readFile(path.join(e.parentPath, e.name), 'utf8'));
    for (const [hvor, tekst] of [['console', linjer.join('\n')], ['responses', svar.join('\n')], ['events', events.join('\n')], ['urls', f.modtaget.map((m) => m.sti).join('\n')], ['data dir', filer.join('\n')]] as const) {
      assert.ok(!tekst.includes(NOEGLE) && !tekst.includes('HEMMELIG'), `the key is not in ${hvor}`);
    }
  } finally {
    Object.assign(console, gemt);
    await f.luk();
    await rm(dir, { recursive: true, force: true });
  }
});
