// KC-0097: "Færdig med de N til orientering" — one press runs each mail's own Færdig.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';

const NOW = new Date('2026-10-27T08:40:00Z');
const mail = (mailId: string, type: string, extra: Record<string, unknown> = {}) => ({ mailId, emne: `Mail ${mailId}`, fra: 'Afsender', modtaget: '2026-10-26T10:00:00Z', type, resume: 'r', betydning: 'b', arkivmappe: mailId === '503' ? 'Folders/køb' : 'Archive', muligheder: [], ...extra });
const mailJson = {
  beslutninger: [
    mail('501', 'info'), mail('502', 'info'), mail('503', 'kvittering'),
    mail('504', 'svar', { udkast: 'Hej' }),
    mail('505', 'info', { muligheder: [{ id: 'ring', label: 'Ring', instruktion: 'Ring til dem.' }] }),
    mail('506', 'info'), mail('507', 'kvittering'),
  ],
  hermesStatus: 'Holder øje med Handling',
};
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('baggrundsopgave')) return 'Flyttet.';
  if (req.instructions.includes('svar med præcis dette skema')) return '```json\n' + JSON.stringify(mailJson) + '\n```';
  return 'ok';
}
const runner: Runner = async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' });

let dir = '';
let hermes = createFakeAgent({ answer });
let sut = createApp({ store: createFileStore('/nonexistent'), hermes, sourceGlob: '/nonexistent/{date}.json', mailRunner: runner, mailStateDir: '/nonexistent', now: () => NOW });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-mail-alle-'));
  await mkdir(path.join(dir, 'state'));
  hermes = createFakeAgent({ answer });
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: path.join(dir, 'state'), now: () => NOW });
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

const post = async (url: string, body?: unknown): Promise<Response> => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
async function startAndWait(url: string, body?: unknown) {
  const res = await post(url, body);
  const text = await res.text();
  assert.equal(res.status, 202, text);
  const { runId } = JSON.parse(text) as { runId: string };
  const rec = sut.runs.get(runId)!;
  return { runId, done: await rec.finished };
}
const page = async () => (await sut.app.request('/rum/mail')).text();
const ALLE = '/api/rum/mail/aktion/faerdig-alle';

test('setup: seven mails are waiting', async () => {
  const { done } = await startAndWait('/api/rum/mail/opdater', { mode: 'opdater' });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.result?.venter, { mail: 7 });
});

test('faerdig-alle validates its ids against the stored state: empty, unknown, real-step and malformed bodies are 400', async () => {
  assert.equal((await post(ALLE, {})).status, 400);
  assert.equal((await post(ALLE, { mailIds: [] })).status, 400);
  assert.equal((await post(ALLE, { mailIds: '501' })).status, 400);
  assert.equal((await post(ALLE, { mailIds: ['501', 'nope'] })).status, 400);
  assert.equal((await post(ALLE, { mailIds: ['501', '504'] })).status, 400, 'a svar mail has a real step');
  assert.equal((await post(ALLE, { mailIds: ['501', '505'] })).status, 400, 'a mail with a mulighed has a real step');
  assert.equal((await post(ALLE, { mailIds: [501, 502] })).status, 400, 'ids are strings');
  assert.match(await page(), /data-aktion="faerdig-alle"/, 'nothing was changed by the rejected calls');
});

test('faerdig-alle marks every named mail done, moves each in the background with its own Fortryd, answers once and drops the waiting count by N', async () => {
  const before = hermes.calls.length;
  const { done } = await startAndWait(ALLE, { mailIds: ['501', '502', '503'] });
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.result?.text, '3 mails færdige.');
  assert.deepEqual(done.result?.venter, { mail: 4 });
  const out = await page();
  assert.equal((out.match(/Færdig → /g) ?? []).length, 3, 'three finished cards');
  for (const id of ['501', '502', '503']) assert.match(out, new RegExp(`Færdig med &quot;Mail ${id}&quot;`), `log line for ${id}`);
  for (let i = 0; i < 40 && hermes.calls.length < before + 3; i++) await new Promise((r) => setTimeout(r, 10));
  const moves = hermes.calls.slice(before).map((c) => c.input);
  assert.equal(moves.length, 3);
  assert.ok(moves.some((m) => /--from Folders\/Handling --to Archive 501/.test(m)));
  assert.ok(moves.some((m) => /--from Folders\/Handling --to Archive 502/.test(m)));
  assert.ok(moves.some((m) => /--from Folders\/Handling --to Folders\/køb 503/.test(m)), 'the receipt goes to its own folder');
  await new Promise((r) => setTimeout(r, 60));
  const efter = await page();
  assert.equal((efter.match(/data-fortryd="/g) ?? []).length, 3, 'each move keeps its own Fortryd');
  assert.equal((await post(ALLE, { mailIds: ['501', '502'] })).status, 400, 'already done');
});

test('faerdig-alle: the same press arriving together runs once (KC-0082)', async () => {
  const before = hermes.calls.length;
  const body = { mailIds: ['506', '507'] };
  const [a, b] = await Promise.all([post(ALLE, body), post(ALLE, body)]);
  assert.equal(a.status, 202);
  const [ja, jb] = [(await a.json()) as { runId: string }, (await b.json()) as { runId: string }];
  assert.equal(ja.runId, jb.runId, 'both presses join one run');
  await sut.runs.get(ja.runId)!.finished;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(hermes.calls.length - before, 2, 'one move per mail, not two');
});
