// KC-0117 core: the person reaches the rooms per request (d.person), the Kø
// panel shows only runs the person may see, and log lines always carry a zone.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-zoner-'));
after(() => rm(rod, { recursive: true, force: true }));
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const som = (l: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': l } });

async function husstandAf2(navn: string) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' },
  ] });
  const store = createFileStore(dataDir);
  const sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, ...noMail });
  return { sut, store, dataDir };
}

test("the Kø panel shows the owner's privat runs to the owner only", async () => {
  const { sut } = await husstandAf2('koe');
  const start = await sut.app.request('/api/rum/dagen/chat', som('henrik@example.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: 'hej' }) }), LOOPBACK);
  assert.equal(start.status, 202);
  const ejer = (await (await sut.app.request('/api/koe', som('henrik@example.com'), LOOPBACK)).json()) as { runs: unknown[] };
  const maja = (await (await sut.app.request('/api/koe', som('maja@example.com'), LOOPBACK)).json()) as { runs: unknown[] };
  assert.equal(ejer.runs.length, 1);
  assert.equal(maja.runs.length, 0);
});

test('a log line is always written with a zone (privat when the room names none)', async () => {
  const dataDir = path.join(rod, 'log');
  const store = createFileStore(dataDir);
  await store.appendLog('dagen', { kilde: 'system', tekst: 'x' });
  await store.appendLog('dagen', { kilde: 'system', tekst: 'y', zone: 'husstand' });
  const linjer = (await readFile(path.join(dataDir, 'rum', 'dagen', 'log.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { zone?: string });
  assert.deepEqual(linjer.map((l) => l.zone), ['privat', 'husstand']);
});

test('d.person is the person of each request, also when requests overlap', async () => {
  const { sut } = await husstandAf2('samtidig');
  // Twenty overlapping requests alternating between the two persons: each page names its own person.
  const svar = await Promise.all(Array.from({ length: 20 }, (_, i) => {
    const hvem = i % 2 ? 'maja' : 'henrik';
    return Promise.resolve(sut.app.request('/rum/dagen', som(`${hvem}@example.com`), LOOPBACK)).then(async (r) => ({ hvem, html: await r.text() }));
  }));
  for (const { hvem, html } of svar) assert.match(html, new RegExp(`<body[^>]* data-person="${hvem}"`));
});

test('a queued run finishes as the person who started it, not as the one who freed the slot', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { createRunRegistry } = await import('../src/runs.ts');
  const hvem = new AsyncLocalStorage<string>();
  const runs = createRunRegistry(createFakeAgent({ answer: () => 'ok', delayMs: 20 }), { maxParallel: 1 });
  const saa: string[] = [];
  const start = (navn: string) => hvem.run(navn, () => runs.start({ kind: 'chat', spec: { input: 'x', instructions: 'y' }, onDone: async () => { saa.push(`${navn}:${hvem.getStore()}`); return {}; } }));
  const a = start('henrik');
  const b = start('maja'); // waits for henrik's slot
  await Promise.all([a.finished, b.finished]);
  assert.deepEqual(saa.sort(), ['henrik:henrik', 'maja:maja']);
});
