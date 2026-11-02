// KC-0139: helbred.json and the controller around the state machine: what the registry
// saw of a read (hook), what a health poll finds, the persisted state (atomic,
// unreadable = none), pruning of sources no longer connected, the log line and the live
// notice only when what is shown changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KILDER_LOG, lavRegister, skrivKonfig } from '../../src/kilder/register.ts';
import { laesHelbredFil, lavHelbredStyring } from '../../src/kilder/helbred-fil.ts';
import { KildeFejl, type Helbred, type Kilde } from '../../src/kilder/types.ts';
import { medData, testKilde } from './hjaelp.ts';

const T0 = Date.parse('2026-11-01T08:00:00Z');
const EJER = 'henrik';

type Opsaet = { helbred?: () => Promise<Helbred>; read?: Kilde['read']; id?: string };

async function verden(dir: string, store: Parameters<Parameters<typeof medData>[0]>[1], o: Opsaet = {}) {
  let nu = T0;
  const meldt: string[] = [];
  let styring: ReturnType<typeof lavHelbredStyring> | undefined;
  const id = o.id ?? 'test-kalender';
  const register = lavRegister({ dataDir: dir, store, nu: () => new Date(nu), helbredMaksMs: 30, efterLaesning: (i, ok) => styring?.laesning(i, ok) });
  const kilde = testKilde({ id, ...(o.helbred ? { helbred: o.helbred } : {}), ...(o.read ? { read: o.read } : {}) });
  register.registrer(kilde);
  await skrivKonfig(dir, { kilder: [{ id, status: 'forbundet', zone: 'privat', valg: {}, tid: new Date(T0).toISOString(), af: EJER }] });
  styring = lavHelbredStyring({ dataDir: dir, nu: () => new Date(nu), register, store, live: { notify: (k) => { meldt.push(k); } } });
  return { register, styring, id, meldt, tid: (min: number) => { nu = T0 + min * 60_000; } };
}

test('no file, an unreadable file and a broken entry all read as no state', async () => {
  await medData(async (dir) => {
    assert.deepEqual(await laesHelbredFil(dir), {});
    await writeFile(path.join(dir, 'helbred.json'), '{ikke json', 'utf8');
    assert.deepEqual(await laesHelbredFil(dir), {});
    await writeFile(path.join(dir, 'helbred.json'), JSON.stringify({ kilder: { god: { vist: 'ok', fejl: 0 }, daarlig: { vist: 'maaske', fejl: 'mange' }, ikkeObj: 4 } }), 'utf8');
    assert.deepEqual(Object.keys(await laesHelbredFil(dir)), ['god']);
  });
});

test('a successful read the registry makes is remembered as the last read, and the file is written atomically', async () => {
  await medData(async (dir, store) => {
    const v = await verden(dir, store);
    await v.register.laes(v.id);
    await v.styring.tom();
    const fil = await laesHelbredFil(dir);
    assert.equal(fil[v.id]?.sidstLaest, new Date(T0).toISOString());
    assert.equal(fil[v.id]?.vist, 'ok');
    assert.deepEqual((await readdir(dir)).filter((n) => n.includes('.tmp-')), [], 'no tmp file is left behind');
  });
});

test('a read the registry refuses (its health says not working) is never tried, so it is no failed read', async () => {
  await medData(async (dir, store) => {
    let kald = 0;
    const v = await verden(dir, store, { read: async () => { throw new KildeFejl(502, 'ude'); }, helbred: async () => { kald += 1; return { status: 'nede', tekst: 'ude' }; } });
    await assert.rejects(v.register.laes(v.id), /virker ikke lige nu/); // laes() checks health first: the read is not even tried
    assert.equal(kald, 1, 'the pre-check is a health call of its own');
    await v.styring.tom();
    assert.equal((await laesHelbredFil(dir))[v.id], undefined, 'a refused read (never tried) is not a failed read');
  });
});

test('a failed read polls the health right away and the answer is what counts: log-ind-igen is visible at once', async () => {
  await medData(async (dir, store) => {
    let kald = 0;
    const v = await verden(dir, store, { read: async () => { throw new KildeFejl(502, 'ude'); }, helbred: async () => { kald += 1; return kald === 1 ? { status: 'ok' } : { status: 'log-ind-igen' }; } });
    await assert.rejects(v.register.laes(v.id));
    await v.styring.tom();
    assert.equal(kald, 2, 'one pre-check, one poll after the failed read');
    assert.equal((await laesHelbredFil(dir))[v.id]?.vist, 'log-ind-igen');
  });
});

test('a read that fails although health says ok counts as one nede failure', async () => {
  await medData(async (dir, store) => {
    const v = await verden(dir, store, { read: async () => { throw new KildeFejl(502, 'ude'); } });
    await assert.rejects(v.register.laes(v.id));
    await v.styring.tom();
    const p = (await laesHelbredFil(dir))[v.id];
    assert.equal(p?.fejl, 1);
    assert.equal(p?.vist, 'ok');
  });
});

test('three transient failures over an hour become visible once: one live notice and one log line; recovery clears with a line', async () => {
  await medData(async (dir, store) => {
    let tilstand: Helbred = { status: 'nede', tekst: 'rå tekst fra udbyderen <b>' };
    const v = await verden(dir, store, { helbred: async () => tilstand });
    for (const min of [0, 30, 60]) { v.tid(min); await v.styring.poll(v.id); }
    assert.equal((await laesHelbredFil(dir))[v.id]?.vist, 'nede');
    assert.deepEqual(v.meldt, ['hjem']);
    const log = (await store.readLog(KILDER_LOG, 10)).map((e) => e.tekst);
    assert.equal(log.length, 1);
    assert.match(log[0] ?? '', /Din kalender svarer ikke/);
    assert.doesNotMatch(log[0] ?? '', /rå tekst|<b>/, 'the provider text never reaches the log');
    tilstand = { status: 'ok' };
    v.tid(90);
    await v.styring.poll(v.id);
    assert.equal((await laesHelbredFil(dir))[v.id]?.vist, 'ok');
    assert.deepEqual(v.meldt, ['hjem', 'hjem']);
    assert.match((await store.readLog(KILDER_LOG, 10))[0]?.tekst ?? '', /virker igen/);
  });
});

test('an auth failure is visible at once; a poll that changes nothing says nothing', async () => {
  await medData(async (dir, store) => {
    const v = await verden(dir, store, { helbred: async () => ({ status: 'log-ind-igen' }) });
    await v.styring.poll(v.id);
    assert.equal((await laesHelbredFil(dir))[v.id]?.vist, 'log-ind-igen');
    v.tid(30);
    await v.styring.poll(v.id);
    assert.deepEqual(v.meldt, ['hjem']);
    assert.equal((await store.readLog(KILDER_LOG, 10)).length, 1);
  });
});

test('a health check that throws or hangs is a transient failure, never ok', async () => {
  await medData(async (dir, store) => {
    const kaster = await verden(dir, store, { helbred: async () => { throw new Error('boom'); } });
    await kaster.styring.poll(kaster.id);
    assert.equal((await laesHelbredFil(dir))[kaster.id]?.fejl, 1);
  });
  await medData(async (dir, store) => {
    const haenger = await verden(dir, store, { helbred: () => new Promise<Helbred>(() => {}) });
    await haenger.styring.poll(haenger.id);
    const p = (await laesHelbredFil(dir))[haenger.id];
    assert.equal(p?.fejl, 1);
    assert.equal(p?.vist, 'ok');
  });
});

test('a known expiry in the health answer raises snart-udloebet', async () => {
  await medData(async (dir, store) => {
    const v = await verden(dir, store, { helbred: async () => ({ status: 'ok', udloeber: new Date(T0 + 24 * 3600_000).toISOString() }) });
    await v.styring.poll(v.id);
    assert.equal((await laesHelbredFil(dir))[v.id]?.vist, 'snart-udloebet');
  });
});

test('pollAlle keeps only connected sources: a disconnected one loses its state', async () => {
  await medData(async (dir, store) => {
    const v = await verden(dir, store, { helbred: async () => ({ status: 'log-ind-igen' }) });
    await v.styring.pollAlle();
    assert.ok((await laesHelbredFil(dir))[v.id]);
    await skrivKonfig(dir, { kilder: [{ id: v.id, status: 'frakoblet', zone: 'privat', valg: {}, tid: new Date(T0).toISOString(), af: EJER }] });
    await v.styring.pollAlle();
    assert.deepEqual(await laesHelbredFil(dir), {});
    assert.match(await readFile(path.join(dir, 'helbred.json'), 'utf8'), /"kilder"/);
  });
});

test('registry: helbredFor is null for an unknown or unconnected source', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store });
    r.registrer(testKilde());
    assert.equal(await r.helbredFor('test-kalender'), null);
    assert.equal(await r.helbredFor('findes-ikke'), null);
    assert.deepEqual(await r.forbundneAlle(), []);
  });
});

test('registry: the read hook is awaited (the state is written before the caller sees the outcome) and a failing hook never fails the read', async () => {
  await medData(async (dir, store) => {
    const orden: string[] = [];
    const r = lavRegister({ dataDir: dir, store, efterLaesning: async (id, ok) => { await new Promise((res) => setTimeout(res, 10)); orden.push(`hook ${id} ${ok}`); } });
    r.registrer(testKilde());
    await skrivKonfig(dir, { kilder: [{ id: 'test-kalender', status: 'forbundet', zone: 'privat', valg: {}, tid: new Date(T0).toISOString(), af: EJER }] });
    await r.laes('test-kalender');
    orden.push('laes svarede');
    assert.deepEqual(orden, ['hook test-kalender true', 'laes svarede']);
    const braekker = lavRegister({ dataDir: dir, store, efterLaesning: () => { throw new Error('boom'); } });
    braekker.registrer(testKilde());
    assert.equal((await braekker.laes('test-kalender')).slags, 'kalender');
    const afviser = lavRegister({ dataDir: dir, store, efterLaesning: () => Promise.reject(new Error('boom')) });
    afviser.registrer(testKilde({ read: async () => { throw new KildeFejl(502, 'ude'); } }));
    await assert.rejects(afviser.laes('test-kalender'), /ude/);
  });
});
