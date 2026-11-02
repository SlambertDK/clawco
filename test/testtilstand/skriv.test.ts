import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import { testMailRunner, skrivFroe } from '../../src/testtilstand/skriv.ts';
import type { Froe } from '../../src/testtilstand/typer.ts';
import { idagKbh } from '../../src/testtilstand/ur.ts';
import { readMailSource } from '../../src/rooms/mail/source.ts';

const DAG = '2026-10-29';
const froe = (over: Partial<Froe> = {}): Froe => ({
  rum: {
    hjem: { state: { a: 1 }, log: [
      { id: 'l2', tid: '2026-10-29T05:00:00.000Z', kilde: 'hermes', tekst: 'senere' },
      { id: 'l1', tid: '2026-10-29T04:00:00.000Z', kilde: 'hermes', tekst: 'tidligere' },
    ], chat: [{ id: 'c1', tid: '2026-10-29T04:30:00.000Z', fra: 'hermes', tekst: 'hej' }] },
    dagen: { state: { b: 2 } },
  },
  mappe: { 'Folders/Handling': [{ id: '1', subject: 'Hej' }], Inbox: [{ id: '2' }, { id: '3' }] },
  avis: { dato: DAG },
  mailPlan: { plan: true },
  husstand: { personer: [] },
  ...over,
});

async function medTestDir(fn: (dir: string, rod: string) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-skriv-'));
  const dir = path.join(rod, 'data-test');
  await mkdir(dir);
  try { await fn(dir, rod); } finally { await rm(rod, { recursive: true, force: true }); }
}

test('skrivFroe skriver state, log (ældste først) og chat gennem lageret', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    await skrivFroe(dir, froe(), store, DAG);
    assert.deepEqual(await store.readState('hjem'), { a: 1 });
    assert.deepEqual(await store.readState('dagen'), { b: 2 });
    assert.deepEqual((await store.readLog('hjem')).map((e) => e.id), ['l2', 'l1']); // newest first, as the store reads
    assert.equal((await store.readChat('hjem'))[0]?.tekst, 'hej');
    assert.deepEqual(await store.readLog('dagen'), []);
  });
});

test('skrivFroe rydder gammel rum-data, avis, plan og vault, men rører ikke andet i dataDir', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    await store.writeState('gammelt-rum', { x: 1 });
    await writeFile(path.join(dir, 'avis_2020-01-01.json'), '{}');
    await mkdir(path.join(dir, 'vault', '00-Indbakke'), { recursive: true });
    await writeFile(path.join(dir, 'vault', '00-Indbakke', 'note.md'), 'x');
    await writeFile(path.join(dir, 'andet.json'), '{"ok":true}');
    // KC-0127: indstillinger.json holds Start's step 2, so it belongs to the moment and is cleared with it.
    await writeFile(path.join(dir, 'indstillinger.json'), '{"ok":true}');
    await skrivFroe(dir, froe({ mailPlan: null }), store, DAG);
    assert.equal(await store.readState('gammelt-rum'), null);
    assert.deepEqual((await readdir(dir)).sort(), ['andet.json', 'avis_2026-10-29.json', 'husstand.json', 'rum']);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'husstand.json'), 'utf8')), { personer: [] }, 'KC-0116: the household file is written');
  });
});

test('skrivFroe skriver avis og mailPlan med de filnavne kilderne læser', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    await skrivFroe(dir, froe(), store, DAG);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, `avis_${DAG}.json`), 'utf8')), { dato: DAG });
    const planer = await readdir(path.join(dir, 'hermes-state'));
    assert.deepEqual(planer, [`mail-plan-auto-${DAG}-031000.json`]);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'hermes-state', planer[0]!), 'utf8')), { plan: true });
  });
});

test('skrivFroe: en ny dag erstatter den gamle, og uden dag bruges i dag', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    await skrivFroe(dir, froe(), store, DAG);
    // a second seed with a different day replaces the first
    await skrivFroe(dir, froe(), store, '2026-11-02');
    assert.deepEqual((await readdir(dir)).filter((n) => n.startsWith('avis_')), ['avis_2026-11-02.json']);
    assert.deepEqual(await readdir(path.join(dir, 'hermes-state')), ['mail-plan-auto-2026-11-02-031000.json']);
    await skrivFroe(dir, froe(), store);
    assert.deepEqual((await readdir(dir)).filter((n) => n.startsWith('avis_')), [`avis_${idagKbh(new Date())}.json`]);
  });
});

test('skrivFroe nægter en mappe der ikke er en testmappe, før noget fjernes', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-skriv-nej-'));
  try {
    const fremmed = path.join(rod, 'data');
    await mkdir(path.join(fremmed, 'rum', 'hjem'), { recursive: true });
    await writeFile(path.join(fremmed, 'rum', 'hjem', 'state.json'), '{"vigtig":1}');
    await assert.rejects(() => skrivFroe(fremmed, froe(), createFileStore(fremmed), DAG), /testmappe/);
    assert.equal(await readFile(path.join(fremmed, 'rum', 'hjem', 'state.json'), 'utf8'), '{"vigtig":1}');
    await assert.rejects(() => skrivFroe(path.join(rod, 'kontrolcenter-data'), froe(), createFileStore(rod), DAG), /testmappe/);
    await assert.rejects(() => stat(path.join(rod, 'kontrolcenter-data')));
  } finally { await rm(rod, { recursive: true, force: true }); }
});

test('skrivFroe nægter navne hvor "test" kun er en delstreng (latest, contest), og fjerner intet', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-skriv-delstreng-'));
  try {
    for (const navn of ['latest', 'contest', 'attestation']) {
      const dir = path.join(rod, navn);
      await mkdir(path.join(dir, 'rum', 'hjem'), { recursive: true });
      await writeFile(path.join(dir, 'rum', 'hjem', 'state.json'), '{"vigtig":1}');
      await assert.rejects(() => skrivFroe(dir, froe(), createFileStore(dir), DAG), /testmappe/);
      assert.equal(await readFile(path.join(dir, 'rum', 'hjem', 'state.json'), 'utf8'), '{"vigtig":1}');
    }
    // whole-token names are accepted
    for (const navn of ['data-test', 'kc-test-123', 'kontrolcenter-data-test', 'test']) {
      const dir = path.join(rod, navn);
      await skrivFroe(dir, froe(), createFileStore(dir), DAG);
    }
  } finally { await rm(rod, { recursive: true, force: true }); }
});

test('skrivFroe afviser en ugyldig dag uden at røre mappen', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    await store.writeState('gammelt-rum', { x: 1 });
    await assert.rejects(() => skrivFroe(dir, froe(), store, 'i dag'), /ugyldig dag/);
    assert.deepEqual(await store.readState('gammelt-rum'), { x: 1 });
  });
});

test('testMailRunner svarer fra mappe, tom liste for ukendt mappe, og harmløst på andre kommandoer', async () => {
  const run = testMailRunner(() => froe());
  const a = await run('himalaya', ['envelope', 'list', '-m', 'Inbox', '-s', '120', '-p', '1', '--json']);
  assert.equal(a.code, 0);
  assert.equal((JSON.parse(a.stdout) as { envelopes: unknown[] }).envelopes.length, 2);
  const b = await run('himalaya', ['envelope', 'list', '-m', 'Folders/Findes-ikke', '--json']);
  assert.deepEqual(JSON.parse(b.stdout), { envelopes: [] });
  const c = await run('himalaya', ['message', 'move', 'Folders/Handling', '1']);
  assert.equal(c.code, 0);
});

test('mail-kilden læser det skrevne: kuverter og plan', async () => {
  await medTestDir(async (dir) => {
    const store = createFileStore(dir);
    const f = froe({ mailPlan: null });
    await skrivFroe(dir, f, store, DAG);
    const m = await readMailSource({ run: testMailRunner(() => f), stateDir: path.join(dir, 'hermes-state'), now: new Date('2026-10-29T08:00:00Z') });
    assert.equal(m.tal.indbakke, 2);
    assert.equal(m.tal.handling, 1);
  });
});
