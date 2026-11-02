import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { opretUnivers } from '../src/rooms/univers/lager.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

let nu = new Date('2026-10-29T08:00:00.000Z');
let dir = '';
let sut: ReturnType<typeof createApp>;
const hermes = createFakeAgent({ answer: () => 'Javel.' });

const side = async (url: string): Promise<string> => (await sut.app.request(url)).text();
const post = (url: string, body: unknown): Promise<Response> => Promise.resolve(sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
// Shown = an <li> without hidden (own-work rooms always carry data-eget, KC-0079).
const iNav = (html: string, id: string): boolean => new RegExp(`<li(?: data-eget)?><a href="/rum/${id}"`).test(html);

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-menu-'));
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  sut = createApp({ store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => nu, mailStateDir: '/nonexistent', dataDir: path.join(dir, 'settings') });
  await opretUnivers(store, { navn: 'Min arena', om: '' }, nu);
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('KC-0052: a fresh day shows only Hjem; a room Henrik opens stays in the nav and among the tiles for the rest of the day', async () => {
  nu = new Date('2026-10-29T10:00:00.000Z'); // 11.00, the day: in the morning Dagen is relevant by itself (KC-0114)
  const hjem = await side('/rum/hjem');
  assert.ok(iNav(hjem, 'hjem'));
  for (const id of ['skrive', 'dagen', 'mail', 'nyheder', 'univers']) assert.ok(!iNav(hjem, id), `${id} hidden`);
  assert.match(hjem, /<li hidden data-eget><a href="\/rum\/skrive"/, 'hidden, not removed: a live count can show it');

  assert.ok(iNav(await side('/rum/skrive'), 'skrive'), 'the room on screen');
  const efter = await side('/rum/hjem');
  assert.ok(iNav(efter, 'skrive'), 'opened today');
  assert.match(efter, /data-room-tile="skrive"/);
  assert.doesNotMatch(efter, /data-room-tile="nyheder"/);

  nu = new Date('2026-10-29T23:30:00.000Z'); // 00.30 the next day in Copenhagen
  assert.ok(!iNav(await side('/rum/hjem'), 'skrive'), 'gone the next day');
  nu = new Date('2026-10-29T08:00:00.000Z');
});

test('KC-0052: "jeg vil skrive" in the chat opens Skrive without asking Hermes; the room is in the nav afterwards', async () => {
  nu = new Date('2026-10-30T09:00:00.000Z');
  const foer = hermes.calls.length;
  const r = await post('/api/rum/hjem/chat', { besked: 'Jeg vil skrive', aabn: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { aabn: '/rum/skrive' });
  assert.equal(hermes.calls.length, foer, 'no Hermes run');
  assert.ok(iNav(await side('/rum/hjem'), 'skrive'));
});

test('KC-0052: a sentence that says more goes on with the room; a univers opens by name', async () => {
  const r = await post('/api/rum/hjem/chat', { besked: 'jeg vil skrive en tekst om fredagens møde', aabn: true });
  assert.deepEqual(await r.json(), { aabn: '/rum/skrive', videre: 'jeg vil skrive en tekst om fredagens møde' });
  const u = await post('/api/rum/dagen/chat', { besked: 'åbn min arena', aabn: true });
  assert.deepEqual(await u.json(), { aabn: '/rum/univers-min-arena' });
});

test('KC-0052: without the flag, in the room asked for, or with no room in the sentence, Hermes answers as before', async () => {
  assert.equal((await post('/api/rum/hjem/chat', { besked: 'jeg vil skrive' })).status, 202, 'Samtale and other callers do not switch rooms');
  assert.equal((await post('/api/rum/skrive/chat', { besked: 'jeg vil skrive', aabn: true })).status, 202, 'already there');
  assert.equal((await post('/api/rum/hjem/chat', { besked: 'Hvad står der i nyhederne?', aabn: true })).status, 202);
});

test('KC-0098: "Hvad kan jeg sige?" is answered locally, stored in the chat, and never reaches Hermes', async () => {
  const foer = hermes.calls.length;
  const r = await post('/api/rum/hjem/chat', { besked: 'Hvad kan jeg sige?', aabn: true });
  assert.equal(r.status, 200);
  const j = await r.json() as { svar: string };
  assert.match(j.svar, /"Jeg vil skrive"/);
  assert.match(j.svar, /"Åbn Min arena"/);
  assert.match(j.svar, /Alt andet kan du bare spørge mig om\./);
  assert.equal(hermes.calls.length, foer, 'no Hermes run');
  assert.match(await side('/rum/hjem'), /Alt andet kan du bare spørge mig om\./, 'both sides are in the chat after a reload');
  assert.equal((await post('/api/rum/hjem/chat', { besked: 'Hvad kan jeg sige?' })).status, 202, 'Samtale and other callers still go to Hermes');
});
