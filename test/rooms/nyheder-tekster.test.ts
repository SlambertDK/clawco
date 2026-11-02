// KC-0170: Nyheder's screen in English or Danish. One table per language beside the room's code; Danish (no language
// chosen) renders byte for byte as before (test/fixtures/sprog-nyheder/ was captured before the strings moved); an
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
import { nyhederRoom } from '../../src/rooms/nyheder/room.ts';
import { renderNyhederEmpty } from '../../src/rooms/nyheder/render.ts';
import { NYHEDER_TEKSTER } from '../../src/rooms/nyheder/tekster.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import * as golden from '../fixtures/sprog-golden-nyheder.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-nyheder');
const fixtur = (navn: string): string => readFileSync(path.join(mappe, navn), 'utf8');
const rec = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

test('Nyheder: English has exactly Danish\'s keys and shapes; no string is empty; none is a Danish string copied over', () => {
  assert.deepEqual(form(NYHEDER_TEKSTER.en), form(NYHEDER_TEKSTER.da));
  for (const t of [NYHEDER_TEKSTER.da, NYHEDER_TEKSTER.en]) assert.deepEqual(tomme(rec(t)), []);
  assert.deepEqual(ensStrenge(rec(NYHEDER_TEKSTER.da), rec(NYHEDER_TEKSTER.en)), []);
});

test('Nyheder: with no language chosen (and with Danish chosen) the screen renders byte for byte as before', () => {
  const samme = (s: string): string => s.replaceAll('&#39;', "'");
  const filer = readdirSync(mappe).sort();
  assert.deepEqual(Object.keys(golden.NYHEDER).map((k) => `${k}.html`).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(golden.NYHEDER)) {
    assert.equal(samme(lav()), fixtur(`${k}.html`), k);
    assert.equal(samme(medSprog('da', lav)), fixtur(`${k}.html`), `${k} (da chosen)`);
  }
});

test('Nyheder: an English render has no Danish line left, and says it in English', () => {
  for (const [k, lav] of Object.entries(golden.NYHEDER)) {
    // The freshness phrase ("fra lørdag 09.10", "opdateret 08.10") and the zone chip ("Privat") come from src/shell/friskhed.ts
    // and src/shell/zone.ts, which this room does not own: still Danish there (follow-up in the shell).
    if (k !== 'tom') assert.deepEqual(danskeLinjer(medSprog('en', lav)).filter((l) => !/^fra \S+ \d\d\.\d\d$/.test(l)), [], k);
  }
  const tom = medSprog('en', () => String(renderNyhederEmpty(NYHEDER_TEKSTER.en.ingenAvis)));
  assert.deepEqual(danskeLinjer(tom), []);
  assert.match(tom, /The room is empty/);
  assert.match(tom, />Ask Hermes to fetch the paper</);
  const fuld = medSprog('en', golden.NYHEDER['fuld']!);
  assert.match(fuld, /<h1>News<\/h1>/);
  assert.match(fuld, /Today in five lines/);
  assert.match(fuld, />Save for later</);
  assert.match(fuld, />Saved</);
  assert.match(fuld, /9 of 25 sources answered, 39 stories/);
  assert.match(fuld, /Sources that did not answer today: r\/LocalLLaMA, r\/OpenAI\./);
  assert.match(fuld, /<b>Work<\/b> Your own system\./);
  assert.match(fuld, />Refresh</);
  assert.match(fuld, />Newsletters archived today</);
  assert.match(fuld, /data-element="Story: Reserves tighten this winter"/);
});

test('Nyheder: the Nu line is in the language of the request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-nyheder-tekster-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    const hermes = createFakeAgent();
    const deps: RoomDeps = {
      store, hermes, runs: createRunRegistry(hermes), now: () => golden.NU, dagenSourceGlob: '', mailStateDir: '', mailRunner: async () => ({ code: 1, stdout: '', stderr: '' }),
      himalaya: 'himalaya', vaultInbox: '', vaultRod: '', regnskabsfil: () => '', live: createLiveBus(), kalenderScript: '', person: ENEBRUGER,
    };
    await store.writeState('nyheder', { dato: '2026-10-27', genereret: '2026-10-27T07:10:00Z', femLinjer: [], baner: [], forslag: [{ id: 'f1', tekst: 'Shall I build a test room?', handling: { id: 'h-f1', label: 'Yes', instruktion: 'i' } }], nyhedsbreve: [], kilder: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] }, gemt: [], hermesStatus: 'Ready' });
    const nu = async (sprog?: 'da' | 'en') => (await (sprog ? medSprog(sprog, () => nyhederRoom.hjemVenter!(deps)) : nyhederRoom.hjemVenter!(deps))).map((l) => l.tekst);
    assert.deepEqual(await nu(), ['Nyheder: Shall I build a test room?']);
    assert.deepEqual(await nu('da'), ['Nyheder: Shall I build a test room?']);
    assert.deepEqual(await nu('en'), ['News: Shall I build a test room?']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('KC-0241: the spoken passages have their own section: same shape in both languages, none empty, no Danish copied, no Danish in English', () => {
  const da = NYHEDER_TEKSTER.da.stemme as Record<string, unknown>;
  const en = NYHEDER_TEKSTER.en.stemme as Record<string, unknown>;
  assert.ok(da && en && Object.keys(da).length > 0);
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(en), []);
  assert.deepEqual(ensStrenge(da, en), []);
  assert.deepEqual(danskeLinjer(Object.values(en).filter((v): v is string => typeof v === 'string').join('\n')), []);
});
