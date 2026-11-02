import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { PRODUKT } from '../src/shell/navn.ts';

// KC-0094: when the app cannot be reached the phone shows a calm Danish page, not Safari's
// English error. The service worker serves it from its own small cache; the page is fully
// self-contained (nothing else is reachable at that moment) and brings itself back.
const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' });

test('/sw.js is javascript at the root and always revalidated', async () => {
  const res = await app.request('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
});

test('/uden-forbindelse is a Danish dark page with a retry button', async () => {
  const res = await app.request('/uden-forbindelse');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const t = await res.text();
  assert.match(t, /<html lang="da">/);
  assert.match(t, /name="viewport"/);
  assert.match(t, /name="theme-color"/);
  assert.match(t, new RegExp(`<h1>${PRODUKT} kan ikke nås lige nu</h1>`));
  assert.match(t, /Er Tailscale tændt på telefonen\? Siden prøver selv igen, når forbindelsen er tilbage\./);
  assert.match(t, /<button[^>]*>Prøv igen<\/button>/);
  assert.match(t, /color-scheme/);
});

test('/uden-forbindelse is self-contained: no request to any other file or host', async () => {
  const t = await (await app.request('/uden-forbindelse')).text();
  assert.doesNotMatch(t, /https?:\/\//);
  assert.doesNotMatch(t, /<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(t, /<script[^>]+src=/);
  assert.match(t, /fetch\('\/health'/);
});
