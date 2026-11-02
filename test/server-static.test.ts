import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

// KC-0018: after a deploy the browser (and the home-screen app) must pick up the new client,
// so static files are always revalidated instead of heuristically cached.
test('static files are served with Cache-Control: no-cache', async () => {
  const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' });
  for (const p of ['/app.js', '/app.css', '/manifest.webmanifest']) {
    const res = await app.request(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('cache-control'), 'no-cache', p);
  }
});

// KC-0064: the keyed morph is its own classic script next to app.js.
test('the morph script is served as javascript', async () => {
  const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' });
  const res = await app.request('/morph.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});
