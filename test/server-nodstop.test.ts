// KC-0124: the kill switch and the audit log over HTTP — POST /api/nodstop (any
// non-guest), POST /api/nodstop/genoptag (owner only), 503 on new runs and 409
// on voice actions while paused, /health.pause, a restart stays paused, and
// GET /api/revision (no guests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { createFakeStemme } from '../src/stemme/fake.ts';
import { parseDagenState } from '../src/rooms/dagen/schema.ts';
import type { Person } from '../src/identitet/husstand.ts';

const NOW = new Date('2026-10-31T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const GAEST: Person = { id: 'farmor', login: null, navn: 'Farmor', rolle: 'gaest' };
const dagenJson = {
  dato: '2026-10-31', treLinjer: ['A.', 'B.', 'C.'],
  anbefaling: { tekst: 'Blokér kl. 13.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'Opret kalenderblok 13-14.', fortryd: 'Slet blokken.' } },
  kalender: [], morgenavis: [], hermesStatus: 'Klar',
};

type App = ReturnType<typeof createApp>;
async function medApp(fn: (lav: (person?: Person, delayMs?: number) => App, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-nodstop-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await store.writeState('dagen', parseDagenState(dagenJson, NOW));
    const lav = (person: Person = EJER, delayMs = 0): App => createApp({
      store, hermes: createFakeAgent({ answer: () => 'Gjort.', delayMs }), stemme: createFakeStemme(), sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: person },
    });
    await fn(lav, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (app: App['app'], url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const health = async (app: App['app']) => (await (await app.request('/health')).json()) as { pause: boolean };
type Linje = { udfald: string; person: string; rum: string; verb: string; runId?: string; kilde: string };
const revision = async (app: App['app'], q = '') => (await (await app.request(`/api/revision${q}`)).json()) as { linjer: Linje[]; kaede: { ok: boolean } };

test('Stop alt: the run in flight is stopped, /health says pause, new runs get 503 and voice actions 409', async () => {
  await medApp(async (lav) => {
    const sut = lav(EJER, 5_000);
    assert.equal((await health(sut.app)).pause, false);
    const { runId } = (await (await post(sut.app, '/api/rum/dagen/opdater', { mode: 'opdater' })).json()) as { runId: string };
    assert.equal(sut.runs.get(runId)?.status, 'running');

    const res = await post(sut.app, '/api/nodstop');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { pause: true, stoppede: 1 });
    assert.equal(sut.runs.get(runId)?.status, 'failed');
    assert.equal((await health(sut.app)).pause, true);

    const ny = await post(sut.app, '/api/rum/dagen/opdater', { mode: 'opdater' });
    assert.equal(ny.status, 503);
    assert.deepEqual(await ny.json(), { error: 'Clawco er sat på pause' });
    assert.equal((await post(sut.app, '/api/rum/hjem/chat', { besked: 'hej' })).status, 503);
    assert.equal((await post(sut.app, '/api/rum/dagen/handlinger/blok-13')).status, 503);
    assert.equal((await post(sut.app, '/api/stemme/udfoer', { id: 'dagen:blok-13' })).status, 409);
    assert.equal((await post(sut.app, '/api/stemme/samtale', { rum: 'hjem' })).status, 409);
    assert.equal(await sut.kuratorTik({ fra: 0, til: 24, hverMin: 1 }), null, 'Kuratoren\'s tick skips');
    assert.deepEqual(sut.runs.list().filter((r) => r.status === 'queued' || r.status === 'running'), []);
    assert.deepEqual((await (await sut.app.request('/api/koe')).json() as { pause: boolean }).pause, true);
  });
});

test('a restart while paused stays paused; only the owner resumes, and each stop and resume is one audit line', async () => {
  await medApp(async (lav) => {
    const maja = lav(MEDLEM);
    assert.equal((await post(maja.app, '/api/nodstop')).status, 200);

    const efterGenstart = lav(EJER);
    assert.equal((await health(efterGenstart.app)).pause, true, 'a new app on the same data dir is still paused');
    assert.equal((await post(efterGenstart.app, '/api/rum/dagen/opdater', { mode: 'opdater' })).status, 503);

    const nej = await post(lav(MEDLEM).app, '/api/nodstop/genoptag');
    assert.equal(nej.status, 403);
    assert.equal((await health(efterGenstart.app)).pause, true);

    const ja = await post(efterGenstart.app, '/api/nodstop/genoptag');
    assert.equal(ja.status, 200);
    assert.deepEqual(await ja.json(), { pause: false });
    assert.equal((await health(efterGenstart.app)).pause, false);
    const res = await post(efterGenstart.app, '/api/rum/dagen/opdater', { mode: 'opdater' });
    assert.equal(res.status, 202);
    await efterGenstart.runs.get(((await res.json()) as { runId: string }).runId)!.finished;

    const r = await revision(efterGenstart.app);
    const nodstop = r.linjer.filter((l) => l.kilde === 'nodstop').map((l) => [l.udfald, l.person]);
    assert.deepEqual(nodstop, [['genoptag', 'henrik'], ['stop', 'maja']]);
    assert.ok(r.linjer.some((l) => l.udfald === 'tillad' && l.rum === 'dagen' && l.verb === 'laes' && l.runId), 'the rebuild after the resume is a decision line with its run');
    assert.deepEqual(r.kaede, { ok: true });
  });
});

test('a guest can neither stop, resume nor read the audit log; the owner\'s nej filter shows only refusals', async () => {
  await medApp(async (lav) => {
    const gaest = lav(GAEST);
    assert.equal((await post(gaest.app, '/api/nodstop')).status, 403);
    assert.equal((await post(gaest.app, '/api/nodstop/genoptag')).status, 403);
    assert.equal((await gaest.app.request('/api/revision')).status, 403);
    assert.equal((await health(gaest.app)).pause, false);

    const ejer = lav(EJER);
    await post(ejer.app, '/api/nodstop');
    await post(ejer.app, '/api/nodstop/genoptag');
    // Send without the human tap: the policy layer wants a yes (403) — one kraever-ja line.
    assert.equal((await post(ejer.app, '/api/rum/mail/aktion/send', { mailId: '1' })).status, 403);
    const alle = await revision(ejer.app);
    assert.deepEqual(alle.linjer.map((l) => l.udfald), ['kraever-ja', 'genoptag', 'stop']);
    const kunNej = await revision(ejer.app, '?nej=1');
    assert.deepEqual(kunNej.linjer.map((l) => [l.udfald, l.rum, l.verb]), [['kraever-ja', 'mail', 'send-til-andre']]);
  });
});

test('the pages: Stop alt in the Kø panel while running; the pause band with Start igen for the owner only while paused', async () => {
  await medApp(async (lav) => {
    const ejer = lav(EJER);
    let side = await (await ejer.app.request('/rum/hjem')).text();
    assert.match(side, /data-nodstop="stop"[^>]*>Stop alt</);
    assert.match(side, /data-revision="liste"/);
    assert.doesNotMatch(side, /data-nodstop="pause"/);

    await post(ejer.app, '/api/nodstop');
    side = await (await ejer.app.request('/rum/hjem')).text();
    assert.match(side, /data-nodstop="pause"/);
    assert.match(side, /Clawco er sat på pause/);
    assert.match(side, /data-nodstop="genoptag"[^>]*>Start igen</);
    assert.doesNotMatch(side, /data-nodstop="stop"/, 'nothing to stop while paused');

    const maja = await (await lav(MEDLEM).app.request('/rum/dagen')).text();
    assert.match(maja, /data-nodstop="pause"/);
    assert.doesNotMatch(maja, /data-nodstop="genoptag"/);

    const koe = (await (await ejer.app.request('/api/koe')).json()) as { revision: string };
    assert.match(koe.revision, /Stop alt/);
  });
});
