// KC-0117: zones on the room Mail — schema, filter, render, and the page per person.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMailState, synligMail, type Beslutning, type MailState } from '../../src/rooms/mail/schema.ts';
import { renderMail } from '../../src/rooms/mail/render.ts';
import { stemmeMail } from '../../src/rooms/mail/stemme.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';

const NOW = new Date('2026-10-27T08:40:00Z');
const tal = { handling: 2, afventer: 1, regninger: 12, sorteretIDag: 3 };
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };

const beslutning = (mailId: string, over: Partial<Beslutning> = {}): Beslutning => ({
  mailId, emne: `Emne ${mailId}`, fra: 'Afsender', modtaget: '2026-10-26T18:57:39Z', type: 'info', resume: '', betydning: 'Betyder noget.', arkivmappe: 'Archive', muligheder: [], ...over,
});
const ordnet = (mailId: string, over: Record<string, unknown> = {}) => ({
  mailId, emne: `Ordnet ${mailId}`, fra: 'X', til: 'Folders/Regninger', hvorfor: 'faktura', tid: '2026-10-27T08:30:01', handling: { id: `ordnet-${mailId}`, label: 'Fortryd', instruktion: 'i' }, ...over,
});
const state: MailState = {
  dato: '2026-10-27', genereret: '2026-10-27T08:00:00Z', tal, hermesStatus: 'Klar',
  beslutninger: [
    beslutning('1'),
    beslutning('2', { zone: 'privat', ejer: 'maja' }),
    beslutning('3', { zone: 'husstand' }),
  ],
  ordnet: [ordnet('5'), ordnet('6', { zone: 'privat', ejer: 'maja' }), ordnet('7', { zone: 'husstand' })],
};
const log: LogEntry[] = [
  { id: 'a', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Min linje', zone: 'privat', ejer: 'henrik' },
  { id: 'b', tid: '2026-10-27T08:01:00Z', kilde: 'hermes', tekst: 'Majas linje', zone: 'privat', ejer: 'maja' },
  { id: 'c', tid: '2026-10-27T08:02:00Z', kilde: 'hermes', tekst: 'Fælles linje', zone: 'husstand' },
];
const ider = (s: MailState): string[] => s.beslutninger.map((b) => b.mailId);

const svar = (zone?: unknown) => ({ beslutninger: [{ mailId: '9', emne: 'e', fra: 'f', type: 'info', betydning: 'b', ...(zone === undefined ? {} : { zone }) }] });

test('a Hermes answer naming an unknown zone is rejected as a schema error', () => {
  assert.throws(() => parseMailState(svar('firma'), { tal, ordnet: [] }, NOW), SchemaError);
});

test('a mail naming arbejde in a privat run is rejected, never relabelled', () => {
  assert.throws(() => parseMailState(svar('arbejde'), { tal, ordnet: [] }, NOW), SchemaError);
});

test('a mail without a zone is stored as privat, and so is an ordnet item', () => {
  const s = parseMailState(svar(), { tal, ordnet: [{ mailId: '301', emne: 'F', fra: 'G', til: 'Folders/Regninger', hvorfor: 'h', tid: '2026-10-27T08:30:01' }] }, NOW);
  assert.equal(s.beslutninger[0]?.zone, 'privat');
  assert.equal(s.ordnet[0]?.zone, 'privat');
  assert.equal(parseMailState(svar('privat'), { tal, ordnet: [] }, NOW).beslutninger[0]?.zone, 'privat');
});

test("synligMail drops another person's privat mail and ordnet item; husstand is for members, not guests", () => {
  assert.deepEqual(ider(synligMail(state, henrik)), ['1', '3']);
  assert.deepEqual(synligMail(state, henrik).ordnet.map((o) => o.mailId), ['5', '7']);
  assert.deepEqual(ider(synligMail(state, maja)), ['2', '3']);
  assert.deepEqual(ider(synligMail(state, gaest)), []);
  assert.deepEqual(synligMail(state, gaest).ordnet, []);
  assert.equal(synligMail(state, maja).tal.handling, 0, 'the folder counts are the owner\'s privat numbers');
  assert.equal(synligMail(state, henrik).tal.handling, 2);
});

test("the spoken overview and the rendered room leave out what the person may not see", () => {
  const sagt = JSON.stringify(stemmeMail(synligMail(state, henrik)));
  assert.doesNotMatch(sagt, /Emne 2/);
  const side = String(renderMail(synligMail(state, henrik), log.filter((e) => e.ejer !== 'maja' || e.zone === 'husstand'), NOW));
  assert.doesNotMatch(side, /Emne 2|Ordnet 6/);
  assert.match(side, /Emne 3/);
});

test('every mail card and ordnet row carries data-datazone, and a card has the zone chip', () => {
  const side = String(renderMail(synligMail(state, henrik), log, NOW));
  assert.match(side, /<article[^>]*class="card mail"[^>]* data-datazone="privat"/);
  assert.match(side, /<article[^>]*class="card mail"[^>]* data-datazone="husstand"/);
  assert.match(side, /class="chip zone-chip">Privat</);
  assert.match(side, /class="chip zone-chip">Husstand</);
  assert.match(side, /data-element="Mailen: Ordnet 7" data-datazone="husstand"/);
});

test('log rows carry data-datazone', () => {
  const side = String(renderMail(state, [{ id: 'z', tid: '2026-10-27T08:05:00Z', kilde: 'hermes', tekst: 'Fælles', zone: 'husstand' }], NOW));
  assert.match(side, /data-log="z" data-datazone="husstand"/);
});

const rod = await mkdtemp(path.join(tmpdir(), 'kc-mail-zoner-'));
after(() => rm(rod, { recursive: true, force: true }));
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const som = (l: string): RequestInit => ({ headers: { 'Tailscale-User-Login': l } });

test('the room page and fragment show each person only their own mail', async () => {
  const dataDir = path.join(rod, 'side');
  await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' },
  ] });
  const store = createFileStore(dataDir);
  await store.writeState('mail', state);
  await store.appendLog('mail', { kilde: 'hermes', tekst: 'Majas linje', zone: 'privat', ejer: 'maja' });
  const sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' });
  const hent = async (l: string, sti: string) => (await sut.app.request(sti, som(l), LOOPBACK)).text();
  const h = await hent('henrik@example.com', '/rum/mail');
  assert.match(h, /Emne 1/); assert.match(h, /Emne 3/); assert.doesNotMatch(h, /Emne 2|Ordnet 6|Majas linje/);
  const m = await hent('maja@example.com', '/rum/mail');
  assert.match(m, /Emne 2/); assert.match(m, /Emne 3/); assert.doesNotMatch(m, /Emne 1|Ordnet 5/);
  const frag = await hent('maja@example.com', '/api/rum/mail/fragment');
  assert.doesNotMatch(frag, /Emne 1/);
  // Maja may not press a handling on Henrik's mail either.
  const faerdig = await sut.app.request('/api/rum/mail/aktion/faerdig', { ...som('maja@example.com'), method: 'POST', headers: { 'content-type': 'application/json', 'Tailscale-User-Login': 'maja@example.com' }, body: JSON.stringify({ mailId: '1' }) }, LOOPBACK);
  assert.equal(faerdig.status, 400);
});
