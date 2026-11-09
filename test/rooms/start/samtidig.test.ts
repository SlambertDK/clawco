// KC-0281: every write of Start's state is a read-modify-write of one file. Two that overlap (the first Ret heard while a
// rebuild retires a preview, a first read while Spring over is pressed) must both survive: the second reads what the
// first wrote. A store whose reads are slow makes the overlap certain; without one queue per store, one write is lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../../src/store/fileStore.ts';
import { createLiveBus } from '../../../src/live.ts';
import { parseStartState, type StartState } from '../../../src/rooms/start/schema.ts';
import { modtagRet } from '../../../src/rooms/start/ret.ts';
import { koerselFaerdig, modtagFoersteLaesning } from '../../../src/rooms/start/vaerdi.ts';
import type { RoomDeps } from '../../../src/rooms/module.ts';

const STARTET = '2026-10-31T08:00:00.000Z';
const NU = new Date('2026-10-31T09:00:00.000Z');
const KAL = { kildeId: 'falsk-kalender', navn: 'Kalender', slags: 'kalender', titel: 'To aftaler', linje: '', hentet: STARTET };
const FOER: StartState = { startet: STARTET, trin: {}, afvist: {}, kilder: { 'falsk-kalender': { foersteVaerdiMs: 1, tid: STARTET, forhaandsvisning: KAL, rum: 'dagen' } } };

async function medLangsomStore(fn: (d: RoomDeps, laes: () => Promise<StartState | null>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-start-samtidig-'));
  try {
    const store = createFileStore(dir);
    await store.writeState('start', FOER);
    // Every read of Start's state takes a while, so two writers both read before either writes (unless they queue).
    const langsom = { ...store, readState: async (rum: string) => { const v = await store.readState(rum); await new Promise((r) => setTimeout(r, 30)); return v; } };
    const d = { store: langsom, live: createLiveBus(), now: () => NU, person: { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' } } as unknown as RoomDeps;
    await fn(d, async () => parseStartState(await store.readState('start')));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the first Ret and a rebuild retiring the preview at the same time: both are kept', async () => {
  await medLangsomStore(async (d, laes) => {
    await Promise.all([
      modtagRet(d, { art: 'ret', tid: '2026-10-31T08:59:00.000Z', titel: 'To aftaler' }),
      koerselFaerdig(d, { room: 'dagen', kind: 'opdater', status: 'done', startedAt: Date.parse('2026-10-31T08:30:00.000Z') }),
    ]);
    const s = await laes();
    assert.ok(s?.ret, 'the Ret is kept');
    assert.ok(s?.kilder?.['falsk-kalender']?.erstattet, 'the preview is retired');
  });
});

test('a second source\'s first read and the first Ret at the same time: both are kept', async () => {
  await medLangsomStore(async (d, laes) => {
    await Promise.all([
      modtagFoersteLaesning(d, { kilde: { id: 'falsk-mail', navn: 'Mail', slags: 'mail' }, laesning: { slags: 'mail', hentet: NU.toISOString(), data: [] } as never, zone: 'privat', ejer: 'henrik', forbundet: STARTET }),
      modtagRet(d, { art: 'ikke-relevant', tid: '2026-10-31T08:59:00.000Z', titel: 'To aftaler' }),
    ]);
    const s = await laes();
    assert.ok(s?.ret, 'the Ret is kept');
    assert.ok(s?.kilder?.['falsk-mail'], 'the mail\'s first value is kept');
    assert.ok(s?.kilder?.['falsk-kalender'], 'the calendar\'s first value is kept');
  });
});
