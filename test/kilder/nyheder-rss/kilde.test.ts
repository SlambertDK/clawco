// KC-0137: the connector — connect (paste, several, discovery, OPML), read (the shape the Nyheder room consumes),
// health, the card, and the disconnect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HentFejl } from '../../../src/kilder/nyheder-rss/hent.ts';
import { MAKS_FEEDS, nyhederRss, NYHEDER_RSS_ID } from '../../../src/kilder/nyheder-rss/kilde.ts';
import { laesKonfig, skrivKonfig } from '../../../src/kilder/register.ts';
import { KildeFejl, type Kilde, type Nyhed } from '../../../src/kilder/types.ts';
import { trimNyheder } from '../../../src/rooms/nyheder/source.ts';
import { ctx, falskHenter, NU, rss, type Kald, type Post, type Svar } from './hjaelp.ts';

const status = (status: number) => (e: unknown): boolean => e instanceof KildeFejl && e.status === status;
type Feed = { url: string; navn?: string; tilfoejet: string; lokal?: true };
const feedsAf = (valg: Record<string, string>): Feed[] => JSON.parse(valg['feeds'] ?? '[]') as Feed[];
async function opsaet(k: Kilde, valg: Record<string, string>): Promise<{ tekst: string; valg: Record<string, string> }> {
  assert.ok(k.opsaet);
  return k.opsaet(ctx(valg));
}
async function medDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-rss-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const A = 'https://a.example/feed.xml';
const B = 'https://b.example/rss';
const FEED_A = rss('Vindkraft Dagligt', [['Nordvik får grønt lys', 'https://a.example/1', '2026-11-01T05:00:00Z', 'Kabelkorridoren godkendes.'], ['Kabelfabrik', 'https://a.example/2', '2026-10-31T10:00:00Z']]);
const FEED_B = rss('Netbladet', [['Negative elpriser', 'https://b.example/1', '2026-11-01T06:00:00Z']]);

test('identity: a local source of news, untrusted, in the private zone', () => {
  const k = nyhederRss({ hent: falskHenter({}) });
  assert.deepEqual([k.id, k.slags, k.auth, k.zone, k.tillid, k.standard], [NYHEDER_RSS_ID, 'nyheder', 'local', 'privat', 'uklar', undefined]);
  assert.equal(k.act, undefined);
});

test('connect: a pasted address is fetched, named by its title, and stored with the time added', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A } }) });
  const r = await opsaet(k, { adresser: A });
  assert.deepEqual(feedsAf(r.valg), [{ url: A, navn: 'Vindkraft Dagligt', tilfoejet: NU.toISOString() }]);
  assert.match(r.tekst, /1 nyhedskilde/);
  assert.deepEqual(Object.keys(r.valg), ['feeds']);
});

test('connect: several addresses, separated by lines, commas or nothing at all, add several', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: { tekst: FEED_B } }) });
  for (const tekst of [`${A}\n${B}`, `${A}, ${B}`, `${A}${B}`, `  ${A}  \r\n\r\n ${B} \n`]) {
    const r = await opsaet(k, { adresser: tekst });
    assert.deepEqual(feedsAf(r.valg).map((f) => f.url), [A, B], JSON.stringify(tekst));
  }
});

test('connect: a web page is searched for its feed (auto-discovery); a page without one is refused', async () => {
  const side = 'https://c.example/blog/';
  const html = '<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/blog/feed.xml"></head><body>hej</body></html>';
  const k = nyhederRss({ hent: falskHenter({ [side]: { tekst: html }, 'https://c.example/blog/feed.xml': { tekst: rss('Bloggen', [['Indlæg', 'https://c.example/blog/1']]) }, 'https://d.example/': { tekst: '<html><body>intet</body></html>' } }) });
  const r = await opsaet(k, { adresser: side });
  assert.deepEqual(feedsAf(r.valg).map((f) => [f.url, f.navn]), [['https://c.example/blog/feed.xml', 'Bloggen']]);
  await assert.rejects(opsaet(k, { adresser: 'https://d.example/' }), status(400));
});

test('connect: a bad address refuses the whole connect with a sentence naming it', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, 'https://slem.example/x': new HentFejl('status', 'Kilden svarede 404.'), 'https://a.example/ikke-xml': { tekst: 'hej' } }) });
  for (const slem of ['javascript:alert(1)', 'http://169.254.169.254/latest', 'https://u:p@a.example/x', 'https://slem.example/x', 'https://ingen.example/x', 'https://a.example/ikke-xml']) {
    await assert.rejects(opsaet(k, { adresser: `${A}\n${slem}` }), (e: unknown) => e instanceof KildeFejl && e.status === 400 && !/[<>]/.test(e.message), slem);
  }
  await assert.rejects(opsaet(k, { adresser: '' }), status(400));
  await assert.rejects(opsaet(k, {}), status(400));
});

test('connect: an address on the local network is accepted only because the user pasted it, and is marked so', async () => {
  const lokal = 'http://192.168.1.5:8080/feed';
  const kald: Kald[] = [];
  const hent = falskHenter({ [lokal]: { tekst: rss('Hjemmeserveren', [['Nyt', 'http://192.168.1.5/1']]) }, [A]: { tekst: FEED_A } }, kald);
  const refuser = async (adr: string, o: Parameters<typeof hent>[1]) => { if (o.oprindelse === 'ekstern' && adr === lokal) throw new HentFejl('afvist', 'Lokalt.'); return hent(adr, o); };
  const k = nyhederRss({ hent: refuser });
  const feeds = feedsAf((await opsaet(k, { adresser: `${lokal}\n${A}` })).valg);
  assert.deepEqual(feeds.map((f) => [f.url, f.lokal ?? false]), [[lokal, true], [A, false]]);
  await k.read(ctx({ feeds: JSON.stringify(feeds) }));
  assert.deepEqual(kald.filter((c) => c.adresse === lokal).slice(-1)[0]?.oprindelse, 'bruger');
  assert.deepEqual(kald.filter((c) => c.adresse === A).slice(-1)[0]?.oprindelse, 'ekstern');
});

const opml = (urls: [string, string?][]): string => `<?xml version="1.0"?><opml version="2.0"><body><outline text="Mappe">${urls.map(([u, n]) => `<outline type="rss"${n ? ` text="${n}"` : ''} xmlUrl="${u}"/>`).join('')}</outline></body></opml>`;

test('OPML: the feeds are added without fetching them, duplicates (also of the stored ones) merged, names kept', async () => {
  const kald: Kald[] = [];
  const k = nyhederRss({ hent: falskHenter({}, kald) });
  const r = await opsaet(k, { opml: opml([[A, 'Vindkraft'], [B], ['HTTPS://A.example:443/feed.xml', 'igen'], ['javascript:alert(1)', 'slem'], ['http://127.0.0.1/feed', 'lokal']]) });
  assert.deepEqual(feedsAf(r.valg).map((f) => [f.url, f.navn, f.lokal ?? false]), [[A, 'Vindkraft', false], [B, undefined, false]]);
  assert.deepEqual(kald, []);
  assert.match(r.tekst, /2 nyhedskilder/);
  assert.match(r.tekst, /sprang 1 over/);
  await assert.rejects(opsaet(k, { opml: '<rss/>' }), status(400));
});

test('OPML and pasted addresses together; the list never passes 100 and the answer says how many were left out', async () => {
  const mange: [string, string][] = Array.from({ length: 130 }, (_, i) => [`https://f${i}.example/rss`, `Kilde ${i}`]);
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A } }) });
  const r = await opsaet(k, { opml: opml(mange), adresser: A });
  const feeds = feedsAf(r.valg);
  assert.equal(feeds.length, MAKS_FEEDS);
  assert.equal(feeds[0]?.url, A, 'the address the user typed comes first and is not the one cut');
  assert.match(r.tekst, /31 var for mange/);
});

test('connect: stored feeds are kept and added to; nothing to add and nothing stored is refused', async () => {
  await medDir(async (dir) => {
    await skrivKonfig(dir, { kilder: [{ id: NYHEDER_RSS_ID, status: 'frakoblet', zone: 'privat', valg: { feeds: JSON.stringify([{ url: A, navn: 'Gammel', tilfoejet: '2026-10-01T00:00:00.000Z' }]) }, tid: NU.toISOString(), af: 'henrik' }] });
    const k = nyhederRss({ dataDir: dir, hent: falskHenter({ [B]: { tekst: FEED_B } }) });
    const r = await opsaet(k, { adresser: B });
    assert.deepEqual(feedsAf(r.valg).map((f) => f.url), [A, B]);
    assert.equal(feedsAf(r.valg)[0]?.navn, 'Gammel');
    assert.deepEqual(feedsAf((await opsaet(k, {})).valg).map((f) => f.url), [A], 'reconnecting keeps the list');
    assert.equal((await laesKonfig(dir)).kilder.length, 1);
  });
});

test('read: the shape the Nyheder room consumes — newest first, summaries, status counts', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: { tekst: FEED_B } }) });
  const feeds = JSON.stringify([{ url: A, tilfoejet: 'x' }, { url: B, tilfoejet: 'x' }]);
  const l = await k.read(ctx({ feeds }));
  assert.equal(l.slags, 'nyheder');
  assert.equal(l.uklar, true);
  assert.equal(l.hentet, NU.toISOString());
  assert.ok(l.slags === 'nyheder');
  assert.deepEqual(l.data.nyheder.map((n) => n.titel), ['Negative elpriser', 'Nordvik får grønt lys', 'Kabelfabrik']);
  assert.deepEqual(l.data.nyheder[1], { titel: 'Nordvik får grønt lys', kilde: 'Vindkraft Dagligt', url: 'https://a.example/1', resume: 'Kabelkorridoren godkendes.', udgivet: '2026-11-01T05:00:00.000Z' });
  assert.deepEqual(l.data.status, { antal: 2, medNyheder: 2, nyheder: 3, fejlede: [] });
});

test('read: golden — the same logical items come out exactly as trimNyheder shapes them (cap 80, newest first)', async () => {
  const adr = ['https://g0.example/f', 'https://g1.example/f', 'https://g2.example/f', 'https://g3.example/f'];
  const poster = (f: number): Post[] => Array.from({ length: 30 }, (_, i) => [`Nyhed ${f}-${i}`, `https://g${f}.example/n${i}`, new Date(Date.UTC(2026, 10, 1, 0, 0, 0) - (i * 4 + f) * 3_600_000).toISOString(), `Resumé ${f}-${i}`]);
  const k = nyhederRss({ hent: falskHenter(Object.fromEntries(adr.map((a, f) => [a, { tekst: rss(`Avis ${f}`, poster(f)) }]))) });
  const l = await k.read(ctx({ feeds: JSON.stringify(adr.map((url) => ({ url, tilfoejet: 'x' }))) }));
  assert.ok(l.slags === 'nyheder');
  const trimmet = trimNyheder({ sources: adr.map((_, f) => ({ source: `Avis ${f}`, type: 'rss', error: null, items: poster(f).map(([title, url, published, summary]) => ({ title, url, published, summary })) })) });
  assert.deepEqual(l.data.nyheder, trimmet.nyheder);
  assert.equal(l.data.nyheder.length, 80);
  assert.deepEqual(l.data.status, trimmet.kilder);
});

test('read: the same story in two feeds is listed once', async () => {
  const delt = 'https://delt.example/historie';
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: rss('A', [['Historie', delt, '2026-11-01T05:00:00Z']]) }, [B]: { tekst: rss('B', [['Historie (B)', delt, '2026-11-01T05:30:00Z']]) } }) });
  const l = await k.read(ctx({ feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }, { url: B, tilfoejet: 'x' }]) }));
  assert.ok(l.slags === 'nyheder');
  assert.deepEqual(l.data.nyheder.map((n) => n.titel), ['Historie'], 'the first feed in the list keeps it');
});

test('read: one failing feed is named in fejlede and does not stop the others; health is ok with the name', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: new HentFejl('tid', 'Kilden svarede ikke i tide.') }) });
  const valg = { feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }, { url: B, navn: 'Netbladet', tilfoejet: 'x' }]) };
  const l = await k.read(ctx(valg));
  assert.ok(l.slags === 'nyheder');
  assert.deepEqual(l.data.status, { antal: 2, medNyheder: 1, nyheder: 2, fejlede: ['Netbladet'] });
  assert.deepEqual(await k.helbred(ctx(valg)), { status: 'ok', tekst: 'Netbladet svarer ikke lige nu.' });
});

test('read: a feed without a stored name is named by its host', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: new HentFejl('status', 'x') }) });
  const l = await k.read(ctx({ feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }, { url: B, tilfoejet: 'x' }]) }));
  assert.ok(l.slags === 'nyheder');
  assert.deepEqual(l.data.status.fejlede, ['b.example']);
});

test('read: all feeds failing fails the read; health is nede for ten minutes, then ok so the registry reads again', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: new HentFejl('net', 'x'), [B]: new HentFejl('status', 'x') }) });
  const valg = { feeds: JSON.stringify([{ url: A, navn: 'Alfa', tilfoejet: 'x' }, { url: B, navn: 'Beta', tilfoejet: 'x' }]) };
  assert.equal((await k.helbred(ctx(valg))).status, 'ok', 'nothing read yet is not a failure');
  await assert.rejects(k.read(ctx(valg)), status(502));
  assert.deepEqual(await k.helbred(ctx(valg, new Date(NU.getTime() + 60_000))), { status: 'nede', tekst: 'Ingen af kilderne svarer: Alfa og Beta.' });
  assert.deepEqual(await k.helbred(ctx(valg, new Date(NU.getTime() + 11 * 60_000))), { status: 'ok', tekst: 'Prøver igen.' });
});

test('read: no feeds is an empty read; helbred says there is nothing set up', async () => {
  const k = nyhederRss({ hent: falskHenter({}) });
  const l = await k.read(ctx());
  assert.ok(l.slags === 'nyheder');
  assert.deepEqual(l.data, { nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } });
  assert.equal((await k.helbred(ctx())).status, 'nede');
});

test('read: conditional GET — the stored validators go out, "uændret" reuses the items, and a restart keeps them', async () => {
  await medDir(async (dir) => {
    const kald: Kald[] = [];
    const tabel: Record<string, Svar> = { [A]: { tekst: FEED_A, etag: '"v1"' } };
    const valg = { feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }]) };
    const k1 = nyhederRss({ dataDir: dir, hent: falskHenter(tabel, kald) });
    const foerste = await k1.read(ctx(valg));
    const anden = await k1.read(ctx(valg));
    assert.deepEqual(kald.map((c) => c.etag), [undefined, '"v1"']);
    assert.deepEqual(anden, foerste);
    const k2 = nyhederRss({ dataDir: dir, hent: falskHenter(tabel, kald) });
    assert.deepEqual(await k2.read(ctx(valg)), foerste);
    assert.equal(kald.at(-1)?.etag, '"v1"');
  });
});

test('read: HTML and scripts in a feed never come out; a failing parse names the feed', async () => {
  const slem = `<?xml version="1.0"?><rss version="2.0"><channel><title>Slem &lt;script&gt;x&lt;/script&gt;</title><item><title>Titel &lt;img src=x onerror=alert(1)&gt;</title><link>javascript:alert(1)</link><pubDate>${new Date('2026-11-01T05:00:00Z').toUTCString()}</pubDate><description>&lt;script&gt;steal()&lt;/script&gt;Tekst</description></item></channel></rss>`;
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: slem }, [B]: { tekst: '<html>ikke et feed</html>' } }) });
  const l = await k.read(ctx({ feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }, { url: B, navn: 'Brudt', tilfoejet: 'x' }]) }));
  assert.ok(l.slags === 'nyheder');
  assert.equal(JSON.stringify(l.data).match(/[<>]/), null);
  assert.equal(l.data.nyheder[0]?.url, undefined);
  assert.equal(l.data.nyheder[0]?.resume, 'Tekst');
  assert.deepEqual(l.data.status.fejlede, ['Brudt']);
});

test('kort: three states — nothing yet, some sources, one that does not answer — all plain text', async () => {
  const k = nyhederRss({ hent: falskHenter({ [A]: { tekst: FEED_A }, [B]: new HentFejl('tid', 'x') }) });
  const ingen = await k.kort(ctx());
  assert.equal(ingen.handling, 'Tilføj');
  assert.deepEqual(ingen.felter.map((f) => [f.navn, f.type, f.skjult ?? false, f.flere ?? false]), [['adresser', 'tekst', false, true], ['opml', 'fil', false, false], ['feeds', 'tekst', true, false]]);
  assert.match(ingen.tekst, /OPML/);
  assert.ok(!/Feedly|Inoreader|http/.test(ingen.tekst), 'no starter list of outlets and no invented links');
  const valg = { feeds: JSON.stringify([{ url: A, navn: 'Vindkraft Dagligt', tilfoejet: 'x' }, { url: B, navn: 'Netbladet <b>', tilfoejet: 'x' }]) };
  const med = await k.kort(ctx(valg));
  assert.match(med.tekst, /^2 nyhedskilder: Vindkraft Dagligt og Netbladet b\./);
  assert.equal(med.handling, 'Tilføj flere');
  await k.read(ctx(valg));
  const fejl = await k.kort(ctx(valg));
  assert.match(fejl.tekst, /Netbladet b svarer ikke lige nu/);
  for (const kort of [ingen, med, fejl]) for (const t of [kort.titel, kort.tekst, kort.handling, ...kort.felter.map((f) => f.etiket)]) assert.ok(!/[<>]/.test(t), t);
});

test('frakobl: the stored items and validators go with the connection', async () => {
  await medDir(async (dir) => {
    const valg = { feeds: JSON.stringify([{ url: A, tilfoejet: 'x' }]) };
    const k = nyhederRss({ dataDir: dir, hent: falskHenter({ [A]: { tekst: FEED_A, etag: '"v1"' } }) });
    await k.read(ctx(valg));
    await access(path.join(dir, 'nyheder-rss'));
    assert.ok(k.frakobl);
    await k.frakobl(ctx(valg));
    await assert.rejects(access(path.join(dir, 'nyheder-rss')));
  });
});
