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
import type { Runner } from '../src/rooms/mail/source.ts';
import { udpak } from '../src/agent/udtroet.ts';

const fixture = readFileSync(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-26T07:10:00Z');
const nyhederJson = {
  femLinjer: ['Eksempel Energi strammer reserverne.', 'Agentmodeller rykker.', 'L3', 'L4', 'L5'],
  baner: [{ navn: 'Energi', nyheder: [{ titel: 'Eksempel Energi strammer reserver i vinter', hvorfor: 'Dit eget system.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/reserver' }] },
          { navn: 'AI og agenter', nyheder: [{ titel: 'Open-weight agent model matches closed models on tool use', hvorfor: 'Kandidat til kira-home.', kilde: 'r/LocalLLaMA', url: 'https://example.org/r/agents' }] }],
  forslag: [{ tekst: 'Skal jeg lave et testrum til agent-nyheder?', handling: { label: 'Ja, lav testrum', instruktion: 'Opret et testrum.', fortryd: 'Slet testrummet.' } }],
  hermesStatus: 'Følger AI og energi',
};
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('trykket på knappen')) return 'Testrummet er oprettet.';
  if (req.instructions.includes('rummet "Nyheder"') && req.instructions.includes('Svar med præcis dette skema')) return '```json\n' + JSON.stringify(nyhederJson) + '\n```';
  return 'Artiklen handler om reserver.';
}
const runner: Runner = async (_c, args) => args.includes('Archive')
  ? { code: 0, stdout: JSON.stringify({ envelopes: [{ id: '7', subject: 'Ugens energinyt', from: [{ name: 'Eksempel Energi', email: 'n@e' }], date: '2026-10-26T06:10:00Z', flags: [] }] }), stderr: '' }
  : { code: 0, stdout: '{"envelopes":[]}', stderr: '' };

let dir = '';
let hermes = createFakeAgent({ answer });
let sut = createApp({ store: createFileStore('/nonexistent'), hermes, sourceGlob: '/nonexistent/{date}.json', now: () => NOW });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-ny-'));
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  hermes = createFakeAgent({ answer });
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: '/nonexistent', vaultInbox: path.join(dir, 'vault'), now: () => NOW });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });
async function post(url: string, body?: unknown): Promise<Response> {
  return sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
}
async function wait(res: Response) {
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const { runId } = JSON.parse(text) as { runId: string };
  return await sut.runs.get(runId)!.finished;
}
const page = async () => (await sut.app.request('/rum/nyheder')).text();

test('Nyheder starts empty with the hent button', async () => {
  assert.match(await page(), /data-opdater="hent"/);
});

test('opdater passes every item to Hermes and stores lanes, newsletters and source stats; forslag with a handling counts as waiting', async () => {
  const done = await wait(await post('/api/rum/nyheder/opdater', { mode: 'opdater' }));
  assert.equal(done.status, 'done', done.error);
  assert.ok(hermes.calls.at(-1)?.input.includes('Ny udbudsrunde for fleksibilitet'), 'all items passed');
  assert.deepEqual(done.result?.venter, { nyheder: 1 });
  const out = await page();
  assert.match(out, /Eksempel Energi strammer reserverne\./);
  assert.match(out, /AI og agenter/);
  assert.match(out, /Ugens energinyt/);
  assert.match(out, /3 af 3 kilder/);
  assert.match(out, /data-handling="forslag-1-ja-lav-testrum"/);
});

test('gem til senere appends a line to Læs senere.md, marks the item and can be undone', async () => {
  const done = await wait(await post('/api/rum/nyheder/aktion/gem', { nyhedId: 'n1' }));
  assert.equal(done.status, 'done', done.error);
  const fil = path.join(dir, 'vault', 'Læs senere.md');
  const text = await readFile(fil, 'utf8');
  assert.match(text, /- \[Eksempel Energi strammer reserver i vinter\]\(https:\/\/example\.org\/eksempel-energi\/reserver\) — Dit eget system\. \(Eksempel Energi, 2026-10-26\)/);
  let out = await page();
  assert.match(out, /Gemt/);
  assert.doesNotMatch(out, /data-aktion="gem"[^>]*data-arg="[^"]*n1/);
  const id = /data-fortryd="([^"]+)"/.exec(out)?.[1];
  assert.ok(id);
  const undone = await wait(await post(`/api/rum/nyheder/log/${id}/fortryd`));
  assert.equal(undone.status, 'done', undone.error);
  assert.doesNotMatch(await readFile(fil, 'utf8'), /Eksempel Energi strammer reserver i vinter/);
  out = await page();
  assert.match(out, /data-aktion="gem"[^>]*data-arg="[^"]*n1/);
  assert.equal((await post('/api/rum/nyheder/aktion/gem', { nyhedId: 'n99' })).status, 400);
});

test('a forslag handling runs through Hermes and lands in the log with fortryd', async () => {
  const done = await wait(await post('/api/rum/nyheder/handlinger/forslag-1-ja-lav-testrum'));
  assert.equal(done.status, 'done', done.error);
  assert.equal(udpak(hermes.calls.at(-1)?.input ?? '')[0]?.tekst, 'Opret et testrum.'); // KC-0123: an afledt segment
  assert.deepEqual(done.result?.venter, {});
  assert.match(await page(), /Testrummet er oprettet\./);
});

test('chat passes the context and Hjem lists nothing from Nyheder once done', async () => {
  const done = await wait(await post('/api/rum/nyheder/chat', { besked: 'Hvad siger den?', kontekst: 'Nyheden: Eksempel Energi strammer reserver i vinter' }));
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /Om: Nyheden: Eksempel Energi/);
  assert.equal(done.result?.text, 'Artiklen handler om reserver.');
});
