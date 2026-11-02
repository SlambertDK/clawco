// KC-0132: the connector routes. GET /api/kilder (every connector with its card,
// connection and health), POST /api/kilder/:id/forbind (body checked against
// the card; owner only), POST /api/kilder/:id/frakobl (owner only), GET
// /api/kilder/:id/tilbage (the OAuth redirect; the state must match). A
// connect announces the first read on the live bus; no response ever carries a
// secret value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { falskeKilder, type FalskData } from '../src/kilder/falsk/falsk.ts';
import { FOERSTE_LAESNING } from '../src/kilder/register.ts';
import type { Person } from '../src/identitet/husstand.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const HEMMELIG = 'pw-meget-hemmelig-42';

const DATA: FalskData = {
  kalender: () => ({ generated: NOW.toISOString(), days: [{ date: '2026-10-31', events: [{ title: 'Stand-up' }, { title: 'Frokost' }] }], errors: [] }),
  mail: () => [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: NOW.toISOString(), laest: false, flag: false, vedhaeftning: false }],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};

type App = ReturnType<typeof createApp>;
async function medApp(fn: (lav: (person?: Person) => App, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-kilder-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    const lav = (person: Person = EJER): App => createApp({
      store, hermes: createFakeAgent({ answer: () => 'Gjort.' }), sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: person },
      kilder: falskeKilder({ data: DATA, tilstand: (s) => (s === 'beskeder' ? 'nede' : 'ok') }),
    });
    await fn(lav, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (app: App['app'], url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
type Oversigt = { id: string; forbundet: boolean; helbred: { status: string } | null; kort: { titel: string } };
const liste = async (app: App['app']) => ((await (await app.request('/api/kilder')).json()) as { kilder: Oversigt[] }).kilder;

test('GET /api/kilder lists every connector with its card; health only for the connected', async () => {
  await medApp(async (lav) => {
    const { app } = lav();
    const k = await liste(app);
    assert.deepEqual(k.map((x) => [x.id, x.forbundet, x.helbred]), [['falsk-kalender', false, null], ['falsk-mail', false, null], ['falsk-noter', false, null], ['falsk-nyheder', false, null], ['falsk-beskeder', false, null]]);
    assert.equal(k[1]?.kort.titel, 'Falsk mail');
  });
});

test('POST forbind: invalid body → 400, unknown id → 404, a member → 403; a valid connect answers the first read and announces it', async () => {
  await medApp(async (lav) => {
    assert.equal((await post(lav(MEDLEM).app, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'ella', adgangskode: HEMMELIG } })).status, 403);
    const sut = lav();
    const kanal: number[] = [];
    sut.live.subscribe(FOERSTE_LAESNING, (v) => kanal.push(v));
    assert.equal((await post(sut.app, '/api/kilder/ukendt/forbind', {})).status, 404);
    assert.equal((await post(sut.app, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'ella' } })).status, 400);
    assert.equal((await post(sut.app, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'ella', adgangskode: 'x', mere: 'y' } })).status, 400);
    assert.equal((await sut.app.request('/api/kilder/falsk-mail/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ikke json' })).status, 400);
    assert.deepEqual(kanal, []);

    const res = await post(sut.app, '/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'ella', adgangskode: HEMMELIG } });
    assert.equal(res.status, 200);
    const tekst = await res.text();
    assert.ok(!tekst.includes(HEMMELIG));
    assert.deepEqual(JSON.parse(tekst), { forbundet: true, foersteLaesning: { slags: 'mail', hentet: NOW.toISOString(), antal: 1 } });
    assert.equal(kanal.length, 1);
    const k = await liste(sut.app);
    assert.deepEqual(k.find((x) => x.id === 'falsk-mail')?.helbred, { status: 'ok' });
    assert.ok(!JSON.stringify(k).includes(HEMMELIG), 'the list carries no secret');
  });
});

test('a source that is down still connects, reports its health and announces no first read', async () => {
  await medApp(async (lav) => {
    const sut = lav();
    let n = 0;
    sut.live.subscribe(FOERSTE_LAESNING, () => { n++; });
    const res = await post(sut.app, '/api/kilder/falsk-beskeder/forbind', { felter: { noegle: HEMMELIG } });
    assert.deepEqual(await res.json(), { forbundet: true, foersteLaesning: null });
    assert.equal(n, 0);
    assert.equal((await liste(sut.app)).find((x) => x.id === 'falsk-beskeder')?.helbred?.status, 'nede');
  });
});

test('POST frakobl: owner only; 409 when not connected; afterwards not connected', async () => {
  await medApp(async (lav) => {
    const sut = lav();
    assert.equal((await post(sut.app, '/api/kilder/falsk-noter/frakobl')).status, 409);
    await post(sut.app, '/api/kilder/falsk-noter/forbind', { felter: { mappe: '/noter' } });
    assert.equal((await post(lav(MEDLEM).app, '/api/kilder/falsk-noter/frakobl')).status, 403);
    assert.equal((await post(sut.app, '/api/kilder/falsk-noter/frakobl')).status, 200);
    assert.equal((await liste(sut.app)).find((x) => x.id === 'falsk-noter')?.forbundet, false);
    assert.equal((await post(sut.app, '/api/kilder/ukendt/frakobl')).status, 404);
  });
});

test('OAuth: forbind answers the provider URL; tilbage with a wrong or replayed state → 400; the right state connects and redirects', async () => {
  await medApp(async (lav) => {
    const sut = lav();
    const { omdiriger } = (await (await post(sut.app, '/api/kilder/falsk-kalender/forbind', {})).json()) as { omdiriger: string };
    const url = new URL(omdiriger, 'http://x');
    assert.equal(url.pathname, '/api/kilder/falsk-kalender/tilbage');
    const state = url.searchParams.get('state') ?? '';
    assert.ok(state.length >= 32);
    assert.equal((await sut.app.request(`/api/kilder/falsk-kalender/tilbage?state=forkert&code=falsk-kode`)).status, 400);
    assert.equal((await sut.app.request(`/api/kilder/falsk-kalender/tilbage?code=falsk-kode`)).status, 400);
    assert.equal((await sut.app.request(`/api/kilder/falsk-mail/tilbage?state=${state}&code=falsk-kode`)).status, 400, 'a state for another connector');
    assert.equal((await lav(MEDLEM).app.request(`${url.pathname}${url.search}`)).status, 403);
    const ok = await sut.app.request(`${url.pathname}${url.search}`);
    assert.equal(ok.status, 302);
    assert.equal((await liste(sut.app)).find((x) => x.id === 'falsk-kalender')?.forbundet, true);
    assert.equal((await sut.app.request(`${url.pathname}${url.search}`)).status, 400, 'a state works once');
  });
});

test('a corrupt kilder.json fails closed with 503, never "nothing connected"', async () => {
  await medApp(async (lav, dir) => {
    await writeFile(path.join(dir, 'kilder.json'), '{ ødelagt', 'utf8');
    const sut = lav();
    assert.equal((await sut.app.request('/api/kilder')).status, 503);
    assert.equal((await post(sut.app, '/api/kilder/falsk-noter/forbind', { felter: { mappe: '/n' } })).status, 503);
  });
});

// KC-0120: "Kilder" in the Kø panel. /api/koe?kilder=1 carries the section rendered by the server (escaped); only
// the connected sources, Frakobl for the owner alone; a corrupt kilder.json is one plain line, and the queue still answers.
const koe = async (app: App['app'], q = '?kilder=1') => {
  const res = await app.request(`/api/koe${q}`);
  return { status: res.status, d: (await res.json()) as { kilder?: string; runs: unknown[] } };
};

test('GET /api/koe?kilder=1: the connected sources with their state; Frakobl for the owner only; nothing without ?kilder=1', async () => {
  await medApp(async (lav) => {
    const sut = lav();
    assert.equal((await koe(sut.app)).d.kilder, '', 'nothing connected = no section');
    assert.equal((await post(sut.app, '/api/kilder/falsk-noter/forbind', { felter: { mappe: '/n' } })).status, 200);
    assert.equal((await post(sut.app, '/api/kilder/falsk-beskeder/forbind', { felter: { noegle: HEMMELIG } })).status, 200);
    const ejer = (await koe(sut.app)).d.kilder ?? '';
    assert.match(ejer, /data-blok="bunke"/);
    assert.match(ejer, /data-kilde="falsk-noter" data-kilde-tilstand="forbundet"/);
    assert.match(ejer, /data-kilde="falsk-beskeder" data-kilde-tilstand="nede"/);
    assert.doesNotMatch(ejer, /falsk-kalender|falsk-mail/, 'unconnected sources are not listed');
    assert.equal((ejer.match(/data-kilde-frakobl="/g) ?? []).length, 2);
    assert.ok(!ejer.includes(HEMMELIG));
    const medlem = (await koe(lav(MEDLEM).app)).d.kilder ?? '';
    assert.match(medlem, /data-kilde="falsk-noter"/);
    assert.doesNotMatch(medlem, /Frakobl/);
    assert.equal((await koe(sut.app, '')).d.kilder, undefined);
    assert.equal((await post(sut.app, '/api/kilder/falsk-noter/frakobl')).status, 200);
    assert.doesNotMatch((await koe(sut.app)).d.kilder ?? '', /falsk-noter/);
  });
});

test('GET /api/koe?kilder=1 with a corrupt kilder.json: one plain line, and the queue still answers', async () => {
  await medApp(async (lav, dir) => {
    await writeFile(path.join(dir, 'kilder.json'), '{ ødelagt', 'utf8');
    const { status, d } = await koe(lav().app);
    assert.equal(status, 200);
    assert.ok(Array.isArray(d.runs));
    assert.match(d.kilder ?? '', /data-kilder="fejl"[^>]*>Forbindelserne kunne ikke læses\./);
  });
});
