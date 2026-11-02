// KC-0116 end to end: the identity middleware in createApp and the testtilstand
// dispatcher in front of it.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { medTesttilstand } from '../src/testtilstand/kontakt.ts';
import type { Testverden } from '../src/testtilstand/verden.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-id-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../public', import.meta.url)));

const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
function lav(navn: string) {
  const dataDir = path.join(rod, navn);
  return { dataDir, sut: createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, ...noMail }) };
}
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const FJERN = { incoming: { socket: { remoteAddress: '100.64.0.9' } } };
const som = (l: string): RequestInit => ({ headers: { 'Tailscale-User-Login': l, 'Tailscale-User-Name': 'X' } });
const TO = { personer: [
  { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const },
  { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const },
] };

test('single-user: no household file → the implicit owner on <body>', async () => {
  const { sut } = lav('enebruger');
  const res = await sut.app.request('/rum/hjem');
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /<body[^>]* data-person="ejer"/);
  assert.match(h, /<body[^>]* data-rolle="ejer"/);
  assert.doesNotMatch(h, /class="husstand"/, 'no household list for one person');
});

test('a household of two: no identity → 401 page; /health stays open', async () => {
  const { sut, dataDir } = lav('to');
  await skrivHusstand(dataDir, TO);
  const res = await sut.app.request('/rum/hjem', {}, LOOPBACK);
  assert.equal(res.status, 401);
  assert.match(await res.text(), /Tailscale/);
  const api = await sut.app.request('/api/koe', {}, LOOPBACK);
  assert.equal(api.status, 401);
  assert.ok(((await api.json()) as { error: string }).error);
  const health = await sut.app.request('/health');
  assert.equal(health.status, 200);
});

test('a household of two: the loopback header picks the person', async () => {
  const { sut, dataDir } = lav('to-ok');
  await skrivHusstand(dataDir, TO);
  const res = await sut.app.request('/rum/hjem', som('maja@example.com'), LOOPBACK);
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /<body[^>]* data-person="maja"/);
  assert.match(h, /<body[^>]* data-rolle="medlem"/);
  assert.match(h, /class="husstand"/, 'the household is listed in the Kø panel');
  assert.match(h, /<li data-person="henrik" data-rolle="ejer">/);
});

test('the header from a non-loopback peer is ignored', async () => {
  const { sut, dataDir } = lav('to-fjern');
  await skrivHusstand(dataDir, TO);
  assert.equal((await sut.app.request('/rum/hjem', som('henrik@example.com'), FJERN)).status, 401);
  assert.equal((await sut.app.request('/rum/hjem', som('henrik@example.com'))).status, 401, 'no bindings at all');
});

test('an unknown login is refused with 403', async () => {
  const { sut, dataDir } = lav('to-fremmed');
  await skrivHusstand(dataDir, TO);
  assert.equal((await sut.app.request('/rum/hjem', som('ukendt@example.com'), LOOPBACK)).status, 403);
});

test('Funnel traffic is refused, static files included', async () => {
  const { sut } = lav('funnel');
  const res = await sut.app.request('/app.css', { headers: { 'Tailscale-Funnel-Request': '?1' } }, LOOPBACK);
  assert.equal(res.status, 403);
});

test('a broken household file fails closed with 503, never single-user', async () => {
  const { sut, dataDir } = lav('brudt');
  await skrivHusstand(dataDir, TO);
  await writeFile(path.join(dataDir, 'husstand.json'), '{ikke json', 'utf8');
  assert.equal((await sut.app.request('/rum/hjem', {}, LOOPBACK)).status, 503);
  assert.equal((await sut.app.request('/health')).status, 200);
});

test('a cookie, query string or body cannot select a person', async () => {
  const { sut, dataDir } = lav('to-cookie');
  await skrivHusstand(dataDir, TO);
  const res = await sut.app.request('/rum/hjem?person=henrik&login=henrik@example.com', { headers: { cookie: 'person=henrik; kc_person=henrik' } }, LOOPBACK);
  assert.equal(res.status, 401);
});

test('the testtilstand dispatcher passes the Node bindings through to the real app', async () => {
  const { sut, dataDir } = lav('to-kontakt');
  await skrivHusstand(dataDir, TO);
  const ingenVerden = (): Promise<Testverden> => Promise.reject(new Error('ikke brugt'));
  const disp = medTesttilstand(sut.app, ingenVerden);
  const res = await disp.request('/rum/hjem', som('maja@example.com'), LOOPBACK);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /data-person="maja"/);
  const funnel = await disp.request('/test/status', { headers: { 'Tailscale-Funnel-Request': '?1' } }, LOOPBACK);
  assert.equal(funnel.status, 403, 'the dispatcher refuses Funnel traffic on its own routes too');
});
