import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { falskeKilder, type FalskData } from '../../src/kilder/falsk/falsk.ts';
import { byggPrompt } from '../../src/agent/prompt.ts';
import { MASKE, nulstilRegistrerede } from '../../src/graenser/redaktion.ts';
import type { Person } from '../../src/identitet/husstand.ts';

// KC-0125 invariant (§0 r2): no secret value appears in a prompt, a log line, a run text, an API answer or a data file
// outside the one secret folder. Dummy secrets exist only in this test.
const NOW = new Date('2026-11-01T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MILJOE = {
  KC_HERMES_API_KEY: 'dummy-hermes-nøgle-aaaa1111',
  KC_ELEVENLABS_API_KEY: 'dummy-eleven-nøgle-bbbb2222',
  KC_GOOGLE_CLIENT_SECRET: 'dummy-google-hemmelig-cccc3333',
  KC_MODEL_NOEGLE_ANTHROPIC: 'dummy-model-nøgle-dddd4444',
};
const KILDE_PW = 'dummy-imap-adgangskode-eeee5555';
const KILDE_NOEGLE = 'dummy-beskeds-nøgle-ffff6666';
const ALLE = [...Object.values(MILJOE), KILDE_PW, KILDE_NOEGLE];
const DATA: FalskData = {
  kalender: () => ({ generated: NOW.toISOString(), days: [{ date: '2026-11-01', events: [{ title: 'Stand-up' }] }], errors: [] }),
  mail: () => [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: NOW.toISOString(), laest: false, flag: false, vedhaeftning: false }],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};

let dir = '';
let sut: ReturnType<typeof createApp>;
let hermes: ReturnType<typeof createFakeAgent>;
const gemt: Record<string, string | undefined> = {};
const post = (url: string, b: unknown = {}) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const lækker = (tekst: string, hvad: string): void => { for (const v of ALLE) assert.ok(!tekst.includes(v), `${hvad} holds a secret value`); };

before(async () => {
  nulstilRegistrerede();
  for (const [k, v] of Object.entries(MILJOE)) { gemt[k] = process.env[k]; process.env[k] = v; }
  dir = await mkdtemp(path.join(tmpdir(), 'kc-ingen-hemmeligheder-'));
  // Hermes fails the way a real client can: its message carries the key it was called with.
  hermes = createFakeAgent({ answer: () => { throw new Error(`Hermes afviste kørslen: 401 (key ${MILJOE.KC_HERMES_API_KEY}, ${KILDE_PW})`); } });
  sut = createApp({
    store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: EJER },
    kilder: falskeKilder({ data: DATA }),
  });
  assert.equal((await post('/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'ella', adgangskode: KILDE_PW } })).status, 200);
  assert.equal((await post('/api/kilder/falsk-beskeder/forbind', { felter: { noegle: KILDE_NOEGLE } })).status, 200);
  assert.equal((await post('/api/indstillinger', { modeller: { lille: 'claude-haiku-5.5' } })).status < 500, true);
});
after(async () => {
  nulstilRegistrerede();
  for (const [k, v] of Object.entries(gemt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(dir, { recursive: true, force: true });
});

async function filer(rod: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(rod, { withFileTypes: true })) {
    const p = path.join(rod, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p))); else ud.push(p);
  }
  return ud;
}

test('secrets live only in the secret folder (0600) — every other data file holds names and ids only', async () => {
  const alle = await filer(dir);
  const hemmelige = alle.filter((f) => f.includes(`${path.sep}hemmeligheder${path.sep}`));
  assert.ok(hemmelige.length >= 2, 'the connector credentials are stored');
  for (const f of hemmelige) assert.equal((await stat(f)).mode & 0o777, 0o600, f);
  const andre = alle.filter((f) => !hemmelige.includes(f));
  assert.ok(andre.some((f) => f.endsWith('kilder.json')), 'kilder.json exists (names and ids)');
  for (const f of andre) {
    // An atomic write in flight (tmp file + rename, AGENTS §4.5; e.g. the health poll's helbred.json) can vanish between
    // the listing and the read; its content lands in the real file, which is read here too.
    let tekst: string;
    try { tekst = await readFile(f, 'utf8'); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && /\.tmp-/.test(path.basename(f))) continue;
      throw err;
    }
    lækker(tekst, path.relative(dir, f));
  }
});

test('/health, /api/indstillinger, /api/kilder and the pages never echo a secret', async () => {
  for (const url of ['/health', '/api/indstillinger', '/api/kilder', '/api/koe?kilder=1', '/api/revision', '/api/situation', '/rum/hjem', '/rum/start', '/rum/dagen']) {
    const res = await sut.app.request(url);
    assert.ok(res.status < 500, `${url} → ${res.status}`);
    lækker(await res.text(), url);
  }
});

test('a failing run shows its error without the key — in the queue, the event stream and the ticket-facing run list', async () => {
  const res = await post('/api/rum/dagen/opdater', { mode: 'opdater' });
  const { runId } = (await res.json()) as { runId: string };
  const done = await sut.runs.get(runId)!.finished;
  assert.equal(done.status, 'failed');
  assert.ok(done.error?.includes(MASKE), done.error);
  const koe = await (await sut.app.request('/api/koe')).text();
  lækker(koe, '/api/koe');
  assert.ok(koe.includes(MASKE));
  const events = await (await sut.app.request(`/api/runs/${runId}/events`)).text();
  lækker(events, 'the run event stream');
});

test('a secret typed into a chat, or sitting in a room refresh, never reaches Hermes', async () => {
  const foer = hermes.calls.length;
  await post('/api/rum/dagen/chat', { besked: `her er min nøgle ${MILJOE.KC_HERMES_API_KEY} og ${KILDE_PW}` });
  await post('/api/rum/mail/opdater', { mode: 'opdater' });
  await post('/api/rum/nyheder/opdater', { mode: 'opdater' });
  await new Promise((r) => setTimeout(r, 50));
  const kald = hermes.calls.slice(foer);
  assert.ok(kald.length >= 1, 'something was sent to Hermes');
  for (const k of kald) lækker(`${k.input}\n${k.instructions}`, 'a request to Hermes');
});

test('no prompt module reads the environment or a secret store: a builder cannot produce a secret by construction', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const rod = path.resolve(import.meta.dirname, '../../src');
  const prompts: string[] = [];
  const gaa = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gaa(p); else if (/prompt\.ts$/.test(e.name) || p.endsWith(path.join('import', 'foreslaa.ts'))) prompts.push(p);
    }
  };
  gaa(rod);
  assert.ok(prompts.length >= 10, `found ${prompts.length} prompt modules`);
  for (const f of prompts) {
    const kode = readFileSync(f, 'utf8');
    assert.ok(!/process\.env|\bhemmeligheder\b|laesKildeHemmelighed|noeglelager/.test(kode), `${path.relative(rod, f)} touches the environment or a secret store`);
  }
});

test('the prompt builder itself, with every secret in the environment, produces none', () => {
  const p = byggPrompt({ rum: 'mail', zone: 'privat', opgave: 'Sorter indbakken.', data: [{ kilde: 'mail', zone: 'privat', tillid: 'utroet', tekst: 'Hej fra Clara' }] });
  lækker(`${p.input}\n${p.instructions}`, 'byggPrompt');
});
