import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';

test('GET/POST /api/indstillinger read and change the models, and runs use them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-ind-'));
  try {
    const hermes = createFakeAgent({ answer: () => 'Svar.' });
    const sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent' });
    let res = await sut.app.request('/api/indstillinger');
    assert.deepEqual(await res.json(), { modeller: {}, stemme: {}, niveauer: { lille: ['chat', 'handling', 'fortryd', 'kladde', 'baggrund', 'afmeld', 'laer'], taenker: ['opdater', 'frontload', 'forslag', 'nyt', 'analyse', 'kurator', 'univers', 'forbered'] } });
    res = await sut.app.request('/api/indstillinger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modeller: { lille: 'claude-haiku-5.5', taenker: 'claude-opus-5.5' } }) });
    assert.equal(res.status, 200);
    const chat = await sut.app.request('/api/rum/dagen/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: 'hej' }) });
    const { runId } = (await chat.json()) as { runId: string };
    await sut.runs.get(runId)!.finished;
    assert.equal(hermes.calls.at(-1)?.model, 'claude-haiku-5.5');
    const page = await (await sut.app.request('/rum/hjem')).text();
    assert.match(page, /id="indstillinger"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
