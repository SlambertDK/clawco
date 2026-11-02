// KC-0128: steps 3–4 through the app with the fake connectors and a gated fake
// agent. Connect → a preview built from the read stands in Nu before Hermes has
// answered; when the matching room rebuild lands, the preview is replaced (same
// stable id, never beside it); foersteVaerdiMs is recorded. A failed first read
// shows the connector's own words. The cards are the registry's, not Start's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentClient, AgentRunRequest } from '../src/agent/types.ts';
import { falskeKilder, type FalskData, type FalskTilstand } from '../src/kilder/falsk/falsk.ts';
import { laesKonfig, skrivKonfig } from '../src/kilder/register.ts';
import type { Kilde, Slags } from '../src/kilder/types.ts';
import { googleKalender } from '../src/kilder/google-kalender/kilde.ts';
import type { Person } from '../src/identitet/husstand.ts';
import type { RumLager } from '../src/store/types.ts';
import type { StartState } from '../src/rooms/start/schema.ts';

const NOW = new Date('2026-10-31T09:30:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const kuvert = (id: string, fra: string, laest = false) => ({ id, emne: `Brev ${id}`, fra, modtaget: NOW.toISOString(), laest, flag: false, vedhaeftning: false });
const DATA: FalskData = {
  kalender: () => ({ generated: NOW.toISOString(), days: [{ date: '2026-10-31', events: [{ calendar: 'A', title: 'Standup', start: '2026-10-31T09:00:00+01:00', end: '2026-10-31T09:15:00+01:00', all_day: false, location: null }] }], errors: [] }),
  mail: () => [kuvert('1', 'Clara'), kuvert('2', 'Skolen'), kuvert('3', 'Banken', true)],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};
const MAIL_SVAR = { beslutninger: [{ mailId: '1', emne: 'Brev 1', fra: 'Clara', modtaget: NOW.toISOString(), type: 'svar', resume: 'Clara spørger.', betydning: 'Svar i dag.', arkivmappe: 'Archive', muligheder: [] }], hermesStatus: 'Holder øje' };

type Sut = ReturnType<typeof createApp> & { dir: string; store: RumLager; aabn: () => void; kald: AgentRunRequest[] };
async function medApp(o: { tilstand?: Partial<Record<Slags, FalskTilstand>>; ekstra?: Kilde[]; kilder?: Kilde[] }, fn: (s: Sut) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-kilder-'));
  let aabn!: () => void;
  const port = new Promise<void>((res) => { aabn = res; });
  const fake = createFakeAgent({ answer: (req) => (req.instructions.includes('svar med præcis dette skema') ? '```json\n' + JSON.stringify(MAIL_SVAR) + '\n```' : 'ok') });
  // The agent is scripted to wait until the test opens the gate: Hermes has not answered yet.
  const hermes: AgentClient = { ...fake, run: async (req) => { await port; return fake.run(req); } };
  try {
    const store = createFileStore(dir);
    const app = createApp({
      store, hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent', identitet: { fast: EJER },
      kilder: o.kilder ?? [...falskeKilder({ data: DATA, forsinkelseMs: 0, tilstand: (s) => o.tilstand?.[s] ?? 'ok' }), ...(o.ekstra ?? [])],
    });
    try { await fn({ ...app, dir, store, aabn, kald: fake.calls }); } finally {
      // Let every released run and its listeners finish writing before the dir goes.
      aabn();
      await Promise.all(app.runs.list().map((r) => r.finished.catch(() => null)));
      await new Promise((res) => setTimeout(res, 50));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (s: Sut, url: string, body: unknown = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const nu = async (s: Sut): Promise<string> => ((await (await s.app.request('/api/rum/hjem/fragment')).json()) as { html: string }).html;
const side = async (s: Sut, url: string): Promise<string> => (await s.app.request(url)).text();
const ider = (h: string): string[] => [...h.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]!);
const startState = async (s: Sut): Promise<StartState> => (await s.store.readState('start')) as StartState;
const forbindMail = (s: Sut, zone?: string) => post(s, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'alma', adgangskode: 'hemmelig' }, ...(zone ? { zone } : {}) });
const venPaaKoersler = async (s: Sut): Promise<void> => { await Promise.all(s.runs.list().map((r) => r.finished)); };
/** The finished-run listeners write after the run settles: wait (bounded) until `ok` holds. */
async function indtil(ok: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 50 && !(await ok()); i++) await new Promise((res) => setTimeout(res, 10));
}

test('connect mail: the preview stands in Nu before Hermes answers, then the curated view replaces it under the same id', async () => {
  await medApp({}, async (s) => {
    const r = await forbindMail(s);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(((await r.json()) as { foersteLaesning: { antal: number } }).foersteLaesning.antal, 3);

    const foer = await nu(s);
    assert.match(foer, /data-id="forhaandsvisning-falsk-mail"/);
    assert.match(foer, /2 ulæste/);
    assert.match(foer, /De nyeste fra Clara og Skolen/);
    assert.ok(s.runs.list().some((x) => x.room === 'mail' && x.kind === 'opdater' && x.status !== 'done'), 'the Mail rebuild is running, not done');
    assert.equal(s.kald.length, 0, 'Hermes has not answered anything yet');

    const st = await startState(s);
    const v = st.kilder?.['falsk-mail'];
    assert.ok(v && typeof v.foersteVaerdiMs === 'number' && v.foersteVaerdiMs >= 0, 'foersteVaerdiMs recorded');
    assert.equal(v?.rum, 'mail');
    assert.ok((await s.store.readLog('start', 20)).some((e) => /Første kig fra Falsk mail efter/.test(e.tekst)), 'logged with the timing');

    s.aabn();
    await venPaaKoersler(s);
    await indtil(async () => Boolean((await startState(s)).kilder?.['falsk-mail']?.erstattet));
    const efter = await nu(s);
    assert.doesNotMatch(efter, /forhaandsvisning-falsk-mail/, 'replaced, not beside');
    assert.match(efter, /href="\/rum\/mail"/, 'the curated Mail line is in Nu');
    const alle = ider(efter);
    assert.equal(new Set(alle).size, alle.length, 'no duplicate element id');
    assert.ok((await startState(s)).kilder?.['falsk-mail']?.erstattet, 'marked replaced');
  });
});

test('connect the calendar through its login: back in Nu with the preview, and Dagen is being rebuilt', async () => {
  await medApp({}, async (s) => {
    const r = await post(s, '/api/kilder/falsk-kalender/forbind', {});
    const { omdiriger } = (await r.json()) as { omdiriger: string };
    const tilbage = await s.app.request(omdiriger);
    assert.equal(tilbage.status, 302);
    const h = await nu(s);
    assert.match(h, /data-id="forhaandsvisning-falsk-kalender"/);
    assert.match(h, /1 aftale i dag/);
    assert.match(h, /Første kl\. 09\.00: Standup/);
    assert.ok(s.runs.list().some((x) => x.room === 'dagen'), 'Dagen rebuild started');
    assert.match(await side(s, '/rum/start'), /data-trin="foerste-kilde" data-trin-status="klaret"/);
  });
});

test('a connect whose first read failed shows the connector\'s own error, not a blank card', async () => {
  await medApp({ tilstand: { mail: 'nede' } }, async (s) => {
    const r = await forbindMail(s);
    assert.equal(((await r.json()) as { foersteLaesning: unknown }).foersteLaesning, null);
    assert.doesNotMatch(await nu(s), /forhaandsvisning-/);
    const h = await side(s, '/rum/start');
    assert.match(h, /data-kilde-fejl="falsk-mail"/);
    assert.match(h, /Kilden svarer ikke\./);
    assert.match(h, /data-trin="foerste-kilde" data-trin-status="ikke-startet"/);
  });
});

// KC-0133: a card with setup steps (Google Calendar before the install's own Google app exists) shows them one at a
// time (an exclusive accordion, the first open), the redirect address with a copy button, and its env-file fields
// as ordinary fields of the form (the registry sends them to the env file).
test('step 3 shows a card\'s setup steps one at a time, with the address to copy, and its env fields as ordinary fields', async () => {
  await medApp({ ekstra: [googleKalender({ env: {}, adresse: 'https://kc.example' })] }, async (s) => {
    const h = await side(s, '/rum/start');
    assert.match(h, /data-kilde-kort="google-kalender"/);
    const trin = [...h.matchAll(/<details class="kilde-trin-et" name="kilde-trin-google-kalender"( open)?>/g)];
    assert.equal(trin.length, 7, 'every step');
    assert.deepEqual(trin.map((m) => Boolean(m[1])), [true, false, false, false, false, false, false], 'only the first is open');
    assert.match(h, /Trin 1 af 7/);
    assert.match(h, /data-kopier="https:\/\/kc\.example\/api\/kilder\/google-kalender\/tilbage"/);
    assert.match(h, /name="klient_id" type="text" required/);
    assert.match(h, /name="klient_hemmelighed" type="password"/);
    assert.match(h, /data-kilde-forbind="google-kalender"[^>]*>Gem og log ind med Google</);
    assert.doesNotMatch(h, /data-kilde-trin="falsk-mail"/, 'a card without steps shows none');
  });
});

test('step 3 offers the registry\'s calendar and mail cards with their fields and zone; another connector adds a card without Start code', async () => {
  const anden: Kilde = {
    id: 'anden-kalender', navn: 'Anden kalender', slags: 'kalender', zone: 'arbejde', auth: 'local', tillid: 'uklar',
    read: async (ctx) => ({ slags: 'kalender', hentet: ctx.nu.toISOString(), uklar: true, data: DATA.kalender(ctx.nu) }),
    kort: async () => ({ titel: 'Anden kalender', tekst: 'Arbejdskalenderen.', felter: [{ navn: 'konto', etiket: 'Konto', type: 'tekst', paakraevet: true, muligheder: [{ vaerdi: 'a', etiket: 'Konto A' }] }], handling: 'Forbind' }),
    helbred: async () => ({ status: 'ok' }),
  };
  await medApp({ ekstra: [anden] }, async (s) => {
    const h = await side(s, '/rum/start');
    const kort = [...h.matchAll(/data-kilde-kort="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(kort, ['falsk-kalender', 'falsk-mail', 'anden-kalender'], 'step 3: calendar and mail only, in registry order');
    assert.match(h, /data-kilde-forbind="falsk-mail"/);
    assert.match(h, /name="adgangskode" type="password"/);
    assert.match(h, /<option value="a">Konto A<\/option>/, 'a field with choices renders them');
    assert.match(h, /Det her er[\s\S]*?<option value="arbejde" selected>/, 'the connector\'s default zone, changeable');
    assert.doesNotMatch(h, /data-trin="flere-kilder"/, 'step 4 is not on screen before step 3 holds');
  });
});

test('connect with another zone: the source and its preview are in that zone', async () => {
  await medApp({}, async (s) => {
    await forbindMail(s, 'arbejde');
    assert.equal((await laesKonfig(s.dir)).kilder.find((k) => k.id === 'falsk-mail')?.zone, 'arbejde');
    assert.match(await nu(s), /data-forhaandsvisning="falsk-mail" data-kilde="falsk-mail" data-datazone="arbejde"/);
  });
});

test('step 4 offers one source at a time — the other of calendar/mail first — and Spring over takes it off screen', async () => {
  await medApp({}, async (s) => {
    s.aabn();
    await forbindMail(s);
    let h = await side(s, '/rum/start');
    assert.match(h, /data-trin="flere-kilder"/);
    const flere = (x: string): string[] => [...(/data-trin="flere-kilder"[\s\S]*?<\/article>/.exec(x)?.[0] ?? '').matchAll(/data-kilde-kort="([^"]+)"/g)].map((m) => m[1]!);
    assert.deepEqual(flere(h), ['falsk-kalender']);
    const r = await post(s, '/api/rum/start/aktion/kilde-spring-over', { kildeId: 'falsk-kalender' });
    assert.equal(r.status, 202, await r.clone().text());
    await venPaaKoersler(s);
    h = await side(s, '/rum/start');
    assert.deepEqual(flere(h), ['falsk-noter']);
    assert.ok((await startState(s)).sprunget?.['falsk-kalender']);
    assert.equal((await post(s, '/api/rum/start/aktion/kilde-spring-over', { kildeId: 'ukendt' })).status, 400);
  });
});

test('an install like kira-home (Done latched, legacy sources connected) never sees the new steps', async () => {
  const legacy = (id: string, slags: 'kalender' | 'mail'): Kilde => ({
    id, navn: id, slags, zone: 'privat', auth: 'local', tillid: 'uklar', standard: 'forbundet',
    read: async (ctx) => (slags === 'kalender' ? { slags, hentet: ctx.nu.toISOString(), uklar: true, data: DATA.kalender(ctx.nu) } : { slags, hentet: ctx.nu.toISOString(), uklar: true, data: DATA.mail(ctx.nu) }),
    kort: async () => ({ titel: id, tekst: 'x', felter: [], handling: 'Forbind' }),
    helbred: async () => ({ status: 'ok' }),
  });
  await medApp({ kilder: [legacy('kira-kalender', 'kalender'), legacy('kira-mail', 'mail'), { ...legacy('kira-nyheder', 'kalender'), slags: 'nyheder' } as Kilde, { ...legacy('kira-noter', 'kalender'), slags: 'noter' } as Kilde] }, async (s) => {
    await s.store.writeState('start', { startet: NOW.toISOString(), trin: {}, afvist: {}, faerdig: NOW.toISOString() } satisfies StartState);
    await skrivKonfig(s.dir, { kilder: [] });
    const h = await side(s, '/rum/hjem');
    assert.doesNotMatch(h, /<li><a href="\/rum\/start"/, 'Start stays out of the nav');
    assert.doesNotMatch(h, /Start: Første kilde/);
    assert.doesNotMatch(h, /forhaandsvisning-/);
    assert.equal((await s.app.request('/')).headers.get('location'), '/rum/hjem');
  });
});
