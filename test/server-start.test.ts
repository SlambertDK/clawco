// KC-0126: the Start room through the app. First run: GET / lands in Start,
// once. Step 1 (velkommen-gem) validates the profile, writes profil.json
// atomically, logs the previous profile as its undo. Start leaves the nav when
// the journey is Done and comes back only with a suggestion. An install like
// kira-home (agent reachable, legacy sources connected, cards in Nu, a Luk in
// the log, no profile and no Start state) never sees onboarding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { falskeKilder, type FalskData } from '../src/kilder/falsk/falsk.ts';
import { skrivKonfig } from '../src/kilder/register.ts';
import type { Kilde } from '../src/kilder/types.ts';
import type { Person } from '../src/identitet/husstand.ts';
import type { RumLager } from '../src/store/types.ts';
import type { RegelSeam } from '../src/rooms/start/regelforslag.ts';
import type { StartState } from '../src/rooms/start/schema.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const dageSiden = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const kuvert = (id: string, emne: string, n: number) => ({ id, emne, fra: 'Clara', modtaget: dageSiden(n), laest: false, flag: false, vedhaeftning: false });

const DATA: FalskData = {
  kalender: () => ({ generated: NOW.toISOString(), days: [], errors: [] }),
  mail: () => [kuvert('1', 'Invitation: Frokost', 1), kuvert('2', 'Opdateret invitation: Standup', 3), kuvert('3', 'Mødeindkaldelse: Budget', 6), kuvert('4', 'Faktura', 2)],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};

/** Host-connected sources like kira-home's legacy adapters (standard: forbundet). */
const legacy = (id: string, slags: 'kalender' | 'mail'): Kilde => ({
  id, navn: id, slags, zone: 'privat', auth: 'local', tillid: 'uklar', standard: 'forbundet',
  read: async (ctx) => (slags === 'kalender' ? { slags, hentet: ctx.nu.toISOString(), uklar: true, data: DATA.kalender(ctx.nu) } : { slags, hentet: ctx.nu.toISOString(), uklar: true, data: DATA.mail(ctx.nu) }),
  kort: async () => ({ titel: id, tekst: 'x', felter: [], handling: 'Forbind' }),
  helbred: async () => ({ status: 'ok' }),
});

type Sut = ReturnType<typeof createApp> & { dir: string; store: RumLager; hermes: ReturnType<typeof createFakeAgent> };
async function medApp(o: { person?: Person; kilder?: Kilde[]; regelforslag?: RegelSeam }, fn: (s: Sut) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-start-'));
  try {
    const store = createFileStore(dir);
    const hermes = createFakeAgent({ answer: () => 'Hej.' });
    const app = createApp({
      store, hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: o.person ?? EJER },
      kilder: o.kilder ?? [],
      ...(o.regelforslag ? { regelforslag: o.regelforslag } : {}),
    });
    await fn({ ...app, dir, store, hermes });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (s: Sut, url: string, body: unknown = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function vent(s: Sut, res: Response) {
  const text = await res.text();
  assert.equal(res.status, 202, text);
  return s.runs.get((JSON.parse(text) as { runId: string }).runId)!.finished;
}
const side = async (s: Sut, url: string): Promise<string> => (await s.app.request(url)).text();
const iNav = (h: string): boolean => /<li><a href="\/rum\/start"/.test(h);
const findes = (f: string): Promise<boolean> => access(f).then(() => true, () => false);

/** Nu as kira-home has it: one Kuratoren card, and a card Henrik closed (Ikke relevant). */
async function brugtNu(store: RumLager): Promise<void> {
  await store.writeState('hjem', { kort: [{ id: 'k1', type: 'regning', titel: 'Elregningen', betyder: 'Den er steget.', grundlag: [], kilder: [], anbefaling: 'Tjek aftalen', prioritet: 1 }], intet: [], afvist: [], sete: [] });
  await store.appendLog('hjem', { kilde: 'henrik', tekst: 'Lukkede "Nyhedsbrev": ikke relevant for mig' });
}

test('first run: GET / lands in Start once; Start is in the nav with step 1 open', async () => {
  await medApp({}, async (s) => {
    const r = await s.app.request('/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/rum/start');
    const h = await side(s, '/rum/start');
    assert.match(h, /<body data-room="start"/);
    assert.match(h, /data-trin="velkommen" data-trin-status="ikke-startet"/);
    assert.ok(iNav(h), 'Start in the nav');
    assert.equal((await s.app.request('/')).headers.get('location'), '/rum/hjem', 'second time: Nu');
    assert.ok(iNav(await side(s, '/rum/hjem')), 'still in the nav while the journey is not Done');
  });
});

test('velkommen-gem: bad input is a 400 and writes nothing', async () => {
  await medApp({}, async (s) => {
    for (const bad of [{ navn: '', sprog: 'da', husstand: 'alene' }, { navn: 'A'.repeat(61), sprog: 'da', husstand: 'alene' }, { navn: 'Alma', sprog: 'de', husstand: 'alene' }, { navn: 'Alma', sprog: 'da', husstand: 'familie' }]) {
      const r = await post(s, '/api/rum/start/aktion/velkommen-gem', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(await findes(path.join(s.dir, 'profil.json')), false);
  });
});

test('velkommen-gem: only the owner saves the profile', async () => {
  await medApp({ person: MEDLEM }, async (s) => {
    const r = await post(s, '/api/rum/start/aktion/velkommen-gem', { navn: 'Maja', sprog: 'da', husstand: 'husstand' });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /ejeren/);
    assert.equal(await findes(path.join(s.dir, 'profil.json')), false);
  });
});

test('velkommen-gem saves the profile atomically, the step turns Klaret, Hermes is told; Fortryd restores the previous profile', async () => {
  await medApp({}, async (s) => {
    const run = await vent(s, await post(s, '/api/rum/start/aktion/velkommen-gem', { navn: '  Alma ', sprog: 'en', husstand: 'husstand' }));
    assert.equal(run.status, 'done', run.error);
    assert.deepEqual(JSON.parse(await readFile(path.join(s.dir, 'profil.json'), 'utf8')), { navn: 'Alma', sprog: 'en', husstand: 'husstand' });
    assert.deepEqual((await readdir(s.dir)).filter((f) => f.startsWith('profil.json.tmp')), []);
    const h = await side(s, '/rum/start');
    assert.match(h, /data-trin="velkommen" data-trin-status="klaret"/);
    assert.match(h, /Du hedder Alma/);
    const [linje] = await s.store.readLog('start');
    assert.equal(linje?.handlingId, 'velkommen-gem');
    assert.ok(linje?.fortryd?.startsWith('lokal:'));

    // The profile reaches every run: the name and the language Hermes answers in.
    await vent(s, await post(s, '/api/rum/start/chat', { besked: 'Hvad nu?' }));
    const instr = s.hermes.calls.at(-1)?.instructions ?? '';
    assert.match(instr, /Alma/);
    assert.match(instr, /English/);

    // A second save changes it; Fortryd brings the first back, a second Fortryd removes it again.
    await vent(s, await post(s, '/api/rum/start/aktion/velkommen-gem', { navn: 'Alma B', sprog: 'da', husstand: 'alene' }));
    const [ny] = await s.store.readLog('start');
    await vent(s, await post(s, `/api/rum/start/log/${ny!.id}/fortryd`));
    assert.equal(JSON.parse(await readFile(path.join(s.dir, 'profil.json'), 'utf8')).navn, 'Alma');
    await vent(s, await post(s, `/api/rum/start/log/${linje!.id}/fortryd`));
    assert.equal(await findes(path.join(s.dir, 'profil.json')), false);
    assert.match(await side(s, '/rum/start'), /data-trin="velkommen" data-trin-status="i-gang"/, 'the step reopens: its real condition is gone');
  });
});

test('an install like kira-home never sees onboarding: no redirect, Start not in the nav, nothing of Start in Nu', async () => {
  await medApp({ kilder: [legacy('kira-kalender', 'kalender'), legacy('kira-mail', 'mail')] }, async (s) => {
    await brugtNu(s.store);
    assert.equal((await s.app.request('/')).headers.get('location'), '/rum/hjem');
    const nu = await side(s, '/rum/hjem');
    assert.ok(!iNav(nu), 'Start not in the nav');
    assert.ok(!nu.includes('Velkommen'), 'no Start line in Nu');
    const frag = (await (await s.app.request('/api/rum/hjem/fragment')).json()) as { venter: Record<string, number> };
    assert.equal(frag.venter['start'], undefined, 'Start counts nothing');
    // Done is latched: Nu empty later does not bring Start back.
    await s.store.writeState('hjem', { kort: [], intet: [], afvist: [], sete: [] });
    assert.ok(!iNav(await side(s, '/rum/hjem')));
    assert.equal((await s.app.request('/')).headers.get('location'), '/rum/hjem');
  });
});

test('after Done, Start returns with a suggestion (calendar, three invites in mail) and goes when it is dismissed', async () => {
  const kilder = falskeKilder({ data: DATA, forsinkelseMs: 0 });
  await medApp({ kilder }, async (s) => {
    await brugtNu(s.store);
    await skrivKonfig(s.dir, { kilder: [{ id: 'falsk-mail', status: 'forbundet', zone: 'privat', valg: {}, tid: NOW.toISOString(), af: 'henrik' }] });
    const nu = await side(s, '/rum/hjem');
    assert.ok(iNav(nu), 'Start is back');
    const h = await side(s, '/rum/start');
    assert.match(h, /data-forslag-kilde="falsk-kalender"/);
    assert.match(h, /3 invitationer/);
    const run = await vent(s, await post(s, '/api/rum/start/aktion/forslag-afvis', { kildeId: 'falsk-kalender' }));
    assert.equal(run.status, 'done', run.error);
    assert.ok(!iNav(await side(s, '/rum/hjem')), 'gone after Ikke nu');
    assert.equal((await post(s, '/api/rum/start/aktion/forslag-afvis', { kildeId: 'findes-ikke' })).status, 400);
  });
});

// KC-0130: step 6 through the real routes — Luk (Ikke relevant) is heard by Start, the step turns Klaret, the
// explanation card stands, E4's proposal waits for the user's own Ja, and Done follows (derived, once).
test('KC-0130: Ikke relevant through Luk completes step 6 and Done; E4\'s proposal is created only by the Ja POST', async () => {
  const opret: unknown[] = [];
  const regelforslag: RegelSeam = {
    foreslaaRegel: (h) => ({ titel: `Skjul ${h.titel}`, tekst: 'Kort af den slags vises ikke igen.', trin: 1, gaelder: { kilde: 'kurator', slags: 'regning' }, oprindelse: { art: 'ikke-relevant' } }),
    opretRegel: async (f) => { opret.push(f); return { id: 'R-0003' }; },
  };
  await medApp({ regelforslag }, async (s) => {
    await side(s, '/rum/start'); // the journey begins: Start has a state
    await s.store.writeState('hjem', { kort: [{ id: 'k1', type: 'regning', titel: 'Elregningen', betyder: 'Den er steget.', grundlag: [], kilder: [], anbefaling: 'Tjek aftalen', prioritet: 1 }], intet: [], afvist: [], sete: [] });
    const foer = await side(s, '/rum/start');
    assert.match(foer, /data-trin="foerste-ret" data-trin-status="ikke-startet"/);
    assert.match(foer, /data-foerste-ret="aaben"/);
    assert.match(foer, /»Elregningen« i Nu/, 'points at the card that carries Ret');
    assert.ok(iNav(await side(s, '/rum/hjem')));
    assert.equal((await vent(s, await post(s, '/api/rum/hjem/kort/k1/luk', { grund: 'ikke relevant for mig' }))).status, 'done'); // the reason starts Hermes' learning run
    const efter = await side(s, '/rum/start');
    assert.match(efter, /data-trin="foerste-ret" data-trin-status="klaret"/);
    assert.match(efter, /data-tillidskort/);
    assert.match(efter, /data-regel-forslag="/);
    assert.deepEqual(opret, [], 'the proposal is shown, not created');
    const st = JSON.parse(await readFile(path.join(s.dir, 'rum', 'start', 'state.json'), 'utf8')) as StartState;
    assert.equal(st.ret?.art, 'ikke-relevant');
    assert.equal(st.ret?.tekst, 'ikke relevant for mig');
    assert.ok(st.faerdig, 'Done latched: an element (the closed card) and the Ret');
    assert.ok(!iNav(await side(s, '/rum/hjem')), 'Start folded away');
    const id = /data-regel-forslag="([0-9a-f]{12})"/.exec(efter)![1]!;
    assert.equal((await post(s, '/api/rum/start/aktion/regel-ja', { forslagId: 'ffffffffffff' })).status, 400, 'a proposal Start did not offer');
    assert.deepEqual(opret, []);
    const run = await vent(s, await post(s, '/api/rum/start/aktion/regel-ja', { forslagId: id }));
    assert.equal(run.status, 'done', run.error);
    assert.equal(opret.length, 1);
    assert.doesNotMatch(await side(s, '/rum/start'), /data-regel-forslag="/, 'answered: the block is gone');
  });
});

test('KC-0130: a Ret on a card in Hjem\'s chat completes step 6 the same way, and without E4 there is no proposal', async () => {
  await medApp({}, async (s) => {
    await side(s, '/rum/start');
    await s.store.writeState('hjem', { kort: [{ id: 'k1', type: 'regning', titel: 'Elregningen', betyder: 'Den er steget.', grundlag: [], kilder: [], anbefaling: 'Tjek aftalen', prioritet: 1 }], intet: [], afvist: [], sete: [] });
    const run = await vent(s, await post(s, '/api/rum/hjem/chat', { besked: 'Den hører til i det private regnskab.', kontekst: 'Kortet: Elregningen' }));
    assert.equal(run.status, 'done', run.error);
    const h = await side(s, '/rum/start');
    assert.match(h, /data-trin="foerste-ret" data-trin-status="klaret"/);
    assert.match(h, /data-tillidskort/);
    assert.doesNotMatch(h, /data-regel-forslag/);
    const st = JSON.parse(await readFile(path.join(s.dir, 'rum', 'start', 'state.json'), 'utf8')) as StartState;
    assert.equal(st.ret?.art, 'ret');
    assert.equal(st.ret?.kortId, 'k1');
  });
});
