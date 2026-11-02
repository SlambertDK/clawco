// KC-0082: the same handling never runs twice at once — a second press (another tab, the phone and the laptop,
// a double tap before the button greys out) joins the run that is already going instead of starting a new one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';

const fixture = readFileSync(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-26T06:30:00Z');
const dagenJson = {
  dato: '2026-10-26', treLinjer: ['Mødet kl. 10 er det vigtigste.', 'Kl. 13 er ledig.', 'Regn fra 11.'],
  anbefaling: { tekst: 'Brug kl. 13 på udkastet.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret kalenderblok 13-14 "Udkast".', fortryd: 'Slet kalenderblokken 13-14 "Udkast".' } },
  kalender: [{ tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', status: 'klar', handling: { label: 'Forbered', instruktion: 'Saml materialet til mødet kl. 10.' } }],
  morgenavis: [],
  hermesStatus: 'Holder øje med kalenderen',
};
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('"treLinjer": ["linje 1"')) return '```json\n' + JSON.stringify(dagenJson) + '\n```';
  return 'Jeg oprettede blokken kl. 13.';
}

let dir = '';
let hermes = createFakeAgent({ answer, delayMs: 60 });
let sut: ReturnType<typeof createApp>;
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen himalaya i tests' }), mailStateDir: '/nonexistent' };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-engang-'));
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  hermes = createFakeAgent({ answer, delayMs: 60 });
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NOW, sha: 'abc123', ...noMail });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function post(url: string, body?: unknown): Promise<{ status: number; runId: string }> {
  const res = await sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const j = await res.json() as { runId: string };
  return { status: res.status, runId: j.runId };
}
async function vent(runId: string) { return sut.runs.get(runId)!.finished; }

test('two presses of Opdater while the first runs give one run', async () => {
  const kald = hermes.calls.length;
  const [a, b] = await Promise.all([post('/api/rum/dagen/opdater', { mode: 'opdater' }), post('/api/rum/dagen/opdater', { mode: 'opdater' })]);
  assert.equal(a.status, 202); assert.equal(b.status, 202);
  assert.equal(b.runId, a.runId);
  assert.equal((await vent(a.runId)).status, 'done');
  assert.equal(hermes.calls.length - kald, 1);
});

test('the same handling pressed twice joins the running one; a different mode is its own run', async () => {
  const kald = hermes.calls.length;
  const a = await post('/api/rum/dagen/handlinger/blok-13');
  const b = await post('/api/rum/dagen/handlinger/blok-13');
  const hent = await post('/api/rum/dagen/opdater', { mode: 'hent' });
  assert.equal(b.runId, a.runId);
  assert.notEqual(hent.runId, a.runId);
  await Promise.all([vent(a.runId), vent(hent.runId)]);
  assert.equal(hermes.calls.length - kald, 2);
});

test('once the run is finished, the next press starts a new one', async () => {
  const a = await post('/api/rum/dagen/handlinger/blok-13');
  await vent(a.runId);
  const b = await post('/api/rum/dagen/handlinger/blok-13');
  assert.notEqual(b.runId, a.runId);
  await vent(b.runId);
});

test('an action with a different body is a different press', async () => {
  const a = await post('/api/rum/dagen/opdater', { mode: 'opdater' });
  const b = await post('/api/rum/dagen/opdater', { mode: 'hent' });
  assert.notEqual(b.runId, a.runId);
  await Promise.all([vent(a.runId), vent(b.runId)]);
});
