// KC-0259: an agent without tools (the built-in agent) never gets Hermes-only buttons or suggestions on screen:
// Nyheder's forslag, Mail's muligheder (Afmeld), the Kurator's card buttons and web search. With Hermes (tools) it is as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import { createFakeStemme } from '../src/stemme/fake.ts';
import { laesKurator } from '../src/kurator/kurator.ts';
import type { Kort, KuratorState } from '../src/rooms/hjem/kort.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const avis = readFileSync(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8');
const envelopes = readFileSync(new URL('./fixtures/himalaya_handling_sample.json', import.meta.url), 'utf8');
const plan = readFileSync(new URL('./fixtures/mail-plan-auto-sample.json', import.meta.url), 'utf8');
const NOW = new Date('2026-10-27T08:40:00Z');
const firstId = (JSON.parse(envelopes).envelopes ?? JSON.parse(envelopes))[0].id as string;

const nyhederJson = {
  femLinjer: ['L1', 'L2', 'L3', 'L4', 'L5'],
  baner: [{ navn: 'Energi', nyheder: [{ titel: 'Eksempel Energi strammer reserver i vinter', hvorfor: 'Dit eget system.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/reserver' }] }],
  forslag: [{ tekst: 'Skal jeg lave et testrum?', handling: { label: 'Ja, lav testrum', instruktion: 'Opret et testrum.' } }],
  hermesStatus: 'Følger energi',
};
const mailJson = {
  beslutninger: [
    { mailId: firstId, emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'aktion', resume: 'Tilbud.', betydning: 'Svar inden fredag.' },
    { mailId: '999', emne: 'Ugens energinyt', fra: 'Nyhedsbrev', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'Nyhedsbrev.', betydning: 'Du åbner det aldrig.',
      muligheder: [{ id: 'afmeld', label: 'Afmeld', instruktion: 'Afmeld nyhedsbrevet.' }] },
  ],
  hermesStatus: 'Holder øje',
};
const kortJson = { id: 'tjeneste:a', type: 'tjeneste', titel: 'Skift plan', betyder: 'En plan.', grundlag: ['x'], kilder: ['mail fra Y'], anbefaling: 'Skift.', prioritet: 1, handling: { label: 'Skift plan', instruktion: 'Skift planen til årlig.' } };
const kurator = (kort: unknown[]): string => '```json\n' + JSON.stringify({ kort, vurderinger: [], intet: [] }) + '\n```';

const dagenJson = {
  dato: '2026-10-27', treLinjer: ['L1', 'L2', 'L3'],
  anbefaling: { tekst: 'Brug kl. 13 på udkastet.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret kalenderblok 13-14.' } },
  kalender: [{ tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', status: 'klar', handling: { label: 'Forbered', instruktion: 'Saml materialet.' } }],
  morgenavis: [{ titel: 'Eksempel Energi', hvorfor: 'Relevant.', kilde: 'Eksempel Energi', url: 'https://example.org/a' }],
  hermesStatus: 'Holder øje',
};

function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('"treLinjer": ["linje 1"')) return 'Her er dagen:\n```json\n' + JSON.stringify(dagenJson) + '\n```';
  if (req.instructions.includes('Du er Kuratoren')) return kurator([kortJson]);
  if (req.instructions.includes('rummet "Nyheder"') && req.instructions.includes('Svar med præcis dette skema')) return '```json\n' + JSON.stringify(nyhederJson) + '\n```';
  if (req.instructions.includes('svar med præcis dette skema')) return '```json\n' + JSON.stringify(mailJson) + '\n```';
  return 'ok';
}
const runner: Runner = async (_c, args) => {
  const m = args[args.indexOf('-m') + 1];
  return m === 'Folders/Handling' ? { code: 0, stdout: envelopes, stderr: '' } : { code: 0, stdout: '{"envelopes":[]}', stderr: '' };
};

async function opsaet(vaerktoejer: boolean) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-uvt-'));
  await mkdir(path.join(dir, 'state'));
  await writeFile(path.join(dir, 'state', 'mail-plan-auto-2026-10-27-083001.json'), plan);
  await writeFile(path.join(dir, 'avis_2026-10-27.json'), avis);
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  const hermes = createFakeAgent({ answer, vaerktoejer });
  const sut = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: runner, mailStateDir: path.join(dir, 'state'), vaultInbox: path.join(dir, 'vault', '00-Indbakke'), stemme: createFakeStemme(), now: () => NOW });
  const post = async (url: string, body?: unknown): Promise<Response> => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const koer = async (url: string, body: unknown) => {
    const res = await post(url, body);
    assert.equal(res.status, 202, await res.clone().text());
    const { runId } = (await res.json()) as { runId: string };
    return sut.runs.get(runId)!.finished;
  };
  return { dir, store, hermes, sut, post, koer, side: async (p: string) => (await sut.app.request(p)).text(), ryd: () => rm(dir, { recursive: true, force: true }) };
}

for (const [navn, vaerktoejer] of [['Hermes (tools)', true], ['the built-in agent (no tools)', false]] as const) {
  test(`KC-0259 Nyheder, ${navn}: the forslag ${vaerktoejer ? 'with its button is on screen' : 'is neither asked for nor drawn'}`, async () => {
    const t = await opsaet(vaerktoejer);
    try {
      const done = await t.koer('/api/rum/nyheder/opdater', { mode: 'opdater' });
      assert.equal(done.status, 'done', done.error);
      const ask = t.hermes.calls.at(-1)!.instructions;
      const out = await t.side('/rum/nyheder');
      assert.equal(/^\s*"forslag": \[/m.test(ask), vaerktoejer, 'the schema names forslag only with tools');
      assert.equal(ask.includes('valgfri (0-3)'), vaerktoejer, 'and so does the rule');
      assert.equal(out.includes('data-handling="forslag-1-ja-lav-testrum"'), vaerktoejer);
      assert.equal(out.includes('Skal jeg lave et testrum?'), vaerktoejer, 'the suggestion text is gone too, not greyed');
      assert.deepEqual(done.result?.venter ?? {}, vaerktoejer ? { nyheder: 1 } : {});
      // The chat does not send the agent to read an article it cannot open.
      await t.koer('/api/rum/nyheder/chat', { besked: 'Hvad står der?' });
      assert.equal(t.hermes.calls.at(-1)!.instructions.includes('Læs artiklen med dine værktøjer'), vaerktoejer);
    } finally { await t.ryd(); }
  });

  test(`KC-0259 Mail, ${navn}: the Afmeld mulighed ${vaerktoejer ? 'is on screen' : 'is neither asked for nor drawn'}`, async () => {
    const t = await opsaet(vaerktoejer);
    try {
      const done = await t.koer('/api/rum/mail/opdater', { mode: 'opdater' });
      assert.equal(done.status, 'done', done.error);
      const ask = t.hermes.calls.at(-1)!.instructions;
      const out = await t.side('/rum/mail');
      assert.equal(/"muligheder"/.test(ask), vaerktoejer);
      assert.equal(out.includes('data-handling="999-afmeld"'), vaerktoejer);
      assert.match(out, /Ugens energinyt/, 'the mail itself stays');
    } finally { await t.ryd(); }
  });

  test(`KC-0259 Kuratoren, ${navn}: web search and the card button ${vaerktoejer ? 'are as before' : 'are neither asked for, stored nor drawn'}`, async () => {
    const t = await opsaet(vaerktoejer);
    const stop = t.sut.kurator('07-22/60');
    try {
      await t.store.writeState('nyheder', { dato: '2026-10-27', genereret: '2026-10-27T05:10:00Z', femLinjer: ['Eksempel Energi strammer reserverne.'], baner: [], forslag: [], nyhedsbreve: [], kilder: {}, gemt: [], hermesStatus: 'x' });
      await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
      let r;
      for (let i = 0; i < 100 && !r; i++) { r = t.sut.runs.list().find((x) => x.kind === 'kurator'); if (!r) await new Promise((res) => setTimeout(res, 10)); }
      assert.ok(r, 'a kurator run started');
      assert.equal((await t.sut.runs.get(r.id)!.finished).status, 'done');
      const ask = t.hermes.calls.find((c) => c.instructions.includes('Du er Kuratoren'))!.instructions;
      assert.equal(/søg på nettet/.test(ask), vaerktoejer, 'the deep run searches the web only with tools');
      assert.equal(/^\s*"handling":/m.test(ask), vaerktoejer, 'the card schema has a handling only with tools');
      const gemt = (await laesKurator(t.store)).kort.find((k) => k.id === 'tjeneste:a');
      assert.ok(gemt, 'the card itself is stored');
      assert.equal(Boolean(gemt.handling), vaerktoejer, 'a handling the agent proposed anyway is not stored without tools');
      assert.equal((await t.side('/rum/hjem')).includes('data-kort-handling="tjeneste:a"'), vaerktoejer);
    } finally { stop(); await t.ryd(); }
  });
}

for (const [navn, vaerktoejer] of [['Hermes (tools)', true], ['the built-in agent (no tools)', false]] as const) {
  test(`KC-0259 Dagen, ${navn}: handling buttons ${vaerktoejer ? 'are as before' : 'are neither asked for, drawn, counted, spoken nor runnable'}`, async () => {
    const t = await opsaet(vaerktoejer);
    try {
      const done = await t.koer('/api/rum/dagen/opdater', { mode: 'opdater' });
      assert.equal(done.status, 'done', done.error);
      const ask = t.hermes.calls.at(-1)!.instructions;
      const out = await t.side('/rum/dagen');
      assert.equal(/"handling":/.test(ask), vaerktoejer, 'the schema names handling only with tools');
      assert.equal(ask.includes('tilAndre'), vaerktoejer, 'and so does the tilAndre rule');
      assert.equal(out.includes('data-handling="blok-13"'), vaerktoejer, 'the anbefaling button');
      assert.equal(/data-handling="kal-1/.test(out), vaerktoejer, 'the calendar button');
      assert.match(out, /Driften: vinterberedskab/, 'the room itself stays');
      assert.equal(done.result?.venter?.['dagen'] ?? 0, vaerktoejer ? 2 : 0, 'nothing waits on a button that is not there');
      const sig = JSON.stringify(await (await t.sut.app.request('/api/stemme/oversigt')).json());
      if (vaerktoejer) assert.ok(sig.includes('Brug kl'), 'with tools the spoken overview offers the anbefaling');
      else assert.ok(!sig.includes('Brug kl') && !sig.includes('Forbered'), 'the spoken overview does not offer it either');
      if (!vaerktoejer) assert.equal((await t.post('/api/rum/dagen/handlinger/blok-13')).status, 404, 'a stored handling id posted directly is refused: it is gone');
    } finally { await t.ryd(); }
  });
}

test('KC-0259: Hent (the agent fetches with its terminal) is gone without tools in Dagen and Nyheder, and the refresh from data stays', async () => {
  for (const vaerktoejer of [true, false]) {
    const t = await opsaet(vaerktoejer);
    try {
      for (const rum of ['dagen', 'nyheder']) {
        const tom = await t.side(`/rum/${rum}`);
        assert.equal(/\sdata-opdater="hent"/.test(tom), vaerktoejer, `${rum}: the empty state's button`);
        const res = await t.post(`/api/rum/${rum}/opdater`, { mode: 'hent' });
        assert.equal(res.status === 202, vaerktoejer, `${rum}: mode hent`);
      }
      // With the paper's data present the plain refresh still runs for both.
      assert.equal((await t.post('/api/rum/dagen/opdater', { mode: 'opdater' })).status, 202);
      assert.equal((await t.post('/api/rum/nyheder/opdater', { mode: 'opdater' })).status, 202);
    } finally { await Promise.all(t.sut.runs.list().map((r) => t.sut.runs.get(r.id)!.finished)); await t.ryd(); }
  }
});

test('KC-0259: without tools a Nyheder handling and a Nu card handling posted directly are refused with 404', async () => {
  const t = await opsaet(false);
  try {
    await t.koer('/api/rum/nyheder/opdater', { mode: 'opdater' });
    assert.equal((await t.post('/api/rum/nyheder/handlinger/forslag-1-ja-lav-testrum')).status, 404);
    const k: Kort = { id: 'k:a', type: 'tjeneste', titel: 'Skift plan', betyder: 'b', grundlag: [], kilder: [], anbefaling: 'a', prioritet: 1, handling: { id: 'k:a:h', label: 'Skift plan', instruktion: 'Skift.' } };
    await t.store.writeState('hjem', { kort: [k], intet: [], afvist: [], sete: [] } satisfies KuratorState);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/handling', {})).status, 404);
    assert.equal(t.hermes.calls.filter((c) => c.instructions.includes('trykket på knappen')).length, 0, 'no run was started');
  } finally { await t.ryd(); }
});

test('KC-0259 Kuratoren: a button the agent proposed anyway is dropped with one system line per card in the room log', async () => {
  const t = await opsaet(false);
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.store.writeState('nyheder', { dato: '2026-10-27', genereret: '2026-10-27T05:10:00Z', femLinjer: ['x'], baner: [], forslag: [], nyhedsbreve: [], kilder: {}, gemt: [], hermesStatus: 'x' });
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    let r;
    for (let i = 0; i < 100 && !r; i++) { r = t.sut.runs.list().find((x) => x.kind === 'kurator'); if (!r) await new Promise((res) => setTimeout(res, 10)); }
    assert.ok(r);
    await t.sut.runs.get(r.id)!.finished;
    const log = (await t.store.readLog('hjem')).filter((e) => e.kilde === 'system' && e.tekst.includes('Skift plan'));
    assert.equal(log.length, 1);
    assert.match(log[0]!.tekst, /Fjernede knappen på kortet "Skift plan"/);
  } finally { stop(); await t.ryd(); }
});

test('KC-0259 Nu: a card an earlier Hermes left with a button shows no button once the agent has no tools (the stored card is kept)', async () => {
  const t = await opsaet(false);
  try {
    const k: Kort = { id: 'k:a', type: 'tjeneste', titel: 'Skift plan', betyder: 'b', grundlag: [], kilder: [], anbefaling: 'a', prioritet: 1, handling: { id: 'k:a:h', label: 'Skift plan', instruktion: 'Skift.' } };
    const s: KuratorState = { kort: [k], intet: [], afvist: [], sete: [] };
    await t.store.writeState('hjem', s);
    const out = await t.side('/rum/hjem');
    assert.match(out, /Skift plan/);
    assert.ok(!out.includes('data-kort-handling="k:a"'));
    assert.ok((await laesKurator(t.store)).kort[0]?.handling, 'the file still has it (only the screen is without)');
  } finally { await t.ryd(); }
});
