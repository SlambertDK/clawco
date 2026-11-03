// KC-0275 (E4): one torn line in a room's chat.jsonl or log.jsonl (a crash mid-append) never makes a page answer 500.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

test('a torn line in chat.jsonl and log.jsonl: /rum/hjem, /rum/dagen and /rum/mail still answer 200', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-defekt-'));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const store = createFileStore(dir);
    await rejsenFaerdig(store);
    for (const rum of ['hjem', 'dagen', 'mail']) {
      await mkdir(path.join(dir, 'rum', rum), { recursive: true });
      await writeFile(path.join(dir, 'rum', rum, 'chat.jsonl'), '{"id":"1","rolle":"bruger","tekst":"hej","tid":"2026-10-26T06:00:00Z"}\n{"id":"2","rol\n');
      await writeFile(path.join(dir, 'rum', rum, 'log.jsonl'), '{"id":"x","tid":"2026-10-26T06:00:00Z"}\n{"id\n');
    }
    const { app } = createApp({ store, hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', now: () => new Date('2026-10-26T06:30:00Z'), sha: 'abc' });
    for (const rum of ['hjem', 'dagen', 'mail']) assert.equal((await app.request(`/rum/${rum}`)).status, 200, rum);
  } finally { console.warn = warn; await rm(dir, { recursive: true, force: true }); }
});

test('KC-0275 (B7): past 20 waiting runs the next chat answers 429 with a fixed text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-loft-'));
  try {
    const store = createFileStore(dir);
    await rejsenFaerdig(store);
    const sut = createApp({ store, hermes: createFakeAgent({ answer: () => 'svar', delayMs: 200 }), sourceGlob: '/nonexistent/{date}.json', now: () => new Date('2026-10-26T06:30:00Z'), sha: 'abc', maxParallel: 1 });
    const status: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await sut.app.request('/api/rum/dagen/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: `hej ${i}` }) });
      status.push(res.status);
      if (res.status === 429) assert.match(((await res.json()) as { error: string }).error, /venter/);
    }
    assert.ok(status.includes(429), status.join(','));
    assert.equal(status.indexOf(429) > 0, true);
    await sut.runs.stopAlle('x');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
