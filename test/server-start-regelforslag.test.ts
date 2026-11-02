// KC-0227: a rule proposal ("Skal jeg gøre det til en regel?") is answered in Start as well as in Nu — through the SAME
// routes (/api/tillid/forslag/:id/godkend|afvis: owner only, one-time Ja for exactly that proposal), from the same pending
// list. After an answer it is gone from both rooms, and both rooms are told to refetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import type { KuratorState } from '../src/rooms/hjem/kort.ts';
import { laesKurator } from '../src/kurator/kurator.ts';
import { lavReglerLager } from '../src/tillid/lager.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { lavForslag, type Regelforslag } from '../src/tillid/forslag.ts';
import type { StartState } from '../src/rooms/start/schema.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const REGLER = '# Regler for Clawco\n\nnaeste-id: R-0004\n\n## R-0001 · Nyhedsbreve sorteres\n- trin: 1\n- gaelder: mail / nyhedsbrev\n- oprindelse: import 2026-10-01\n- status: aktiv\n\nNyhedsbreve flyttes til deres mapper.\n';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const ingenMail: Runner = async () => ({ code: 0, stdout: '[]', stderr: '' });
const BLOK = { titel: 'Revisor er aldrig rutine', tekst: 'Mails fra revisoren lægger jeg altid i Kræver dig.', trin: 1 as const, gaelder: { kilde: 'mail', slags: 'revisor' } };
/** Step 6 is Klaret (a Ret was heard) but the journey is not Done: Start still shows the explanation card. */
const START: StartState = { startet: '2026-10-31T08:00:00.000Z', trin: { 'foerste-ret': { status: 'klaret' } }, afvist: {}, ret: { art: 'ret', tid: '2026-10-31T08:30:00.000Z', titel: 'Elregningen', kortId: 'k1' } };
const tom = (over: Partial<KuratorState> = {}): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [], ...over });
const forslag = (over: Partial<Regelforslag> = {}): Regelforslag => ({ ...lavForslag(BLOK, { kort: { id: 'regning:revisor', titel: 'Revisoren: regning' }, art: 'ret', nu: NOW }), ...over });

async function opsaet(o: { svar?: string } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-forslag-'));
  const dataDir = path.join(dir, 'data');
  const vaultRod = path.join(dir, 'vault');
  const store = createFileStore(dataDir);
  await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' },
  ] });
  const lager = lavReglerLager({ vaultDir: vaultRod, dataDir });
  await lager.skrivTekst(REGLER);
  await store.writeState('start', START);
  const hermes = createFakeAgent({ answer: () => o.svar ?? 'Noteret.' });
  const sut = createApp({
    store, hermes, dataDir, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: ingenMail, mailStateDir: path.join(dir, 'state'),
    now: () => NOW, personer: '/vault/personer', vaultInbox: path.join(vaultRod, '00-Indbakke'),
  });
  const som = (hvem: string): Record<string, string> => ({ 'Tailscale-User-Login': `${hvem}@example.com` });
  const post = (url: string, body: unknown, hvem = 'henrik'): Promise<Response> =>
    Promise.resolve(sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...som(hvem) }, body: JSON.stringify(body) }, LOOPBACK));
  const side = async (url: string, hvem = 'henrik'): Promise<string> => (await sut.app.request(url, { headers: som(hvem) }, LOOPBACK)).text();
  const ja = async (id: string, hvem = 'henrik'): Promise<string> => ((await (await post('/api/graense/ja', { rum: 'hjem', slags: 'forslag', id }, hvem)).json()) as { ja: string }).ja;
  return { store, sut, post, side, ja, lager, hermes, kurator: () => laesKurator(store), ryd: () => rm(dir, { recursive: true, force: true }) };
}
const kort = (h: string): number => (h.match(/<article[^>]*data-regelforslag="/g) ?? []).length;
const iStart = (h: string): number => (h.match(/data-regelforslag-start="/g) ?? []).length;

test('Ja in Start: the same route writes the rule once, and the proposal is gone from Start and from Nu', async () => {
  const t = await opsaet();
  try {
    const f = forslag();
    await t.store.writeState('hjem', tom({ regelforslag: [f] }));
    const foer = [await t.side('/rum/start'), await t.side('/rum/hjem')];
    assert.equal(kort(foer[0]!), 1, 'Start shows it');
    assert.equal(iStart(foer[0]!), 1);
    assert.equal(kort(foer[1]!), 1, 'and so does Nu');
    assert.equal(iStart(foer[1]!), 0, 'the Start mark is Start\'s only');
    assert.ok(foer[0]!.indexOf('data-tillidskort') < foer[0]!.indexOf('data-regelforslag="'), 'under the explanation card');
    const bevaegelser: string[] = [];
    for (const rum of ['start', 'hjem']) t.sut.live.subscribe(rum, () => bevaegelser.push(rum));
    const res = await t.post(`/api/tillid/forslag/${f.id}/godkend`, { ja: await t.ja(f.id) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: f.id, regelId: 'R-0004' });
    assert.match(await readFile(t.lager.fil, 'utf8'), /## R-0004 · Revisor er aldrig rutine/);
    assert.equal(kort(await t.side('/rum/start')), 0, 'gone from Start, not greyed');
    assert.equal(kort(await t.side('/rum/hjem')), 0, 'gone from Nu');
    assert.ok(bevaegelser.includes('start') && bevaegelser.includes('hjem'), `both rooms were told: ${bevaegelser.join(',')}`);
  } finally { await t.ryd(); }
});

test('Nej tak in Start: gone from both rooms, both told, and no rule written', async () => {
  const t = await opsaet();
  try {
    const f = forslag();
    await t.store.writeState('hjem', tom({ regelforslag: [f] }));
    const bevaegelser: string[] = [];
    for (const rum of ['start', 'hjem']) t.sut.live.subscribe(rum, () => bevaegelser.push(rum));
    const foer = await readFile(t.lager.fil, 'utf8');
    assert.equal((await t.post(`/api/tillid/forslag/${f.id}/afvis`, {})).status, 200);
    assert.equal(kort(await t.side('/rum/start')) + kort(await t.side('/rum/hjem')), 0);
    assert.equal(await readFile(t.lager.fil, 'utf8'), foer);
    assert.ok(bevaegelser.includes('start') && bevaegelser.includes('hjem'), bevaegelser.join(','));
  } finally { await t.ryd(); }
});

test('a member sees no proposal in Start, and the route answers 403 as before; a decided proposal is not on screen', async () => {
  const t = await opsaet();
  try {
    const f = forslag();
    const afvist = forslag({ id: 'rf-afvist', kortId: 'a', status: 'afvist', afgjort: NOW.toISOString() });
    await t.store.writeState('hjem', tom({ regelforslag: [f, afvist] }));
    assert.equal(kort(await t.side('/rum/start', 'maja')), 0, 'the household\'s rules are the owner\'s');
    assert.equal(kort(await t.side('/rum/start')), 1, 'the owner sees the pending one only');
    const foer = await readFile(t.lager.fil, 'utf8');
    assert.equal((await t.post(`/api/tillid/forslag/${f.id}/godkend`, { ja: await t.ja(f.id, 'maja') }, 'maja')).status, 403);
    assert.equal((await t.post(`/api/tillid/forslag/${f.id}/afvis`, {}, 'maja')).status, 403);
    assert.equal((await t.post(`/api/tillid/forslag/${f.id}/godkend`, {})).status, 403, 'no one-time yes: no rule');
    assert.equal(await readFile(t.lager.fil, 'utf8'), foer);
    assert.equal((await t.kurator()).regelforslag?.find((x) => x.id === f.id)?.status, 'afventer');
  } finally { await t.ryd(); }
});

test('Ret reglen from Start goes through Nu\'s chat: Hermes revises the proposal, and Start shows the new one', async () => {
  const t = await opsaet({ svar: `Smallere nu.\n\`\`\`json\n${JSON.stringify({ regelforslag: { ...BLOK, titel: 'Kun revisorens regninger' } })}\n\`\`\`` });
  try {
    const f = forslag();
    await t.store.writeState('hjem', tom({ regelforslag: [f] }));
    const res = await t.post('/api/rum/start/chat', { besked: 'Kun regninger, ikke alt.', kontekst: `Forslag: ${f.titel}` });
    assert.equal(res.status, 202);
    const r = await t.sut.runs.get(((await res.json()) as { runId: string }).runId)!.finished;
    assert.equal(r.status, 'done', r.error);
    assert.match(t.hermes.calls.at(-1)?.input ?? '', /Revisor er aldrig rutine/, 'Hermes was shown the proposal being corrected');
    const h = await t.side('/rum/start');
    assert.equal(kort(h), 1);
    assert.match(h, /Kun revisorens regninger/);
    assert.doesNotMatch(h, />Revisor er aldrig rutine</, 'the old wording is replaced, not kept beside it');
  } finally { await t.ryd(); }
});
