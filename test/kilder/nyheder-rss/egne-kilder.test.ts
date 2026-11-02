// KC-0222: the user's own news sources after the connection — add one (the same check as the card's: a feed, or a page
// that points at one), remove one (its cache goes with it), the list by id. The connector answers the options to store;
// the registry writes them (test/kilder/register-valg.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { feedId, MAKS_FEEDS, nyhederRss, type NyhederRssKilde } from '../../../src/kilder/nyheder-rss/kilde.ts';
import { HentFejl } from '../../../src/kilder/nyheder-rss/hent.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';
import { ctx, falskHenter, NU, rss, type Kald } from './hjaelp.ts';

type Feed = { url: string; navn?: string; tilfoejet: string };
const feedsAf = (valg: Record<string, string>): Feed[] => JSON.parse(valg['feeds'] ?? '[]') as Feed[];
const status = (s: number) => (e: unknown): boolean => e instanceof KildeFejl && e.status === s;
const A = 'https://a.example/feed.xml';
const B = 'https://b.example/rss';
const FEED_A = rss('Vindkraft Dagligt', [['Nordvik får grønt lys', 'https://a.example/1', '2026-11-01T05:00:00Z']]);
const FEED_B = rss('Netbladet', [['Negative elpriser', 'https://b.example/1', '2026-11-01T06:00:00Z']]);
const liste = (...f: [string, string][]): Record<string, string> => ({ feeds: JSON.stringify(f.map(([url, navn]) => ({ url, navn, tilfoejet: NU.toISOString() }))) });

async function medDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-egne-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const cacheFiler = async (dir: string): Promise<string[]> => readdir(path.join(dir, 'nyheder-rss')).catch(() => []);

test('feeds: the stored list as id and name (a feed without a name by its host), in the stored order', () => {
  const k: NyhederRssKilde = nyhederRss({ hent: falskHenter({}) });
  const valg = { feeds: JSON.stringify([{ url: A, navn: 'Vindkraft Dagligt', tilfoejet: 'x' }, { url: 'https://uden-navn.example/rss', tilfoejet: 'x' }]) };
  assert.deepEqual(k.feeds(valg), [{ id: feedId(A), navn: 'Vindkraft Dagligt' }, { id: feedId('https://uden-navn.example/rss'), navn: 'uden-navn.example' }]);
  assert.deepEqual(k.feeds({}), []);
  assert.match(feedId(A), /^f-[0-9a-f]{12}$/);
  assert.equal(feedId('https://A.example/feed.xml'), feedId(A), 'two spellings of one address are one id');
});

test('add: a pasted address is checked as on the card, named by its title and appended to the list', async () => {
  const kald: Kald[] = [];
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: { tekst: FEED_B } }, kald) });
  const r = await k.tilfoejFeed(B, ctx(liste([A, 'Vindkraft Dagligt'])));
  assert.deepEqual(feedsAf(r.valg).map((f) => [f.url, f.navn]), [[A, 'Vindkraft Dagligt'], [B, 'Netbladet']]);
  assert.equal(feedsAf(r.valg)[1]?.tilfoejet, NU.toISOString());
  assert.deepEqual(r.feed, { id: feedId(B), navn: 'Netbladet' });
  assert.match(r.tekst, /Netbladet/);
  assert.deepEqual(Object.keys(r.valg), ['feeds']);
  assert.deepEqual(kald.map((x) => x.oprindelse), ['ekstern'], 'a public address is fetched as one');
});

test('add: a web page is searched for its feed, exactly as on the card', async () => {
  const side = 'https://c.example/blog/';
  const html = '<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/blog/feed.xml"></head><body>hej</body></html>';
  const k = nyhederRss({ hent: falskHenter({ [side]: { tekst: html }, 'https://c.example/blog/feed.xml': { tekst: rss('Bloggen', [['Indlæg', 'https://c.example/blog/1']]) } }) });
  const r = await k.tilfoejFeed(side, ctx(liste([A, 'A'])));
  assert.deepEqual(feedsAf(r.valg).map((f) => f.url), [A, 'https://c.example/blog/feed.xml']);
});

test('add: a bad address, an address that is no feed, and the guard\'s refusals are 400 in plain words; nothing is fetched for a refused address', async () => {
  const kald: Kald[] = [];
  const k = nyhederRss({ hent: falskHenter({ 'https://tom.example/': { tekst: '<html><body>intet</body></html>' }, 'https://nede.example/rss': new HentFejl('net', 'Kilden kunne ikke nås.') }, kald) });
  for (const raa of ['javascript:alert(1)', 'ftp://x.example/rss', 'http://169.254.169.254/latest/', 'https://bruger:kode@x.example/rss', '']) {
    await assert.rejects(() => k.tilfoejFeed(raa, ctx(liste([A, 'A']))), status(400), raa);
  }
  assert.equal(kald.length, 0);
  await assert.rejects(() => k.tilfoejFeed('https://tom.example/', ctx(liste([A, 'A']))), (e: unknown) => status(400)(e) && /ingen nyhedskilde/.test((e as Error).message));
  await assert.rejects(() => k.tilfoejFeed('https://nede.example/rss', ctx(liste([A, 'A']))), status(400));
  await assert.rejects(() => k.tilfoejFeed(`${A} ${B}`, ctx(liste([A, 'A']))), (e: unknown) => status(400)(e) && /én adresse/i.test((e as Error).message));
});

test('add: a source already on the list (also spelled differently, or found through a page) is refused with its name; the list is untouched', async () => {
  const kald: Kald[] = [];
  const side = 'https://a.example/';
  const html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>';
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [side]: { tekst: html } }, kald) });
  const stand = ctx(liste([A, 'Vindkraft Dagligt']));
  for (const raa of [A, 'https://A.EXAMPLE/feed.xml#top', side]) {
    await assert.rejects(() => k.tilfoejFeed(raa, stand), (e: unknown) => status(409)(e) && /har du allerede/.test((e as Error).message) && /Vindkraft Dagligt/.test((e as Error).message), raa);
  }
  assert.deepEqual(kald.map((x) => x.adresse), [side, 'https://a.example/feed.xml'], 'a plain duplicate is refused before any fetch; the page one only after its feed was found');
});

test('add: the cap of 100 is kept, and said before anything is fetched', async () => {
  const kald: Kald[] = [];
  const fuld = { feeds: JSON.stringify(Array.from({ length: MAKS_FEEDS }, (_, i) => ({ url: `https://k${i}.example/rss`, navn: `K${i}`, tilfoejet: 'x' }))) };
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A } }, kald) });
  await assert.rejects(() => k.tilfoejFeed(A, ctx(fuld)), (e: unknown) => status(400)(e) && /Højst 100/.test((e as Error).message));
  assert.equal(kald.length, 0);
});

test('add: a loopback address the user typed is allowed and marked local; remove: the cache goes, the list shrinks, a missing id is 404, the last one stays', async () => {
  await medDir(async (dir) => {
    const lokal = 'http://127.0.0.1:9/feed.xml';
    const k = nyhederRss({ dataDir: dir, hent: async (a, o) => {
      if (a === lokal && o.oprindelse === 'ekstern') throw new HentFejl('afvist', 'Adressen peger på dit lokale netværk.');
      return { status: 'ny', tekst: a === lokal ? rss('Min egen', [['x', 'http://127.0.0.1:9/1']]) : a === A ? FEED_A : FEED_B, endeligAdresse: a };
    } });
    let valg = liste([A, 'Vindkraft Dagligt']);
    valg = (await k.tilfoejFeed(lokal, ctx(valg))).valg;
    assert.equal((feedsAf(valg)[1] as Feed & { lokal?: true }).lokal, true);
    valg = (await k.tilfoejFeed(B, ctx(valg))).valg;
    assert.equal((await cacheFiler(dir)).length, 2, 'the two added feeds are cached (A was never read here)');

    const ud = await k.fjernFeed(feedId(B), ctx(valg));
    assert.deepEqual(feedsAf(ud.valg).map((f) => f.url), [A, lokal]);
    assert.deepEqual(ud.feed, { id: feedId(B), navn: 'Netbladet' });
    assert.equal((await cacheFiler(dir)).length, 1, 'the removed feed\'s cached items are gone');
    await assert.rejects(() => k.fjernFeed(feedId(B), ctx(ud.valg)), status(404));
    await assert.rejects(() => k.fjernFeed('../../etc', ctx(ud.valg)), status(404));
    const en = (await k.fjernFeed(feedId(lokal), ctx(ud.valg))).valg;
    await assert.rejects(() => k.fjernFeed(feedId(A), ctx(en)), (e: unknown) => status(409)(e) && /sidste/.test((e as Error).message));
  });
});

test('remove, then add the same address again: it is back (this is Fortryd)', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: { tekst: FEED_B } }) });
  const foer = liste([A, 'Vindkraft Dagligt'], [B, 'Netbladet']);
  const uden = (await k.fjernFeed(feedId(B), ctx(foer))).valg;
  assert.deepEqual(feedsAf(uden).map((f) => f.url), [A]);
  const igen = (await k.tilfoejFeed(B, ctx(uden))).valg;
  assert.deepEqual(feedsAf(igen).map((f) => f.url), [A, B]);
});
