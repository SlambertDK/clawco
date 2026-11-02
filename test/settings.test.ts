import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettings, modelRevision } from '../src/settings.ts';

test('settings persist models to indstillinger.json and validate names', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-set-'));
  try {
    const s = createSettings(dir);
    assert.deepEqual(await s.read(), { modeller: {}, stemme: {} });
    await s.setModels({ lille: ' claude-haiku-5.5 ', taenker: 'claude-opus-5.5', junk: 'x' } as Record<string, string>);
    assert.deepEqual((await s.read()).modeller, { lille: 'claude-haiku-5.5', taenker: 'claude-opus-5.5' });
    await s.setModels({ lille: '', taenker: 'bad name with spaces' });
    assert.deepEqual((await s.read()).modeller, {});
    const again = createSettings(dir);
    assert.deepEqual((await again.read()).modeller, {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stemme: voice id and agent ids survive a round trip and setModels keeps them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-set-'));
  try {
    const s = createSettings(dir);
    assert.deepEqual((await s.read()).stemme, {});
    await s.setStemme({ voiceId: 'abc123', agentId: 'ag_1', toolIds: { udfoer: 't1', 'bad key!': 't2' } });
    assert.deepEqual((await s.read()).stemme, { voiceId: 'abc123', agentId: 'ag_1', toolIds: { udfoer: 't1' } });
    await s.setModels({ lille: 'claude-haiku-5.5' });
    const after = await s.read();
    assert.equal(after.modeller.lille, 'claude-haiku-5.5');
    assert.equal(after.stemme.voiceId, 'abc123');
    await s.setStemme({ voiceId: '' });
    assert.equal((await s.read()).stemme.voiceId, undefined);
    assert.equal((await s.read()).stemme.agentId, 'ag_1');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// KC-0127: the last live test per tier, the provider chosen in Start's step 2, and the revision a test belongs to.
test('modelTest: valid entries survive, bad values are dropped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-set-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    const ok = { ok: true, tid: '2026-10-31T09:00:00.000Z', ms: 812, rev: 'abc123' };
    await writeFile(path.join(dir, 'indstillinger.json'), JSON.stringify({
      modeller: { lille: 'a', taenker: 'b' }, udbyder: 'anthropic',
      modelTest: { lille: ok, taenker: { ok: 'ja', tid: 'nu', ms: -1, rev: 7 }, ekstra: ok },
    }));
    const s = await createSettings(dir).read();
    assert.deepEqual(s.modelTest, { lille: ok });
    assert.equal(s.udbyder, 'anthropic');
    await writeFile(path.join(dir, 'indstillinger.json'), JSON.stringify({ udbyder: 'ikke gyldig!', modelTest: { lille: { ...ok, fejl: 'noegle' }, taenker: { ...ok, ms: Number.NaN, fejl: 'x'.repeat(50) } } }));
    const t = await createSettings(dir).read();
    assert.deepEqual(t.modelTest, { lille: { ...ok, fejl: 'noegle' } });
    assert.equal(t.udbyder, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setModels keeps modelTest and udbyder; setModelTest sets and clears per tier', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-set-'));
  try {
    const s = createSettings(dir);
    await s.setModels({ lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' }, { udbyder: 'anthropic' });
    const ok = { ok: true, tid: '2026-10-31T09:00:00.000Z', ms: 500, rev: modelRevision('anthropic', 'claude-haiku-4-5') };
    await s.setModelTest({ lille: ok });
    await s.setModels({ lille: 'claude-haiku-4-5', taenker: 'claude-opus-4-1' }); // the Kø panel
    const r = await s.read();
    assert.equal(r.udbyder, 'anthropic');
    assert.deepEqual(r.modelTest, { lille: ok });
    await s.setModelTest({ lille: null });
    assert.equal((await s.read()).modelTest, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('modelRevision changes with the provider and the model, and is stable', () => {
  assert.equal(modelRevision('anthropic', 'a'), modelRevision('anthropic', 'a'));
  assert.notEqual(modelRevision('anthropic', 'a'), modelRevision('anthropic', 'b'));
  assert.notEqual(modelRevision('anthropic', 'a'), modelRevision('openai', 'a'));
  assert.notEqual(modelRevision(undefined, 'a'), modelRevision('anthropic', 'a'));
});
