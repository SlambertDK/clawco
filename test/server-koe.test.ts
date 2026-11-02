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
const dagen = { dato: '2026-10-26', treLinjer: ['A'], anbefaling: { tekst: 'Gør X.' }, kalender: [], morgenavis: [], hermesStatus: 'S' };
let dir = '';
let sut = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent(), sourceGlob: '/nonexistent/{date}.json', now: () => NOW });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-koe-'));
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes: createFakeAgent({ answer: () => '```json\n' + JSON.stringify(dagen) + '\n```', delayMs: 20 }), sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', now: () => NOW });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('the queue lists runs with room, label and status, and the global live stream announces finished runs', async () => {
  const live = await sut.app.request('/api/live');
  assert.equal(live.headers.get('content-type')?.split(';')[0], 'text/event-stream');
  const reader = live.body!.getReader();
  const res = await sut.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  const { runId } = (await res.json()) as { runId: string };
  let koe = (await (await sut.app.request('/api/koe')).json()) as { runs: { id: string; room: string; label: string; status: string }[] };
  assert.equal(koe.runs[0]?.id, runId);
  assert.equal(koe.runs[0]?.room, 'dagen');
  assert.match(koe.runs[0]?.label ?? '', /Dagen/);
  const done = await sut.runs.get(runId)!.finished;
  assert.equal(done.status, 'done', done.error);
  let text = '';
  const deadline = Date.now() + 2000;
  while (!text.includes('event: run.done') && Date.now() < deadline) {
    const { value, done: end } = await reader.read();
    if (end) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  assert.match(text, /event: run\.done\ndata: \{"id":"kc_[^"]+","room":"dagen","label":"[^"]*Dagen[^"]*","status":"done"/);
  koe = (await (await sut.app.request('/api/koe')).json()) as typeof koe;
  assert.equal(koe.runs[0]?.status, 'done');
});

test('the shell has the queue button and panel', async () => {
  const page = await (await sut.app.request('/rum/hjem')).text();
  assert.match(page, /id="koe-toggle"/);
  assert.match(page, /id="koe-panel"/);
});

test('KC-0100: the queue tells when each run began and what time the server thinks it is', async () => {
  const res = await sut.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  const { runId } = (await res.json()) as { runId: string };
  await sut.runs.get(runId)!.finished;
  const koe = (await (await sut.app.request('/api/koe')).json()) as { nu: number; runs: { id: string; begyndt: number | null; label: string }[] };
  assert.equal(koe.nu, NOW.getTime());
  const r = koe.runs.find((x) => x.id === runId)!;
  assert.equal(r.begyndt, NOW.getTime());
  assert.match(r.label, /^Dagen: /);
});

test('KC-0100: a run with no room label gets a Danish label, never its bare kind', async () => {
  const run = sut.runs.start({ kind: 'kurator', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({}) });
  await run.finished;
  const koe = (await (await sut.app.request('/api/koe')).json()) as { runs: { id: string; label: string }[] };
  assert.equal(koe.runs.find((x) => x.id === run.id)?.label, 'ordner kortene');
});
