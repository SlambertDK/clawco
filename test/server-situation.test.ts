import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { PRODUKT } from '../src/shell/navn.ts';
import { arkiverUnivers, endreIndeks, endreUnivers, opretUnivers, universRum } from '../src/rooms/univers/lager.ts';
import type { Moede } from '../src/rooms/univers/schema.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const START = '2026-10-27T12:00:00.000Z';
const SLUT = '2026-10-27T13:00:00.000Z';
const SLIDES = '<!doctype html><html><body><h1>Arena</h1></body></html>';
let nu = new Date('2026-10-27T08:00:00.000Z');

let dir = '';
let sut: ReturnType<typeof createApp>;
let store: ReturnType<typeof createFileStore>;

const moede = (over: Partial<Moede> = {}): Moede => ({ id: 'moede-arena1', kilde: 'manuel', titel: 'Arena kickoff', start: START, slut: SLUT, deltagere: [{ navn: 'Jonas Holm' }], ...over });
const forberedt = (): Moede => moede({ forberedelse: { maal: 'Få rollen afklaret', deltagere: [{ navn: 'Jonas Holm', hvem: 'Din leder', baggrund: 'Otte år i huset', vil: 'Høre din plan' }], talepunkter: ['Åbn med planen', 'Spørg til tallene'], dokumentId: 'dok-slides1', tid: '2026-10-26T10:00:00.000Z' } });
const side = async (url: string): Promise<{ status: number; text: string; location: string | null }> => { const r = await sut.app.request(url); return { status: r.status, text: await r.text(), location: r.headers.get('location') }; };
const situation = async (): Promise<{ situation: string; moede: Record<string, string> | null }> => (await sut.app.request('/api/situation')).json() as Promise<{ situation: string; moede: Record<string, string> | null }>;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-situation-'));
  store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'Intet.' }), sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => nu, mailStateDir: '/nonexistent', dataDir: path.join(dir, 'settings') });
  await opretUnivers(store, { navn: 'Min arena', om: 'Min nye lederrolle' }, nu);
  await endreUnivers(store, universRum('min-arena'), (s) => ({
    ...s,
    moeder: [forberedt()],
    dokumenter: [{ id: 'dok-slides1', titel: 'Arena-pitch', html: SLIDES, tekst: 'Arena', versioner: [], moedeId: 'moede-arena1', oprettet: '2026-10-26T10:00:00.000Z', aendret: '2026-10-26T10:00:00.000Z' }],
  }));
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('/api/situation is null until ten minutes before the start (inclusive) and null again at the end (exclusive)', async () => {
  nu = new Date('2026-10-27T11:49:59.999Z');
  assert.deepEqual(await situation(), { situation: 'dagen', moede: null });
  nu = new Date('2026-10-27T11:50:00.000Z');
  assert.deepEqual(await situation(), { situation: 'moede', moede: { url: '/moede/min-arena/moede-arena1', titel: 'Arena kickoff', start: START, slut: SLUT, univers: 'Min arena' } });
  nu = new Date('2026-10-27T12:59:59.999Z');
  assert.equal((await situation()).moede?.url, '/moede/min-arena/moede-arena1');
  nu = new Date(SLUT);
  assert.deepEqual(await situation(), { situation: 'dagen', moede: null });
});

test('a meeting in an archived univers is not active', async () => {
  await opretUnivers(store, { navn: 'Gammelt', om: '' }, nu);
  await endreUnivers(store, universRum('gammelt'), (s) => ({ ...s, moeder: [moede({ id: 'moede-gammel', titel: 'Gammelt møde', start: '2026-10-27T11:00:00.000Z', slut: '2026-10-27T11:30:00.000Z' })] }));
  nu = new Date('2026-10-27T11:10:00.000Z');
  assert.equal((await situation()).moede?.titel, 'Gammelt møde');
  await arkiverUnivers(store, 'gammelt', nu);
  assert.equal((await situation()).moede, null);
});

test('/ goes to the active meeting, else to Hjem', async () => {
  nu = new Date('2026-10-27T08:00:00.000Z');
  const hjem = await side('/');
  assert.equal(hjem.status, 302);
  assert.equal(hjem.location, '/rum/hjem');
  nu = new Date('2026-10-27T12:30:00.000Z');
  const moedet = await side('/');
  assert.equal(moedet.status, 302);
  assert.equal(moedet.location, '/moede/min-arena/moede-arena1');
});

test('the meeting page is the shell of the univers with the meeting view as main, the chat about the meeting, and the end time for the client', async () => {
  nu = new Date('2026-10-27T12:30:00.000Z');
  const p = await side('/moede/min-arena/moede-arena1');
  assert.equal(p.status, 200);
  assert.match(p.text, new RegExp(`<title>Arena kickoff · ${PRODUKT}</title>`));
  assert.match(p.text, /data-room="univers-min-arena"/);
  assert.match(p.text, /data-situation="moede"/);
  assert.match(p.text, /data-moede-slut="2026-10-27T13:00:00.000Z"/);
  assert.match(p.text, /data-moede-id="moede-arena1"/);
  assert.doesNotMatch(p.text, /data-live="1"/);
  assert.match(p.text, /<h1>Arena kickoff<\/h1>/);
  assert.match(p.text, /Åbn med planen/);
  assert.match(p.text, /Få rollen afklaret/);
  assert.match(p.text, /<iframe[^>]*sandbox/);
  assert.match(p.text, /data-forlad-moede="moede-arena1"/);
  assert.match(p.text, /id="chat-form" data-room="univers-min-arena"/);
  assert.match(p.text, /id="kontekst">Om: Mødet: Arena kickoff</);
  assert.match(p.text, /<ul class="rooms-sub"><li data-eget><a href="\/rum\/univers-min-arena" aria-current="page">/);
});

test('an unknown univers, meeting or an archived univers is a Danish 404 page', async () => {
  for (const url of ['/moede/findes-ikke/moede-arena1', '/moede/min-arena/moede-findes-ikke', '/moede/gammelt/moede-gammel']) {
    const p = await side(url);
    assert.equal(p.status, 404, url);
    assert.match(p.text, /findes ikke/i, url);
  }
});

test('Hjem lists the waiting new meetings and a prepared meeting of today', async () => {
  nu = new Date('2026-10-27T08:00:00.000Z');
  await endreIndeks(store, (i) => ({ ...i, nyeMoeder: [{ eventId: 'e1', titel: 'Nyt', start: '2026-10-28T10:00:00+01:00', slut: '2026-10-28T11:00:00+01:00', deltagere: [{ navn: 'Jonas Holm' }] }] }));
  const h = await side('/rum/hjem');
  assert.match(h.text, /1 nyt møde venter på et univers/);
  assert.match(h.text, /Mødet &quot;Arena kickoff&quot; kl\. 13\.00 er forberedt \(Min arena\)/);
  assert.match(h.text, /href="\/rum\/univers-min-arena"><span class="rum-ikon"><svg[^]*?<\/svg><\/span><span class="row-main"><span class="row-title">[^<]*<\/span><span class="row-note">Univers<\/span>/);
  await endreIndeks(store, (i) => ({ ...i, nyeMoeder: [] }));
  assert.doesNotMatch((await side('/rum/hjem')).text, /nyt møde venter/);
});

test('creating and archiving a univers tell the browser where to go next', async () => {
  const post = (url: string, body: unknown) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const kør = async (res: Response) => { const rec = sut.runs.get(((await res.json()) as { runId: string }).runId); assert.ok(rec); return rec.finished; };
  const ny = await kør(await post('/api/rum/univers/aktion/nytUnivers', { navn: 'Havearbejde', om: 'Haven' }));
  assert.equal(ny.status, 'done', ny.error);
  assert.equal(ny.result?.url, '/rum/univers-havearbejde');
  const ark = await kør(await post('/api/rum/univers-havearbejde/aktion/arkiver', {}));
  assert.equal(ark.status, 'done', ark.error);
  assert.equal(ark.result?.url, '/rum/univers');
});

test('KC-0114: /api/situation follows the clock outside meetings, and Hjem carries the situation on <body>', async () => {
  nu = new Date('2026-10-27T06:10:00.000Z'); // 07.10 in Copenhagen
  assert.deepEqual(await situation(), { situation: 'morgen', moede: null });
  assert.match((await side('/rum/hjem')).text, /<body data-room="hjem"[^>]* data-situation="morgen"/);
  nu = new Date('2026-10-27T19:30:00.000Z'); // 20.30
  assert.equal((await situation()).situation, 'aften');
  assert.match((await side('/rum/hjem')).text, /data-situation="aften"/);
  nu = new Date('2026-10-27T12:10:00.000Z'); // in the meeting: Hjem says moede but is not the meeting page
  const hjem = (await side('/rum/hjem')).text;
  assert.match(hjem, /data-situation="moede"/);
  assert.doesNotMatch(hjem, /data-moede-id=/);
});

test('KC-0115: /nu leads to Nu (the room id stays hjem)', async () => {
  const r = await side('/nu');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/rum/hjem');
});
