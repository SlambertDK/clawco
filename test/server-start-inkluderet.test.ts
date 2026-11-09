// KC-0265: Clawco's AI included in a Sky plan, end to end through the app and a fake model proxy (the contract Sky's proxy
// keeps: POST /v1/messages with a bearer token, GET /v1/forbrug, 402 kvote_brugt, 503 ikke_tilgaengelig). A fresh tenant never
// touches step 2: the installation chooses the included AI and tests it, and the card says so in plain words with the month's
// meter; when the allowance is used up Nu shows one calm card; a self-hoster never sees any of it; the token is in no page,
// response, log or file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, lavAgentMedLogin } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createSettings } from '../src/settings.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { anthropicStream, startFalskUdbyder, type FalskSvar, type Modtaget } from './helpers/falsk-udbyder.ts';
import { forbiTil } from './helpers/start-forbi.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'clara', login: null, navn: 'Clara', rolle: 'medlem' };
const TOKEN = 'kc-model-HEMMELIG-0265-0123456789abcdef';

type Proxy = { kvote: boolean; nede: boolean; procent: number; nulstilles: string };

async function opsaet(o: { person?: Person; medProxy?: boolean; utenToken?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-inkl-app-'));
  const noeglefil = path.join(dir, '..', `kc-key-inkl-${randomBytes(4).toString('hex')}`);
  await writeFile(noeglefil, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  const tokenFil = path.join(dir, '..', `kc-model-token-${randomBytes(4).toString('hex')}`);
  if (!o.utenToken) await writeFile(tokenFil, `${TOKEN}\n`);
  const tilstand: Proxy = { kvote: false, nede: false, procent: 12, nulstilles: '2026-12-01' };
  const svar = (m: Modtaget): FalskSvar => {
    if (m.sti === '/v1/forbrug') return { status: 200, body: JSON.stringify({ brugtMikroUsd: 480_000, loftMikroUsd: 4_000_000, procent: tilstand.procent, nulstilles: tilstand.nulstilles, modeller: ['claude-haiku-5-5'] }) };
    if (tilstand.nede) return { status: 503, body: '{"error":{"type":"ikke_tilgaengelig"}}' };
    if (tilstand.kvote) return { status: 402, body: JSON.stringify({ error: { type: 'kvote_brugt' }, nulstilles: tilstand.nulstilles }) };
    return { stream: anthropicStream(['Det virker']) };
  };
  const proxy = await startFalskUdbyder(svar);
  const env: Record<string, string> = { KC_AGENT: 'direkte', KC_DATA_DIR: dir, KC_HEMMELIGHEDER_FIL: noeglefil, ...(o.medProxy === false ? {} : { KC_MODEL_PROXY_URL: proxy.url, KC_MODEL_TOKEN_FIL: tokenFil }) };
  const dele = lavAgentMedLogin(env, { env: {} });
  const s = createApp({
    store: createFileStore(dir), hermes: dele.agent, sourceGlob: '/nonexistent/{date}.json', dataDir: dir,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: o.person ?? EJER },
    model: { fetchImpl: (async () => new Response('{}', { status: 404 })) as typeof fetch, testMs: 5000, miljoe: { fil: path.join(dir, 'clawco.env'), env: {} }, ...(dele.inkluderet ? { inkluderet: dele.inkluderet } : {}) },
  });
  const ryd = async (): Promise<void> => { await proxy.luk(); await rm(dir, { recursive: true, force: true }); await rm(noeglefil, { force: true }); await rm(tokenFil, { force: true }); };
  return { s, dir, tokenFil, proxy, tilstand, dele, ryd };
}
type T = Awaited<ReturnType<typeof opsaet>>;

const side = async (t: T, sti = '/rum/start'): Promise<string> => (await t.s.app.request(sti)).text();
const modelKort = (h: string): string => /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
/** Without the fold that holds the provider form (the quiet link's), which is the one place a key field or a model name may be. */
const udenFold = (h: string): string => h.replace(/<details class="vis-mere">[\s\S]*?<\/details>/g, '');
async function vent(betingelse: () => Promise<boolean>, ms = 5000): Promise<void> {
  const slut = Date.now() + ms;
  while (Date.now() < slut) { if (await betingelse()) return; await new Promise((r) => setTimeout(r, 25)); }
  assert.fail('the condition did not hold in time');
}
async function koer(t: T, aktion: string, body: unknown = {}): Promise<{ res: Response; tekst: string; faerdig?: { status: string; error?: string; result?: { text?: string; html?: string } } }> {
  const res = await t.s.app.request(`/api/rum/start/aktion/${aktion}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const tekst = await res.text();
  if (res.status !== 202) return { res, tekst };
  const id = (JSON.parse(tekst) as { runId: string }).runId;
  return { res, tekst, faerdig: (await t.s.runs.get(id)!.finished) as never };
}
async function alleFiler(dir: string): Promise<string> {
  let ud = '';
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) ud += (await readFile(path.join(f.parentPath, f.name))).toString('latin1');
  return ud;
}
/** A fresh tenant: step 1 is done (the profile), nothing else touched. */
async function klarFoerste(t: T): Promise<void> {
  await forbiTil(t.dir, 'situation'); // KC-0248: step 0 (the pick) is behind us, so steps 1–2 are the ones that show
  await t.s.app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ navn: 'Alma', sprog: 'da', husstand: 'alene' }) });
}
async function klaretPaaEgenHaand(t: T): Promise<string> {
  await side(t); // looking at Start is all it takes
  await vent(async () => /data-trin-status="klaret"/.test(modelKort(await side(t))));
  return modelKort(await side(t));
}

test('a fresh tenant: step 2 is Klaret on its own, in plain words with the meter; no key field, no provider, no model name on the card; the token reaches only the proxy', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    const kort = await klaretPaaEgenHaand(t);
    const synligt = udenFold(kort);
    const plain = /<div data-inkluderet="ok">[\s\S]*$/.exec(synligt)?.[0] ?? '';
    assert.match(synligt, /data-inkluderet="ok"/);
    assert.match(synligt, /Clawcos AI er med i din plan: rolig og hurtig til hverdagen\./);
    assert.match(synligt, /12 % af månedens AI er brugt · starter forfra 1\. december/);
    assert.match(synligt, /data-inkluderet-maaler="12"/);
    assert.doesNotMatch(synligt, /type="password"|name="noegle"|<select|<input/i, 'no field at all on the card');
    assert.doesNotMatch(plain, /haiku|sonnet|opus|Anthropic|OpenAI|Copilot|udbyder|model|nøgle|key/i, 'no key, provider or model name in the words of the card');
    assert.match(kort, /<summary>[\s\S]*Brug den AI, du allerede har/, 'the quiet link');
    assert.match(kort, /<option value="clawco"[^>]*data-clawco-ai[^>]*selected/, 'Clawco\'s AI is the chosen one in the form behind it');
    assert.match(kort, /<option value="anthropic"/, 'and today\'s providers are there');

    // The installation chose, and both tiers passed the normal live test, through the proxy.
    const ind = (await (await t.s.app.request('/api/indstillinger')).json()) as { udbyder?: string; modeller: Record<string, string>; modelTest?: Record<string, { ok: boolean }>; inkluderet?: boolean };
    assert.equal(ind.udbyder, 'clawco');
    assert.deepEqual(ind.modeller, { lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' });
    assert.deepEqual([ind.modelTest?.['lille']?.ok, ind.modelTest?.['taenker']?.ok], [true, true]);
    assert.equal(ind.inkluderet, true);
    const beskeder = t.proxy.modtaget.filter((m) => m.sti === '/v1/messages');
    assert.ok(beskeder.length >= 2, 'one live test per tier');
    for (const m of beskeder) {
      assert.equal(m.headers['authorization'], `Bearer ${TOKEN}`);
      assert.equal(m.headers['x-api-key'], undefined);
      assert.equal(m.body['model'], 'claude-haiku-5-5');
    }

    // The token is in no page, response, log or file.
    const sider = await Promise.all(['/rum/start', '/rum/hjem', '/api/indstillinger', '/health', '/api/koe?kilder=1'].map((p) => side(t, p)));
    for (const h of sider) assert.ok(!h.includes(TOKEN) && !h.includes('HEMMELIG'));
    const filer = await alleFiler(t.dir);
    assert.ok(!filer.includes(TOKEN), 'not copied into the data folder, not into the encrypted store');
    assert.match(await readFile(path.join(t.dir, 'rum', 'start', 'log.jsonl'), 'utf8'), /Clawcos AI, der er med i planen/);
    assert.ok(!(await readFile(path.join(t.dir, 'rum', 'start', 'log.jsonl'), 'utf8')).includes('haiku'), 'the log names no model');
  } finally { await t.ryd(); }
});

test('a self-hosted install (no proxy configured) never sees it: not in the form, nothing chosen on its own, nothing asked of a proxy', async () => {
  const t = await opsaet({ medProxy: false });
  try {
    await klarFoerste(t);
    const kort = modelKort(await side(t));
    assert.doesNotMatch(kort, /clawco|Clawcos AI|data-inkluderet/);
    assert.match(kort, /type="password"/, 'the ordinary form with its key field');
    await t.s.tikNu();
    assert.equal((await (await t.s.app.request('/api/indstillinger')).json() as { udbyder?: string }).udbyder, undefined, 'nothing chosen on its own');
    assert.equal(t.proxy.modtaget.length, 0);
    const r = await koer(t, 'model-gem', { udbyder: 'clawco' });
    assert.equal(r.res.status, 404, r.tekst);
    assert.equal(t.proxy.modtaget.length, 0);
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/);
    assert.doesNotMatch(JSON.stringify(await (await t.s.app.request('/api/koe?kilder=1')).json()), /data-inkluderet-panel/);
  } finally { await t.ryd(); }
});

test('only one of the two values set is none at all; a bad address refuses to start naming only the key', () => {
  assert.equal(lavAgentMedLogin({ KC_AGENT: 'direkte', KC_DATA_DIR: tmpdir(), KC_MODEL_PROXY_URL: 'https://x.example.test/model' }).inkluderet, undefined);
  assert.equal(lavAgentMedLogin({ KC_AGENT: 'direkte', KC_DATA_DIR: tmpdir(), KC_MODEL_TOKEN_FIL: '/x/t' }).inkluderet, undefined);
  assert.throws(() => lavAgentMedLogin({ KC_AGENT: 'direkte', KC_DATA_DIR: tmpdir(), KC_MODEL_PROXY_URL: 'http://hemmelig.example.test/m', KC_MODEL_TOKEN_FIL: '/x/t' }), (e: Error) => /KC_MODEL_PROXY_URL/.test(e.message) && !e.message.includes('hemmelig'));
});

test('a person who chose another AI is left alone: nothing is chosen for them, and Clawco\'s AI is one choice in the list', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    await createSettings(t.dir).setModels({ lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' }, { udbyder: 'anthropic' });
    const kort = modelKort(await side(t));
    await t.s.tikNu();
    assert.equal((await (await t.s.app.request('/api/indstillinger')).json() as { udbyder?: string }).udbyder, 'anthropic');
    assert.equal(t.proxy.modtaget.filter((m) => m.sti === '/v1/messages').length, 0);
    assert.match(kort, /<option value="clawco"/);
    assert.match(kort, /type="password"/);
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/);
    assert.doesNotMatch(JSON.stringify(await (await t.s.app.request('/api/koe?kilder=1')).json()), /data-inkluderet-panel/, 'no meter for an AI that is not in use');
  } finally { await t.ryd(); }
});

test('choosing another provider and back works: the form hides the key and the models for Clawco\'s AI, and whatever it posts for the tiers is not taken', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    await klaretPaaEgenHaand(t);
    await createSettings(t.dir).setModels({ lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' }, { udbyder: 'anthropic' });
    const tilbage = await koer(t, 'model-gem', { udbyder: 'clawco', lille: 'claude-opus-5-5', taenker: 'claude-opus-5-5', noegle: 'sk-ant-IKKE-TAGET' });
    assert.equal(tilbage.faerdig?.status, 'done', tilbage.tekst);
    assert.match(tilbage.faerdig?.result?.text ?? '', /^Virker/);
    const ind = (await (await t.s.app.request('/api/indstillinger')).json()) as { udbyder?: string; modeller: Record<string, string> };
    assert.equal(ind.udbyder, 'clawco');
    assert.deepEqual(ind.modeller, { lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' });
    assert.ok(t.proxy.modtaget.filter((m) => m.sti === '/v1/messages').every((m) => m.body['model'] === 'claude-haiku-5-5'), 'the proxy only ever hears the one model');
    assert.ok(!(await alleFiler(t.dir)).includes('IKKE-TAGET'));
    const kort = modelKort(await side(t));
    assert.match(kort, /data-model-felt="noegle" hidden/);
    assert.match(kort, /data-model-felt="modeller" hidden/);
    assert.match(kort, /data-inkluderet="ok"/);
  } finally { await t.ryd(); }
});

test('the Kø panel: the month\'s meter for the owner while Clawco\'s AI is chosen; the tiers are not shown and cannot be changed there', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    await klaretPaaEgenHaand(t);
    const koe = (await (await t.s.app.request('/api/koe?kilder=1')).json()) as { inkluderet?: string };
    assert.match(koe.inkluderet ?? '', /data-inkluderet-panel/);
    assert.match(koe.inkluderet ?? '', /Clawcos AI i planen/);
    assert.match(koe.inkluderet ?? '', /12 % af månedens AI er brugt/);
    assert.match(await side(t, '/rum/hjem'), /data-tier-felter/, 'the page carries the wrapper the panel hides');
    const efter = await t.s.app.request('/api/indstillinger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modeller: { lille: 'claude-opus-5-5', taenker: 'claude-opus-5-5' } }) });
    const ind = (await efter.json()) as { modeller: Record<string, string> };
    assert.deepEqual(ind.modeller, { lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' });
  } finally { await t.ryd(); }
});

test('used up: the run fails with one fixed sentence; Nu shows ONE calm card with the date and the way to the AI you already have; Start says it too; it goes with a run that works, or another AI', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    await klaretPaaEgenHaand(t);
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/, 'no card while the month has room');
    t.tilstand.kvote = true;
    t.tilstand.procent = 100;
    const r = await koer(t, 'model-test', { tier: 'lille' });
    assert.equal(r.faerdig?.status, 'done');
    assert.match(r.faerdig?.result?.text ?? '', /^Månedens AI, der er med i din plan, er brugt\./, 'the one fixed sentence');
    assert.ok(!JSON.stringify(r).includes(TOKEN));

    const nu = await side(t, '/rum/hjem');
    assert.equal((nu.match(/data-inkluderet-kort="brugt"/g) ?? []).length, 1, 'one card');
    const kortHtml = /<article[^>]*data-inkluderet-kort[\s\S]*?<\/article>/.exec(nu)?.[0] ?? '';
    assert.match(kortHtml, /Månedens AI er brugt/);
    assert.match(kortHtml, /Den starter forfra 1\. december/);
    assert.match(kortHtml, /<a class="btn btn-primary" href="\/rum\/start#model-form" data-inkluderet-egen>Brug den AI, du allerede har<\/a>/);
    assert.doesNotMatch(kortHtml.replace(/<[^>]+>/g, ' '), /haiku|sonnet|opus|nøgle|udbyder|model/i, 'in the words of the card');
    const start = udenFold(modelKort(await side(t)));
    assert.match(start, /data-inkluderet="brugt"/);
    assert.match(start, /Månedens AI er brugt\. Du kan bruge den AI, du allerede har/);
    assert.match(modelKort(await side(t)), /id="model-form"/, 'the provider form is there behind the link');

    // A person who uses another AI no longer has the card.
    await createSettings(t.dir).setModels({ lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' }, { udbyder: 'anthropic' });
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/);
    await createSettings(t.dir).setModels({ lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' }, { udbyder: 'clawco' });
    assert.match(await side(t, '/rum/hjem'), /data-inkluderet-kort="brugt"/, 'back on it, still used up: the card is back');

    // The month starts over: the next run goes through and the card is gone.
    t.tilstand.kvote = false;
    t.tilstand.procent = 1;
    const igen = await koer(t, 'model-test', { tier: 'lille' });
    assert.match(igen.faerdig?.result?.text ?? '', /^Virker/);
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/);
  } finally { await t.ryd(); }
});

test('used up: only the owner is shown the card in Nu', async () => {
  const t = await opsaet({ person: MEDLEM });
  try {
    await klarFoerste(t);
    await createSettings(t.dir).setModels({ lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' }, { udbyder: 'clawco' });
    t.tilstand.kvote = true;
    t.tilstand.procent = 100;
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/);
    assert.doesNotMatch(JSON.stringify(await (await t.s.app.request('/api/koe?kilder=1')).json()), /data-inkluderet-panel/);
  } finally { await t.ryd(); }
});

test('not available (503): a fixed sentence, the existing agent status says utilgaengelig and the card says so calmly, no crash', async () => {
  const t = await opsaet();
  try {
    await klarFoerste(t);
    await klaretPaaEgenHaand(t);
    const foer = (await (await t.s.app.request('/health')).json()) as { agent: { status: string; reachable: boolean } };
    assert.deepEqual([foer.agent.status, foer.agent.reachable], ['klar', true]);
    t.tilstand.nede = true;
    const r = await koer(t, 'model-test', { tier: 'lille' });
    assert.equal(r.faerdig?.status, 'done');
    assert.match(r.faerdig?.result?.text ?? '', /^Clawcos AI er ikke tilgængelig lige nu\./);
    const efter = (await (await t.s.app.request('/health')).json()) as { agent: { status: string; reachable: boolean } };
    assert.deepEqual([efter.agent.status, efter.agent.reachable], ['utilgaengelig', false]);
    assert.match(udenFold(modelKort(await side(t))), /data-inkluderet="utilgaengelig"/);
    assert.doesNotMatch(await side(t, '/rum/hjem'), /data-inkluderet-kort/, 'not the "used up" card: it is not used up');
    t.tilstand.nede = false;
    assert.match((await koer(t, 'model-test', { tier: 'lille' })).faerdig?.result?.text ?? '', /^Virker/);
    assert.equal(((await (await t.s.app.request('/health')).json()) as { agent: { status: string } }).agent.status, 'klar');
  } finally { await t.ryd(); }
});

test('the token file appears after boot: closed until then (step 2 open with the fixed reason and a try-again), then one press makes it Klaret', async () => {
  const t = await opsaet({ utenToken: true });
  try {
    await klarFoerste(t);
    await side(t);
    await vent(async () => /data-inkluderet="fejl"/.test(modelKort(await side(t))));
    const kort = modelKort(await side(t));
    assert.match(udenFold(kort), /Clawcos AI er ikke klar endnu\./);
    assert.match(kort, /data-aktion="model-gem" data-arg="\{&quot;udbyder&quot;:&quot;clawco&quot;\}"/);
    assert.doesNotMatch(kort, /data-trin-status="klaret"/);
    assert.equal(t.proxy.modtaget.filter((m) => m.sti === '/v1/messages').length, 0, 'no request without a token');
    await writeFile(t.tokenFil, `${TOKEN}\n`);
    const igen = await koer(t, 'model-gem', { udbyder: 'clawco' });
    assert.match(igen.faerdig?.result?.text ?? '', /^Virker/, igen.tekst);
    assert.match(modelKort(await side(t)), /data-trin-status="klaret"/);
  } finally { await t.ryd(); }
});

test('English: the card, the meter and Nu say it in English; the fixed sentence of a failed run stays as the run made it', async () => {
  const t = await opsaet();
  try {
    await t.s.app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ navn: 'Alma', sprog: 'en', husstand: 'alene' }) });
    const kort = await klaretPaaEgenHaand(t);
    const synligt = udenFold(kort).replace(/&#39;/g, "'");
    assert.match(synligt, /Clawco's AI is included in your plan: calm and quick for the everyday\./);
    assert.match(synligt, /12% of this month's AI used · starts over 1 December/);
    assert.match(kort, /Use the AI you already have/);
    t.tilstand.kvote = true;
    t.tilstand.procent = 100;
    await koer(t, 'model-test', { tier: 'lille' });
    const nu = (await side(t, '/rum/hjem')).replace(/&#39;/g, "'");
    assert.match(nu, /This month's AI is used up/);
    assert.match(nu, /starts over 1 December/);
    assert.match(nu, /Use the AI you already have/);
  } finally { await t.ryd(); }
});
