import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { udpak } from '../src/agent/udtroet.ts';

const fixture = readFileSync(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-26T06:30:00Z');

const dagenJson = {
  dato: '2026-10-26', treLinjer: ['Mødet kl. 10 er det vigtigste.', 'Kl. 13 er ledig.', 'Regn fra 11.'],
  anbefaling: { tekst: 'Brug kl. 13 på udkastet.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret kalenderblok 13-14 "Udkast".', fortryd: 'Slet kalenderblokken 13-14 "Udkast".' } },
  kalender: [{ tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', status: 'klar', handling: { label: 'Forbered', instruktion: 'Saml materialet til mødet kl. 10.' } }],
  morgenavis: [{ titel: 'Eksempel Energi strammer reserver', hvorfor: 'Relevant for mødet.', kilde: 'Eksempel Energi', url: 'https://example.org/a' }],
  hermesStatus: 'Holder øje med kalenderen',
};

function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('"treLinjer": ["linje 1"')) return 'Her er dagen:\n```json\n' + JSON.stringify(dagenJson) + '\n```';
  if (req.instructions.includes('trykket "Fortryd"')) return 'Jeg slettede blokken igen.';
  if (req.instructions.includes('trykket på knappen')) return 'Jeg oprettede blokken kl. 13.';
  if (req.input.includes('flyt mødet')) return 'Mødet er flyttet.\n```json\n{"opdater": {"kalender": [{"tid": "11.00", "titel": "Driften: vinterberedskab", "status": "flyttet"}]}}\n```';
  return 'Du skal forberede materialet.';
}

let dir = '';
let hermes = createFakeAgent({ answer });
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen himalaya i tests' }), mailStateDir: '/nonexistent' };
let sut = createApp({ store: createFileStore('/nonexistent'), hermes, sourceGlob: '/nonexistent/{date}.json', now: () => NOW, sha: 'abc123', ...noMail });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-srv-'));
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  hermes = createFakeAgent({ answer });
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  sut = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NOW, sha: 'abc123', ...noMail });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function post(url: string, body?: unknown): Promise<Response> {
  return sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
}
async function startAndWait(url: string, body?: unknown) {
  const res = await post(url, body);
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const { runId } = JSON.parse(text) as { runId: string };
  const rec = sut.runs.get(runId);
  assert.ok(rec, 'run registered');
  return { runId, done: await rec.finished };
}

test('GET / redirects to Hjem', async () => {
  const res = await sut.app.request('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/rum/hjem');
});

test('unknown rooms are 404 and every built room renders', async () => {
  assert.equal((await sut.app.request('/rum/bank')).status, 404);
  for (const id of ['dagen', 'mail', 'skrive', 'nyheder']) assert.equal((await sut.app.request(`/rum/${id}`)).status, 200, id);
});

test('GET /health reports sha and Hermes mode', async () => {
  const res = await sut.app.request('/health');
  const body = (await res.json()) as { ok: boolean; sha: string; hermes: { mode: string; reachable: boolean }; agent: { mode: string; reachable: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.sha, 'abc123');
  assert.deepEqual(body.hermes, { mode: 'fake', reachable: true, status: 'klar' });
  assert.deepEqual(body.agent, { mode: 'fake', reachable: true, status: 'klar' }, 'KC-0118: the agent seam reports itself (KC-0127: and why not, when not)');
});

test('Dagen without state shows the empty room with the hent button', async () => {
  const res = await sut.app.request('/rum/dagen');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /data-opdater="hent"/);
});

test('POST opdater builds Dagen from the source file via Hermes and stores state, log and status', async () => {
  const { done } = await startAndWait('/api/rum/dagen/opdater', { mode: 'opdater' });
  assert.equal(done.status, 'done', done.error);
  assert.ok(hermes.calls.at(-1)?.input.includes('Driften: vinterberedskab'), 'trimmed data passed to Hermes');
  assert.match(done.result?.html ?? '', /Mødet kl\. 10 er det vigtigste\./);
  assert.equal(done.result?.hermesStatus, 'Holder øje med kalenderen');
  assert.deepEqual(done.result?.venter, { dagen: 2 });
  const page = await (await sut.app.request('/rum/dagen')).text();
  assert.match(page, /data-handling="blok-13"/);
  assert.match(page, /Hermes byggede Dagen/);
  assert.match(page, /aria-current="page"[^>]*><span>Dagen<\/span><span class="count">2<\/span>/);
});

test('POST opdater with mode hent asks Hermes to run the pipeline', async () => {
  const { done } = await startAndWait('/api/rum/dagen/opdater', { mode: 'hent' });
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /morgenavis_cron\.py/);
});

test('POST opdater with an invalid mode is 400', async () => {
  assert.equal((await post('/api/rum/dagen/opdater', { mode: 'x' })).status, 400);
});

test('an unknown handling is 404; a known one runs its stored instruction and lands in the log with fortryd', async () => {
  assert.equal((await post('/api/rum/dagen/handlinger/nope')).status, 404);
  const { done } = await startAndWait('/api/rum/dagen/handlinger/blok-13');
  assert.equal(done.status, 'done', done.error);
  assert.equal(udpak(hermes.calls.at(-1)?.input ?? '')[0]?.tekst, 'Opret kalenderblok 13-14 "Udkast".'); // KC-0123: an afledt segment
  assert.deepEqual(done.result?.venter, { dagen: 1 });
  const page = await (await sut.app.request('/rum/dagen')).text();
  assert.match(page, /Jeg oprettede blokken kl\. 13\./);
  assert.match(page, /data-fortryd="[^"]+"/);
});

test('fortryd on a log entry runs the stored undo instruction and marks the entry undone', async () => {
  const logText = await readFile(path.join(dir, 'data', 'rum', 'dagen', 'log.jsonl'), 'utf8');
  const entry = logText.trim().split('\n').map((l) => JSON.parse(l) as { id: string; fortryd?: string }).find((e) => e.fortryd);
  assert.ok(entry, 'an undoable entry exists');
  assert.equal((await post('/api/rum/dagen/log/nope/fortryd')).status, 404);
  const { done } = await startAndWait(`/api/rum/dagen/log/${entry.id}/fortryd`);
  assert.equal(done.status, 'done', done.error);
  assert.equal(udpak(hermes.calls.at(-1)?.input ?? '')[0]?.tekst, 'Slet kalenderblokken 13-14 "Udkast".');
  const page = await (await sut.app.request('/rum/dagen')).text();
  assert.match(page, /Fortrudt kl\./);
  assert.doesNotMatch(page, new RegExp(`data-fortryd="${entry.id}"`));
  assert.match(page, /Jeg slettede blokken igen\./);
});

test('chat stores both sides, passes the context, and an {"opdater"} answer changes the room', async () => {
  assert.equal((await post('/api/rum/dagen/chat', { besked: '' })).status, 400);
  const a = await startAndWait('/api/rum/dagen/chat', { besked: 'Hvad skal jeg forberede?', kontekst: 'Mødet kl. 10.00: Driften: vinterberedskab' });
  assert.equal(a.done.status, 'done', a.done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /Om: Mødet kl\. 10\.00/);
  assert.equal(a.done.result?.text, 'Du skal forberede materialet.');
  assert.equal(a.done.result?.html, undefined);

  const b = await startAndWait('/api/rum/dagen/chat', { besked: 'flyt mødet til 11' });
  assert.equal(b.done.status, 'done', b.done.error);
  assert.equal(b.done.result?.text, 'Mødet er flyttet.');
  assert.match(b.done.result?.html ?? '', /11\.00/);
  const page = await (await sut.app.request('/rum/dagen')).text();
  assert.match(page, /Hvad skal jeg forberede\?/);
  assert.match(page, /flyttet/);
});

test('chat is refused in rooms that do not exist', async () => {
  assert.equal((await post('/api/rum/bank/chat', { besked: 'hej' })).status, 404);
});

test('run events stream as SSE and end with done', async () => {
  const { runId } = await startAndWait('/api/rum/dagen/opdater', { mode: 'opdater' });
  const res = await sut.app.request(`/api/runs/${runId}/events`);
  assert.equal(res.headers.get('content-type')?.split(';')[0], 'text/event-stream');
  const text = await res.text();
  assert.match(text, /event: status/);
  assert.match(text, /event: done/);
  assert.equal((await sut.app.request('/api/runs/nope/events')).status, 404);
});

test('Hjem lists what waits in Dagen and what Hermes did', async () => {
  const page = await (await sut.app.request('/rum/hjem')).text();
  assert.match(page, /href="\/rum\/dagen"[^>]*>[\s\S]*?Forbered/);
  assert.match(page, /Hermes byggede Dagen/);
});

test('a Hermes answer that is not valid Dagen JSON fails the run without touching the stored state', async () => {
  const bad = createFakeAgent({ answer: () => 'bare tekst' });
  const other = createApp({ store: createFileStore(path.join(dir, 'data')), hermes: bad, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NOW, sha: 'x', ...noMail });
  const res = await other.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  const { runId } = (await res.json()) as { runId: string };
  const done = await other.runs.get(runId)!.finished;
  assert.equal(done.status, 'failed');
  assert.match(done.error ?? '', /JSON|treLinjer|objekt/);
  const page = await (await other.app.request('/rum/dagen')).text();
  assert.match(page, /data-handling="blok-13"/);
});

test('KC-0050: a Dagen answer without JSON goes back to Hermes once and the corrected answer builds the room', async () => {
  const retter = createFakeAgent({ answer: (req) => (req.input.includes('kunne ikke bruges') ? answer({ ...req, input: '' }) : 'bare tekst') });
  const other = createApp({ store: createFileStore(path.join(dir, 'data-retur')), hermes: retter, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NOW, sha: 'x', ...noMail });
  const res = await other.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
  const { runId } = (await res.json()) as { runId: string };
  const done = await other.runs.get(runId)!.finished;
  assert.equal(done.status, 'done', done.error);
  assert.equal(retter.calls.length, 2);
  assert.match(retter.calls[1]!.input, /bare tekst/);
});

test('KC-0018: built rooms ask for a live stream, and so does Hjem (KC-0028: its cards change when Kuratoren runs)', async () => {
  const hjem = await (await sut.app.request('/rum/hjem')).text();
  assert.match(hjem, /<body[^>]*data-live="1"/);
  const dagen = await (await sut.app.request('/rum/dagen')).text();
  assert.match(dagen, /<body[^>]*data-live="1"/);
});

test('KC-0019: Hjem has a chat — Hermes gets the overview of every room and both sides are stored', async () => {
  const a = await startAndWait('/api/rum/hjem/chat', { besked: 'Hvad venter?' });
  assert.equal(a.done.status, 'done', a.done.error);
  assert.match(hermes.calls.at(-1)?.instructions ?? '', /rummet "Nu"/);
  assert.equal(a.done.result?.text, 'Du skal forberede materialet.');
  const page = await (await sut.app.request('/rum/hjem')).text();
  assert.match(page, /Hvad venter\?/);
  assert.match(page, /Du skal forberede materialet\./);
  assert.equal((await post('/api/rum/hjem/chat', { besked: '' })).status, 400);
  assert.equal((await post('/api/rum/findes-ikke/chat', { besked: 'x' })).status, 404);
});

test('KC-0024: a chat from the phone tells Hermes to answer short; from the laptop it does not', async () => {
  const fra = async (url: string, b: Record<string, unknown>) => { const a = await startAndWait(url, b); assert.equal(a.done.status, 'done', a.done.error); return hermes.calls.at(-1)?.instructions ?? ''; };
  assert.match(await fra('/api/rum/dagen/chat', { besked: 'Hvad nu?', enhed: 'telefon' }), /Henrik er på telefonen/);
  assert.match(await fra('/api/rum/hjem/chat', { besked: 'Hvad nu?', enhed: 'telefon' }), /højst 2–3 korte sætninger/);
  assert.doesNotMatch(await fra('/api/rum/dagen/chat', { besked: 'Hvad nu?' }), /på telefonen/);
  assert.doesNotMatch(await fra('/api/rum/dagen/chat', { besked: 'Hvad nu?', enhed: '<script>' }), /på telefonen/);
});
