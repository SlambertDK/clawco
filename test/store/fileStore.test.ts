import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import type { RumLager } from '../../src/store/types.ts';

async function medTempLager(fn: (lager: RumLager, rod: string) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(join(tmpdir(), 'kc-store-'));
  try {
    await fn(createFileStore(rod), rod);
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
}

test('readState giver null når rummet ikke har state', async () => {
  await medTempLager(async (lager) => {
    assert.equal(await lager.readState('lager'), null);
  });
});

test('writeState og readState giver samme objekt tilbage', async () => {
  await medTempLager(async (lager) => {
    const state = { titel: 'Lager', tal: [1, 2, 3] };
    await lager.writeState('lager', state);
    assert.deepEqual(await lager.readState('lager'), state);
  });
});

test('writeState efterlader ingen .tmp-fil og skriver pæn JSON', async () => {
  await medTempLager(async (lager, rod) => {
    await lager.writeState('lager', { a: 1 });
    await lager.writeState('lager', { a: 2 });
    const filer = await readdir(join(rod, 'rum', 'lager'));
    assert.deepEqual(filer, ['state.json']);
    assert.equal(await readFile(join(rod, 'rum', 'lager', 'state.json'), 'utf8'), '{\n  "a": 2\n}');
  });
});

test('et ugyldigt rum-id kaster og rører ikke filsystemet', async () => {
  await medTempLager(async (lager, rod) => {
    for (const id of ['', '../ud', 'Stor', 'a/b', 'a'.repeat(41), 'under_score']) {
      await assert.rejects(lager.readState(id), { message: 'ugyldigt rum-id' });
      await assert.rejects(lager.writeState(id, {}), { message: 'ugyldigt rum-id' });
      await assert.rejects(lager.appendLog(id, { kilde: 'system', tekst: 'x' }), { message: 'ugyldigt rum-id' });
    }
    assert.deepEqual(await readdir(rod), []);
  });
});

test('appendLog udfylder id og tid; readLog giver nyeste først med limit', async () => {
  await medTempLager(async (lager) => {
    assert.deepEqual(await lager.readLog('lager'), []);
    const a = await lager.appendLog('lager', { kilde: 'hermes', tekst: 'første' });
    assert.match(a.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(a.tid)));
    await lager.appendLog('lager', { kilde: 'henrik', tekst: 'anden' });
    await lager.appendLog('lager', { id: 'fast', tid: '2026-01-01T00:00:00.000Z', kilde: 'system', tekst: 'tredje' });
    const alle = await lager.readLog('lager');
    assert.deepEqual(alle.map((e) => e.tekst), ['tredje', 'anden', 'første']);
    assert.equal(alle[0]?.id, 'fast');
    assert.equal(alle[0]?.tid, '2026-01-01T00:00:00.000Z');
    assert.deepEqual((await lager.readLog('lager', 2)).map((e) => e.tekst), ['tredje', 'anden']);
  });
});

test('appendChat udfylder id og tid; readChat giver ældste først, de sidste N', async () => {
  await medTempLager(async (lager) => {
    assert.deepEqual(await lager.readChat('lager'), []);
    const a = await lager.appendChat('lager', { fra: 'henrik', tekst: 'ét', kontekst: 'Om: kasse' });
    assert.match(a.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(a.tid)));
    assert.equal(a.kontekst, 'Om: kasse');
    await lager.appendChat('lager', { fra: 'hermes', tekst: 'to' });
    await lager.appendChat('lager', { fra: 'henrik', tekst: 'tre' });
    assert.deepEqual((await lager.readChat('lager')).map((e) => e.tekst), ['ét', 'to', 'tre']);
    assert.deepEqual((await lager.readChat('lager', 2)).map((e) => e.tekst), ['to', 'tre']);
  });
});

test('updateLog retter en post, gemmer den, ignorerer id i patch og lader ingen tmp-fil blive', async () => {
  await medTempLager(async (lager, rod) => {
    const a = await lager.appendLog('lager', { kilde: 'hermes', tekst: 'flyttet', fortryd: 'flyt tilbage' });
    const b = await lager.appendLog('lager', { kilde: 'system', tekst: 'urørt' });
    const patch = { fortrudt: '2026-02-02T00:00:00.000Z', id: 'forsøg-på-nyt-id' } as unknown as Parameters<RumLager['updateLog']>[2];
    const opdateret = await lager.updateLog('lager', a.id, patch);
    assert.equal(opdateret?.id, a.id);
    assert.equal(opdateret?.fortrudt, '2026-02-02T00:00:00.000Z');
    assert.equal(opdateret?.tekst, 'flyttet');
    const log = await lager.readLog('lager');
    assert.deepEqual(log, [b, { ...a, fortrudt: '2026-02-02T00:00:00.000Z' }]);
    assert.deepEqual((await readdir(join(rod, 'rum', 'lager'))).sort(), ['log.jsonl']);
  });
});

test('updateLog giver null for ukendt id (også uden logfil) og ændrer intet', async () => {
  await medTempLager(async (lager) => {
    assert.equal(await lager.updateLog('lager', 'findes-ikke', { tekst: 'x' }), null);
    const a = await lager.appendLog('lager', { kilde: 'hermes', tekst: 'a' });
    assert.equal(await lager.updateLog('lager', 'findes-ikke', { tekst: 'x' }), null);
    assert.deepEqual(await lager.readLog('lager'), [a]);
  });
});

test('en korrupt state.json kaster i stedet for at give null', async () => {
  await medTempLager(async (lager, rod) => {
    await mkdir(join(rod, 'rum', 'lager'), { recursive: true });
    await writeFile(join(rod, 'rum', 'lager', 'state.json'), '{ ikke json', 'utf8');
    await assert.rejects(lager.readState('lager'), SyntaxError);
  });
});

test('now-sømmen: log og chat får tid fra opts.now, og en eksplicit tid vinder', async () => {
  const rod = await mkdtemp(join(tmpdir(), 'kc-store-now-'));
  try {
    const lager = createFileStore(rod, { now: () => new Date('2026-01-02T08:00:00.000Z') });
    assert.equal((await lager.appendLog('lager', { kilde: 'hermes', tekst: 'a' })).tid, '2026-01-02T08:00:00.000Z');
    assert.equal((await lager.appendChat('lager', { fra: 'henrik', tekst: 'b' })).tid, '2026-01-02T08:00:00.000Z');
    assert.equal((await lager.appendLog('lager', { kilde: 'hermes', tekst: 'c', tid: '2026-01-01T00:00:00.000Z' })).tid, '2026-01-01T00:00:00.000Z');
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
});

test('uden opts.now er tid stadig det rigtige nu', async () => {
  await medTempLager(async (lager) => {
    const foer = Date.now();
    const e = await lager.appendLog('lager', { kilde: 'hermes', tekst: 'x' });
    assert.ok(Date.parse(e.tid) >= foer && Date.parse(e.tid) - foer < 5000);
  });
});
