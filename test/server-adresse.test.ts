import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

// KC-0017: typing just `kontrol/` (a MagicDNS short name, plain http) lands on
// the canonical https address — the microphone needs https.
const base = { store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json' };
const ADRESSE = 'https://kontrol.example.ts.net';

test('a short host name is sent to the canonical address, path and query kept', async () => {
  const { app } = createApp({ ...base, adresse: ADRESSE });
  const res = await app.request('http://kontrol/rum/mail?x=1');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), ADRESSE + '/rum/mail?x=1');
});

test('full names, IPs and localhost are served as they are', async () => {
  const { app } = createApp({ ...base, adresse: ADRESSE });
  for (const url of ['https://kontrol.example.ts.net/health', 'https://kira-home.example.ts.net:8750/health', 'http://127.0.0.1:8750/health', 'http://localhost:8750/health', 'http://[::1]:8750/health']) {
    assert.equal((await app.request(url)).status, 200, url);
  }
});

test('without a canonical address nothing is redirected', async () => {
  const { app } = createApp(base);
  assert.equal((await app.request('http://kontrol/health')).status, 200);
});
