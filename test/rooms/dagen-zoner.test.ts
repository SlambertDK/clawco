// KC-0117: zones on the room Dagen — schema, filter, next appointment, render, and the page per person.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDagenState, synligDagen, SchemaError, type DagenState } from '../../src/rooms/dagen/schema.ts';
import { renderDagen } from '../../src/rooms/dagen/render.ts';
import { stemmeDagen } from '../../src/rooms/dagen/stemme.ts';
import { naesteAftale } from '../../src/rooms/dagen/naeste.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';

const NOW = new Date('2026-10-30T06:00:00Z');
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };

const state: DagenState = {
  dato: '2026-10-30', genereret: '2026-10-30T05:00:00Z', treLinjer: ['x'], anbefaling: { tekst: 'y' }, hermesStatus: 'Klar',
  kalender: [
    { tid: '09.00', slut: '10.00', titel: 'Mit møde' },
    { tid: '10.00', slut: '11.00', titel: 'Majas tandlæge', zone: 'privat', ejer: 'maja', handling: { id: 'maja-h', label: 'Flyt', instruktion: 'i' } },
    { tid: '12.00', slut: '13.00', titel: 'Fælles middag', zone: 'husstand' },
  ],
  morgenavis: [
    { titel: 'Min nyhed', hvorfor: 'h' },
    { titel: 'Majas nyhed', hvorfor: 'h', zone: 'privat', ejer: 'maja' },
    { titel: 'Fælles nyhed', hvorfor: 'h', zone: 'husstand' },
  ],
};
const log: LogEntry[] = [
  { id: 'a', tid: '2026-10-30T05:00:00Z', kilde: 'hermes', tekst: 'Min linje', zone: 'privat', ejer: 'henrik' },
  { id: 'b', tid: '2026-10-30T05:01:00Z', kilde: 'hermes', tekst: 'Majas linje', zone: 'privat', ejer: 'maja' },
  { id: 'c', tid: '2026-10-30T05:02:00Z', kilde: 'hermes', tekst: 'Fælles linje', zone: 'husstand' },
];
const titler = (s: DagenState): string[] => s.kalender.map((k) => k.titel);
const avis = (s: DagenState): string[] => s.morgenavis.map((k) => k.titel);

const raa = (over: Record<string, unknown>) => ({ treLinjer: ['a'], anbefaling: { tekst: 'b' }, ...over });
const kal = (zone?: unknown) => ({ kalender: [{ tid: '09.00', titel: 'Møde', ...(zone === undefined ? {} : { zone }) }] });
const nyh = (zone?: unknown) => ({ morgenavis: [{ titel: 'Nyt', hvorfor: 'h', ...(zone === undefined ? {} : { zone }) }] });

test('a Hermes answer naming an unknown zone is rejected, for a calendar post and a paper item', () => {
  assert.throws(() => parseDagenState(raa(kal('firma')), NOW), SchemaError);
  assert.throws(() => parseDagenState(raa(nyh('firma')), NOW), SchemaError);
});

test('a post naming arbejde in a privat run is rejected, never relabelled', () => {
  assert.throws(() => parseDagenState(raa(kal('arbejde')), NOW), SchemaError);
  assert.throws(() => parseDagenState(raa(nyh('arbejde')), NOW), SchemaError);
});

test('posts without a zone are stored as privat', () => {
  const s = parseDagenState(raa({ ...kal(), ...nyh() }), NOW);
  assert.equal(s.kalender[0]?.zone, 'privat');
  assert.equal(s.morgenavis[0]?.zone, 'privat');
  assert.equal(parseDagenState(raa(kal('privat')), NOW).kalender[0]?.zone, 'privat');
});

test("synligDagen drops another person's privat posts; husstand is for members, not guests", () => {
  assert.deepEqual(titler(synligDagen(state, henrik)), ['Mit møde', 'Fælles middag']);
  assert.deepEqual(avis(synligDagen(state, henrik)), ['Min nyhed', 'Fælles nyhed']);
  assert.deepEqual(titler(synligDagen(state, maja)), ['Majas tandlæge', 'Fælles middag']);
  assert.deepEqual(titler(synligDagen(state, gaest)), []);
  assert.deepEqual(avis(synligDagen(state, gaest)), []);
});

test("the next appointment skips what the person may not see", () => {
  // 09.30 CET: Mit møde running, then Majas tandlæge at 10.
  const kl = (hhmm: string): Date => new Date(`2026-10-30T${hhmm}:00+01:00`);
  assert.equal(naesteAftale(synligDagen(state, henrik), kl('10:15'))?.titel, 'Fælles middag');
  assert.equal(naesteAftale(synligDagen(state, maja), kl('09:30'))?.titel, 'Majas tandlæge');
  assert.equal(naesteAftale(synligDagen(state, gaest), kl('09:30')), null);
});

test('the spoken overview and the rendered room leave out what the person may not see', () => {
  assert.doesNotMatch(JSON.stringify(stemmeDagen(synligDagen(state, henrik), [])), /Majas tandlæge|maja-h/);
  const side = String(renderDagen(synligDagen(state, henrik), log.filter((e) => e.ejer !== 'maja'), NOW));
  assert.doesNotMatch(side, /Majas|maja-h/);
  assert.match(side, /Fælles middag/);
});

test('every calendar row, paper item and log row carries data-datazone; calendar rows and paper items have the zone chip', () => {
  const side = String(renderDagen(synligDagen(state, henrik), log, NOW));
  assert.match(side, /data-element="Mødet kl\. 09\.00: Mit møde" data-datazone="privat"/);
  assert.match(side, /data-element="Mødet kl\. 12\.00: Fælles middag" data-datazone="husstand"/);
  assert.match(side, /data-element="Nyheden: Fælles nyhed" data-datazone="husstand"/);
  assert.match(side, /data-log="c" data-datazone="husstand"/);
  assert.match(side, /class="chip zone-chip">Privat</);
  assert.match(side, /class="chip zone-chip">Husstand</);
});

const rod = await mkdtemp(path.join(tmpdir(), 'kc-dagen-zoner-'));
after(() => rm(rod, { recursive: true, force: true }));
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const som = (l: string): RequestInit => ({ headers: { 'Tailscale-User-Login': l } });

test('the room page and fragment show each person only their own posts', async () => {
  const dataDir = path.join(rod, 'side');
  await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' },
  ] });
  const store = createFileStore(dataDir);
  // Dated today so the page is not the "Dagen er ikke bygget" one.
  const idag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
  await store.writeState('dagen', { ...state, dato: idag, genereret: new Date().toISOString() });
  await store.appendLog('dagen', { kilde: 'hermes', tekst: 'Majas linje', zone: 'privat', ejer: 'maja' });
  const sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' });
  const hent = async (l: string, sti: string) => (await sut.app.request(sti, som(l), LOOPBACK)).text();
  const h = await hent('henrik@example.com', '/rum/dagen');
  assert.match(h, /Mit møde/); assert.match(h, /Fælles middag/); assert.doesNotMatch(h, /Majas/);
  const m = await hent('maja@example.com', '/rum/dagen');
  assert.match(m, /Majas tandlæge/); assert.match(m, /Fælles nyhed/); assert.doesNotMatch(m, /Mit møde|Min nyhed/);
  assert.doesNotMatch(await hent('maja@example.com', '/api/rum/dagen/fragment'), /Mit møde/);
  // Henrik may not press Majas handling.
  const tryk = await sut.app.request('/api/rum/dagen/handlinger/maja-h', { method: 'POST', headers: { 'Tailscale-User-Login': 'henrik@example.com' } }, LOOPBACK);
  assert.equal(tryk.status, 404);
});
