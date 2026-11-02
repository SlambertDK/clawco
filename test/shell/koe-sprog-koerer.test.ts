// KC-0170 slice 3, part A: what a run says it is doing in the Kø panel (the tool names, the correction line, the label by
// kind) follows the language: the profile's for a run in flight, the request's for the label. Danish is as before.
// The prompt lines to Hermes stay Danish (src/runs.ts); only words shown on screen move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRunRegistry } from '../../src/runs.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { SvarFejl } from '../../src/svarfejl.ts';
import { TEKSTER } from '../../src/shell/tekster.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';

type Profil = { navn: string; sprog: 'da' | 'en'; husstand: 'alene' | 'husstand' };
const statusser = async (profil: Profil | null, medRetning = false): Promise<string[]> => {
  let n = 0;
  const hermes = createFakeAgent({ answer: () => (++n === 1 ? 'x' : 'y'), delayMs: 5 });
  const runs = createRunRegistry(hermes, { profil: () => profil });
  const seen: string[] = [];
  const run = runs.start({ kind: 'opdater', spec: { input: 'x', instructions: 'y' }, onDone: async (o) => { if (medRetning && o === 'x') throw new SvarFejl('forkert'); return {}; } });
  runs.subscribe(run.id, (e) => { if (e.type === 'status') seen.push(e.text); });
  await run.finished;
  return seen;
};

test('a run in flight says its tool in the language of the profile; Danish with no profile', async () => {
  assert.deepEqual(await statusser(null), ['kører en kommando: fake', 'tænker']);
  assert.deepEqual(await statusser({ navn: 'Alma', sprog: 'da', husstand: 'alene' }), ['kører en kommando: fake', 'tænker']);
  const en = await statusser({ navn: 'Alma', sprog: 'en', husstand: 'alene' });
  assert.deepEqual(en, ['running a command: fake', 'thinking']);
  for (const l of en) assert.deepEqual(danskeLinjer(l), []);
});

test('the correction line follows the language too', async () => {
  assert.ok((await statusser(null, true)).includes('retter sit svar'));
  assert.ok((await statusser({ navn: 'Alma', sprog: 'en', husstand: 'alene' }, true)).includes('correcting its answer'));
});

test('every tool name and every kind label has an English word', () => {
  assert.deepEqual(Object.keys(TEKSTER.en.vaerktoej).sort(), Object.keys(TEKSTER.da.vaerktoej).sort());
  assert.deepEqual(Object.keys(TEKSTER.en.koerLabels).sort(), Object.keys(TEKSTER.da.koerLabels).sort());
  for (const t of [TEKSTER.da.vaerktoej, TEKSTER.da.koerLabels, TEKSTER.en.vaerktoej, TEKSTER.en.koerLabels]) assert.ok(Object.values(t).every((v) => v.trim()));
});

const EJER: Person = { id: FAMILIE.medlem.id, login: null, navn: FAMILIE.medlem.navn, rolle: 'ejer' };
test('a run with no room label gets its kind in the request\'s language: Danish, then English once chosen in Start', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-koe-sprog-'));
  try {
    const hermes = createFakeAgent({ answer: () => 'Hej.' });
    const sut = createApp({
      store: createFileStore(dir), hermes, sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => new Date('2026-10-31T10:00:00Z'),
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: EJER }, kilder: [],
    });
    const etiket = async (): Promise<string | undefined> => {
      const run = sut.runs.start({ kind: 'kurator', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({}) });
      await run.finished;
      const koe = (await (await sut.app.request('/api/koe')).json()) as { runs: { id: string; label: string }[] };
      return koe.runs.find((x) => x.id === run.id)?.label;
    };
    assert.equal(await etiket(), 'ordner kortene');
    const res = await sut.app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ navn: FAMILIE.medlem.navn, sprog: 'en', husstand: 'alene' }) });
    assert.equal(res.status, 202);
    await sut.runs.get(((await res.json()) as { runId: string }).runId)!.finished;
    assert.equal(await etiket(), 'sorting the cards');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
