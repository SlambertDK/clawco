// KC-0124: the kill switch. Invariant: after stopAlle() returns, no agent run is
// queued or running and none can start until the owner resumes — across
// restarts (pause.json on the data dir) — and every stop/resume has exactly one
// audit line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRunRegistry } from '../src/runs.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { lavPause, PauseFejl, PAUSE_TEKST, NodstopNaegtet, stopAlt, startIgen } from '../src/graenser/nodstop.ts';
import { lavRevisionslog } from '../src/graenser/revisionslog.ts';
import { startScheduler } from '../src/scheduler.ts';
import type { Person } from '../src/identitet/husstand.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const BARN: Person = { id: 'ella', login: null, navn: 'Ella', rolle: 'barn' };
const GAEST: Person = { id: 'farmor', login: null, navn: 'Farmor', rolle: 'gaest' };

async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-nodstop-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const spec = { input: 'x', instructions: 'y' };
const startEn = (runs: ReturnType<typeof createRunRegistry>) => runs.start({ kind: 'opdater', spec, onDone: async () => ({ text: 'gjort' }) });

test('stopAlle cancels the queue, aborts the run in flight and leaves nothing queued or running', async () => {
  await medMappe(async (dir) => {
    const hermes = createFakeAgent({ answer: () => 'svar', delayMs: 5_000 });
    const runs = createRunRegistry(hermes, { maxParallel: 1, pause: lavPause(dir) });
    const a = startEn(runs);
    const b = startEn(runs);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(a.status, 'running');
    assert.equal(b.status, 'queued');

    const stoppede = await runs.stopAlle(EJER.id);
    assert.equal(stoppede, 2);
    assert.deepEqual(runs.list().filter((r) => r.status === 'queued' || r.status === 'running'), []);
    assert.equal(a.status, 'failed');
    assert.equal(b.status, 'failed');
    assert.match(a.error ?? '', /pause/);
    assert.equal(hermes.calls.length, 1, 'the queued run never reached Hermes');
    assert.equal(hermes.calls[0]?.signal?.aborted, true, 'the run in flight got the abort (KC-0118 signal)');
    assert.equal((await a.finished).status, 'failed');
    assert.equal((await b.finished).status, 'failed');
  });
});

test('a run that finishes after the stop does not turn back into done', async () => {
  await medMappe(async (dir) => {
    let slip!: () => void;
    const vent = new Promise<void>((r) => { slip = r; });
    const runs = createRunRegistry({ mode: 'fake', health: async () => true, status: async () => 'klar', saetModelNoegle: async () => ({ slags: 'kommando', kommando: '' }), run: async () => { await vent; return { runId: 'x', output: 'svar' }; } }, { pause: lavPause(dir) });
    const a = startEn(runs);
    await new Promise((r) => setTimeout(r, 5));
    await runs.stopAlle(EJER.id);
    slip();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(a.status, 'failed');
  });
});

test('while paused no run starts: start and local throw PauseFejl with the Danish text', async () => {
  await medMappe(async (dir) => {
    const hermes = createFakeAgent();
    const runs = createRunRegistry(hermes, { pause: lavPause(dir) });
    await runs.stopAlle(EJER.id);
    assert.equal(runs.paaPause(), true);
    assert.throws(() => startEn(runs), (e: unknown) => e instanceof PauseFejl && e.message === PAUSE_TEKST);
    assert.throws(() => runs.local('gem', async () => ({})), PauseFejl);
    assert.equal(PAUSE_TEKST, 'Clawco er sat på pause');
    assert.equal(hermes.calls.length, 0);
  });
});

test('the pause survives a new registry on the same data dir (a restart), and is written atomically to pause.json', async () => {
  await medMappe(async (dir) => {
    const foerste = createRunRegistry(createFakeAgent(), { pause: lavPause(dir) });
    await foerste.stopAlle(MEDLEM.id);
    const fil = JSON.parse(await readFile(path.join(dir, 'pause.json'), 'utf8')) as { pause: boolean; tid: string; person: string };
    assert.equal(fil.pause, true);
    assert.equal(fil.person, 'maja');
    assert.ok(!Number.isNaN(Date.parse(fil.tid)));

    const anden = createRunRegistry(createFakeAgent(), { pause: lavPause(dir) });
    assert.equal(anden.paaPause(), true);
    assert.throws(() => startEn(anden), PauseFejl);
  });
});

test('fail-safe: no pause.json = running; an unreadable pause.json = paused', async () => {
  await medMappe(async (dir) => {
    assert.equal(lavPause(dir).erPaaPause(), false);
    await writeFile(path.join(dir, 'pause.json'), '{ ikke json');
    assert.equal(lavPause(dir).erPaaPause(), true);
    await writeFile(path.join(dir, 'pause.json'), JSON.stringify({ pause: 'nej' }));
    assert.equal(lavPause(dir).erPaaPause(), true);
  });
});

test('resume is owner-only; stop is any non-guest; each stop and resume is exactly one audit line', async () => {
  await medMappe(async (dir) => {
    const runs = createRunRegistry(createFakeAgent(), { pause: lavPause(dir) });
    const revision = lavRevisionslog(dir);

    await assert.rejects(stopAlt({ runs, revision, person: GAEST, kanal: 'knap' }), NodstopNaegtet);
    assert.equal(runs.paaPause(), false);

    await stopAlt({ runs, revision, person: BARN, kanal: 'knap' });
    assert.equal(runs.paaPause(), true);
    await assert.rejects(startIgen({ runs, revision, person: MEDLEM, kanal: 'knap' }), NodstopNaegtet);
    await assert.rejects(startIgen({ runs, revision, person: BARN, kanal: 'knap' }), NodstopNaegtet);
    assert.equal(runs.paaPause(), true);

    await startIgen({ runs, revision, person: EJER, kanal: 'knap' });
    assert.equal(runs.paaPause(), false);
    const run = startEn(runs);
    assert.equal((await run.finished).status, 'done');

    const linjer = await revision.seneste();
    assert.deepEqual(linjer.map((e) => [e.udfald, e.person, e.kilde]), [['genoptag', 'henrik', 'nodstop'], ['stop', 'ella', 'nodstop']]);
    assert.deepEqual(await revision.tjekKaede(), { ok: true });
    // A new registry after the resume starts unpaused.
    assert.equal(createRunRegistry(createFakeAgent(), { pause: lavPause(dir) }).paaPause(), false);
  });
});

test('the scheduler skips its due rooms while paused', async () => {
  const hhmm = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('.', ':');
  const nu = new Date();
  const spec = [{ room: 'mail', tider: [hhmm(nu), hhmm(new Date(nu.getTime() + 60_000))] }];
  let pause = true;
  const due: string[] = [];
  const stop = startScheduler(spec, (r) => due.push(r), 5, () => !pause);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(due, [], 'nothing fires while paused');
  pause = false;
  await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.deepEqual(due, ['mail'], 'it fires once the pause is lifted');
});
