import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

const fixture = readFileSync(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-26T06:30:00Z');
const dagen = { dato: '2026-10-26', treLinjer: ['A', 'B', 'C'], anbefaling: { tekst: 'Gør X.' }, kalender: [], morgenavis: [], hermesStatus: 'Ny status' };
let dir = '';
let startet = 0;
let sut = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent(), sourceGlob: '/nonexistent/{date}.json', now: () => NOW });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-live-'));
  startet = Date.now();
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes: createFakeAgent({ answer: () => '```json\n' + JSON.stringify(dagen) + '\n```' }), sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', now: () => NOW });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('fragment returns the room markup, counts, status and version; unknown rooms are 404', async () => {
  const res = await sut.app.request('/api/rum/dagen/fragment');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { html: string; venter: Record<string, number>; hermesStatus: string; version: number };
  assert.match(body.html, /data-opdater="hent"/);
  // KC-0071: versions start at the process's start time, so a restarted server never repeats
  // a version an open page already showed (the page would miss what changed).
  assert.ok(body.version >= startet, `version ${body.version} starts at the process start`);
  assert.equal((await sut.app.request('/api/rum/bank/fragment')).status, 404);
});

test('a finished run bumps the version and the live stream announces it', async () => {
  const live = await sut.app.request('/api/rum/dagen/live');
  assert.equal(live.headers.get('content-type')?.split(';')[0], 'text/event-stream');
  const reader = live.body!.getReader();
  const res = await sut.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  const { runId } = (await res.json()) as { runId: string };
  const done = await sut.runs.get(runId)!.finished;
  assert.equal(done.status, 'done', done.error);
  let text = '';
  const deadline = Date.now() + 2000;
  while (!text.includes('event: changed') && Date.now() < deadline) {
    const { value, done: end } = await reader.read();
    if (end) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  const v = Number(/event: changed\ndata: \{"version":(\d+)/.exec(text)?.[1]);
  assert.ok(v > startet, `changed carries a version above the start (${v})`);
  const frag = (await (await sut.app.request('/api/rum/dagen/fragment')).json()) as { version: number; hermesStatus: string };
  assert.ok(frag.version >= 1, 'start, end and the room render each bump the version (KC-0064)');
  assert.equal(frag.hermesStatus, 'Ny status');
});

// KC-0064: rooms hear when a run starts and ends, and a room's I gang band is the registry's truth.
async function lukketApp(opts: { fejl?: boolean } = {}) {
  let aabn!: () => void;
  const port = new Promise<void>((res) => { aabn = res; });
  const fake = createFakeAgent({ answer: () => { if (opts.fejl) throw new Error('Hermes er nede'); return '```json\n' + JSON.stringify(dagen) + '\n```'; } });
  const hermes = { ...fake, run: async (req: Parameters<typeof fake.run>[0]) => { await port; return fake.run(req); } };
  const store = createFileStore(path.join(dir, `data-${Math.random()}`));
  const app = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', now: () => NOW });
  await store.writeState('dagen', dagen);
  const version = async (rum: string) => ((await (await app.app.request(`/api/rum/${rum}/fragment`)).json()) as { version: number }).version;
  const fragment = async (rum: string) => ((await (await app.app.request(`/api/rum/${rum}/fragment`)).json()) as { html: string }).html;
  const post = async (url: string, body: unknown) => ((await (await app.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { runId: string }).runId;
  return { app, aabn, version, fragment, post };
}

test('KC-0064: a room run\'s start and end bump the room\'s and Hjem\'s version', async () => {
  const t = await lukketApp();
  const [d0, h0] = [await t.version('dagen'), await t.version('hjem')];
  const id = await t.post('/api/rum/dagen/opdater', { mode: 'opdater' });
  const [d1, h1] = [await t.version('dagen'), await t.version('hjem')];
  assert.ok(d1 > d0 && h1 > h0, 'start bumps both');
  assert.deepEqual(t.app.runs.igang('dagen').map((r) => r.label), ['Dagen: bygger rummet']);
  assert.match(await t.fragment('dagen'), /data-run="[^"]+"[\s\S]*Dagen: bygger rummet/);
  t.aabn();
  await t.app.runs.get(id)!.finished;
  assert.ok((await t.version('dagen')) > d1 && (await t.version('hjem')) > h1, 'end bumps both');
});

test('KC-0064: a failed run leaves no I gang row', async () => {
  const t = await lukketApp({ fejl: true });
  const id = await t.post('/api/rum/dagen/opdater', { mode: 'opdater' });
  const mens = await t.version('dagen');
  assert.equal(t.app.runs.igang('dagen').length, 1);
  t.aabn();
  assert.equal((await t.app.runs.get(id)!.finished).status, 'failed');
  assert.deepEqual(t.app.runs.igang('dagen'), []);
  assert.ok((await t.version('dagen')) > mens);
  assert.doesNotMatch(await t.fragment('dagen'), /data-run=/);
});

test('KC-0064: a chat answer is never I gang', async () => {
  const t = await lukketApp();
  const v0 = await t.version('dagen');
  const id = await t.post('/api/rum/dagen/chat', { besked: 'hej' });
  assert.deepEqual(t.app.runs.igang('dagen'), []);
  assert.deepEqual(t.app.runs.igang(null), []);
  assert.equal(await t.version('dagen'), v0);
  t.aabn();
  await t.app.runs.get(id)!.finished;
});
