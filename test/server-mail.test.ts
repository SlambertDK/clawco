import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { udpak } from '../src/agent/udtroet.ts';

const envelopes = readFileSync(new URL('./fixtures/himalaya_handling_sample.json', import.meta.url), 'utf8');
const plan = readFileSync(new URL('./fixtures/mail-plan-auto-sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-27T08:40:00Z');
const firstId = (JSON.parse(envelopes).envelopes ?? JSON.parse(envelopes))[0].id as string;

const mailJson = {
  beslutninger: [
    { mailId: firstId, emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Tilbud på 18.400 kr.', betydning: 'Svar inden fredag.', frist: '2026-10-31', udkast: 'Hej, tak for tilbuddet.', arkivmappe: 'Folders/Afventer', muligheder: [] },
    { mailId: '999', emne: 'Ugens energinyt', fra: 'Nyhedsbrev', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'Nyhedsbrev.', betydning: 'Du åbner det aldrig.', arkivmappe: 'Archive', muligheder: [{ id: 'afmeld', label: 'Afmeld', instruktion: 'Afmeld nyhedsbrevet via List-Unsubscribe.' }] },
  ],
  hermesStatus: 'Holder øje med Handling',
};
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('trykket "Fortryd"')) return 'Flyttede mailen tilbage.';
  if (req.instructions.includes('trykket på knappen')) return 'Afmeldt via linket.';
  if (req.instructions.includes('gem den som kladde')) return 'Kladden ligger i Drafts.';
  if (req.instructions.includes('Henrik har godkendt')) return 'Svaret er sendt til Elektrikeren ApS.';
  if (req.instructions.includes('baggrundsopgave')) return 'Flyttet.';
  if (req.instructions.includes('svar med præcis dette skema')) return '```json\n' + JSON.stringify(mailJson) + '\n```';
  return 'Mailen handler om et tilbud.';
}
const runner: Runner = async (_cmd, args) => {
  const m = args[args.indexOf('-m') + 1];
  if (m === 'Folders/Handling') return { code: 0, stdout: envelopes, stderr: '' };
  return { code: 0, stdout: '{"envelopes":[]}', stderr: '' };
};

let dir = '';
let hermes = createFakeAgent({ answer });
let sut = createApp({ store: createFileStore('/nonexistent'), hermes, sourceGlob: '/nonexistent/{date}.json', mailRunner: runner, mailStateDir: '/nonexistent', now: () => NOW });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-mail-'));
  await mkdir(path.join(dir, 'state'));
  await writeFile(path.join(dir, 'state', 'mail-plan-auto-2026-10-27-083001.json'), plan);
  hermes = createFakeAgent({ answer });
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  sut = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: path.join(dir, 'state'), now: () => NOW });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

async function post(url: string, body?: unknown): Promise<Response> {
  return sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
}
/** KC-0122: what the browser does for a red button — ask for a one-time yes for exactly this press, then post with it. */
async function medJa(url: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const m = /^\/api\/rum\/([^/]+)\/(aktion|handlinger)\/([^/]+)$/.exec(url);
  assert.ok(m, url);
  const slags = m[2] === 'aktion' ? 'aktion' : 'handling';
  const res = await post('/api/graense/ja', { rum: m[1], slags, id: decodeURIComponent(m[3]!), ...(slags === 'aktion' ? { body } : {}) });
  assert.equal(res.status, 200);
  return { ...body, ja: ((await res.json()) as { ja: string }).ja };
}

async function startAndWait(url: string, body?: unknown, ja = false) {
  const res = await post(url, ja ? await medJa(url, (body ?? {}) as Record<string, unknown>) : body);
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const { runId } = JSON.parse(text) as { runId: string };
  const rec = sut.runs.get(runId);
  assert.ok(rec);
  return { runId, done: await rec.finished };
}
const page = async () => (await sut.app.request('/rum/mail')).text();

test('opdater stores the analysis: svar card with draft, nyhedsbrev card with Afmeld, two waiting', async () => {
  const { done } = await startAndWait('/api/rum/mail/opdater', { mode: 'opdater' });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.result?.venter, { mail: 2 });
  const out = await page();
  assert.match(out, new RegExp(`id="udkast-${firstId}"[^>]*>Hej, tak for tilbuddet\\.</textarea>`));
  assert.match(out, /data-handling="999-afmeld"/);
  assert.match(out, /Skal besvares/);
});

test('kladde sends Henriks edited text to Hermes, keeps it in the state and logs it', async () => {
  const { done } = await startAndWait('/api/rum/mail/aktion/kladde', { mailId: firstId, tekst: 'Hej, tak. Kan I give en pris uden udvidelse?' });
  assert.equal(done.status, 'done', done.error);
  assert.ok(hermes.calls.at(-1)?.input.includes('Kan I give en pris uden udvidelse?'));
  const out = await page();
  assert.match(out, /Kan I give en pris uden udvidelse\?<\/textarea>/);
  assert.match(out, /Kladden ligger i Drafts\./);
  assert.equal((await post('/api/rum/mail/aktion/kladde', { mailId: firstId, tekst: '' })).status, 400);
});

test('send runs the approved text through Hermes, marks the mail sent, moves it in the background and logs without undo', async () => {
  assert.equal((await post('/api/rum/mail/aktion/send', { mailId: firstId, tekst: 'Hej' })).status, 403, 'KC-0122: no human yes, no send');
  assert.equal((await post('/api/rum/mail/aktion/send', await medJa('/api/rum/mail/aktion/send', { mailId: firstId, tekst: '' }))).status, 400);
  const before = hermes.calls.length;
  const { done } = await startAndWait('/api/rum/mail/aktion/send', { mailId: firstId, tekst: 'Hej, tak. Vi tager tilbuddet.' }, true);
  assert.equal(done.status, 'done', done.error);
  const sendCall = hermes.calls[before]!;
  assert.ok(sendCall.input.includes('Vi tager tilbuddet.'));
  assert.match(sendCall.instructions, /Henrik har godkendt/);
  assert.deepEqual(done.result?.venter, { mail: 1 });
  const out = await page();
  assert.match(out, /Sendt → Afventer/);
  assert.match(out, /Svaret er sendt til Elektrikeren ApS\./);
  const row = /<div data-id="log:[^"]+" class="row log-row" data-log="[^"]+"(?: data-datazone="[^"]*")?>\s*<span class="mono time">[^<]*<\/span>\s*<span class="row-main"><span class="row-title">Svaret er sendt til Elektrikeren ApS\.<\/span><\/span>\s*(<button[^>]*data-fortryd)?/.exec(out);
  assert.ok(row, 'send log row found');
  assert.equal(row[1], undefined, 'no Fortryd on a sent mail');
  for (let i = 0; i < 20 && hermes.calls.length < before + 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(hermes.calls.at(-1)?.input ?? '', new RegExp(`--to Folders/Afventer ${firstId}`));
  assert.equal((await post('/api/rum/mail/aktion/send', await medJa('/api/rum/mail/aktion/send', { mailId: firstId, tekst: 'igen' }))).status, 400, 'a sent mail cannot be sent twice');
});

test('Afmeld runs through Hermes and lands in the card', async () => {
  const { done } = await startAndWait('/api/rum/mail/handlinger/999-afmeld', undefined, true);
  assert.equal(done.status, 'done', done.error);
  assert.equal(udpak(hermes.calls.at(-1)?.input ?? '')[0]?.tekst, 'Afmeld nyhedsbrevet via List-Unsubscribe.'); // KC-0123: an afledt segment
  assert.match(await page(), /Afmeldt via linket\./);
});

test('faerdig marks the mail done at once and moves it in the background; the page says where it went', async () => {
  const before = hermes.calls.length;
  const { done } = await startAndWait('/api/rum/mail/aktion/faerdig', { mailId: '999' });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.result?.venter, {});
  const out = await page();
  assert.match(out, /Færdig → Archive/);
  for (let i = 0; i < 20 && hermes.calls.length === before; i++) await new Promise((r) => setTimeout(r, 10));
  const bg = hermes.calls.at(-1);
  assert.match(bg?.input ?? '', /--from Folders\/Handling --to Archive 999/);
  await new Promise((r) => setTimeout(r, 30));
  assert.match(await page(), /Flyttet\./);
  assert.equal((await post('/api/rum/mail/aktion/faerdig', { mailId: 'nope' })).status, 400);
});

test('Fortryd on a sorted mail is a handling the app built itself', async () => {
  const { done } = await startAndWait('/api/rum/mail/handlinger/ordnet-301');
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /--from "Folders\/Regninger" --to "Folders\/Handling" 301/);
});

test('chat in Mail passes the context and stores both sides', async () => {
  const { done } = await startAndWait('/api/rum/mail/chat', { besked: 'Hvad vil de?', kontekst: 'Mailen: Tilbud på ny eltavle' });
  assert.equal(done.status, 'done', done.error);
  assert.match(hermes.calls.at(-1)?.input ?? '', /Om: Mailen: Tilbud på ny eltavle/);
  assert.equal(done.result?.text, 'Mailen handler om et tilbud.');
});

test('Hjem lists nothing from Mail once everything is sent or finished', async () => {
  const page2 = await (await sut.app.request('/rum/hjem')).text();
  assert.match(page2, /Intet venter på dig/);
});
