import { test } from 'node:test';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import { opretUnivers, endreUnivers } from '../../src/rooms/univers/lager.ts';
import { universOversigt, universRoom, beskrivAendring } from '../../src/rooms/univers/room.ts';
import { startMoedeTik } from '../../src/rooms/univers/moedetik.ts';

async function opsaet(now: Date) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-univers-room-'));
  const store = createFileStore(path.join(dir, 'data'));
  const hermes = createFakeAgent();
  const deps: RoomDeps = {
    store, hermes, runs: createRunRegistry(hermes), now: () => now, dagenSourceGlob: '', mailStateDir: '', mailRunner: async () => ({ code: 1, stdout: '', stderr: '' }),
    himalaya: 'himalaya', vaultInbox: '', live: createLiveBus(), kalenderScript: '', person: ENEBRUGER,
  };
  return { deps, store, ryd: () => rm(dir, { recursive: true, force: true }) };
}

test('hjemVenter of a univers names the next prepared meeting today, not past, unprepared or other days', async () => {
  const t = await opsaet(new Date('2026-10-27T08:00:00Z'));
  try {
    await opretUnivers(t.store, { navn: 'Min arena', om: '' }, new Date('2026-10-27T07:00:00Z'));
    const forb = { maal: 'x', deltagere: [], talepunkter: ['a'], tid: '2026-10-27T07:00:00Z' };
    const m = (id: string, titel: string, start: string, slut: string, med: boolean) => ({ id, kilde: 'manuel' as const, titel, start, slut, deltagere: [], ...(med ? { forberedelse: forb } : {}) });
    await endreUnivers(t.store, 'univers-min-arena', (s) => ({ ...s, moeder: [
      m('moede-1', 'Forbi', '2026-10-27T06:00:00Z', '2026-10-27T07:00:00Z', true),
      m('moede-2', 'Uforberedt', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z', false),
      m('moede-3', 'I morgen', '2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z', true),
      m('moede-4', 'Senere', '2026-10-27T13:00:00Z', '2026-10-27T14:00:00Z', true),
      m('moede-5', 'Næste', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z', true),
    ] }));
    const linjer = await universRoom('min-arena').hjemVenter(t.deps);
    assert.equal(linjer.length, 1);
    assert.equal(linjer[0]?.roomId, 'univers-min-arena');
    assert.match(linjer[0]?.tekst ?? '', /"Næste" kl\. 11\.00 er forberedt/);
    assert.deepEqual(await universRoom('findes-ikke').hjemVenter(t.deps), []);
    assert.deepEqual(await universOversigt.hjemVenter(t.deps), []);
    assert.equal(await universRoom('findes-ikke').venter(t.deps), 0);
  } finally { await t.ryd(); }
});

test('venter counts open tasks (not the finished ones)', async () => {
  const t = await opsaet(new Date('2026-10-27T08:00:00Z'));
  try {
    await opretUnivers(t.store, { navn: 'Min arena', om: '' }, new Date());
    await endreUnivers(t.store, 'univers-min-arena', (s) => ({ ...s, opgaver: [{ id: 'opg-1', titel: 'a', status: 'aaben' }, { id: 'opg-2', titel: 'b', status: 'igang' }, { id: 'opg-3', titel: 'c', status: 'faerdig' }] }));
    assert.equal(await universRoom('min-arena').venter(t.deps), 2);
  } finally { await t.ryd(); }
});

test('beskrivAendring words new and updated elements in Danish', () => {
  const b = (type: 'dokument' | 'note' | 'opgave', titel: string, ny: boolean) => ({ type, id: 'x', titel, ny });
  assert.equal(beskrivAendring([b('note', 'Idé', true), b('opgave', 'Ring', true)]), 'Hermes lavede 1 note og 1 opgave: "Idé", "Ring".');
  assert.equal(beskrivAendring([b('dokument', 'Pitch', false)]), 'Hermes opdaterede 1 dokument: "Pitch".');
  assert.match(beskrivAendring([b('note', 'a', true), b('note', 'b', true), b('opgave', 'c', false), b('note', 'd', true)]), /lavede 3 noter og opdaterede 1 opgave: "a", "b", "c" og 1 til\./);
});

test('startMoedeTik without a script returns a no-op stop function', async () => {
  const t = await opsaet(new Date());
  try {
    const stop = startMoedeTik(t.deps);
    stop();
  } finally { await t.ryd(); }
});
