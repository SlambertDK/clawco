// KC-0274 (finding C1, C4): no feed can freeze the server, and 1 100 plain escapes are not an entity bomb.
// Timings are asserted generously (500 ms) so a slow runner does not flake; before the fix these took seconds to minutes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFeedLinks, parseFeed, renTekst } from '../../../src/kilder/nyheder-rss/parse.ts';

const A = 'https://example.org/feed.xml';
const GRAENSE_MS = 500;
const tid = (fn: () => void): number => { const t0 = performance.now(); fn(); return performance.now() - t0; };

test('200 KB of "<a<a<a…" inside a CDATA description parses fast', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>Én</title><description><![CDATA[${'<a'.repeat(100_000)}]]></description></item></channel></rss>`;
  let f: ReturnType<typeof parseFeed> | undefined;
  const ms = tid(() => { f = parseFeed(xml, { adresse: A }); });
  assert.ok(ms < GRAENSE_MS, `took ${ms.toFixed(0)} ms`);
  assert.equal(f?.nyheder[0]?.titel, 'Én');
});

test('the other quadratic shapes are cut too: unclosed comments, CDATA, script and entity soup', () => {
  for (const del of ['<!--', '<![CDATA[', '<script ', '&amp;<', '<</', '<!<?<!']) {
    const ms = tid(() => { renTekst(del.repeat(Math.ceil(200_000 / del.length)), 300); });
    assert.ok(ms < GRAENSE_MS, `${del}: ${ms.toFixed(0)} ms`);
  }
});

test('renTekst still strips markup inside the examined head, and the cut cannot leave the text longer than max', () => {
  assert.equal(renTekst('<p>Hej <b>du</b></p>', 300), 'Hej du');
  const lang = renTekst(`<p>${'ord '.repeat(50_000)}</p>`, 300);
  assert.ok(lang.length <= 300);
  assert.ok(lang.startsWith('ord ord'));
});

test('findFeedLinks on a page of 200 KB "<link<link…" is fast and still finds the real link', () => {
  const html = `<html><head>${'<link'.repeat(40_000)}<link rel="alternate" type="application/rss+xml" href="/f.xml"></head></html>`;
  let l: string[] = [];
  const ms = tid(() => { l = findFeedLinks(html, 'https://example.org/'); });
  assert.ok(ms < GRAENSE_MS, `took ${ms.toFixed(0)} ms`);
  assert.deepEqual(l, ['https://example.org/f.xml']);
  const ms2 = tid(() => { findFeedLinks(`<link ${'<link '.repeat(300_000)}`, 'https://example.org/'); });
  assert.ok(ms2 < GRAENSE_MS, `unclosed: ${ms2.toFixed(0)} ms`);
});

test('C4: plain escapes are not entities — 1 100 "&amp;" parse, declared entities are still refused', () => {
  const med = (n: number): string => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>${'&amp;'.repeat(n)}x</title></item></channel></rss>`;
  assert.equal(parseFeed(med(900), { adresse: A }).nyheder.length, 1);
  const f = parseFeed(med(1100), { adresse: A });
  assert.equal(f.nyheder.length, 1);
  assert.equal(f.nyheder[0]?.titel.startsWith('&&&'), true);
  assert.throws(() => parseFeed('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><rss><channel><title>&a;</title></channel></rss>', { adresse: A }));
});
