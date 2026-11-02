import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { udenData } from '../src/agent/udtroet.ts'; // KC-0123: the draft is wrapped data; Henrik's ask stands outside

const NOW = new Date('2026-10-27T10:00:00Z');
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('første udkast')) return 'Her:\n```json\n{"titel":"Mail til Tom","afsnit":["Hej Tom.","Vi strammer reserverne fra december.","Sig til, hvis du vil have tallene."],"kilder":["Eksempel Energi-rapport okt. 2026"]}\n```';
  if (udenData(req.input).startsWith('Afsnit a2:')) return '```json\n{"forslag":[{"afsnitId":"a2","ny":"Fra december strammer vi reserverne med 15 %.","hvorfor":"Konkret tal."}]}\n```';
  if (req.input.includes('varmere')) return 'Her er et forslag.\n```json\n{"forslag":[{"afsnitId":"a3","ny":"Skriv endelig, så sender jeg tallene.","hvorfor":"Varmere."}]}\n```';
  return 'Teksten handler om reserver.';
}

let dir = '';
let hermes = createFakeAgent({ answer });
let sut = createApp({ store: createFileStore('/nonexistent'), hermes, sourceGlob: '/nonexistent/{date}.json', now: () => NOW });
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent' };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-skrive-'));
  hermes = createFakeAgent({ answer });
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), vaultInbox: path.join(dir, 'vault', '00-Indbakke'), now: () => NOW, ...noMail });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function post(url: string, body?: unknown): Promise<Response> {
  return sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
}
async function aktion(name: string, body: unknown) {
  const res = await post(`/api/rum/skrive/aktion/${name}`, body);
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const { runId } = JSON.parse(text) as { runId: string };
  const rec = sut.runs.get(runId);
  assert.ok(rec);
  return await rec.finished;
}
const page = async () => (await sut.app.request('/rum/skrive')).text();

test('Skrive starts empty and offers Nyt udkast; unknown actions are 404 and a missing brief is 400', async () => {
  assert.match(await page(), /Ingen udkast endnu/);
  assert.equal((await post('/api/rum/skrive/aktion/nope', {})).status, 404);
  assert.equal((await post('/api/rum/skrive/aktion/nyt', { brief: '' })).status, 400);
});

test('nyt asks Hermes for a first draft and stores it as the active document', async () => {
  const done = await aktion('nyt', { titel: 'Mail til Tom', brief: 'Kort mail til Tom om reserver' });
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /Kort mail til Tom om reserver/);
  const out = await page();
  assert.match(out, /Mail til Tom/);
  assert.match(out, /data-element="Afsnit 2"/);
  assert.match(out, /Eksempel Energi-rapport okt\. 2026/);
});

test('forslag on a paragraph brings a proposal card; brug applies it, logs with fortryd and counts in the nav', async () => {
  const dokId = /data-arg="\{&quot;dokId&quot;:&quot;(dok-[^&]+)&quot;/.exec(await page())?.[1];
  assert.ok(dokId, 'document id found in the page');
  const done = await aktion('forslag', { dokId, afsnitId: 'a2', type: 'konkret' });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.result?.venter, { skrive: 1 });
  let out = await page();
  const forslagId = /data-arg="\{&quot;forslagId&quot;:&quot;(f-[^&]+)&quot;/.exec(out)?.[1];
  assert.ok(forslagId);
  assert.match(out, /href="\/rum\/skrive"[^>]*><span>Skrive<\/span><span class="count">1<\/span>/);
  const brugt = await aktion('brug', { forslagId });
  assert.equal(brugt.status, 'done', brugt.error);
  assert.equal(hermes.calls.length, 2, 'brug does not call Hermes');
  out = await page();
  assert.match(out, /Fra december strammer vi reserverne med 15 %\./);
  assert.doesNotMatch(out, /Vi strammer reserverne fra december\./);
  assert.match(out, /data-fortryd="[^"]+"/);
  assert.deepEqual(brugt.result?.venter, {});
});

test('fortryd on an applied proposal restores the old paragraph without Hermes', async () => {
  const out = await page();
  const id = /data-fortryd="([^"]+)"/.exec(out)?.[1];
  assert.ok(id);
  const calls = hermes.calls.length;
  const res = await post(`/api/rum/skrive/log/${id}/fortryd`);
  const { runId } = (await res.json()) as { runId: string };
  const done = await sut.runs.get(runId)!.finished;
  assert.equal(done.status, 'done', done.error);
  assert.equal(hermes.calls.length, calls);
  const after = await page();
  assert.match(after, /Vi strammer reserverne fra december\./);
  assert.match(after, /Fortrudt kl\./);
});

test('chat can answer with a forslag block that becomes a card; afvis removes it', async () => {
  const res = await post('/api/rum/skrive/chat', { besked: 'Gør afslutningen varmere', kontekst: 'Afsnit 3' });
  const { runId } = (await res.json()) as { runId: string };
  const done = await sut.runs.get(runId)!.finished;
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.result?.text, 'Her er et forslag.');
  assert.match(done.result?.html ?? '', /Skriv endelig, så sender jeg tallene\./);
  const forslagId = /data-arg="\{&quot;forslagId&quot;:&quot;(f-[^&]+)&quot;/.exec(await page())?.[1];
  assert.ok(forslagId);
  const afvist = await aktion('afvis', { forslagId });
  assert.equal(afvist.status, 'done');
  assert.doesNotMatch(await page(), /Skriv endelig, så sender jeg tallene\./);
});

test('the document can be fetched as markdown and saved into the vault inbox', async () => {
  const dokId = /data-arg="\{&quot;dokId&quot;:&quot;(dok-[^&]+)&quot;/.exec(await page())?.[1];
  const md = await sut.app.request(`/rum/skrive/dok/${dokId}.md`);
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type') ?? '', /markdown/);
  assert.match(await md.text(), /^# Mail til Tom\n\nHej Tom\./);
  assert.equal((await sut.app.request('/rum/skrive/dok/nope.md')).status, 404);
  const gemt = await aktion('gem', { dokId });
  assert.equal(gemt.status, 'done', gemt.error);
  const files = await readdir(path.join(dir, 'vault', '00-Indbakke'));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^2026-10-27 Mail til Tom\.md$/);
  assert.match(await readFile(path.join(dir, 'vault', '00-Indbakke', files[0]!), 'utf8'), /^# Mail til Tom/);
  assert.match(await page(), /Gemt i Obsidian/);
});

test('a second document can be created and switched to; Hjem lists open proposals', async () => {
  const done = await aktion('nyt', { brief: 'Endnu en tekst' });
  assert.equal(done.status, 'done', done.error);
  const out = await page();
  assert.match(out, /data-aktion="vaelg"/);
  const other = /data-arg="\{&quot;dokId&quot;:&quot;(dok-[^&]+)&quot;\}"[^>]*data-status="skifter"/.exec(out)?.[1];
  assert.ok(other);
  const sw = await aktion('vaelg', { dokId: other });
  assert.equal(sw.status, 'done');
  assert.match(await page(), /class="chip tilstand-handling">Mail til Tom/);
});
