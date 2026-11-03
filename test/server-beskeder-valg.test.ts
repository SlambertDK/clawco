// KC-0224: Beskeder after the connection — PUT /api/kilder/beskeder/valg sets which conversations Clawco may read
// (owner only, from Clawco itself, every id a known conversation). Un-choosing purges that conversation's messages from
// Clawco's cache at once (KC-0138's invariant); one count-only line in the connection log; the Kø panel's list follows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { beskederKilde, cacheFil } from '../src/kilder/beskeder/kilde.ts';
import { LOG_FIL } from '../src/kilder/beskeder/jsonl.ts';
import { samtaleNoegle } from '../src/kilder/beskeder/valg.ts';
import { laesKonfig, KILDER_LOG } from '../src/kilder/register.ts';
import type { Person } from '../src/identitet/husstand.ts';

const NU = new Date('2026-11-02T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const MAJA = samtaleNoegle('whatsapp', '+4500000001');
const GRILL = samtaleNoegle('telegram', '-1000000003');
const linje = (o: Record<string, unknown>): string => `${JSON.stringify({ kanal: 'whatsapp', samtale: '+4500000001', gruppe: false, afsender: '+4500000001', afsenderNavn: 'Maja', tid: '2026-11-02T08:00:00.000Z', tekst: 'Kan du hente Ella kl. 15?', ...o })}\n`;
const LOG = linje({}) + linje({ kanal: 'telegram', samtale: '-1000000003', gruppe: true, afsender: '5', afsenderNavn: 'Søren', samtaleNavn: 'Vejens <b>grillaften</b>', tekst: 'Grillaften lørdag?' });
const URL_VALG = '/api/kilder/beskeder/valg';

type App = ReturnType<typeof createApp>;
async function medApp(fn: (s: { lav: (p?: Person) => App; dir: string; store: ReturnType<typeof createFileStore> }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-beskeder-valg-'));
  try {
    await mkdir(path.join(dir, 'beskeder'), { recursive: true });
    await writeFile(path.join(dir, 'beskeder', LOG_FIL), LOG);
    const store = createFileStore(dir);
    const lav = (person: Person = EJER): App => createApp({
      store, hermes: createFakeAgent({ answer: () => '```json\n{"kort":[],"vurderinger":[],"intet":[]}\n```' }), sourceGlob: path.join(dir, 'ingen-{date}.json'), dataDir: dir, now: () => NU, identitet: { fast: person },
      mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: '/nonexistent', beskeder: (o) => beskederKilde({ dataDir: dir, ...o }),
    });
    try { await fn({ lav, dir, store }); } finally { await new Promise((res) => setTimeout(res, 150)); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const put = (app: App['app'], body: unknown, hoved: Record<string, string> = {}) =>
  app.request(URL_VALG, { method: 'PUT', headers: { 'content-type': 'application/json', ...hoved }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const forbind = (app: App['app'], felter: Record<string, string>) =>
  app.request('/api/kilder/beskeder/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter }) });
/** Connecting starts background work (the first read's room run, Kuratoren) that tells Nu on the live bus when it starts;
 *  under load that lands late. Wait until no run is queued or running and the bus has been quiet for a moment. */
async function stille(s: App): Promise<void> {
  let set = 0;
  const af = s.live.subscribe('hjem', () => { set++; });
  try {
    for (let i = 0; i < 40; i++) {
      await s.runs.tomgang();
      const foer = set;
      await new Promise((res) => setTimeout(res, 100));
      if (set === foer && !s.runs.list().some((r) => r.status === 'queued' || r.status === 'running')) return;
    }
  } finally { af(); }
}
const valgFil = async (dir: string): Promise<Record<string, string>> => (await laesKonfig(dir)).kilder.find((k) => k.id === 'beskeder')?.valg ?? {};
const panel = async (app: App['app']): Promise<string> => ((await (await app.request('/api/koe?kilder=1')).json()) as { kilder: string }).kilder;
const cacheSamtaler = async (dir: string): Promise<string[]> => {
  try { return ((JSON.parse(await readFile(cacheFil(dir), 'utf8')) as { beskeder: { samtaleId: string }[] }).beskeder).map((b) => b.samtaleId); } catch { return []; }
};

test('the panel lists every conversation Hermes sees, the chosen one checked, names escaped', async () => {
  await medApp(async ({ lav }) => {
    const s = lav();
    assert.equal((await forbind(s.app, { [MAJA]: 'husstand' })).status, 200);
    const h = await panel(s.app);
    assert.match(h, /Samtaler \(1 valgt af 2\)/);
    assert.match(h, new RegExp(`data-kilde-samtale-valg="${MAJA}"[^>]* checked`));
    assert.doesNotMatch(new RegExp(`data-kilde-samtale-valg="${GRILL}"[^>]*>`).exec(h)?.[0] ?? 'x checked', /checked/);
    assert.match(h, /Vejens &lt;b&gt;grillaften&lt;\/b&gt;/);
    assert.doesNotMatch(h, /<b>grillaften/);
    assert.match(h, /WhatsApp · samtale · Husstand/);
  });
});

test('choosing more: the set is stored (a chosen conversation keeps its zone, a new one starts privat), announced, logged with counts only', async () => {
  await medApp(async ({ lav, dir, store }) => {
    const s = lav();
    await forbind(s.app, { [MAJA]: 'husstand' });
    await stille(s);
    const sendt: number[] = [];
    s.live.subscribe('hjem', (v) => sendt.push(v));
    const r = await put(s.app, { valgte: [MAJA, GRILL] });
    assert.equal(r.status, 200, await r.clone().text());
    const j = (await r.json()) as { samtaler: { noegle: string; valgt: boolean }[]; tekst: string };
    assert.deepEqual(j.samtaler.map((x) => [x.noegle, x.valgt]).sort(), [[GRILL, true], [MAJA, true]].sort());
    assert.deepEqual(await valgFil(dir), { [MAJA]: 'husstand', [GRILL]: 'privat' });
    const log = (await store.readLog(KILDER_LOG, 10)).filter((e) => /ændrede Beskeder/.test(e.tekst));
    assert.equal(log.length, 1);
    assert.match(log[0]?.tekst ?? '', /Henrik ændrede Beskeder: .*2 af 2/);
    assert.ok(!/grillaften|Maja|Søren/.test(log[0]?.tekst ?? ''), 'no conversation name in the log');
    assert.equal(sendt.length, 1, 'Nu is told on the live bus');
    assert.match(await panel(s.app), /Samtaler \(2 valgt af 2\)/);
  });
});

test('un-choosing purges that conversation\'s messages from Clawco\'s cache at once; the others stay; choosing it again is stored', async () => {
  await medApp(async ({ lav, dir }) => {
    const s = lav();
    await forbind(s.app, { [MAJA]: 'privat', [GRILL]: 'privat' });
    assert.deepEqual((await cacheSamtaler(dir)).sort(), [GRILL, MAJA].sort(), 'both are cached after the connection');
    const r = await put(s.app, { valgte: [GRILL] });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await cacheSamtaler(dir), [GRILL], 'Maja\'s messages are gone from the cache before the next read');
    assert.deepEqual(await valgFil(dir), { [GRILL]: 'privat' });
    assert.equal((await put(s.app, { valgte: [] })).status, 200);
    assert.deepEqual(await cacheSamtaler(dir), [], 'nothing chosen: nothing kept');
    assert.deepEqual(await valgFil(dir), {});
    assert.equal((await put(s.app, { valgte: [MAJA] })).status, 200);
    assert.deepEqual(await valgFil(dir), { [MAJA]: 'privat' });
  });
});

test('refusals: a member 403, another site 403, an unknown conversation 400, a bad body 400, not connected 409 — nothing changed or logged', async () => {
  await medApp(async ({ lav, dir, store }) => {
    const ejer = lav();
    assert.equal((await put(ejer.app, { valgte: [MAJA] })).status, 409, 'not connected yet');
    await forbind(ejer.app, { [MAJA]: 'privat' });
    const foer = await valgFil(dir);
    const logFoer = (await store.readLog(KILDER_LOG, 50)).length;
    assert.equal((await put(lav(MEDLEM).app, { valgte: [GRILL] })).status, 403);
    for (const site of ['cross-site', 'same-site']) assert.equal((await put(ejer.app, { valgte: [GRILL] }, { 'sec-fetch-site': site })).status, 403, site);
    const ukendt = await put(ejer.app, { valgte: [MAJA, 's-000000000000'] });
    assert.equal(ukendt.status, 400);
    assert.match(((await ukendt.json()) as { error: string }).error, /samtale/i);
    for (const b of ['ikke json', '{}', { valgte: 'x' }, { valgte: [1] }, { valgte: ['../x'] }, { valgte: [MAJA], andet: 1 }, { valgte: Array(600).fill(MAJA) }]) {
      assert.equal((await put(ejer.app, b)).status, 400, JSON.stringify(b).slice(0, 40));
    }
    assert.deepEqual(await valgFil(dir), foer);
    assert.equal((await store.readLog(KILDER_LOG, 50)).length, logFoer);
  });
});
