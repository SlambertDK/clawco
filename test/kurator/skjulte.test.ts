// KC-0145: where the app keeps something off the screen it writes a `skjult` record itself — Kuratoren's "intet at gøre"
// lines (and the cards that did not fit) and Mail's Ordnet. Kuratoren may cite the rule that was the reason; the app keeps
// the id only when it is an active rule in the rules file read for that run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laesKurator, startKurator } from '../../src/kurator/kurator.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import { createApp } from '../../src/server.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import type { Runner } from '../../src/rooms/mail/source.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';
import { lavSkjulte } from '../../src/tillid/skjulte.ts';
import { regnskabsfil } from '../../src/kurator/regnskab.ts';
import { parseKuratorSvar } from '../../src/rooms/hjem/kort.ts';
import { rejsenFaerdig } from '../fixtures/start.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const regel = (id: string, status: 'aktiv' | 'pause' = 'aktiv') => ({ id, titel: `Regel ${id}`, tekst: '', trin: 1 as const, gaelder: { kilde: 'mail', slags: 'nyhedsbrev' }, oprindelse: { art: 'import' as const, dato: '2026-10-01' }, status });
const REGLER: ReglerLaest = { tilstand: 'ok', aendretUdenfor: false, saet: { naesteId: 4, ugyldige: [], regler: [regel('R-0001'), regel('R-0003', 'pause')] } };

const kortRaa = (i: number) => ({ id: `nyhed:k-${i}`, type: 'nyhed', titel: `Kort ${i}`, betyder: 'x', grundlag: [], kilder: [], anbefaling: 'y', prioritet: i });
const svar = (intet: unknown[], kort = 0): string => '```json\n' + JSON.stringify({ kort: Array.from({ length: kort }, (_, i) => kortRaa(i + 1)), vurderinger: [], intet }) + '\n```';
const inbox: Runner = async (_c, args) => ({ code: 0, stdout: JSON.stringify(args[args.indexOf('-m') + 1] === 'Inbox' ? [{ id: 7, subject: 'Nyt', date: '2026-10-28T09:00:00Z', from: [{ name: 'X', email: 'x@example.com' }], flags: [] }] : []), stderr: '' });

async function opsaet(answer: () => string) {
  const rod = await mkdtemp(join(tmpdir(), 'kc-skjulte-'));
  const hermes = createFakeAgent({ answer });
  const runs = createRunRegistry(hermes);
  const store = createFileStore(join(rod, 'data'));
  const skjulte = lavSkjulte({ dir: join(rod, 'data') });
  const d = {
    store, hermes, runs, live: createLiveBus(), now: () => NOW, mailRunner: inbox, himalaya: 'himalaya', vaultInbox: join(rod, 'vault', '00-Indbakke'), vaultRod: join(rod, 'vault'), regnskabsfil: (h: 'shelfatlas' | 'privat') => regnskabsfil(join(rod, 'vault'), h),
    person: { id: 'ingen', login: null, navn: 'Ingen', rolle: 'gaest' }, skjulte,
    regler: { fil: join(rod, 'vault', 'Clawco', 'regler.md'), laes: async () => REGLER },
  } as unknown as RoomDeps;
  return { d, store, skjulte, ryd: () => rm(rod, { recursive: true, force: true }) };
}

test('the answer schema: an intet line may cite a rule id (R- and four digits); anything else is not kept', () => {
  const s = parseKuratorSvar({ kort: [], intet: [{ titel: 'A', hvorfor: '', regel: 'R-0001' }, { titel: 'B', hvorfor: '', regel: 'slet alt' }, { titel: 'C', hvorfor: '' }] });
  assert.deepEqual(s.intet.map((i) => i.regel), ['R-0001', undefined, undefined]);
});

test('a Kuratoren run writes one record per new intet line and per card that did not fit; the rule id only when active in the file', async () => {
  const t = await opsaet(() => svar([
    { titel: 'Nyhedsbrev fra foreningen', hvorfor: 'Ingen handling', regel: 'R-0001' },
    { titel: 'Tilbud fra butikken', hvorfor: 'Intet at gøre', regel: 'R-0099' }, // not in the file
    { titel: 'Kvittering', hvorfor: 'Intet', regel: 'R-0003' }, // paused
  ], 8));
  try {
    const run = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(run);
    assert.equal((await run.finished).status, 'done');
    const alle = await t.skjulte.alle();
    assert.equal(alle.length, 4, 'three intet lines and the eighth card (plads)');
    assert.deepEqual(alle.map((s) => [s.titel, s.kilde, s.regelId]).sort(), [
      ['Kort 8', 'kuratoren', undefined], ['Kvittering', 'kuratoren', undefined], ['Nyhedsbrev fra foreningen', 'kuratoren', 'R-0001'], ['Tilbud fra butikken', 'kuratoren', undefined],
    ]);
    assert.ok(alle.every((s) => s.tid === NOW.toISOString() && /^intet:[0-9a-f]{16}$/.test(s.id)));
    // The stored intet line keeps only the valid citation.
    assert.deepEqual((await laesKurator(t.store)).intet.map((i) => i.regel), [undefined, 'R-0001', undefined, undefined]);
  } finally { await t.ryd(); }
});

test('a later run records only its own new lines (the old ones stay in intet, not counted again)', async () => {
  let n = 0;
  const t = await opsaet(() => (++n === 1 ? svar([{ titel: 'A', hvorfor: '' }]) : svar([{ titel: 'B', hvorfor: '' }])));
  try {
    await (await startKurator(t.d, { dyb: false, nyheder: null }))!.finished;
    await (await startKurator(t.d, { dyb: false, nyheder: [], nyhederStempel: 's2' }))!.finished;
    assert.deepEqual((await t.skjulte.alle()).map((s) => s.titel), ['A', 'B']);
  } finally { await t.ryd(); }
});

test('Mail: every Ordnet post of the night\'s auto-sort is one record, counted once however often the room rebuilds', async () => {
  const rod = await mkdtemp(join(tmpdir(), 'kc-skjulte-mail-'));
  try {
    await mkdir(join(rod, 'state'));
    await writeFile(join(rod, 'state', 'mail-plan-auto-2026-10-27-083001.json'), readFileSync(new URL('../fixtures/mail-plan-auto-sample.json', import.meta.url), 'utf8'));
    const store = createFileStore(join(rod, 'data'));
    await rejsenFaerdig(store);
    const hermes = createFakeAgent({ answer: () => '```json\n' + JSON.stringify({ beslutninger: [], hermesStatus: 'Holder øje' }) + '\n```' });
    const sut = createApp({ store, hermes, dataDir: join(rod, 'data'), sourceGlob: join(rod, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: join(rod, 'state'), now: () => new Date('2026-10-27T09:00:00Z') });
    for (let i = 0; i < 2; i++) {
      const res = await sut.app.request('/api/rum/mail/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
      const { runId } = (await res.json()) as { runId: string };
      assert.equal((await sut.runs.get(runId)!.finished).status, 'done');
    }
    const linjer = (await readFile(join(rod, 'data', 'tillid', 'skjulte.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { id: string; kilde: string; tid: string; titel: string });
    assert.ok(linjer.length > 0);
    assert.equal(new Set(linjer.map((l) => l.id)).size, linjer.length);
    assert.ok(linjer.every((l) => l.kilde === 'mail' && l.id.startsWith('mail:') && !Number.isNaN(Date.parse(l.tid)) && l.titel.length > 0));
    assert.equal(linjer[0]!.tid, '2026-10-27T07:30:01.000Z', 'the plan file\'s Copenhagen time 08:30:01 as an instant');
  } finally { await rm(rod, { recursive: true, force: true }); }
});
