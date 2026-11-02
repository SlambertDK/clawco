// KC-0170: Skrive's screen in English or Danish. One table per language beside the room's code; Danish (no language
// chosen) renders byte for byte as before (test/fixtures/sprog-skrive/ was captured before the strings moved); an
// English render has no Danish word left in what the user reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import { skriveRoom } from '../../src/rooms/skrive/room.ts';
import { SKRIVE_TEKSTER } from '../../src/rooms/skrive/tekster.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import * as golden from '../fixtures/sprog-golden-skrive.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-skrive');
const fixtur = (navn: string): string => readFileSync(path.join(mappe, navn), 'utf8');
const rec = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

test('Skrive: English has exactly Danish\'s keys and shapes; no string is empty; none is a Danish string copied over', () => {
  assert.deepEqual(form(SKRIVE_TEKSTER.en), form(SKRIVE_TEKSTER.da));
  for (const t of [SKRIVE_TEKSTER.da, SKRIVE_TEKSTER.en]) assert.deepEqual(tomme(rec(t)), []);
  assert.deepEqual(ensStrenge(rec(SKRIVE_TEKSTER.da), rec(SKRIVE_TEKSTER.en)), []);
});

test('Skrive: with no language chosen (and with Danish chosen) the screen renders byte for byte as before', () => {
  const samme = (s: string): string => s.replaceAll('&#39;', "'");
  const filer = readdirSync(mappe).sort();
  assert.deepEqual(Object.keys(golden.SKRIVE).map((k) => `${k}.html`).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(golden.SKRIVE)) {
    assert.equal(samme(lav()), fixtur(`${k}.html`), k);
    assert.equal(samme(medSprog('da', lav)), fixtur(`${k}.html`), `${k} (da chosen)`);
  }
});

test('Skrive: an English render has no Danish line left, and says it in English', () => {
  for (const [k, lav] of Object.entries(golden.SKRIVE)) assert.deepEqual(danskeLinjer(medSprog('en', lav)), [], k);
  const fuld = medSprog('en', golden.SKRIVE['fuld']!);
  assert.match(fuld, /<h1>Write<\/h1>/);
  assert.match(fuld, />Save to Obsidian</);
  assert.match(fuld, />Use</);
  assert.match(fuld, />Dismiss</);
  assert.match(fuld, />Tighten</);
  assert.match(fuld, />Undo</);
  assert.match(fuld, /Paragraph 2/);
  assert.match(fuld, /New paragraph after paragraph 1/);
  assert.match(fuld, /Hermes proposes · Paragraph 2/);
  assert.match(fuld, /changed 11\.05|changed 11:05/);
  assert.match(medSprog('en', golden.SKRIVE['gemt']!), />Save to Obsidian again</);
  assert.match(medSprog('en', golden.SKRIVE['tom']!), /No drafts yet/);
});

test('Skrive: the Nu line is in the language of the request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-skrive-tekster-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    const hermes = createFakeAgent();
    const deps: RoomDeps = {
      store, hermes, runs: createRunRegistry(hermes), now: () => golden.NU, dagenSourceGlob: '', mailStateDir: '', mailRunner: async () => ({ code: 1, stdout: '', stderr: '' }),
      himalaya: 'himalaya', vaultInbox: '', vaultRod: '', regnskabsfil: () => '', live: createLiveBus(), kalenderScript: '', person: ENEBRUGER,
    };
    await store.writeState('skrive', { dokumenter: [{ id: 'dok-1', titel: 'Note to ops', brief: 'b', afsnit: [{ id: 'a1', tekst: 'T' }], kilder: [], oprettet: '2026-10-27T10:00:00Z', aendret: '2026-10-27T10:00:00Z' }], aktivt: 'dok-1', forslag: [{ id: 'f-1', dokId: 'dok-1', afsnitId: 'a1', ny: 'N', hvorfor: '', tid: '2026-10-27T10:04:00Z' }, { id: 'f-2', dokId: 'dok-9', afsnitId: 'a1', ny: 'N', hvorfor: '', tid: '2026-10-27T10:04:00Z' }], hermesStatus: 'Ready' });
    const nu = async (sprog?: 'da' | 'en') => (await (sprog ? medSprog(sprog, () => skriveRoom.hjemVenter!(deps)) : skriveRoom.hjemVenter!(deps))).map((l) => l.tekst);
    assert.deepEqual(await nu(), ['Forslag til "Note to ops"', 'Forslag til "udkast"']);
    assert.deepEqual(await nu('da'), ['Forslag til "Note to ops"', 'Forslag til "udkast"']);
    assert.deepEqual(await nu('en'), ['Proposal for "Note to ops"', 'Proposal for "draft"']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
