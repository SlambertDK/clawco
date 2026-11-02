import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeStemme } from '../../src/stemme/fake.ts';
import type { StemmeClient } from '../../src/stemme/types.ts';
import { regnskabsfil } from '../../src/kurator/regnskab.ts';
import type { KuratorState } from '../../src/rooms/hjem/kort.ts';
import type { SkriveState } from '../../src/rooms/skrive/schema.ts';
import type { Opgave } from '../../src/udvikling/opgaver.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import { MOMENTER } from '../../src/testtilstand/indhold.ts';

const sov = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const JSON_HOVED = { 'content-type': 'application/json' };
const post = (v: Testverden, sti: string, body: unknown = {}): Promise<Response> =>
  Promise.resolve(v.app.request(sti, { method: 'POST', headers: JSON_HOVED, body: JSON.stringify(body) }));

/** Every file under `dir` (recursively) with size and mtime; `uden` is left out. */
async function snapshot(dir: string, uden: string): Promise<Record<string, string>> {
  const ud: Record<string, string> = {};
  async function gaa(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (p === uden) continue;
      if (e.isDirectory()) { ud[p + '/'] = 'dir'; await gaa(p); } else { const s = await stat(p); ud[p] = `${s.size}:${s.mtimeMs}`; }
    }
  }
  await gaa(dir);
  return ud;
}

/** A "real" ElevenLabs client that records what was asked of it. */
function spionStemme(): StemmeClient & { kald: string[] } {
  const fake = createFakeStemme();
  const kald: string[] = [];
  return {
    mode: 'elevenlabs', kald,
    async lyt(a, m, k) { kald.push('lyt'); void a; void m; void k; return 'spion hørte dette'; },
    async sig(t, v) { kald.push('sig'); return fake.sig(t, v); },
    async samtaleToken() { kald.push('samtaleToken'); return 'tok'; },
    async ensureAgent(c, v, k) { kald.push('ensureAgent'); return fake.ensureAgent(c, v, k); },
    async ensureVoice(v) { kald.push('ensureVoice'); return v || 'spion-stemme'; },
  };
}

type Opsat = { rod: string; dir: string; verden: Testverden };
async function medVerden(o: { delayMs?: number; trinMs?: number; stemme?: StemmeClient }, fn: (x: Opsat) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-verden-'));
  const dir = path.join(rod, 'data-test');
  try {
    const verden = await lavTestverden({ dataDir: dir, delayMs: o.delayMs ?? 0, ...(o.trinMs !== undefined ? { trinMs: o.trinMs } : {}), ...(o.stemme ? { stemme: o.stemme } : {}) });
    await fn({ rod, dir, verden });
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
}

/** Waits until no run is queued or running (the Kø panel's view). */
async function rolig(v: Testverden): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { runs } = (await (await v.app.request('/api/koe')).json()) as { runs: { status: string }[] };
    if (!runs.some((r) => r.status === 'queued' || r.status === 'running')) return;
    await sov(5);
  }
  throw new Error('kørslerne blev aldrig færdige');
}

const afkod = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const alle = (html: string, attr: string): string[] => [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((m) => afkod(m[1] ?? ''));

const kbh = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace('.', ':');

async function opgaver(v: Testverden): Promise<Opgave[]> {
  return ((await (await v.app.request('/api/udvikling/opgaver?repo=SlambertDK/kontrolcenter')).json()) as { opgaver: Opgave[] }).opgaver;
}
async function ventPaa<T>(fn: () => Promise<T | undefined>, ms = 3000): Promise<T> {
  const slut = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > slut) throw new Error('ventede forgæves');
    await sov(5);
  }
}

test('(a) real seams untouched: every POST a page can call, at every moment, stays inside the test dir', async () => {
  const realStemme = spionStemme();
  await medVerden({ trinMs: 2, stemme: realStemme }, async ({ rod, dir, verden }) => {
    // A stand-in for the real data dir next to the test dir, and the repo's own ./data (where a dev server keeps
    // the real rum-lager): neither may change. The world must report the scripted Hermes, never the real one.
    const realDir = path.join(rod, 'data');
    await mkdir(realDir, { recursive: true });
    await createFileStore(realDir).writeState('hjem', { rigtig: true });
    await writeFile(path.join(rod, 'nabo.txt'), 'rør mig ikke');
    const cwdData = path.resolve('data');
    const cwdFoer = await snapshot(cwdData, '').catch(() => null);
    const foer = await snapshot(rod, dir);
    const health = (await (await verden.app.request('/health')).json()) as { sha: string; hermes: { mode: string } };
    assert.equal(health.hermes.mode, 'fake');
    assert.equal(health.sha, 'test');

    const statusser: string[] = [];
    const tjek = async (sti: string, res: Response | Promise<Response>): Promise<Response> => {
      const r = await res;
      statusser.push(`${r.status} ${sti}`);
      assert.ok(r.status < 500, `${sti} gav ${r.status}: ${await r.clone().text()}`);
      return r;
    };
    const p = (sti: string, body: unknown = {}): Promise<Response> => tjek(sti, post(verden, sti, body));
    const lager = createFileStore(dir);

    for (const m of MOMENTER) {
      if (m.id === 'pause') continue; // KC-0124: paused, every POST is refused by design (test/testtilstand/pause.test.ts)
      await verden.hop(m.id);
      const rum = (await readdir(path.join(dir, 'rum'))).filter((x) => x !== 'nav' && x !== 'udvikling');
      for (const id of rum) {
        const side = await verden.app.request(`/rum/${id}`);
        if (side.status !== 200) continue;
        const html = await side.text();
        for (const h of alle(html, 'data-handling')) await p(`/api/rum/${id}/handlinger/${encodeURIComponent(h)}`);
        for (const l of alle(html, 'data-fortryd')) await p(`/api/rum/${id}/log/${encodeURIComponent(l)}/fortryd`);
        for (const l of alle(html, 'data-hjem-fortryd')) await p(`/api/rum/hjem/fortryd/${encodeURIComponent(l)}`);
        for (const k of alle(html, 'data-kort-handling')) await p(`/api/rum/hjem/kort/${encodeURIComponent(k)}/handling`);
        // Every aktion button with its own argument (Skrive, Nyheder, Mail, Univers).
        for (const tag of html.match(/<button[^>]*data-aktion="[^"]*"[^>]*>/g) ?? []) {
          const navn = alle(tag, 'data-aktion')[0] ?? '';
          const arg = alle(tag, 'data-arg')[0];
          await p(`/api/rum/${id}/aktion/${encodeURIComponent(navn)}`, arg ? JSON.parse(arg) : {});
        }
        await p(`/api/rum/${id}/chat`, { besked: 'Hvad er det vigtigste lige nu?' });
        if (id !== 'hjem') await p(`/api/rum/${id}/opdater`, {});
        await rolig(verden);
      }
      // Ledger: choose, move, undo (whichever bills exist at this moment), and close a card.
      const k = (await lager.readState<KuratorState>('hjem'))?.kort ?? [];
      for (const kort of k) {
        const base = `/api/rum/hjem/kort/${encodeURIComponent(kort.id)}`;
        if (kort.regnskabUklart) await p(`${base}/regnskab/privat`);
        if (kort.skrevet) { await p(`${base}/regnskab/flyt`); await p(`${base}/regnskab/fortryd`); }
      }
      if (k[0]) await p(`/api/rum/hjem/kort/${encodeURIComponent(k[0].id)}/luk`, { grund: 'klaret' });
      // Mail decisions by aktion; Skrive and Nyheder save to Obsidian.
      const mail = await lager.readState<{ beslutninger: { mailId: string; afgjort?: unknown }[] }>('mail');
      for (const b of (mail?.beslutninger ?? []).filter((x) => !x.afgjort).slice(0, 3)) {
        await p('/api/rum/mail/aktion/kladde', { mailId: b.mailId, tekst: 'Tak, det passer fint.' });
        await p('/api/rum/mail/aktion/faerdig', { mailId: b.mailId });
      }
      const skrive = await lager.readState<SkriveState>('skrive');
      for (const d of skrive?.dokumenter ?? []) await p('/api/rum/skrive/aktion/gem', { dokId: d.id });
      const nyhedId = (await lager.readState<NyhederState>('nyheder'))?.baner.flatMap((b) => b.nyheder)[0]?.id;
      if (nyhedId) await p('/api/rum/nyheder/aktion/gem', { nyhedId });
      await rolig(verden);
    }

    // Udvikling: send, the scripted pipeline asks, answer, done.
    const sendt = await p('/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Gør knapperne runde' });
    const id = ((await sendt.json()) as { opgave: Opgave }).opgave.id;
    await ventPaa(async () => ((await opgaver(verden)).find((o) => o.id === id && o.status === 'parkeret') ? true : undefined));
    await p(`/api/udvikling/opgaver/${id}/svar`, { svar: 'Ja' });
    await ventPaa(async () => ((await opgaver(verden)).find((o) => o.id === id && o.status === 'faerdig') ? true : undefined));

    // Voice: listen and speak go to the real client; a Samtale never reaches it.
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'lyd.webm');
    fd.append('rum', 'hjem');
    await tjek('/api/stemme/lyt', verden.app.request('/api/stemme/lyt', { method: 'POST', body: fd }));
    await p('/api/stemme/sig', { tekst: 'Hej' });
    assert.equal((await post(verden, '/api/stemme/samtale', { rum: 'hjem' })).status, 503);
    await p('/api/indstillinger', { modeller: {} });
    await rolig(verden);

    assert.ok(statusser.length > 40, `for få kald: ${statusser.length}`);
    assert.ok(statusser.some((s) => s.startsWith('202 /api/rum/mail/handlinger/')), 'en mail-beslutning blev kørt');
    assert.ok(statusser.some((s) => /^200 \/api\/rum\/hjem\/kort\/.*\/regnskab\/fortryd$/.test(s)), 'en regnskabslinje blev fortrudt');
    assert.ok(statusser.some((s) => s.startsWith('202 /api/rum/skrive/aktion/gem')), 'Skrive gemte i Obsidian');
    assert.ok(statusser.some((s) => s.startsWith('202 /api/rum/nyheder/aktion/gem')), 'Nyheder gemte til senere');
    // Zero contact with the real side; nothing outside the test dir changed.
    assert.deepEqual(await snapshot(cwdData, '').catch(() => null), cwdFoer);
    assert.deepEqual(realStemme.kald.filter((k) => k !== 'lyt' && k !== 'sig'), []);
    assert.deepEqual(await snapshot(rod, dir), foer);
    assert.deepEqual(await createFileStore(realDir).readState('hjem'), { rigtig: true });
  });
});

test('(b) hop("moede") sets the clock to 11:10 Copenhagen and Hjem/Univers show the meeting', async () => {
  await medVerden({}, async ({ verden }) => {
    assert.equal((await verden.hop('ukendt')), null);
    assert.deepEqual(await verden.hop('moede'), { url: '/rum/hjem' });
    assert.equal(kbh(verden.ur.now()), '11:10');
    assert.equal(verden.moment().id, 'moede');
    const { moede } = (await (await verden.app.request('/api/situation')).json()) as { moede: { url: string; titel: string } | null };
    assert.ok(moede, 'et møde er i gang');
    const rod = await verden.app.request('/');
    assert.equal(rod.status, 302);
    assert.equal(rod.headers.get('location'), moede.url);
    const side = await (await verden.app.request(moede.url)).text();
    assert.match(side, /data-situation="moede"/);
    const hjem = await (await verden.app.request('/rum/hjem')).text();
    assert.ok(hjem.includes(moede.titel), 'Hjem nævner mødet');
    const slug = moede.url.split('/')[2] ?? '';
    const univers = await (await verden.app.request(`/rum/univers-${slug}`)).text();
    assert.ok(univers.includes(moede.titel), 'universet viser mødet');
  });
});

test('(c) generation: a chat answer that comes back after a jump is not written into the new moment', async () => {
  await medVerden({ delayMs: 50 }, async ({ dir, verden }) => {
    await verden.hop('formiddag');
    const res = await post(verden, '/api/rum/hjem/chat', { besked: 'Hvad venter på mig?' });
    assert.equal(res.status, 202);
    await verden.hop('foer-moede');
    const lager = createFileStore(dir);
    const efterHop = await lager.readChat('hjem');
    await sov(150);
    await rolig(verden);
    assert.deepEqual(await lager.readChat('hjem'), efterHop);
    assert.equal((await lager.readChat('hjem')).filter((e) => e.fra === 'hermes').length, 0);
    const { runs } = (await (await verden.app.request('/api/koe')).json()) as { runs: { kind: string; status: string }[] };
    assert.equal(runs.find((r) => r.kind === 'chat')?.status, 'failed');
  });
});

test('(c) generation: handlinger queued behind others before a jump write nothing into the new moment', async () => {
  await medVerden({ delayMs: 50 }, async ({ dir, verden }) => {
    await verden.hop('morgen');
    const ider: [string, string][] = [];
    for (const rum of ['dagen', 'hjem', 'mail', 'nyheder']) {
      // KC-0122: a red button needs a human yes first; this test is about the queue, so it presses the others.
      const side = await (await verden.app.request(`/rum/${rum}`)).text();
      for (const [knap, h] of side.matchAll(/<button[^>]*data-handling="([^"]+)"[^>]*>/g)) if (!knap.includes('data-kraever-ja')) ider.push([rum, h!]);
    }
    assert.ok(ider.length >= 3, `for få handlinger: ${ider.length}`);
    for (const [rum, h] of ider.slice(0, 3)) assert.equal((await post(verden, `/api/rum/${rum}/handlinger/${encodeURIComponent(h)}`)).status, 202);
    await verden.hop('formiddag');
    const lager = createFileStore(dir);
    const rum = (await readdir(path.join(dir, 'rum'))).sort();
    const efterHop = await Promise.all(rum.map(async (r) => [await lager.readLog(r, 500), await lager.readChat(r, 500)]));
    await sov(250);
    await rolig(verden);
    assert.deepEqual(await Promise.all(rum.map(async (r) => [await lager.readLog(r, 500), await lager.readChat(r, 500)])), efterHop);
  });
});

test('(d) pipeline: a sent opgave is received, started and parked with a question; the answer finishes it', async () => {
  await medVerden({ trinMs: 5 }, async ({ dir, verden }) => {
    const res = await post(verden, '/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Gør knapperne runde' });
    assert.equal(res.status, 201);
    const id = ((await res.json()) as { opgave: Opgave }).opgave.id;
    const parkeret = await ventPaa(async () => (await opgaver(verden)).find((o) => o.id === id && o.status === 'parkeret'));
    assert.deepEqual(parkeret.spoergsmaal?.valg, ['Ja', 'Nej']);
    assert.ok(parkeret.spoergsmaal?.tekst);
    assert.match(parkeret.ticket ?? '', /^KC-\d{4}$/);
    const log = (await createFileStore(dir).readLog('hjem', 50)).map((e) => e.tekst);
    assert.ok(log.some((t) => t.startsWith(`Claude Code: modtaget som ${parkeret.ticket}`)));
    assert.ok(log.some((t) => t.startsWith(`Claude Code: ${parkeret.ticket} er i gang`)));
    const svar = await post(verden, `/api/udvikling/opgaver/${id}/svar`, { svar: 'Ja' });
    assert.equal(svar.status, 200);
    const faerdig = await ventPaa(async () => (await opgaver(verden)).find((o) => o.id === id && o.status === 'faerdig'));
    assert.ok(faerdig.bevis);
  });
});

test('(d) pipeline: a jump stops the scripted steps of the old moment', async () => {
  await medVerden({ trinMs: 20 }, async ({ dir, verden }) => {
    const res = await post(verden, '/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'Gør knapperne runde' });
    const id = ((await res.json()) as { opgave: Opgave }).opgave.id;
    await verden.hop('aften');
    const efter = await createFileStore(dir).readLog('hjem', 200);
    await sov(120);
    assert.equal((await opgaver(verden)).find((o) => o.id === id), undefined);
    assert.deepEqual(await createFileStore(dir).readLog('hjem', 200), efter);
  });
});

test('(e) the voice wrapper says fake (so Samtale runs on the Hermes loop) and delegates lyt and sig to the real client', async () => {
  const real = spionStemme();
  await medVerden({ stemme: real }, async ({ verden }) => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'lyd.webm');
    const lyt = await verden.app.request('/api/stemme/lyt', { method: 'POST', body: fd });
    assert.deepEqual(await lyt.json(), { tekst: 'spion hørte dette' });
    const sig = await post(verden, '/api/stemme/sig', { tekst: 'Hej' });
    assert.equal(sig.status, 200);
    assert.deepEqual(real.kald, ['lyt', 'sig']);
    assert.equal((await post(verden, '/api/stemme/samtale', { rum: 'hjem' })).status, 503);
    assert.match(await (await verden.app.request('/rum/hjem')).text(), /data-stemme="lyt"/);
    assert.deepEqual(real.kald, ['lyt', 'sig']);
  });
  // Without a real client: the fake one.
  await medVerden({}, async ({ verden }) => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), 'lyd.webm');
    assert.equal((await verden.app.request('/api/stemme/lyt', { method: 'POST', body: fd })).status, 200);
  });
});

test('ruling: a seeded bill that is already written can be moved and undone (its ledger row exists in the test vault)', async () => {
  await medVerden({}, async ({ dir, verden }) => {
    await verden.hop('morgen');
    const s = (await createFileStore(dir).readState<KuratorState>('hjem'))!;
    const skrevne = s.kort.filter((k) => k.skrevet);
    assert.ok(skrevne.length >= 1);
    const vault = path.join(dir, 'vault');
    for (const k of skrevne) {
      assert.equal(k.skrevet?.fil, regnskabsfil(vault, k.skrevet!.hvor));
      assert.match(await readFile(regnskabsfil(vault, k.skrevet!.hvor), 'utf8'), new RegExp(`<!-- kc:${k.id} -->`));
    }
    const k = skrevne[0]!;
    const base = `/api/rum/hjem/kort/${encodeURIComponent(k.id)}`;
    assert.equal((await post(verden, `${base}/regnskab/flyt`)).status, 200);
    assert.equal((await post(verden, `${base}/regnskab/fortryd`)).status, 200);
    // A written row whose card is gone (moment 2: Bredbåndet chosen at 10.10) is undone from Hjem's log.
    await verden.hop('foer-moede');
    const e = (await createFileStore(dir).readLog('hjem', 200)).find((x) => x.handlingId?.startsWith('regnskab:') && !x.fortrudt);
    assert.ok(e);
    assert.equal((await post(verden, `/api/rum/hjem/fortryd/${encodeURIComponent(e.id)}`)).status, 200);
  });
});

test('ruling: the seeded "Gem i Obsidian" can be undone and removes only its own file in the test vault', async () => {
  await medVerden({}, async ({ dir, verden }) => {
    await verden.hop('aften');
    const lager = createFileStore(dir);
    const dok = (await lager.readState<SkriveState>('skrive'))!.dokumenter.find((d) => d.gemtSom)!;
    assert.ok(dok.gemtSom && path.isAbsolute(dok.gemtSom) && dok.gemtSom.startsWith(path.join(dir, 'vault', '00-Indbakke') + path.sep));
    await stat(dok.gemtSom);
    const e = (await lager.readLog('skrive')).find((x) => x.fortryd?.includes('"slet"'));
    assert.ok(e, 'gem-linjen kan fortrydes');
    const foer = await snapshot(dir, path.join(dir, 'rum'));
    const res = await post(verden, `/api/rum/skrive/log/${encodeURIComponent(e.id)}/fortryd`);
    assert.equal(res.status, 202);
    await rolig(verden);
    await assert.rejects(stat(dok.gemtSom));
    const efter = await snapshot(dir, path.join(dir, 'rum'));
    assert.deepEqual(Object.keys(foer).filter((f) => !(f in efter)), [dok.gemtSom]);
    assert.equal((await lager.readState<SkriveState>('skrive'))!.dokumenter.find((d) => d.id === dok.id)?.gemtSom, undefined);
    assert.match((await lager.readLog('skrive'))[0]?.tekst ?? '', /Fjernede noten/);
  });
});

test('taend() gives a clean world at the first moment and lavTestverden refuses a dir that is not a test dir', async () => {
  await medVerden({}, async ({ dir, verden }) => {
    await verden.hop('aften');
    await createFileStore(dir).writeState('fremmed', { x: 1 });
    assert.deepEqual(await verden.taend(), { url: MOMENTER[0]!.url });
    assert.equal(verden.moment().id, MOMENTER[0]!.id);
    assert.equal(kbh(verden.ur.now()), MOMENTER[0]!.tid);
    assert.equal(await createFileStore(dir).readState('fremmed'), null);
  });
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-verden-'));
  try {
    await assert.rejects(lavTestverden({ dataDir: path.join(rod, 'data') }), /testmappe/);
  } finally { await rm(rod, { recursive: true, force: true }); }
});
