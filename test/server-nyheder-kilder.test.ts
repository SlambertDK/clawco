// KC-0222: the news sources after the connection. POST /api/kilder/nyheder-rss/feeds adds one, DELETE
// /api/kilder/nyheder-rss/feeds/:id removes one: owner only, from Clawco itself, body checked, the same address check
// as the card's, the cap of 100, a repeat refused in plain words, a removed feed's cache gone, one line in Nyheder's
// log, and the Kø panel's list follows without a reload (what /api/koe?kilder=1 renders).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { feedId, nyhederRss } from '../src/kilder/nyheder-rss/kilde.ts';
import { laesKonfig, KILDER_LOG } from '../src/kilder/register.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { falskHenter, rss, type Svar } from './kilder/nyheder-rss/hjaelp.ts';

const NOW = new Date('2026-11-02T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const A = 'https://a.example/rss';
const B = 'https://b.example/rss';
const C = 'https://c.example/rss';
const TABEL: Record<string, Svar> = {
  [A]: { tekst: rss('Vindkraft Dagligt', [['Nordvik', 'https://a.example/1', '2026-11-02T05:00:00Z']]) },
  [B]: { tekst: rss('Netbladet', [['Elpriser', 'https://b.example/1', '2026-11-02T06:00:00Z']]) },
  [C]: { tekst: rss('&lt;img src=x onerror=alert(1)&gt;', [['x', 'https://c.example/1']]) },
};

type App = ReturnType<typeof createApp>;
async function medApp(fn: (s: { lav: (p?: Person) => App; dir: string; store: ReturnType<typeof createFileStore> }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-ny-kilder-'));
  try {
    const store = createFileStore(dir);
    const kilde = nyhederRss({ dataDir: dir, hent: falskHenter(TABEL) });
    const lav = (person: Person = EJER): App => createApp({
      store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: path.join(dir, 'ingen-{date}.json'), dataDir: dir, now: () => NOW, identitet: { fast: person },
      mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent', kilder: [kilde],
    });
    try { await fn({ lav, dir, store }); } finally { await new Promise((res) => setTimeout(res, 50)); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const send = (app: App['app'], metode: string, url: string, body?: unknown, hoved: Record<string, string> = {}) =>
  app.request(url, { method: metode, headers: { 'content-type': 'application/json', ...hoved }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const FEEDS = '/api/kilder/nyheder-rss/feeds';
const forbind = (app: App['app'], adresser: string) => send(app, 'POST', '/api/kilder/nyheder-rss/forbind', { felter: { adresser } });
const feedsFil = async (dir: string): Promise<string[]> => (JSON.parse((await laesKonfig(dir)).kilder.find((k) => k.id === 'nyheder-rss')?.valg['feeds'] ?? '[]') as { url: string }[]).map((f) => f.url);
const panel = async (app: App['app']): Promise<string> => ((await (await app.request('/api/koe?kilder=1')).json()) as { kilder: string }).kilder;
const cache = async (dir: string): Promise<number> => (await readdir(path.join(dir, 'nyheder-rss')).catch(() => [])).length;

test('add: the owner pastes an address; it is checked, stored, logged in Nyheder, announced, and shows in the panel without a reload', async () => {
  await medApp(async ({ lav, dir, store }) => {
    const s = lav();
    assert.equal((await forbind(s.app, A)).status, 200);
    const sendt: number[] = [];
    s.live.subscribe('nyheder', (v) => sendt.push(v));
    const r = await send(s.app, 'POST', FEEDS, { adresse: B });
    assert.equal(r.status, 200, await r.clone().text());
    const j = (await r.json()) as { feeds: { id: string; navn: string }[]; tekst: string };
    assert.deepEqual(j.feeds, [{ id: feedId(A), navn: 'Vindkraft Dagligt' }, { id: feedId(B), navn: 'Netbladet' }]);
    assert.match(j.tekst, /Tilføjede Netbladet/);
    assert.deepEqual(await feedsFil(dir), [A, B]);
    const log = await store.readLog('nyheder', 10);
    assert.equal(log.length, 1);
    assert.match(log[0]?.tekst ?? '', /Henrik.*tilføjede Netbladet/);
    assert.ok(log[0]?.tid, 'with its time');
    assert.equal(log[0]?.fortryd, undefined, 'undo is the add route again, not a Hermes instruction');
    assert.equal(sendt.length, 1, 'Nyheder is announced on the live bus');
    const h = await panel(s.app);
    assert.match(h, /Dine kilder \(2\)/);
    assert.match(h, new RegExp(`data-kilde-feed="${feedId(B)}"[\\s\\S]*?Netbladet`));
    assert.match(h, /data-kilde-feed-adresse/);
    assert.equal((await store.readLog(KILDER_LOG, 10)).filter((e) => /ændrede/.test(e.tekst)).length, 1, 'and the connection log too');
    assert.equal(await cache(dir) >= 1, true);
  });
});

test('remove: the feed leaves the list, its cached items are deleted, one line in Nyheder\'s log; the panel follows', async () => {
  await medApp(async ({ lav, dir, store }) => {
    const s = lav();
    await forbind(s.app, `${A}\n${B}`);
    const foer = await cache(dir);
    assert.equal(foer, 2);
    const sendt: number[] = [];
    s.live.subscribe('nyheder', (v) => sendt.push(v));
    const r = await send(s.app, 'DELETE', `${FEEDS}/${feedId(B)}`);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(((await r.json()) as { feeds: { id: string }[] }).feeds.map((f) => f.id), [feedId(A)]);
    assert.deepEqual(await feedsFil(dir), [A]);
    assert.equal(await cache(dir), 1, 'nothing of the removed feed lingers on disk');
    const log = await store.readLog('nyheder', 10);
    assert.match(log[0]?.tekst ?? '', /Henrik.*fjernede Netbladet.*https:\/\/b\.example\/rss/);
    assert.equal(sendt.length, 1);
    const h = await panel(s.app);
    assert.doesNotMatch(h, new RegExp(feedId(B)));
    assert.match(h, /Dine kilder \(1\)/);
    assert.doesNotMatch(h, /data-kilde-feed-fjern/, 'the last one has no Fjern');
    // Fortryd = add the same address again.
    assert.equal((await send(s.app, 'POST', FEEDS, { adresse: B })).status, 200);
    assert.deepEqual(await feedsFil(dir), [A, B]);
  });
});

test('refusals in plain Danish: a repeat 409, a bad address 400, the last feed 409, an unknown id 404; nothing is changed or logged', async () => {
  await medApp(async ({ lav, dir, store }) => {
    const s = lav();
    await forbind(s.app, A);
    const fejl = async (r: Response): Promise<string> => ((await r.json()) as { error: string }).error;
    let r = await send(s.app, 'POST', FEEDS, { adresse: A });
    assert.equal(r.status, 409);
    assert.match(await fejl(r), /Vindkraft Dagligt har du allerede/);
    r = await send(s.app, 'POST', FEEDS, { adresse: 'http://169.254.169.254/' });
    assert.equal(r.status, 400);
    assert.match(await fejl(r), /intern tjeneste/);
    r = await send(s.app, 'POST', FEEDS, { adresse: 'https://findes-ikke.example/rss' });
    assert.equal(r.status, 400);
    assert.match(await fejl(r), /kunne ikke bruges som nyhedskilde/);
    r = await send(s.app, 'DELETE', `${FEEDS}/${feedId(A)}`);
    assert.equal(r.status, 409);
    assert.match(await fejl(r), /sidste kilde/);
    assert.equal((await send(s.app, 'DELETE', `${FEEDS}/f-000000000000`)).status, 404);
    assert.deepEqual(await feedsFil(dir), [A]);
    assert.deepEqual(await store.readLog('nyheder', 10), []);
  });
});

test('the body is checked: not JSON, no address, a number, a long address, extra fields — all 400', async () => {
  await medApp(async ({ lav }) => {
    const s = lav();
    await forbind(s.app, A);
    for (const b of ['{ikke json', {}, { adresse: 5 }, { adresse: '' }, { adresse: 'x'.repeat(2001) }, { adresse: B, mere: 'y' }, [B], 'null']) {
      assert.equal((await send(s.app, 'POST', FEEDS, b)).status, 400, JSON.stringify(b).slice(0, 40));
    }
  });
});

test('the cap of 100 sources holds through the route', async () => {
  await medApp(async ({ lav, dir }) => {
    const s = lav();
    await forbind(s.app, A);
    const { skrivKonfig } = await import('../src/kilder/register.ts');
    const k = await laesKonfig(dir);
    const feeds = Array.from({ length: 100 }, (_, i) => ({ url: `https://k${i}.example/rss`, navn: `K${i}`, tilfoejet: NOW.toISOString() }));
    await skrivKonfig(dir, { kilder: k.kilder.map((p) => (p.id === 'nyheder-rss' ? { ...p, valg: { feeds: JSON.stringify(feeds) } } : p)) });
    const r = await send(s.app, 'POST', FEEDS, { adresse: B });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /Højst 100/);
  });
});

test('only the owner, only from Clawco itself, only when connected', async () => {
  await medApp(async ({ lav, dir }) => {
    const ejer = lav();
    assert.equal((await send(ejer.app, 'POST', FEEDS, { adresse: A })).status, 409, 'not connected yet');
    assert.equal((await send(ejer.app, 'DELETE', `${FEEDS}/${feedId(A)}`)).status, 409);
    await forbind(ejer.app, `${A}\n${B}`);
    const medlem = lav(MEDLEM);
    assert.equal((await send(medlem.app, 'POST', FEEDS, { adresse: A })).status, 403);
    assert.equal((await send(medlem.app, 'DELETE', `${FEEDS}/${feedId(B)}`)).status, 403);
    assert.doesNotMatch(await panel(medlem.app), /kilde-feeds|data-kilde-feed/, 'a member is not shown the list');
    for (const site of ['cross-site', 'same-site']) {
      assert.equal((await send(ejer.app, 'POST', FEEDS, { adresse: 'https://b.example/rss' }, { 'sec-fetch-site': site })).status, 403, site);
      assert.equal((await send(ejer.app, 'DELETE', `${FEEDS}/${feedId(B)}`, undefined, { 'sec-fetch-site': site })).status, 403, site);
    }
    assert.deepEqual(await feedsFil(dir), [A, B]);
    assert.equal((await send(ejer.app, 'DELETE', `${FEEDS}/${feedId(B)}`, undefined, { 'sec-fetch-site': 'same-origin' })).status, 200);
  });
});

test('a name with markup is shown as text in the panel and in the log', async () => {
  await medApp(async ({ lav }) => {
    const s = lav();
    await forbind(s.app, A);
    const r = await send(s.app, 'POST', FEEDS, { adresse: C });
    assert.equal(r.status, 200, await r.clone().text());
    const h = await panel(s.app);
    assert.doesNotMatch(h, /<img/);
    const rum = await (await s.app.request('/rum/nyheder')).text();
    assert.doesNotMatch(rum, /<img src=x/);
  });
});
