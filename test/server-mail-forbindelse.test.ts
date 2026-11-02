// KC-0214: Mail in a Clawco without Hermes' tools (a Sky tenant: a model key,
// an IMAP account). The room reads the inbox through the connector, and
// Færdig, Fortryd and Gem som kladde run through the connector's verbs and
// the registry (policy layer + audit line) — never an agent run, never
// himalaya. Send is not offered and refused: IMAP cannot send.
// Golden: with the host's own mail source connected (Henrik's install), every
// agent request is byte for byte what the unchanged builders make.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { parseAll, readMailSource, type Runner } from '../src/rooms/mail/source.ts';
import { buildBaggrundFlytRun, buildKladdeRun, buildMailChatRun, buildMailRefreshRun } from '../src/rooms/mail/prompt.ts';
import { mailImapKilde, MAIL_IMAP_ID } from '../src/kilder/mail-imap/mail-imap.ts';
import { kiraMail } from '../src/kilder/legacy/legacy.ts';
import { startFalskImap, type FalskImap, type FalskPostkasse } from './helpers/falsk-imap.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import type { MailState } from '../src/rooms/mail/schema.ts';
import type { LogEntry } from '../src/store/types.ts';

const NOW = new Date('2026-10-31T08:40:00Z');
const KODE = 'app-kode-1';
const POSTKASSER: FalskPostkasse[] = [
  { navn: 'INBOX', beskeder: [
    { uid: 7, dato: '2026-10-30T08:15:00Z', emne: 'Tilbud på eltavle', fra: { navn: 'Elektrikeren ApS', adresse: 'tilbud@el.example' }, messageId: '<a1@el.example>' },
    { uid: 8, dato: '2026-10-31T06:00:00Z', emne: 'Middag på fredag', fra: { navn: 'Søster', adresse: 'soester@x.example' }, messageId: '<a2@x.example>' },
  ] },
  { navn: 'Arkiv', specialUse: '\\Archive', beskeder: [] },
  { navn: 'Kladder', specialUse: '\\Drafts', beskeder: [] },
];
/** What the agent answers a refresh: a draft for the reply, and muligheder a toolless agent could never run. */
const svar = {
  beslutninger: [
    { mailId: '8', emne: 'Middag på fredag', fra: 'Søster', modtaget: '2026-10-31T06:00:00Z', type: 'svar', betydning: 'Søster spørger om fredag.', udkast: 'Ja tak, vi kommer.', arkivmappe: 'Folders/Afventer', muligheder: [{ id: 'kalender', label: 'Sæt i kalenderen', instruktion: 'Lav en kalenderblok' }] },
    { mailId: '7', emne: 'Tilbud på eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-30T08:15:00Z', type: 'info', betydning: 'Et tilbud.', arkivmappe: 'Archive', muligheder: [] },
  ],
  hermesStatus: 'Holder øje med indbakken',
};
const answer = (req: AgentRunRequest): string => (req.instructions.includes('svar med præcis dette skema') ? '```json\n' + JSON.stringify(svar) + '\n```' : 'Gjort.');
/** himalaya must never run in a tenant: any call is recorded and fails. */
const himalaya: string[][] = [];
const runner: Runner = async (_cmd, args) => { himalaya.push(args); return { code: 1, stdout: '', stderr: 'ingen himalaya her' }; };

let dir = '';
let imap: FalskImap;
let hermes = createFakeAgent({ answer });
let sut: ReturnType<typeof createApp>;

async function post(url: string, body?: unknown): Promise<Response> {
  return sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
}
/** Every run started so far has finished (the first read after connecting starts a Mail refresh on its own). */
async function stille(app = sut): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const aabne = app.runs.list().filter((r) => r.status === 'running' || r.status === 'queued');
    if (!aabne.length) return;
    await Promise.all(aabne.map((r) => app.runs.get(r.id)?.finished));
  }
}
async function startOgVent(url: string, body?: unknown) {
  const res = await post(url, body);
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const rec = sut.runs.get((JSON.parse(text) as { runId: string }).runId);
  assert.ok(rec);
  const done = await rec.finished;
  await stille();
  return done;
}
/** A built spec as it reaches the agent: the data fence's nonce differs per build, and the run registry appends its context after the instructions. */
const ren = (t: string): string => t.replace(/\b[0-9a-f]{24}\b/g, '<nonce>');
const sammeKoersel = (c: AgentRunRequest, spec: { instructions: string; input: string }): boolean =>
  ren(c.instructions).startsWith(ren(spec.instructions)) && ren(c.input) === ren(spec.input);
const side = async (): Promise<string> => (await sut.app.request('/rum/mail')).text();
const uids = (navn: string): number[] => (imap.postkasser.find((p) => p.navn === navn)?.beskeder ?? []).map((b) => b.uid);
const store = () => createFileStore(path.join(dir, 'data'));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-mail-forbindelse-'));
  imap = await startFalskImap({ brugere: { 'mig@x.example': KODE }, postkasser: POSTKASSER, tls: 'tls' });
  const s = store();
  await rejsenFaerdig(s);
  sut = createApp({ store: s, dataDir: path.join(dir, 'data'), hermes, kilder: [mailImapKilde({ tidsgraenseMs: 1500 })], sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: path.join(dir, 'state'), now: () => NOW });
  const res = await post(`/api/kilder/${MAIL_IMAP_ID}/forbind`, { felter: { tjeneste: 'anden', adresse: 'mig@x.example', server: '127.0.0.1', port: String(imap.port), sikkerhed: 'tls', adgangskode: KODE } });
  assert.equal(res.status, 200, await res.text());
  await stille();
});
after(async () => { await imap.luk(); await rm(dir, { recursive: true, force: true }); });

test('opdater reads the inbox through the connector; the prompt says bodies cannot be read; no muligheder, archive = Archive', async () => {
  const foer = hermes.calls.length;
  const done = await startOgVent('/api/rum/mail/opdater', { mode: 'opdater' });
  assert.equal(done.status, 'done', done.error);
  const req = hermes.calls.slice(foer).find((c) => c.instructions.includes('svar med præcis dette skema'));
  assert.ok(req);
  assert.match(req.input, /Tilbud på eltavle/);
  assert.match(req.input, /Middag på fredag/);
  assert.doesNotMatch(req.instructions, /himalaya/);
  assert.match(req.instructions, /kan ikke læse selve mail/);
  assert.doesNotMatch(req.instructions, /"muligheder"|"arkivmappe"/);
  const state = await store().readState<MailState>('mail');
  assert.equal(state?.forbindelse, 'Mail');
  assert.deepEqual(state?.beslutninger.map((b) => [b.mailId, b.arkivmappe, b.muligheder.length]), [['8', 'Archive', 0], ['7', 'Archive', 0]]);
  assert.equal(himalaya.length, 0, 'himalaya never runs');
  const html = await side();
  assert.doesNotMatch(html, /data-aktion="send"/, 'no Send: IMAP cannot send');
  assert.match(html, /data-aktion="kladde"/);
  assert.doesNotMatch(html, /Sæt i kalenderen/);
});

// KC-0218: the chat answers from the connector's envelopes, never from himalaya.
test('the chat in Mail describes what the connector reads (sender, subject, date) and names no tool', async () => {
  const foer = hermes.calls.length;
  const done = await startOgVent('/api/rum/mail/chat', { besked: 'Hvem har skrevet i dag?' });
  assert.equal(done.status, 'done', done.error);
  const req = hermes.calls.slice(foer).find((c) => c.input.includes('Hvem har skrevet i dag?'));
  assert.ok(req);
  assert.doesNotMatch(req.instructions, /himalaya|terminal|Folders\//i);
  assert.match(req.instructions, /afsender, emne og dato/);
  assert.match(req.instructions, /kan ikke flytte, skrive kladder eller sende/);
  assert.match(req.input, /Søster/);
  assert.match(req.input, /2026-10-31T06:00:00Z/);
  assert.match(req.input, /Nu er det 2026-10-31/);
  assert.equal(himalaya.length, 0);
});

test('faerdig moves the mail to the archive through the connector (no agent run); Fortryd moves it back', async () => {
  const foer = hermes.calls.length;
  const done = await startOgVent('/api/rum/mail/aktion/faerdig', { mailId: '7' });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(uids('INBOX'), [8]);
  assert.deepEqual(uids('Arkiv'), [1]);
  assert.equal(hermes.calls.length, foer, 'no agent run');
  const log = await store().readLog('mail', 50);
  const flyt = log.find((e) => e.handlingId === 'faerdig-7');
  assert.ok(flyt?.fortryd, JSON.stringify(log));
  assert.equal(flyt.tekst, 'Mailen er flyttet til Arkiv.');
  assert.ok(flyt.fortryd.startsWith('lokal:'), 'the undo is the connector\'s, never an instruction for an agent');
  assert.match(await side(), new RegExp(`data-fortryd="${flyt.id}"`));
  const tilbage = await startOgVent(`/api/rum/mail/log/${flyt.id}/fortryd`);
  assert.equal(tilbage.status, 'done', tilbage.error);
  assert.deepEqual(uids('INBOX'), [8, 9]);
  assert.deepEqual(uids('Arkiv'), []);
  assert.equal(hermes.calls.length, foer, 'no agent run');
  const efter = await store().readLog('mail', 50);
  assert.ok(efter.find((e) => e.id === flyt.id)?.fortrudt);
  assert.ok(efter.some((e: LogEntry) => e.tekst === 'Mailen er flyttet til INBOX.'));
  // Two audit lines: the move and its undo, each through the registry.
  const revision = readFileSync(path.join(dir, 'data', 'revision-2026-10.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(revision.filter((l) => l['rum'] === `kilde:${MAIL_IMAP_ID}` && l['verb'] === 'sorter' && l['udfald'] === 'tillad').length, 2);
});

test('Gem som kladde saves the reply in Drafts through the connector (no agent run); nothing is sent', async () => {
  const foer = hermes.calls.length;
  const done = await startOgVent('/api/rum/mail/aktion/kladde', { mailId: '8', tekst: 'Ja tak, vi kommer fredag.' });
  assert.equal(done.status, 'done', done.error);
  assert.equal(hermes.calls.length, foer);
  assert.equal(imap.tilfoejet.length, 1);
  assert.equal(imap.tilfoejet[0]?.mappe, 'Kladder');
  assert.match(imap.tilfoejet[0]?.tekst ?? '', /^To: soester@x\.example$/m);
  const log = await store().readLog('mail', 50);
  assert.equal(log.find((e) => e.handlingId === 'kladde-8')?.tekst, 'Kladden ligger i Kladder. Clawco har ikke sendt den.');
  assert.equal((await store().readState<MailState>('mail'))?.beslutninger.find((b) => b.mailId === '8')?.udkast, 'Ja tak, vi kommer fredag.');
});

test('a refused move (the mail is gone) un-marks Færdig and says why; Send is refused outright', async () => {
  imap.postkasser.find((p) => p.navn === 'INBOX')!.beskeder.splice(0); // the user moved everything elsewhere
  const done = await startOgVent('/api/rum/mail/aktion/faerdig', { mailId: '8' });
  assert.equal(done.status, 'done', done.error);
  const state = await store().readState<MailState>('mail');
  assert.equal(state?.beslutninger.find((b) => b.mailId === '8')?.afgjort, undefined, 'still waiting: nothing was moved');
  assert.ok((await store().readLog('mail', 50)).some((e) => /ligger ikke længere/.test(e.tekst)));
  const ja = await post('/api/graense/ja', { rum: 'mail', slags: 'aktion', id: 'send', body: { mailId: '8', tekst: 'Hej' } });
  const token = ((await ja.json()) as { ja?: string }).ja;
  const res = await post('/api/rum/mail/aktion/send', { mailId: '8', tekst: 'Hej', ...(token ? { ja: token } : {}) });
  assert.equal(res.status, 400, await res.text());
});

test('golden: with the host\'s own mail source connected, refresh, Færdig and kladde are the unchanged agent runs', async () => {
  const envelopes = readFileSync(new URL('./fixtures/himalaya_handling_sample.json', import.meta.url), 'utf8');
  const henrikRunner: Runner = async (_cmd, args) => ({ code: 0, stdout: args[args.indexOf('-m') + 1] === 'Folders/Handling' ? envelopes : '{"envelopes":[]}', stderr: '' });
  const firstId = parseAll(JSON.parse(envelopes))[0]!.id;
  const gammelt = { beslutninger: [{ mailId: firstId, emne: 'Tilbud', fra: 'El', modtaget: '2026-10-26T18:57:39Z', type: 'svar', betydning: 'Svar.', udkast: 'Hej', arkivmappe: 'Folders/Afventer', muligheder: [] }], hermesStatus: 'Holder øje med Handling' };
  const agent = createFakeAgent({ answer: (req) => (req.instructions.includes('svar med præcis dette skema') ? '```json\n' + JSON.stringify(gammelt) + '\n```' : 'Gjort.') });
  const hdir = await mkdtemp(path.join(tmpdir(), 'kc-mail-golden-'));
  try {
    const s = createFileStore(path.join(hdir, 'data'));
    await rejsenFaerdig(s);
    const app = createApp({
      store: s, dataDir: path.join(hdir, 'data'), hermes: agent, sourceGlob: path.join(hdir, 'avis_{date}.json'), mailRunner: henrikRunner, mailStateDir: path.join(hdir, 'state'), now: () => NOW,
      kilder: [kiraMail({ himalaya: 'himalaya', run: henrikRunner, parse: parseAll }), mailImapKilde({ tidsgraenseMs: 1500 })],
    });
    const req = (url: string, body: unknown) => app.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // The IMAP account is connected too: the host's own source still wins.
    assert.equal((await req(`/api/kilder/${MAIL_IMAP_ID}/forbind`, { felter: { tjeneste: 'anden', adresse: 'mig@x.example', server: '127.0.0.1', port: String(imap.port), sikkerhed: 'tls', adgangskode: KODE } })).status, 200);
    await stille(app);
    const venter = async (res: Response) => { assert.equal(res.status, 202, await res.clone().text()); await stille(app); };
    const foer = agent.calls.length;
    await venter(await req('/api/rum/mail/opdater', { mode: 'opdater' }));
    const data = await readMailSource({ run: henrikRunner, stateDir: path.join(hdir, 'state'), now: NOW, himalaya: 'himalaya' });
    const forventet = buildMailRefreshRun(data, NOW);
    const opdater = agent.calls.slice(foer).find((c) => c.instructions.includes('svar med præcis dette skema'));
    assert.ok(opdater && sammeKoersel(opdater, forventet), 'the refresh is the unchanged agent run');
    // KC-0218: Henrik's own installation keeps the unchanged chat prompt (the tool-mode text, himalaya and all).
    const chatFoer = agent.calls.length;
    await venter(await req('/api/rum/mail/chat', { besked: 'Hvad haster?' }));
    const chat = agent.calls.slice(chatFoer).find((c) => c.input.includes('Hvad haster?'));
    assert.ok(chat && sammeKoersel(chat, buildMailChatRun('Hvad haster?', undefined, await s.readState<MailState>('mail'))), 'the chat is the unchanged agent run');
    assert.match(chat.instructions, /himalaya/);
    await venter(await req('/api/rum/mail/aktion/kladde', { mailId: firstId, tekst: 'Hej igen' }));
    const kladde = buildKladdeRun(firstId, 'Tilbud', 'Hej igen');
    assert.ok(agent.calls.some((c) => sammeKoersel(c, kladde)), 'kladde is the agent run');
    await venter(await req('/api/rum/mail/aktion/faerdig', { mailId: firstId }));
    const flyt = buildBaggrundFlytRun(firstId, 'Folders/Afventer');
    assert.ok(agent.calls.some((c) => sammeKoersel(c, flyt)), 'the move is the background agent run');
    const log = await s.readLog('mail', 50);
    assert.equal(log.find((e) => e.handlingId === `faerdig-${firstId}`)?.fortryd, `himalaya message move --from Folders/Afventer --to Folders/Handling ${firstId}`);
    assert.equal(imap.tilfoejet.length, 1, 'nothing appended through the connector beyond the earlier test');
  } finally { await rm(hdir, { recursive: true, force: true }); }
});
