// KC-0137: RSS 2.0, RSS 1.0, Atom, OPML and feed discovery; and the cleaning every fetched text goes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erHtml, findFeedLinks, ParseFejl, parseFeed, parseOpml, renTekst, renUrl } from '../../../src/kilder/nyheder-rss/parse.ts';

const A = 'https://example.org/feed.xml';

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Vindkraft Dagligt</title><link>https://example.org/</link>
<item><title>Første</title><link>https://example.org/a</link><description>Kort resumé &amp; mere</description><pubDate>Mon, 02 Nov 2026 06:30:00 GMT</pubDate></item>
<item><title>Anden</title><link>https://example.org/b</link><description>Tekst</description><dc:date>2026-11-01T07:00:00Z</dc:date></item>
<item><title>Uden dato</title><link>https://example.org/c</link></item>
</channel></rss>`;

test('RSS 2.0: titles, links, summaries, ISO dates, source name from the channel', () => {
  const f = parseFeed(RSS, { adresse: A });
  assert.equal(f.titel, 'Vindkraft Dagligt');
  assert.deepEqual(f.nyheder.map((n) => n.titel), ['Første', 'Anden', 'Uden dato']);
  assert.deepEqual(f.nyheder[0], { titel: 'Første', kilde: 'Vindkraft Dagligt', url: 'https://example.org/a', resume: 'Kort resumé & mere', udgivet: '2026-11-02T06:30:00.000Z' });
  assert.equal(f.nyheder[1]?.udgivet, '2026-11-01T07:00:00.000Z');
});

test('missing dates leave udgivet out; a given name wins over the channel title', () => {
  const f = parseFeed(RSS, { adresse: A, navn: 'Min avis' });
  assert.equal('udgivet' in (f.nyheder[2] as object), false);
  assert.equal(f.nyheder[2]?.kilde, 'Min avis');
});

test('RSS 1.0 (rdf) items beside the channel', () => {
  const x = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Gammel</title></channel><item><title>Et</title><link>https://example.org/r1</link><dc:date>2026-10-31T10:00:00Z</dc:date></item></rdf:RDF>`;
  const f = parseFeed(x, { adresse: A });
  assert.equal(f.titel, 'Gammel');
  assert.equal(f.nyheder[0]?.url, 'https://example.org/r1');
});

test('Atom: alternate link, summary or content, updated or published', () => {
  const x = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Atom-bladet</title>
<entry><title type="html">Ny &lt;b&gt;regel&lt;/b&gt;</title><link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/atom/1"/><summary>Kort</summary><updated>2026-11-01T05:00:00Z</updated></entry>
<entry><title>Anden</title><link href="https://example.org/atom/2"/><content type="html">&lt;p&gt;Indhold&lt;/p&gt;</content><published>2026-10-30T05:00:00+01:00</published></entry></feed>`;
  const f = parseFeed(x, { adresse: A });
  assert.equal(f.titel, 'Atom-bladet');
  assert.equal(f.nyheder[0]?.titel, 'Ny regel');
  assert.equal(f.nyheder[0]?.url, 'https://example.org/atom/1');
  assert.equal(f.nyheder[0]?.udgivet, '2026-11-01T05:00:00.000Z');
  assert.equal(f.nyheder[1]?.url, 'https://example.org/atom/2');
  assert.equal(f.nyheder[1]?.resume, 'Indhold');
  assert.equal(f.nyheder[1]?.udgivet, '2026-10-30T04:00:00.000Z');
});

test('malformed XML and non-feeds throw ParseFejl', () => {
  assert.throws(() => parseFeed('<rss><channel><item>', { adresse: A }), ParseFejl);
  assert.throws(() => parseFeed('hej verden', { adresse: A }), ParseFejl);
  assert.throws(() => parseFeed('<html><body>ikke en feed</body></html>', { adresse: A }), ParseFejl);
  assert.throws(() => parseFeed('', { adresse: A }), ParseFejl);
});

const item = (beskrivelse: string, link = 'https://example.org/x'): string => `<rss version="2.0"><channel><title>T</title><item><title>X</title><link>${link}</link><description>${beskrivelse}</description></item></channel></rss>`;

test('HTML in a summary is stripped to plain text with entities decoded', () => {
  const f = parseFeed(item('&lt;p&gt;Hej &lt;b&gt;du&lt;/b&gt; &amp;amp; &amp;quot;dig&amp;quot;&lt;/p&gt;&lt;img src=x onerror=alert(1)&gt;'), { adresse: A });
  assert.equal(f.nyheder[0]?.resume, 'Hej du & "dig"');
});

test('script and style content is removed, not only their tags', () => {
  const f = parseFeed(item('Før&lt;script&gt;alert(1)&lt;/script&gt;&lt;style&gt;p{color:red}&lt;/style&gt;Efter'), { adresse: A });
  assert.equal(f.nyheder[0]?.resume, 'Før Efter');
});

test('double-escaped markup leaves no tag behind', () => {
  const f = parseFeed(item('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&amp;lt;b&amp;gt;fed&amp;lt;/b&amp;gt;'), { adresse: A });
  const r = f.nyheder[0]?.resume ?? '';
  assert.ok(!/<[a-z/!]/i.test(r), r);
  assert.ok(!r.includes('alert(1)'), r);
});

test('CDATA summaries are read as text', () => {
  const f = parseFeed(item('<![CDATA[<p>Fra <i>CDATA</i></p>]]>'), { adresse: A });
  assert.equal(f.nyheder[0]?.resume, 'Fra CDATA');
});

test('javascript:, data: and credential URLs are dropped; the item stays', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.org/x', 'ftp://example.org/x', '/relativ']) {
    const f = parseFeed(item('t', u), { adresse: A });
    assert.equal(f.nyheder[0]?.titel, 'X');
    assert.equal(f.nyheder[0]?.url, undefined, u);
  }
});

test('a huge summary is cut to 300 characters and a huge title to 200', () => {
  const f = parseFeed(`<rss version="2.0"><channel><title>T</title><item><title>${'t'.repeat(900)}</title><description>${'r'.repeat(5000)}</description></item></channel></rss>`, { adresse: A });
  assert.equal(f.nyheder[0]?.resume?.length, 300);
  assert.equal(f.nyheder[0]?.titel.length, 200);
});

test('an item without a title is skipped; at most 100 items are kept', () => {
  const mange = Array.from({ length: 150 }, (_, i) => `<item><title>N${i}</title></item>`).join('');
  const f = parseFeed(`<rss version="2.0"><channel><title>T</title><item><description>ingen titel</description></item>${mange}</channel></rss>`, { adresse: A });
  assert.equal(f.nyheder.length, 100);
  assert.equal(f.nyheder[0]?.titel, 'N0');
});

test('declared entities are refused (billion laughs), and __proto__ does not pollute', () => {
  const bombe = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><rss version="2.0"><channel><title>&lol2;</title></channel></rss>`;
  assert.throws(() => parseFeed(bombe, { adresse: A }), ParseFejl);
  const proto = `<rss version="2.0"><channel><title>T</title><__proto__><polluted>ja</polluted></__proto__><item><title>X</title><__proto__><polluted>ja</polluted></__proto__></item></channel></rss>`;
  try { parseFeed(proto, { adresse: A }); } catch { /* refusing is fine */ }
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('OPML: nested folders are flattened, duplicates merged, names kept, non-http dropped', () => {
  const x = `<?xml version="1.0"?><opml version="2.0"><head><title>Min læser</title></head><body>
<outline text="Energi"><outline type="rss" text="Vindkraft" xmlUrl="https://example.org/feed.xml" htmlUrl="https://example.org/"/><outline text="Dybere"><outline type="rss" title="Net" xmlUrl="https://example.net/rss"/></outline></outline>
<outline type="rss" text="Vindkraft igen" xmlUrl="HTTPS://Example.org:443/feed.xml#x"/>
<outline type="rss" text="Slem" xmlUrl="javascript:alert(1)"/><outline type="rss" text="Fil" xmlUrl="file:///etc/passwd"/>
<outline text="Uden adresse"/></body></opml>`;
  assert.deepEqual(parseOpml(x), [{ url: 'https://example.org/feed.xml', navn: 'Vindkraft' }, { url: 'https://example.net/rss', navn: 'Net' }]);
  assert.throws(() => parseOpml('<rss/>'), ParseFejl);
});

test('findFeedLinks resolves alternate feed links against the page', () => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="/s.css"><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"><LINK REL="alternate" TYPE="application/atom+xml" HREF="https://other.example/atom"><link rel="alternate" type="application/rss+xml" href="javascript:alert(1)"><link rel="alternate" hreflang="da" href="/da"></head></html>`;
  assert.deepEqual(findFeedLinks(html, 'https://example.org/blog/'), ['https://example.org/feed.xml', 'https://other.example/atom']);
  assert.equal(erHtml(html), true);
  assert.equal(erHtml(RSS), false);
});

test('renTekst and renUrl', () => {
  assert.equal(renTekst('  a \n\t b\u0000c  ', 50), 'a bc');
  assert.equal(renTekst('x'.repeat(10), 4), 'xxxx');
  assert.equal(renTekst('&#65;&#x42;&nbsp;&unknown;', 50), 'AB &unknown;');
  assert.equal(renUrl('https://example.org/a b'), 'https://example.org/a%20b');
  assert.equal(renUrl('javascript:alert(1)'), undefined);
  assert.equal(renUrl(42), undefined);
});
