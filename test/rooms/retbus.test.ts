// KC-0130: the Ret bus — listeners are awaited in order, a failing listener never fails the caller,
// and Luk (Ikke relevant) announces itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavRetBus, type RetHaendelse } from '../../src/rooms/rethaendelse.ts';
import { luk } from '../../src/kurator/kortHandlinger.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createLiveBus } from '../../src/live.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createRunRegistry } from '../../src/runs.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';

const h: RetHaendelse = { art: 'ret', tid: '2026-10-31T09:00:00.000Z', titel: 'Elregningen' };
const d = {} as RoomDeps;

test('listeners hear it in order and the caller waits for each', async () => {
  const bus = lavRetBus();
  const set: string[] = [];
  bus.lyt(async () => { await new Promise((r) => setTimeout(r, 10)); set.push('a'); });
  bus.lyt(async (_d, x) => { set.push(`b:${x.titel}`); });
  await bus.meld(d, h);
  assert.deepEqual(set, ['a', 'b:Elregningen']);
});

test('a failing listener neither stops the next nor rejects meld', async () => {
  const bus = lavRetBus();
  const set: string[] = [];
  const fejl = console.error;
  console.error = () => {};
  try {
    bus.lyt(async () => { throw new Error('bum'); });
    bus.lyt(async () => { set.push('naeste'); });
    await bus.meld(d, h);
  } finally { console.error = fejl; }
  assert.deepEqual(set, ['naeste']);
});

test('unsubscribe stops a listener', async () => {
  const bus = lavRetBus();
  let n = 0;
  const af = bus.lyt(async () => { n++; });
  await bus.meld(d, h);
  af();
  await bus.meld(d, h);
  assert.equal(n, 1);
});

async function medKort(retBus: boolean, fn: (d: RoomDeps, hoert: RetHaendelse[]) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-retbus-'));
  try {
    const store = createFileStore(path.join(rod, 'data'));
    await store.writeState('hjem', { kort: [{ id: 'k1', type: 'regning', titel: 'Elregningen', betyder: 'Den er steget.', grundlag: [], kilder: [], anbefaling: 'Tjek', prioritet: 1 }], intet: [], afvist: [], sete: [] });
    const hermes = createFakeAgent({ answer: () => 'Noteret.' });
    const bus = lavRetBus();
    const hoert: RetHaendelse[] = [];
    bus.lyt(async (_d, x) => { hoert.push(x); });
    const dd = { store, hermes, runs: createRunRegistry(hermes), live: createLiveBus(), now: () => new Date('2026-10-31T09:00:00Z'), ...(retBus ? { retBus: bus } : {}) } as unknown as RoomDeps;
    await fn(dd, hoert);
  } finally { await rm(rod, { recursive: true, force: true }); }
}

test('Luk announces an Ikke relevant with the card title and the reason', async () => {
  await medKort(true, async (dd, hoert) => {
    const u = await luk(dd, 'k1', 'ikke relevant for mig');
    assert.equal(u.ok, true);
    assert.deepEqual(hoert, [{ art: 'ikke-relevant', tid: '2026-10-31T09:00:00.000Z', titel: 'Elregningen', kortId: 'k1', tekst: 'ikke relevant for mig' }]);
  });
});

test('Luk of an unknown card announces nothing; Luk without a bus still works', async () => {
  await medKort(true, async (dd, hoert) => {
    assert.equal((await luk(dd, 'findes-ikke', '')).ok, false);
    assert.deepEqual(hoert, []);
  });
  await medKort(false, async (dd) => { assert.equal((await luk(dd, 'k1', '')).ok, true); });
});
