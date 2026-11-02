// KC-0223: a mail connection Clawco may only read (Gmail: envelopes, no verbs) fills
// the Mail room and Nu with what waits — unread or flagged mails — and nothing that
// moves a mail or writes a draft is offered: not on screen, and not through the API
// either. himalaya never runs, and Hermes' own path (the host source) is untouched
// (test/server-mail-forbindelse.test.ts holds the golden).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import type { Kilde, Kuvert } from '../src/kilder/types.ts';
import type { MailState } from '../src/rooms/mail/schema.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const NOW = new Date('2026-11-01T08:40:00Z');
const kuvert = (id: string, emne: string, laest: boolean, flag = false): Kuvert => ({ id, emne, fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', laest, flag, vedhaeftning: false });
const INDBAKKE: Kuvert[] = [
  kuvert('1', 'Ulæst: tilmelding', false),
  kuvert('2', 'Læst og glemt', true),
  kuvert('3', 'Markeret: svar <img src=x onerror=alert(1)>', true, true),
];
/** Gmail's shape: envelopes only, no verbs, no act(). */
let virker = true;
const gmail: Kilde = {
  id: 'mail-laes', navn: 'Gmail', slags: 'mail', zone: 'privat', auth: 'local',
  read: async (ctx) => { if (!virker) throw new Error('Gmail virker ikke lige nu'); return ({ slags: 'mail', hentet: ctx.nu.toISOString(), uklar: true, data: INDBAKKE }); },
  kort: async () => ({ titel: 'Gmail', tekst: '', felter: [], handling: 'Forbind' }),
  helbred: async () => ({ status: 'ok' }),
};
/** What the agent answers: it tries a draft, a folder, a button and a mail that is not waiting — none may reach the room. */
const svar = {
  beslutninger: [
    { mailId: '1', emne: 'Ulæst: tilmelding', fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', type: 'svar', betydning: 'Skolen vil have svar.', udkast: 'Ja tak.', arkivmappe: 'Folders/Afventer', muligheder: [{ id: 'kal', label: 'Sæt i kalenderen', instruktion: 'Lav en blok' }] },
    { mailId: '3', emne: 'Markeret', fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', type: 'info', betydning: 'Markeret.' },
    { mailId: '2', emne: 'Læst og glemt', fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', type: 'info', betydning: 'Burde ikke vises.' },
  ],
  hermesStatus: 'Holder øje med indbakken',
};
const answer = (req: AgentRunRequest): string => (req.instructions.includes('svar med præcis dette skema') ? '```json\n' + JSON.stringify(svar) + '\n```' : 'Gjort.');
const himalaya: string[][] = [];
const runner: Runner = async (_cmd, args) => { himalaya.push(args); return { code: 1, stdout: '', stderr: 'ingen himalaya her' }; };

let dir = '';
const hermes = createFakeAgent({ answer });
let sut: ReturnType<typeof createApp>;
const store = () => createFileStore(path.join(dir, 'data'));
const post = async (url: string, body?: unknown): Promise<Response> => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
async function stille(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const aabne = sut.runs.list().filter((r) => r.status === 'running' || r.status === 'queued');
    if (!aabne.length) return;
    await Promise.all(aabne.map((r) => sut.runs.get(r.id)?.finished));
  }
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-mail-laes-'));
  const s = store();
  await rejsenFaerdig(s);
  sut = createApp({ store: s, dataDir: path.join(dir, 'data'), hermes, kilder: [gmail], sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: path.join(dir, 'state'), now: () => NOW });
  assert.equal((await post('/api/kilder/mail-laes/forbind', { felter: {} })).status, 200);
  await stille();
  const res = await post('/api/rum/mail/opdater', { mode: 'opdater' });
  assert.equal(res.status, 202, await res.clone().text());
  await stille();
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('the refresh reads the read-only connection: only unread or flagged mails, no draft, no folder, no buttons, the Mail room never runs himalaya', async () => {
  const req = hermes.calls.find((c) => c.instructions.includes('svar med præcis dette skema'));
  assert.ok(req);
  assert.doesNotMatch(req.instructions, /himalaya|"udkast"|"arkivmappe"|"muligheder"/);
  assert.match(req.input, /Ulæst: tilmelding/);
  assert.doesNotMatch(req.input, /Læst og glemt/, 'a read, unflagged mail is not waiting');
  const state = await store().readState<MailState>('mail');
  assert.deepEqual([state?.forbindelse, state?.laeseKun, state?.tal.handling], ['Gmail', true, 2]);
  assert.deepEqual(state?.beslutninger.map((b) => [b.mailId, b.muligheder.length, b.udkast ?? null]), [['1', 0, null], ['3', 0, null]]);
  // Kuratoren keeps its own himalaya path for now (follow-up); the Mail room's own folder set (Afventer) is never read.
  assert.ok(!himalaya.some((a) => a.includes('Folders/Afventer')), 'the Mail room never calls himalaya');
});

test('Mail and Nu show the waiting mails; nothing that moves or writes is on screen', async () => {
  const mail = await (await sut.app.request('/rum/mail')).text();
  assert.match(mail, /data-mail-kilde="laes-kun"/);
  assert.match(mail, /Ulæst: tilmelding/);
  assert.doesNotMatch(mail, /Læst og glemt/);
  assert.doesNotMatch(mail, /<img src=x onerror/, 'a hostile subject is escaped');
  for (const forbudt of [/data-aktion=/, /data-handling=/, /name="tekst"/, />Færdig</, />Gem som kladde</, /Sæt i kalenderen/]) assert.doesNotMatch(mail, forbudt);
  const nu = await (await sut.app.request('/rum/hjem')).text();
  assert.match(nu, /Mail: Ulæst: tilmelding/);
  assert.match(nu, /Mail: Markeret/);
});

test('the API refuses what the screen does not offer: Færdig, Færdig med alle, kladde and Send answer 400 and run nothing', async () => {
  const foer = hermes.calls.length;
  for (const [navn, body] of [['faerdig', { mailId: '1' }], ['faerdig-alle', { mailIds: ['1', '3'] }], ['kladde', { mailId: '1', tekst: 'Hej' }], ['send', { mailId: '1', tekst: 'Hej' }]] as const) {
    // Send is gated by the policy layer's yes first; give it one, so the refusal under test is the room's.
    const ja = navn === 'send' ? ((await (await post('/api/graense/ja', { rum: 'mail', slags: 'aktion', id: 'send', body })).json()) as { ja?: string }).ja : undefined;
    const res = await post(`/api/rum/mail/aktion/${navn}`, { ...body, ...(ja ? { ja } : {}) });
    assert.equal(res.status, 400, `${navn}: ${await res.clone().text()}`);
  }
  await stille();
  assert.equal(hermes.calls.length, foer, 'no agent run');
  assert.ok(!himalaya.some((a) => a.includes('Folders/Afventer')));
  const state = await store().readState<MailState>('mail');
  assert.ok(state?.beslutninger.every((b) => !b.afgjort && !b.udkast), 'nothing was marked or drafted');
});

test('a connection that cannot be read answers Opdatér with its plain words (400), never a server error', async () => {
  virker = false;
  try {
    const res = await post('/api/rum/mail/opdater', { mode: 'opdater' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /^Mailen kunne ikke læses: Gmail/);
  } finally { virker = true; }
});
