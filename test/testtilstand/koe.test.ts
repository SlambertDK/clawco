// KC-0069: the test world has a real run queue (one run at a time, like a busy Hermes), so the Kø panel and Nu can
// show "I kø"; a jump between moments drops what is queued and cannot be written under; oplæsning speaks with the
// voice Henrik chose in the real settings (read only); the seeded "Gem til senere" is in the test vault.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden, testStemme, type Testverden } from '../../src/testtilstand/verden.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeStemme } from '../../src/stemme/fake.ts';
import { DEFAULT_VOICE_ID } from '../../src/stemme/agent.ts';
import type { StemmeClient } from '../../src/stemme/types.ts';
import { ALLE_MOMENTER } from '../../src/testtilstand/indhold.ts';
import { KOE } from '../../src/testtilstand/indhold/fakta.ts';
import { DAEKNING } from '../../src/testtilstand/daekning.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';

const sov = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const JSON_HOVED = { 'content-type': 'application/json' };
const post = (v: Testverden, sti: string, body: unknown = {}): Promise<Response> =>
  Promise.resolve(v.app.request(sti, { method: 'POST', headers: JSON_HOVED, body: JSON.stringify(body) }));

type Opsat = { rod: string; dir: string; verden: Testverden };
async function medVerden(o: { delayMs?: number; holdMs?: number; stemme?: StemmeClient; rigtigDataDir?: (rod: string) => string }, fn: (x: Opsat) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-koe-'));
  const dir = path.join(rod, 'data-test');
  try {
    const verden = await lavTestverden({ dataDir: dir, delayMs: o.delayMs ?? 0, ...(o.holdMs !== undefined ? { holdMs: o.holdMs } : {}), ...(o.stemme ? { stemme: o.stemme } : {}), ...(o.rigtigDataDir ? { rigtigDataDir: o.rigtigDataDir(rod) } : {}) });
    await fn({ rod, dir, verden });
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
}

type KoeRun = { id: string; kind: string; status: string; room: string | null; label: string };
const koe = async (v: Testverden): Promise<KoeRun[]> => ((await (await v.app.request('/api/koe')).json()) as { runs: KoeRun[] }).runs;
async function rolig(v: Testverden): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (!(await koe(v)).some((r) => r.status === 'queued' || r.status === 'running')) return;
    await sov(5);
  }
  throw new Error('kørslerne blev aldrig færdige');
}

// ---------- 1. the queue ----------

test('a second run started while one is active is "queued" in the Kø panel data, and both finish', async () => {
  await medVerden({ delayMs: 150 }, async ({ verden }) => {
    await verden.hop('morgen');
    assert.equal((await post(verden, '/api/rum/hjem/chat', { besked: 'Hvad venter på mig?' })).status, 202);
    assert.equal((await post(verden, '/api/rum/dagen/chat', { besked: 'Hvad er der i dag?' })).status, 202);
    await sov(20);
    const statusser = (await koe(verden)).map((r) => r.status).sort();
    assert.deepEqual(statusser, ['queued', 'running']);
    await rolig(verden);
    assert.deepEqual((await koe(verden)).map((r) => r.status), ['done', 'done']);
  });
});

test('a jump drops the queued runs at once, and a late answer from the old moment writes nothing', async () => {
  await medVerden({ delayMs: 120 }, async ({ dir, verden }) => {
    await verden.hop('formiddag');
    for (const rum of ['hjem', 'dagen', 'mail']) assert.equal((await post(verden, `/api/rum/${rum}/chat`, { besked: 'Hvad nu?' })).status, 202);
    await sov(20);
    assert.ok((await koe(verden)).some((r) => r.status === 'queued'), 'one waits in the queue');
    await verden.hop('foer-moede');
    assert.deepEqual((await koe(verden)).filter((r) => r.status === 'queued' || r.status === 'running'), [], 'nothing queued or running in the new moment');
    assert.deepEqual((await koe(verden)).map((r) => r.status), ['failed', 'failed', 'failed']);
    const lager = createFileStore(dir);
    const rum = (await readdir(path.join(dir, 'rum'))).sort();
    const aaben = async (): Promise<unknown> => Promise.all(rum.map(async (r) => [await lager.readLog(r, 500), await lager.readChat(r, 500)]));
    const efterHop = await aaben();
    await sov(400);
    assert.deepEqual(await aaben(), efterHop, 'the old answers never landed');
  });
});

test('the narrow race: a local save that is mid-write when a jump starts finishes first and leaves nothing in the new moment', async () => {
  await medVerden({}, async ({ dir, verden }) => {
    const lager = createFileStore(dir);
    const laes = async (): Promise<unknown> => {
      const vault = await readFile(path.join(dir, 'vault', '00-Indbakke', 'Læs senere.md'), 'utf8').catch(() => null);
      return { nyheder: await lager.readState('nyheder'), log: (await lager.readLog('nyheder', 500)).map((e) => e.tekst), vault };
    };
    await verden.hop('foer-moede');
    const baseline = await laes();
    for (let i = 0; i < 5; i++) {
      await verden.hop('formiddag');
      const id = (await lager.readState<NyhederState>('nyheder'))!.baner.flatMap((b) => b.nyheder)[0]!.id;
      const res = await post(verden, '/api/rum/nyheder/aktion/gem', { nyhedId: id });
      assert.equal(res.status, 202, 'the save is under way (a local run)');
      await verden.hop('foer-moede'); // no await in between: the jump meets the save
      assert.deepEqual(await laes(), baseline, `round ${i}: the new moment is exactly the seeded one`);
    }
  });
});

// ---------- the moment with two runs ----------

test('the moment "Kørsler i kø" starts two runs: one with Hermes, one in the queue, both in Nu and in the Kø panel', async () => {
  await medVerden({ holdMs: 60_000 }, async ({ verden }) => {
    assert.ok(ALLE_MOMENTER.some((m) => m.id === KOE));
    assert.ok(await verden.hop(KOE));
    const runs = await koe(verden);
    assert.deepEqual(runs.map((r) => r.status).sort(), ['queued', 'running']);
    assert.ok(runs.every((r) => r.kind === 'opdater' && r.room), 'two room refreshes, as the morning build starts them');
    const nu = await (await verden.app.request('/rum/hjem')).text();
    assert.ok(nu.includes('<span class="chip tilstand-rolig">I kø</span>'), 'Nu shows the queued one as I kø');
    assert.ok(nu.includes('<span class="chip tilstand-rolig">I gang</span>'), 'and the other as I gang');
    // The coverage marker for the item.
    const d = DAEKNING.find((x) => x.id === 'i-koe');
    assert.ok(d && nu.includes(d.marker));
    // A jump takes both away.
    await verden.hop('morgen');
    assert.deepEqual((await koe(verden)).filter((r) => r.status === 'queued' || r.status === 'running'), []);
    assert.ok(!(await (await verden.app.request('/rum/hjem')).text()).includes('I kø</span>'));
  });
});

test('the two runs of the moment end by themselves after a while (the world is never stuck behind them)', async () => {
  await medVerden({ holdMs: 30 }, async ({ verden }) => {
    await verden.hop(KOE);
    await rolig(verden);
    assert.deepEqual((await koe(verden)).map((r) => r.status), ['done', 'done']);
  });
});

// ---------- 2. the voice Henrik chose ----------

/** A "real" voice client that records the voice each oplæsning asked for. */
function stemmeSpion(): StemmeClient & { stemmer: string[] } {
  const fake = createFakeStemme();
  const stemmer: string[] = [];
  return { ...fake, mode: 'elevenlabs', stemmer, async sig(t, v) { stemmer.push(v); return fake.sig(t, v); }, async ensureVoice(v) { return v || DEFAULT_VOICE_ID; } };
}
const skrivIndstillinger = async (mappe: string, stemme: unknown): Promise<void> => {
  await mkdir(mappe, { recursive: true });
  await writeFile(path.join(mappe, 'indstillinger.json'), JSON.stringify({ modeller: {}, stemme }));
};

test('oplæsning in the test world carries the voice id from the real settings; without one, the premade default', async () => {
  const med = stemmeSpion();
  await medVerden({ stemme: med, rigtigDataDir: (rod) => path.join(rod, 'data') }, async ({ rod, verden }) => {
    await skrivIndstillinger(path.join(rod, 'data'), { voiceId: 'henriks-stemme-7' });
    assert.equal((await post(verden, '/api/stemme/sig', { tekst: 'Hej' })).status, 200);
    assert.deepEqual(med.stemmer, ['henriks-stemme-7']);
  });
  for (const [navn, opsaetning] of [['no real settings file', undefined], ['settings without a voice', {}]] as const) {
    const uden = stemmeSpion();
    await medVerden({ stemme: uden, rigtigDataDir: (rod) => path.join(rod, 'data') }, async ({ rod, verden }) => {
      if (opsaetning) await skrivIndstillinger(path.join(rod, 'data'), opsaetning);
      assert.equal((await post(verden, '/api/stemme/sig', { tekst: 'Hej' })).status, 200, navn);
      assert.deepEqual(uden.stemmer, [DEFAULT_VOICE_ID], navn);
    });
  }
  const ingen = stemmeSpion();
  await medVerden({ stemme: ingen }, async ({ verden }) => {
    assert.equal((await post(verden, '/api/stemme/sig', { tekst: 'Hej' })).status, 200);
    assert.deepEqual(ingen.stemmer, [DEFAULT_VOICE_ID], 'no real dir given');
  });
});

test('testStemme.ensureVoice: the world\'s own choice first, then the real settings\' voice, then the default; a failing read is the default', async () => {
  const med = (v: string | undefined) => testStemme(stemmeSpion(), async () => v);
  assert.equal(await med('henrik').ensureVoice(undefined), 'henrik');
  assert.equal(await med('henrik').ensureVoice('verdenens'), 'verdenens');
  assert.equal(await med(undefined).ensureVoice(undefined), DEFAULT_VOICE_ID);
  assert.equal(await testStemme(stemmeSpion(), async () => { throw new Error('ulæselig'); }).ensureVoice(undefined), DEFAULT_VOICE_ID);
  assert.equal(await testStemme(stemmeSpion()).ensureVoice(undefined), DEFAULT_VOICE_ID);
  assert.equal(testStemme(undefined, async () => 'x').mode, 'fake');
});

test('the test world never writes the real settings', async () => {
  await medVerden({ stemme: stemmeSpion(), rigtigDataDir: (rod) => path.join(rod, 'data') }, async ({ rod, verden }) => {
    await skrivIndstillinger(path.join(rod, 'data'), { voiceId: 'henriks-stemme-7' });
    const foer = await readFile(path.join(rod, 'data', 'indstillinger.json'), 'utf8');
    const m = (await stat(path.join(rod, 'data', 'indstillinger.json'))).mtimeMs;
    await post(verden, '/api/stemme/sig', { tekst: 'Hej' });
    await post(verden, '/api/indstillinger', { stemme: { voiceId: 'andet' } });
    assert.equal(await readFile(path.join(rod, 'data', 'indstillinger.json'), 'utf8'), foer);
    assert.equal((await stat(path.join(rod, 'data', 'indstillinger.json'))).mtimeMs, m);
    assert.deepEqual(await readdir(path.join(rod, 'data')), ['indstillinger.json']);
  });
});

// ---------- 4. the seeded Gem til senere is in the vault ----------

test('the seeded "Gem til senere" is a line in the test vault\'s Læs senere.md, and its Fortryd removes just that line', async () => {
  await medVerden({}, async ({ dir, verden }) => {
    const fil = path.join(dir, 'vault', '00-Indbakke', 'Læs senere.md');
    await verden.hop('morgen');
    await assert.rejects(stat(fil), 'nothing is saved at the first moment');
    await verden.hop('eftermiddag');
    const lager = createFileStore(dir);
    const s = (await lager.readState<NyhederState>('nyheder'))!;
    const gemt = s.baner.flatMap((b) => b.nyheder).find((n) => n.id === s.gemt[0])!;
    const tekst = await readFile(fil, 'utf8');
    assert.ok(tekst.startsWith('# Læs senere\n\n- '), tekst);
    assert.ok(tekst.includes(gemt.titel), 'the saved item is the one the room marks as saved');
    assert.equal(tekst.split('\n').filter((l) => l.startsWith('- ')).length, 1);
    const e = (await lager.readLog('nyheder')).find((x) => x.fortryd?.startsWith('lokal:'))!;
    assert.ok(e, 'the log line can be undone');
    assert.equal((await post(verden, `/api/rum/nyheder/log/${encodeURIComponent(e.id)}/fortryd`)).status, 202);
    await rolig(verden);
    assert.ok(!(await readFile(fil, 'utf8')).includes(gemt.titel));
    assert.deepEqual((await lager.readState<NyhederState>('nyheder'))!.gemt, []);
  });
});
