// KC-0148 end to end: the household universe through createApp — hidden for a
// single user and a household of one, under Univers for two; a guest gets 404;
// the shared week has only events from calendars in the husstand zone.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand, type Husstand } from '../src/identitet/husstand.ts';
import { KildeFejl, type Kilde, type Laesning } from '../src/kilder/types.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-hus-'));
// KC-0139: a read through the registry leaves a line in helbred.json; wait for those writes before the folder goes.
const apps: { helbred: { tom(): Promise<void> } }[] = [];
after(async () => { await Promise.all(apps.map((a) => a.helbred.tom())); await rm(rod, { recursive: true, force: true }); });

const NU = new Date('2026-11-02T08:00:00Z');
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const som = (l: string): RequestInit => ({ headers: { 'Tailscale-User-Login': l } });
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const FARMOR = { id: 'farmor', login: 'farmor@example.com', navn: 'Farmor', rolle: 'gaest' as const };

/** A host calendar (connected by the host) in `zone` with one event today at 18.00. */
function kalender(id: string, zone: Kilde['zone'], titel: string, fejl = false): Kilde {
  const l: Laesning = { slags: 'kalender', hentet: NU.toISOString(), uklar: true, data: { generated: NU.toISOString(), days: [{ date: '2026-11-02', events: [{ id: `${id}-1`, title: titel, start: '2026-11-02T18:00:00+01:00', end: '2026-11-02T19:00:00+01:00', all_day: false }] }], errors: [] } };
  return {
    id, navn: id, slags: 'kalender', zone, auth: 'local', standard: 'forbundet',
    read: async () => { if (fejl) throw new KildeFejl(502, 'nede'); return l; },
    kort: async () => ({ titel: id, tekst: '', felter: [], handling: 'Forbind' }),
    helbred: async () => ({ status: 'ok' }),
  };
}

async function lav(navn: string, husstand: Husstand | null, kilder: Kilde[] = []) {
  const dataDir = path.join(rod, navn);
  if (husstand) await skrivHusstand(dataDir, husstand);
  const sut = createApp({
    store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => NU,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent', kilder,
  });
  apps.push(sut);
  return sut.app;
}

/** The nav line for Husstanden: present and not hidden. */
const iNav = (h: string): boolean => /<li(?![^>]*hidden)[^>]*><a href="\/rum\/husstand"/.test(h);

test('single user: no Husstanden in the nav and /rum/husstand is 404', async () => {
  const app = await lav('enebruger', null);
  const hjem = await (await app.request('/rum/hjem')).text();
  assert.equal(iNav(hjem), false);
  const res = await app.request('/rum/husstand');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /data-medlem=/);
  assert.equal((await app.request('/api/rum/husstand/fragment')).status, 404);
});

test('a household of one person: hidden and 404', async () => {
  const app = await lav('en', { personer: [HENRIK] });
  assert.equal(iNav(await (await app.request('/rum/hjem', som(HENRIK.login), LOOPBACK)).text()), false);
  assert.equal((await app.request('/rum/husstand', som(HENRIK.login), LOOPBACK)).status, 404);
});

test('a household of two: Husstanden is under Univers in the nav, and the room lists both with their roles', async () => {
  const app = await lav('to', { personer: [HENRIK, MAJA] });
  const hjem = await (await app.request('/rum/hjem', som(MAJA.login), LOOPBACK)).text();
  assert.ok(iNav(hjem), 'shown');
  assert.match(hjem, /<ul class="rooms-sub">[\s\S]*?href="\/rum\/husstand"/, 'under Univers');
  assert.match(hjem, /<li(?![^>]*hidden)[^>]*><a href="\/rum\/univers"/, 'Univers is shown with it');
  const res = await app.request('/rum/husstand', som(MAJA.login), LOOPBACK);
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /<body data-room="husstand"/);
  assert.match(h, /data-medlem="henrik" data-medlem-rolle="ejer"/);
  assert.match(h, /data-medlem="maja" data-medlem-rolle="medlem"/);
  const oversigt = await (await app.request('/rum/univers', som(MAJA.login), LOOPBACK)).text();
  assert.match(oversigt, /href="\/rum\/husstand"[^>]*>[\s\S]*?Husstanden/, 'the Univers overview links to it');
});

test('a guest is in the household but has no Husstanden: hidden and 404', async () => {
  const app = await lav('gaest', { personer: [HENRIK, MAJA, FARMOR] });
  assert.equal(iNav(await (await app.request('/rum/hjem', som(FARMOR.login), LOOPBACK)).text()), false);
  const res = await app.request('/rum/husstand', som(FARMOR.login), LOOPBACK);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /data-medlem=/);
});

test('someone outside the household never reaches the room (identity answers 403 first)', async () => {
  const app = await lav('fremmed', { personer: [HENRIK, MAJA] });
  assert.equal((await app.request('/rum/husstand', som('ukendt@example.com'), LOOPBACK)).status, 403);
});

const chat = (app: Awaited<ReturnType<typeof lav>>, rum: string, besked: string, login: string | null, aabn = false) =>
  app.request(`/api/rum/${rum}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(login ? { 'Tailscale-User-Login': login } : {}) }, body: JSON.stringify({ besked, ...(aabn ? { aabn: true } : {}) }) }, LOOPBACK);

test('"Åbn husstanden" opens it for a member; for a single user the sentence goes to Hermes', async () => {
  const to = await lav('chat-to', { personer: [HENRIK, MAJA] });
  assert.deepEqual(await (await chat(to, 'hjem', 'Åbn husstanden', MAJA.login, true)).json(), { aabn: '/rum/husstand' });
  const en = await lav('chat-en', null);
  const res = await chat(en, 'hjem', 'Åbn husstanden', null, true);
  assert.equal(res.status, 202);
});

test('the chat in Husstanden runs for a member; a guest (policy layer) and a single user (no Husstanden) are refused', async () => {
  const app = await lav('chat-rum', { personer: [HENRIK, MAJA, FARMOR] });
  assert.equal((await chat(app, 'husstand', 'Hvad skal vi i denne uge?', MAJA.login)).status, 202);
  assert.equal((await chat(app, 'husstand', 'Hvad skal vi i denne uge?', FARMOR.login)).status, 403);
  const en = await lav('chat-rum-en', null);
  assert.equal((await chat(en, 'husstand', 'Hvad skal vi i denne uge?', null)).status, 400);
});

test('the shared week:a husstand calendar\'s event is there, a privat and an arbejde one are not, a failing one adds nothing', async () => {
  const app = await lav('uge', { personer: [HENRIK, MAJA] }, [
    kalender('privat-kal', 'privat', 'Lægetid'),
    kalender('arbejde-kal', 'arbejde', 'Styregruppe'),
    kalender('familie-kal', 'husstand', 'Fællesspisning'),
    kalender('nede-kal', 'husstand', 'Skal ikke ses', true),
  ]);
  const res = await app.request('/rum/husstand', som(HENRIK.login), LOOPBACK);
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /Fællesspisning/);
  assert.doesNotMatch(h, /Lægetid|Styregruppe|Skal ikke ses/);
  assert.match(h, /19\.00–20\.00|18\.00/);
});
