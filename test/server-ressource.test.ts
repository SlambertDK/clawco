// KC-0150 end to end: resources through createApp. An owner books directly
// (a private line with Fortryd that removes exactly that booking); a non-owner's
// booking is a red request to an owner, booked when accepted. A booking that
// hits another person's booking books nothing: exactly those two get the same
// clash card (beslutning) with Hermes' suggestion first — no other owner, no
// child. Own options apply at once; "Spørg Rikke om at bytte" is a red request,
// and her yes swaps. No code path stores a double booking, also not two taps at
// the same moment.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { TOM_HUSSTAND, type HusstandState } from '../src/hushold/schema.ts';
import { dobbeltBooket } from '../src/hushold/ressource.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-ressource-'));
after(() => rm(rod, { recursive: true, force: true }));

const START = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const RIKKE = { id: 'rikke', login: 'rikke@example.com', navn: 'Rikke', rolle: 'medlem' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const ELLA = { id: 'ella', login: 'ella@example.com', navn: 'Ella', rolle: 'barn' as const };
type Hvem = typeof HENRIK | typeof RIKKE | typeof MAJA | typeof ELLA;

const GOD = '```json\n{"foerste":"v2","anbefaling":"Rikke kører hele dagen; Henrik kunne spørge om at bytte."}\n```';
const SEED: HusstandState = {
  ...TOM_HUSSTAND,
  ressourcer: [
    { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'rikke', 'maja'], kalender: [] },
    { id: 'lille-bil', navn: 'Den lille bil', slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] },
  ],
};

async function lav(navn: string, svar = GOD) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [HENRIK, RIKKE, MAJA, ELLA] });
  const store = createFileStore(dataDir);
  await store.writeState('husstand', SEED);
  await writeFile(path.join(dataDir, 'indstillinger.json'), JSON.stringify({ modeller: { lille: 'model-lille', taenker: 'model-taenker' } }));
  const kald: AgentRunRequest[] = [];
  const a = createApp({
    store, hermes: createFakeAgent({ answer: (req) => { kald.push(req); return svar; } }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => START,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login, 'content-type': 'application/json' } }, LOOPBACK);
  const side = async (p: Hvem, sti = '/rum/husstand') => (await req(p, sti)).text();
  const aktion = async (p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) => {
    let b = body;
    if (medJa) {
      const ja = (await (await req(p, '/api/graense/ja', { method: 'POST', body: JSON.stringify({ rum: 'husstand', slags: 'aktion', id: navn, body }) })).json()) as { ja: string };
      b = { ...body, ja: ja.ja };
    }
    const res = await req(p, `/api/rum/husstand/aktion/${navn}`, { method: 'POST', body: JSON.stringify(b) });
    const j = (await res.json()) as { runId?: string; error?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    return { status: res.status, ...j };
  };
  const fortryd = async (p: Hvem, logId: string) => {
    const res = await req(p, `/api/rum/husstand/log/${logId}/fortryd`, { method: 'POST', body: '{}' });
    if (res.status === 202) await a.runs.get(((await res.json()) as { runId: string }).runId)?.finished;
    return res.status;
  };
  const state = async () => (await store.readState<HusstandState>('husstand'))!;
  const log = async () => store.readLog('husstand', 200);
  return { ...a, req, side, aktion, fortryd, state, log, kald };
}

type App = Awaited<ReturnType<typeof lav>>;
const LOERDAG = '2026-11-07';
const book = (a: App, p: Hvem, start: string, slut: string, titel = 'Tur', ressourceId = 'stor-bil', dag = LOERDAG) =>
  a.aktion(p, 'book', { ressourceId, dag, start, slut, titel });
const kalender = async (a: App, id = 'stor-bil') => (await a.state()).ressourcer.find((r) => r.id === id)!.kalender;
const ingenDobbelt = async (a: App) => assert.ok((await a.state()).ressourcer.every((r) => !dobbeltBooket(r)), 'never a double booking');

/** Rikke holds the big car Saturday 08–16; Henrik's 10–14 hits it. */
async function sammenstoed(a: App) {
  assert.equal((await book(a, RIKKE, '08:00', '16:00', 'Til Odense')).status, 202);
  const r = await book(a, HENRIK, '10:00', '14:00', 'Indkøb');
  assert.equal(r.status, 202, r.error);
  return (await a.state()).sammenfald[0]!;
}

test('an owner books directly: a booking in the shared week, a private line whose Fortryd removes exactly that booking', async () => {
  const a = await lav('book');
  assert.equal((await book(a, HENRIK, '09:00', '12:00', 'Indkøb')).status, 202);
  assert.equal((await book(a, RIKKE, '12:00', '15:00', 'Svømning')).status, 202, 'touching edges do not clash');
  assert.deepEqual((await kalender(a)).map((b) => b.af), ['henrik', 'rikke']);
  const linje = (await a.log()).find((e) => e.ejer === 'henrik' && e.fortryd?.startsWith('lokal:'));
  assert.ok(linje, 'the booking is a line with Fortryd');
  assert.equal(linje.zone, 'privat');
  assert.match(await a.side(HENRIK), new RegExp(`data-fortryd="${linje.id}"`));
  assert.doesNotMatch(await a.side(RIKKE), new RegExp(`data-log="${linje.id}"`), "Henrik's line is his");
  assert.match(await a.side(MAJA), /data-post-kilde="booking"[^>]*>[\s\S]*?Den store bil: Indkøb/);
  assert.equal(await a.fortryd(RIKKE, linje.id), 404);
  assert.equal(await a.fortryd(HENRIK, linje.id), 202);
  assert.deepEqual((await kalender(a)).map((b) => [b.af, b.titel]), [['rikke', 'Svømning']]);
  assert.equal(await a.fortryd(HENRIK, linje.id), 404, 'once');
});

test('the booking input is validated, and booking over your own booking is a plain 409', async () => {
  const a = await lav('validering');
  for (const b of [{ ressourceId: 'raket' }, { ressourceId: 'stor-bil', titel: '' }, { ressourceId: 'stor-bil', start: '14:00', slut: '10:00' }, { ressourceId: 'stor-bil', dag: '2026-10-01' }, { ressourceId: 'stor-bil', dag: '' }]) {
    const r = await a.aktion(HENRIK, 'book', { dag: LOERDAG, start: '10:00', slut: '12:00', titel: 'Tur', ...b });
    assert.ok(r.status === 400 || r.status === 404, `${JSON.stringify(b)}: ${r.status}`);
  }
  await book(a, HENRIK, '10:00', '12:00');
  assert.equal((await book(a, HENRIK, '11:00', '13:00')).status, 409);
  assert.equal((await a.state()).sammenfald.length, 0);
});

test('a clash books nothing: exactly the two bookers get the same card; another owner and a child see nothing', async () => {
  const a = await lav('sammenfald');
  const s = await sammenstoed(a);
  assert.deepEqual((await kalender(a)).map((b) => b.af), ['rikke'], 'nothing displaced, nothing double booked');
  assert.deepEqual([s.ny.af, s.mod.af], ['henrik', 'rikke']);
  const henrik = await a.side(HENRIK), rikke = await a.side(RIKKE);
  for (const h of [henrik, rikke]) {
    assert.match(h, /data-blok="beslutning" data-sammenfald="/);
    assert.match(h, /Rikke kører hele dagen; Henrik kunne spørge om at bytte\./);
  }
  assert.match(henrik, /Spørg Rikke om at bytte/);
  assert.match(rikke, /Lad Henrik få den/);
  for (const p of [MAJA, ELLA]) {
    const h = await a.side(p);
    assert.doesNotMatch(h, /data-sammenfald=/, `${p.id} sees no card`);
    assert.doesNotMatch(await a.side(p, '/rum/hjem'), /Dobbeltbooket/);
  }
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Dobbeltbooket: Den store bil/);
  assert.match(await a.side(RIKKE, '/rum/hjem'), /Dobbeltbooket: Den store bil/);
  // Hermes: one run on the small tier, neutral; its first option is stored as advice.
  assert.equal(a.kald.length, 1);
  assert.equal(a.kald[0]!.model, 'model-lille');
  assert.match(a.kald[0]!.instructions, /neutral/);
  assert.deepEqual((await a.state()).sammenfald[0]!.forslag, { foerste: 'v2', anbefaling: 'Rikke kører hele dagen; Henrik kunne spørge om at bytte.' });
  // Lines: private to each party.
  assert.deepEqual((await a.log()).filter((e) => /kort/.test(e.tekst)).map((e) => [e.zone, e.ejer]).sort(), [['privat', 'henrik'], ['privat', 'rikke']]);
  // The same clash again is not a second card.
  assert.equal((await book(a, HENRIK, '10:00', '14:00', 'Indkøb')).status, 409);
});

test('race: two owners book the same slot at the same moment — one booking wins, the loser gets the card', async () => {
  const a = await lav('kapløb');
  const [x, y] = await Promise.all([book(a, HENRIK, '10:00', '14:00', 'Indkøb'), book(a, RIKKE, '10:00', '14:00', 'Til Odense')]);
  assert.deepEqual([x.status, y.status], [202, 202]);
  const k = await kalender(a);
  assert.equal(k.length, 1);
  const s = (await a.state()).sammenfald;
  assert.equal(s.length, 1);
  assert.equal(s[0]!.mod.af, k[0]!.af);
  assert.notEqual(s[0]!.ny.af, k[0]!.af, 'the loser is the one who wishes');
  await ingenDobbelt(a);
});

test("an own option applies at once: Henrik takes the small car, Rikke keeps hers, the card is gone; the other's option is not his", async () => {
  const a = await lav('egen');
  const s = await sammenstoed(a);
  assert.equal((await a.aktion(HENRIK, 'sammenfald-valg', { id: s.id, valg: 'v2' })).status, 400, "letting go is Rikke's");
  assert.equal((await a.aktion(MAJA, 'sammenfald-valg', { id: s.id, valg: 'v1' })).status, 403, 'not a party');
  assert.equal((await a.aktion(HENRIK, 'sammenfald-valg', { id: 'findes-ikke', valg: 'v1' })).status, 404);
  assert.equal((await a.aktion(HENRIK, 'sammenfald-valg', { id: s.id, valg: 'v1' })).status, 202);
  assert.deepEqual((await kalender(a, 'lille-bil')).map((b) => [b.af, b.titel]), [['henrik', 'Indkøb']]);
  assert.deepEqual((await kalender(a)).map((b) => b.af), ['rikke']);
  assert.equal((await a.state()).sammenfald[0]!.afgjort?.valg, 'v1');
  for (const p of [HENRIK, RIKKE]) assert.doesNotMatch(await a.side(p), /data-sammenfald=/);
  assert.equal((await a.aktion(RIKKE, 'sammenfald-valg', { id: s.id, valg: 'v2' })).status, 409, 'settled');
  assert.ok((await a.log()).some((e) => e.ejer === 'henrik' && e.fortryd?.startsWith('lokal:') && /lille bil/.test(e.tekst)), 'the new booking has Fortryd');
  await ingenDobbelt(a);
});

test('"Spørg Rikke om at bytte" is red and becomes a request to her; her yes swaps the car', async () => {
  const a = await lav('bytte');
  const s = await sammenstoed(a);
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v2' })).status, 403, 'red: a human yes first');
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v1' }, true)).status, 400, 'his own option is not an ask');
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v2' }, true)).status, 202);
  const st = await a.state();
  assert.equal(st.forespoergsler.length, 1);
  const f = st.forespoergsler[0]!;
  assert.deepEqual([f.fra, f.til, f.ressourceId, f.tilstand], ['henrik', 'rikke', 'stor-bil', 'spurgt']);
  assert.equal(st.sammenfald[0]!.forespId, f.id);
  const henrik = await a.side(HENRIK);
  assert.match(henrik, /Du har spurgt Rikke\. Venter på svar\./);
  assert.doesNotMatch(henrik, /data-aktion="sammenfald-spoerg"/);
  assert.equal((await a.aktion(HENRIK, 'sammenfald-spoerg', { id: s.id, valg: 'v3' }, true)).status, 409, 'one ask at a time');
  assert.doesNotMatch(await a.side(MAJA), /bytte/i, 'Maja sees neither card nor request');
  // Rikke says yes: her booking goes, Henrik's wish is booked, stamped with the request.
  assert.equal((await a.aktion(RIKKE, 'svar', { id: f.id, svar: 'ja' })).status, 202);
  assert.deepEqual((await kalender(a)).map((b) => [b.af, b.titel, b.foresporgselId]), [['henrik', 'Indkøb', f.id]]);
  assert.equal((await a.state()).sammenfald[0]!.afgjort?.af, 'rikke');
  assert.ok((await a.log()).some((e) => e.ejer === 'rikke' && /gav slip/.test(e.tekst)));
  await ingenDobbelt(a);
});

test('a non-owner asks an owner (red); a yes books it; a yes after the slot was taken is refused and nothing is double booked', async () => {
  const a = await lav('laan');
  assert.equal((await a.aktion(ELLA, 'book', { ressourceId: 'lille-bil', dag: LOERDAG, start: '10:00', slut: '12:00', titel: 'Spejder' })).status, 403, 'not an owner');
  const laan = (dag: string) => a.aktion(ELLA, 'book-spoerg', { ressourceId: 'lille-bil', dag, start: '10:00', slut: '12:00', titel: 'Spejder' }, true);
  assert.equal((await a.aktion(ELLA, 'book-spoerg', { ressourceId: 'lille-bil', dag: LOERDAG, start: '10:00', slut: '12:00', titel: 'Spejder' })).status, 403, 'red');
  assert.equal((await laan(LOERDAG)).status, 202);
  assert.equal((await laan('2026-11-08')).status, 202);
  const [f1, f2] = (await a.state()).forespoergsler;
  assert.deepEqual([f1!.fra, f1!.til, f1!.ressourceId], ['ella', 'henrik', 'lille-bil'], 'the first owner in the circle');
  assert.equal((await kalender(a, 'lille-bil')).length, 0, 'asking books nothing');
  // Rikke (an owner) books Saturday meanwhile; Henrik's yes to Ella cannot be kept.
  assert.equal((await book(a, RIKKE, '11:00', '13:00', 'Tandlæge', 'lille-bil')).status, 202);
  const nej = await a.aktion(HENRIK, 'svar', { id: f1!.id, svar: 'ja' });
  assert.equal(nej.status, 409);
  assert.equal((await a.state()).forespoergsler[0]!.tilstand, 'spurgt');
  assert.equal((await a.aktion(HENRIK, 'svar', { id: f2!.id, svar: 'ja' })).status, 202);
  assert.deepEqual((await kalender(a, 'lille-bil')).map((b) => [b.af, b.foresporgselId ?? '']), [['rikke', ''], ['ella', f2!.id]]);
  await ingenDobbelt(a);
});

test("Hermes' bad answer writes nothing: an option id outside the set leaves the card without a suggestion", async () => {
  const a = await lav('ond', '```json\n{"foerste":"v9","afgjort":true,"anbefaling":"Book bilen til Henrik."}\n```');
  await sammenstoed(a);
  const s = (await a.state()).sammenfald[0]!;
  assert.equal(s.forslag, undefined);
  assert.equal(s.afgjort, undefined);
  assert.deepEqual((await kalender(a)).map((b) => b.af), ['rikke']);
  assert.doesNotMatch(await a.side(HENRIK), /Book bilen til Henrik/);
});

test('Fortryd of the held booking closes the clash for both (it fell away)', async () => {
  const a = await lav('bortfald');
  await sammenstoed(a);
  const linje = (await a.log()).find((e) => e.ejer === 'rikke' && e.fortryd?.startsWith('lokal:'))!;
  assert.equal(await a.fortryd(RIKKE, linje.id), 202);
  assert.equal((await a.state()).sammenfald[0]!.afgjort?.valg, 'bortfaldet');
  assert.doesNotMatch(await a.side(HENRIK), /data-sammenfald=/);
  assert.ok((await a.log()).some((e) => e.ejer === 'henrik' && /kan booke den nu/.test(e.tekst)));
});

test("a single-user install has no Husstanden: the room and its actions are 404", async () => {
  const dataDir = path.join(rod, 'enebruger');
  const a = createApp({
    store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => START,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent',
  });
  assert.equal((await a.app.request('/rum/husstand', {}, LOOPBACK)).status, 404);
  const r = await a.app.request('/api/rum/husstand/aktion/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ressourceId: 'stor-bil', dag: LOERDAG, start: '10:00', slut: '12:00', titel: 'x' }) }, LOOPBACK);
  assert.equal(r.status, 404);
});
