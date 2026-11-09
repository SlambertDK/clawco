// KC-0263: Start's step 2 under the built-in agent (KC_AGENT=direkte) offers GitHub Copilot again, with "Sign in with
// GitHub" instead of a key field: the short code and the link, a calm wait, then "Signed in as <login>" and the live
// test of both tiers. Owner-only; the token lives only in the encrypted store and never reaches a page, a run result,
// the room's files or the log; the device code never leaves the server. A fake GitHub and a fake Copilot runtime answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, githubKlientId, lavAgentMedLogin } from '../src/server.ts';
import { GITHUB_KLIENT_ID } from '../src/agent/github-enhed.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { FALSK_ENHED, FALSK_KODE, FALSK_TOKEN, falskCopilotKlient, falskGithubFetch } from './helpers/falsk-copilot.ts';
import { forbiTil } from './helpers/start-forbi.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'clara', login: null, navn: 'Clara', rolle: 'medlem' };
const modelKort = (h: string): string => /<article[^>]*data-trin="model"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
/** The device-flow wait, held until the test opens the gate (then every wait passes at once, as if the interval went by). */
function port(): { vent: () => Promise<void>; aabn: () => void } {
  let aaben = false;
  let slip: () => void = () => {};
  const aabnet = new Promise<void>((r) => { slip = r; });
  return { vent: () => (aaben ? Promise.resolve() : aabnet), aabn: () => { aaben = true; slip(); } };
}

async function opsaet(o: { klientId?: string; person?: Person; github?: ReturnType<typeof falskGithubFetch> } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-github-'));
  await forbiTil(dir, 'velkommen'); // KC-0247: step 2 is the open step
  const noeglefil = path.join(dir, '..', `kc-key-github-${randomBytes(4).toString('hex')}`);
  await writeFile(noeglefil, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  const gh = o.github ?? falskGithubFetch();
  const p = port();
  const cp = falskCopilotKlient();
  const ingenModeller = (async () => new Response('{"data":[]}', { status: 200 })) as typeof fetch;
  const env = { KC_AGENT: 'direkte', KC_DATA_DIR: dir, KC_HEMMELIGHEDER_FIL: noeglefil, KC_GITHUB_CLIENT_ID: o.klientId ?? 'Iv1.falsk' };
  const dele = lavAgentMedLogin(env, { env: {}, githubFetch: gh.fetchImpl, githubVent: p.vent, copilotKlient: cp.lavKlient });
  const s = createApp({
    store: createFileStore(dir), hermes: dele.agent, sourceGlob: '/nonexistent/{date}.json', dataDir: dir,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: o.person ?? EJER },
    model: { fetchImpl: ingenModeller, testMs: 5000, miljoe: { fil: path.join(dir, 'clawco.env'), env: {} }, ...(dele.github ? { github: dele.github } : {}) },
  });
  const ryd = async (): Promise<void> => { await dele.github?.faerdig(); await dele.copilot?.stop(); await rm(dir, { recursive: true, force: true }); await rm(noeglefil, { force: true }); };
  /** Lets the wait go on and resolves when the sign-in (and its live test) is over. */
  const godkend = async (): Promise<void> => { p.aabn(); await dele.github?.faerdig(); };
  return { s, dir, gh, cp, dele, ryd: async () => { p.aabn(); await ryd(); }, godkend };
}
type S = Awaited<ReturnType<typeof opsaet>>['s'];
async function koer(s: S, aktion: string, body: unknown = {}): Promise<{ res: Response; tekst: string; faerdig?: { status: string; error?: string; result?: { text?: string; html?: string } } }> {
  const res = await s.app.request(`/api/rum/start/aktion/${aktion}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const tekst = await res.text();
  if (res.status !== 202) return { res, tekst };
  const id = (JSON.parse(tekst) as { runId: string }).runId;
  return { res, tekst, faerdig: (await s.runs.get(id)!.finished) as never };
}
const side = async (s: S): Promise<string> => (await s.app.request('/rum/start')).text();

/** Every file in the data dir as text (the encrypted store is bytes, read too). */
async function alleFiler(dir: string): Promise<string> {
  let ud = '';
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) ud += (await readFile(path.join(f.parentPath, f.name))).toString('latin1');
  return ud;
}

test('direkte: GitHub Copilot is offered with Sign in with GitHub instead of a key field', async () => {
  const t = await opsaet();
  try {
    const kort = modelKort(await side(t.s));
    const valg = [...kort.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(valg, ['anthropic', 'openai', 'copilot', 'openrouter', 'lmstudio', 'ollama']);
    assert.match(kort, /<option value="copilot"[^>]*data-login="github"/, 'the option says it signs in, not a key');
    assert.match(kort, /data-model-felt="github" hidden/, 'the sign-in sits beside the key field, shown when Copilot is chosen');
    assert.match(kort, /data-aktion="github-start"/);
    assert.match(kort, /Log ind med GitHub/);
    assert.doesNotMatch(kort, /github_pat_/, 'no token placeholder under direkte');
  } finally { await t.ryd(); }
});

test('direkte: sign in shows the code and the link, then Signed in as the login, the length and both tiers tested; the token is nowhere', async () => {
  const t = await opsaet({ github: falskGithubFetch({ login: 'henrik-l', ventRunder: 1 }) });
  try {
    const start = await koer(t.s, 'github-start');
    assert.equal(start.faerdig?.status, 'done', start.tekst);
    const html = start.faerdig?.result?.html ?? '';
    const kort = modelKort(html);
    assert.match(kort, new RegExp(`data-github-kode[^>]*>${FALSK_KODE}<`), 'the code, large');
    assert.match(kort, new RegExp(`data-kopier="${FALSK_KODE}"`), 'a copy button');
    assert.match(kort, /href="https:\/\/github\.com\/login\/device"/, 'the link to GitHub');
    assert.match(kort, /data-github="venter"/);
    assert.match(kort, /data-model-felt="github">/, 'shown (Copilot chosen while signing in)');
    assert.ok(!html.includes(FALSK_ENHED), 'the device code never reaches the browser');

    await t.godkend();
    const efter = modelKort(await side(t.s));
    assert.match(efter, /Logget ind som henrik-l/);
    assert.ok(efter.includes(`${FALSK_TOKEN.length} tegn`), 'the length, as for a key');
    assert.match(efter, /data-model-tier="lille" data-model-test="ok"/);
    assert.match(efter, /data-model-tier="taenker" data-model-test="ok"/);
    assert.match(efter, /data-trin-status="klaret"/);
    const cfg = t.cp.klienter[0]!.sessioner[0]!;
    assert.deepEqual(cfg.availableTools, [], 'the live test ran with no tools');
    assert.equal(t.cp.klienter[0]!.valg.gitHubToken, FALSK_TOKEN, 'the runtime got the saved token');

    const page = await side(t.s);
    const filer = await alleFiler(t.dir);
    for (const [hvor, tekst] of [['page', page], ['files', filer], ['run result', JSON.stringify(start)]] as const) {
      assert.ok(!tekst.includes(FALSK_TOKEN), `the token is not in the ${hvor}`);
      assert.ok(!tekst.includes(FALSK_ENHED), `the device code is not in the ${hvor}`);
    }
    assert.ok(!filer.includes('gemmes@ikke.example'), 'nothing of GET /user but the login is stored');
    assert.match(await readFile(path.join(t.dir, 'rum', 'start', 'log.jsonl'), 'utf8'), /henrik-l/);
  } finally { await t.ryd(); }
});

test('direkte: sign out removes the token and stops the client; the card offers Sign in again', async () => {
  const t = await opsaet();
  try {
    await koer(t.s, 'github-start');
    await t.godkend();
    assert.equal(t.cp.klienter.length, 1);
    const ud = await koer(t.s, 'github-ud');
    assert.equal(ud.faerdig?.status, 'done', ud.tekst);
    assert.equal(t.cp.klienter[0]!.stoppet >= 1, true, 'the client is stopped');
    const kort = modelKort(await side(t.s));
    assert.match(kort, /data-aktion="github-start"/);
    assert.doesNotMatch(kort, /Logget ind som/);
    assert.doesNotMatch(kort, /data-trin-status="klaret"/, 'step 2 is open again: the model has no access now');
    assert.match(kort, /data-model-test="fejl"/, 'with the reason on each tier');
    assert.equal((await t.dele.github!.status()).tilstand, 'ude');
  } finally { await t.ryd(); }
});

test('direkte: with GitHub switched off (KC_GITHUB_CLIENT_ID=off) Copilot is not offered at all (KC-0052), and nothing calls GitHub', async () => {
  const t = await opsaet({ klientId: 'off' });
  try {
    const kort = modelKort(await side(t.s));
    assert.doesNotMatch(kort, /<option value="copilot"/, 'no dead choice in the provider list');
    assert.doesNotMatch(kort, /data-github=/);
    assert.doesNotMatch(kort, /data-aktion="github-start"/);
    const start = await koer(t.s, 'github-start');
    assert.ok(start.res.status >= 400 && start.res.status < 500, start.tekst);
    assert.equal(t.gh.kald.length, 0);
  } finally { await t.ryd(); }
});

test('direkte: GitHub refusing the sign-in says so plainly and stores nothing', async () => {
  const t = await opsaet({ github: falskGithubFetch({ svar: 'access_denied' }) });
  try {
    await koer(t.s, 'github-start');
    await t.godkend();
    const kort = modelKort(await side(t.s));
    assert.match(kort, /data-github="afvist"/);
    assert.match(kort, /data-aktion="github-start"/, 'one button to try again');
    assert.ok(!(await alleFiler(t.dir)).includes(FALSK_TOKEN));
  } finally { await t.ryd(); }
});

test('direkte: only the owner signs in or out', async () => {
  const t = await opsaet({ person: MEDLEM });
  try {
    for (const a of ['github-start', 'github-ud']) {
      const r = await koer(t.s, a);
      assert.ok(r.res.status >= 400 && r.res.status < 500, `${a}: ${r.tekst}`);
    }
    assert.equal(t.gh.kald.length, 0);
  } finally { await t.ryd(); }
});

test('direkte: model-gem for Copilot needs the sign-in; a pasted token is never taken', async () => {
  const t = await opsaet();
  try {
    const r = await koer(t.s, 'model-gem', { udbyder: 'copilot', noegle: FALSK_TOKEN });
    assert.ok(r.res.status >= 400 && r.res.status < 500, r.tekst);
    assert.match(r.tekst, /Log ind med GitHub/);
    assert.ok(!(await alleFiler(t.dir)).includes(FALSK_TOKEN));
    await koer(t.s, 'github-start');
    await t.godkend();
    const igen = await koer(t.s, 'model-gem', { udbyder: 'copilot', lille: 'claude-haiku-5.5', taenker: 'claude-opus-5.5' });
    assert.match(igen.faerdig?.result?.text ?? '', /^Virker/, igen.tekst);
  } finally { await t.ryd(); }
});

test('githubKlientId: Clawco\'s own app by default, an override wins, off switches it off', () => {
  assert.equal(githubKlientId(undefined), GITHUB_KLIENT_ID);
  assert.equal(githubKlientId('  '), GITHUB_KLIENT_ID);
  assert.equal(githubKlientId('Ov23other'), 'Ov23other');
  assert.equal(githubKlientId('off'), '');
});
