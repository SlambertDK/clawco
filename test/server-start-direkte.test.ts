// KC-0245: Start's step 2 for a self-hoster who runs the built-in agent (KC_AGENT=direkte): no Hermes anywhere in
// the step, no provider that only works through Hermes, local models offered, and the pasted key survives a restart
// when the installer's key file (KC_HEMMELIGHEDER_FIL) is set. Never a real provider: the fetch goes to a local fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, lavAgent } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { MODEL_TEST } from '../src/agent/prompt.ts';
import type { AgentClient } from '../src/agent/types.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { anthropicStream, startFalskUdbyder } from './helpers/falsk-udbyder.ts';
import { forbiTil } from './helpers/start-forbi.ts';

const NOEGLE = 'sk-ant-test-HEMMELIG-selvhost-0245';
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const modelKort = (h: string): string => /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

async function medFalskUdbyder<T>(fn: (o: { omdiriger: typeof fetch; modtaget: { sti: string }[] }) => Promise<T>): Promise<T> {
  const f = await startFalskUdbyder((m) => {
    if (m.metode === 'GET') return { status: 200, body: JSON.stringify({ data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5' }] }) };
    return { stream: anthropicStream(String(m.body['system'] ?? '').startsWith(MODEL_TEST.instructions) ? ['klar'] : ['Hej.']) };
  });
  const omdiriger = ((input: string | URL | Request, init?: RequestInit) => fetch(String(input).replace('https://api.anthropic.com', f.url), init)) as typeof fetch;
  try { return await fn({ omdiriger, modtaget: f.modtaget }); } finally { await f.luk(); }
}

function app(dir: string, hermes: AgentClient, fetchImpl: typeof fetch): ReturnType<typeof createApp> {
  return createApp({
    store: createFileStore(dir), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: EJER },
    model: { fetchImpl, testMs: 5000, miljoe: { fil: path.join(dir, 'clawco.env'), env: {} } },
  });
}
async function post(s: ReturnType<typeof createApp>, url: string, body: unknown): Promise<Response> {
  return s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function koer(s: ReturnType<typeof createApp>, aktion: string, body: unknown): Promise<{ status: string; error?: string; result?: { text?: string } }> {
  const res = await post(s, `/api/rum/start/aktion/${aktion}`, body);
  const tekst = await res.text();
  assert.equal(res.status, 202, tekst);
  return s.runs.get((JSON.parse(tekst) as { runId: string }).runId)!.finished as never;
}
const side = async (s: ReturnType<typeof createApp>): Promise<string> => (await s.app.request('/rum/start')).text();

test('direkte: step 2 shows the providers that work without Hermes (local models too; Copilot only where GitHub sign-in is set up, KC-0263), and no Hermes wording', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-direkte-'));
  try {
    await forbiTil(dir, 'velkommen'); // KC-0247: step 2 is the open step
    await medFalskUdbyder(async ({ omdiriger }) => {
      const s = app(dir, lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: dir }, { env: {}, fetchImpl: omdiriger }), omdiriger);
      const kort = modelKort(await side(s));
      assert.match(kort, /data-trin-status="(ikke-startet|i-gang)"/, 'step 2 is open, not a dead end');
      assert.match(kort, /id="model-form"/, 'the provider choice, not the Hermes key form');
      const valg = [...kort.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
      assert.deepEqual(valg, ['anthropic', 'openai', 'openrouter', 'lmstudio', 'ollama'], 'no GitHub app here, so no Copilot (server-start-github.test.ts covers it with one)');
      assert.doesNotMatch(kort, /Hermes|API_SERVER_KEY|data-model-agent/, 'no Hermes wording in the step');

      const gem = await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
      assert.match(gem.result?.text ?? '', /^Virker/);
      const efter = modelKort(await side(s));
      assert.match(efter, /data-trin-status="klaret"/);
      assert.ok(efter.includes(`(${NOEGLE.length} tegn)`));
      assert.doesNotMatch(efter, /Hermes/, 'the saved-key line does not say the key went to Hermes');
      assert.doesNotMatch(await readFile(path.join(dir, 'rum', 'start', 'log.jsonl'), 'utf8'), /givet til Hermes/, 'nor does the log');
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('direkte: a pasted Copilot token is refused (KC-0263: GitHub sign-in only) and nothing is saved', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-direkte-'));
  try {
    await forbiTil(dir, 'velkommen'); // KC-0247: step 2 is the open step
    await medFalskUdbyder(async ({ omdiriger, modtaget }) => {
      const s = app(dir, lavAgent({ KC_AGENT: 'direkte', KC_DATA_DIR: dir }, { env: {}, fetchImpl: omdiriger }), omdiriger);
      const res = await post(s, '/api/rum/start/aktion/model-gem', { udbyder: 'copilot', noegle: NOEGLE });
      const tekst = await res.text();
      assert.ok(res.status >= 400 && res.status < 500, tekst);
      assert.match(tekst, /Log ind med GitHub/, tekst);
      assert.equal(modtaget.length, 0, 'nothing reached a provider');
      assert.ok(!(await readdir(dir, { recursive: true })).some((f) => f.endsWith('.enc')), 'no key stored');
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('with another agent Start still offers every provider, Copilot included, and the key line is unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-direkte-'));
  try {
    await forbiTil(dir, 'velkommen'); // KC-0247: step 2 is the open step
    const hermes = createFakeAgent();
    const s = app(dir, hermes, (async () => new Response('{"data":[]}', { status: 200 })) as typeof fetch);
    const valg = [...modelKort(await side(s)).matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(valg.includes('copilot'));
    await koer(s, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
    assert.match(modelKort(await side(s)), /Nøglen er givet til Hermes\. Gemt/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('direkte with the installer\'s key file: the pasted key is stored encrypted and survives a restart; without the key file the store fails closed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-direkte-'));
  const noeglefil = path.join(dir, '..', `kc-key-${Date.now()}`);
  try {
    await writeFile(noeglefil, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
    await medFalskUdbyder(async ({ omdiriger }) => {
      const env = { KC_AGENT: 'direkte', KC_DATA_DIR: dir, KC_HEMMELIGHEDER_FIL: noeglefil };
      const foerste = app(dir, lavAgent(env, { env: {}, fetchImpl: omdiriger }), omdiriger);
      assert.match((await koer(foerste, 'model-gem', { udbyder: 'anthropic', noegle: NOEGLE })).result?.text ?? '', /^Virker/);
      // "Restart": a new agent and a new app on the same folders, nothing in memory.
      const efter = app(dir, lavAgent(env, { env: {}, fetchImpl: omdiriger }), omdiriger);
      const h = (await (await efter.app.request('/health')).json()) as { agent: { mode: string; reachable: boolean } };
      assert.deepEqual([h.agent.mode, h.agent.reachable], ['direkte', true], 'the key was found again');
      assert.match((await koer(efter, 'model-test', { tier: 'lille' })).result?.text ?? '', /Virker/);
      const filer = await readdir(dir, { recursive: true });
      assert.ok(filer.includes('hemmeligheder.enc'));
      for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) assert.ok(!(await readFile(path.join(f.parentPath, f.name), 'utf8')).includes(NOEGLE), `the key is not in ${f.name}`);
      // Without the key file the store cannot be opened (fail closed): not reachable, not a silent empty store.
      const uden = app(dir, lavAgent({ ...env, KC_HEMMELIGHEDER_FIL: `${noeglefil}-findes-ikke` }, { env: {}, fetchImpl: omdiriger }), omdiriger);
      const hu = (await (await uden.app.request('/health')).json()) as { agent: { reachable: boolean } };
      assert.equal(hu.agent.reachable, false);
    });
  } finally { await rm(dir, { recursive: true, force: true }); await rm(noeglefil, { force: true }); }
});
