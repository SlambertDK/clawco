// KC-0133: "Log ind med Google" end to end through the HTTP routes, against the
// in-process fake Google: forbind answers Google's consent URL (read-only
// scope, S256); tilbage with a bad state → 400; the right one connects
// (302), announces the first read, and /api/kilder says ok. Dagen then reads
// the week from the connected calendar — with no morning paper, today's
// events build the day — and a calendar the user connected wins over the
// host's own (legacy) one. Also: the composition rules in main().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, egenAdresse, kalenderScriptFra, medGoogleKalender } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { googleKalender, GOOGLE_KALENDER_ID } from '../src/kilder/google-kalender/kilde.ts';
import { falskGoogle } from '../src/kilder/google/falsk-google.ts';
import { FOERSTE_LAESNING } from '../src/kilder/register.ts';
import { kiraKalender } from '../src/kilder/legacy/legacy.ts';
import type { Kilde } from '../src/kilder/types.ts';
import { rejsenFaerdig } from './fixtures/start.ts';

const NOW = new Date('2026-10-31T07:00:00Z');
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ADR = 'https://kontrol.example.ts.net';
const KLIENT = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-k' };
const ENV = { KC_GOOGLE_CLIENT_ID: KLIENT.id, KC_GOOGLE_CLIENT_SECRET: KLIENT.hemmelighed };
const KALENDERE = () => [{ id: 'ella@example.test', summary: 'Ella', events: [
  { id: 'g1', summary: 'Tandlæge med Ella', start: { dateTime: '2026-10-31T10:00:00+01:00' }, end: { dateTime: '2026-10-31T10:30:00+01:00' } },
  { id: 'g2', summary: 'Fodbold', start: { dateTime: '2026-11-02T17:00:00+01:00' }, end: { dateTime: '2026-11-02T18:00:00+01:00' } },
] }];

type App = ReturnType<typeof createApp>;
async function medApp(fn: (o: { sut: App; g: ReturnType<typeof falskGoogle>; hermes: ReturnType<typeof createFakeAgent>; dir: string }) => Promise<void>, ekstra: Kilde[] = []): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-google-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await rejsenFaerdig(store);
    const g = falskGoogle({ klient: KLIENT, kalendere: KALENDERE });
    const hermes = createFakeAgent({ answer: () => 'Ingen JSON.' });
    const sut = createApp({
      store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir: dir, now: () => NOW, adresse: ADR,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent',
      kilder: [...ekstra, googleKalender({ env: { ...ENV }, adresse: ADR, hent: g.hent })],
    });
    await fn({ sut, g, hermes, dir });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (sut: App, url: string, body: unknown = {}) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const lokal = (url: string): string => { const u = new URL(url); return `${u.pathname}${u.search}`; };

async function logInd(sut: App, g: ReturnType<typeof falskGoogle>): Promise<Response> {
  const { omdiriger } = (await (await post(sut, `/api/kilder/${GOOGLE_KALENDER_ID}/forbind`)).json()) as { omdiriger: string };
  return sut.app.request(lokal(g.samtykke(omdiriger)));
}

test('forbind answers Google\'s consent URL: read-only scope, S256, the redirect address on this app', async () => {
  await medApp(async ({ sut }) => {
    const r = await post(sut, `/api/kilder/${GOOGLE_KALENDER_ID}/forbind`);
    assert.equal(r.status, 200);
    const u = new URL(((await r.json()) as { omdiriger: string }).omdiriger);
    assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('redirect_uri'), `${ADR}/api/kilder/google-kalender/tilbage`);
  });
});

test('tilbage: a bad state is 400; the right one connects, redirects, announces the first read and reads ok', async () => {
  await medApp(async ({ sut, g }) => {
    const signaler: unknown[] = [];
    sut.live.subscribe(FOERSTE_LAESNING, (v) => signaler.push(v));
    assert.equal((await sut.app.request(`/api/kilder/${GOOGLE_KALENDER_ID}/tilbage?state=forkert&code=x`)).status, 400);
    const ok = await logInd(sut, g);
    assert.equal(ok.status, 302);
    assert.equal(signaler.length, 1);
    const k = ((await (await sut.app.request('/api/kilder')).json()) as { kilder: { id: string; forbundet: boolean; helbred: { status: string } | null }[] }).kilder;
    const gk = k.find((x) => x.id === GOOGLE_KALENDER_ID)!;
    assert.equal(gk.forbundet, true);
    assert.equal(gk.helbred?.status, 'ok');
  });
});

test('Dagen without a morning paper builds the day and the week from the connected Google calendar', async () => {
  await medApp(async ({ sut, g, hermes }) => {
    await logInd(sut, g);
    const r = await post(sut, '/api/rum/dagen/opdater', { mode: 'opdater' });
    assert.equal(r.status, 202);
    const { runId } = (await r.json()) as { runId: string };
    await sut.runs.get(runId)!.finished;
    const input = hermes.calls[0]!.input;
    assert.match(input, /Dagens rådata/);
    assert.match(input, /Tandlæge med Ella/, 'today from Google');
    assert.match(input, /Fodbold/, 'the week from Google');
    assert.doesNotMatch(input, /morgenavis_cron/);
  });
});

test('a calendar the user connected wins over the host\'s own (legacy) calendar', async () => {
  const kira = kiraKalender({ script: '/nonexistent/kalender_uge.py', run: async () => ({ code: 0, stdout: JSON.stringify({ generated: '', days: [{ date: '2026-10-31', events: [{ title: 'Fra Kira', start: '2026-10-31T09:00:00+01:00' }] }], errors: [] }), stderr: '' }) });
  // kira-kalender's health checks its script file; point it at this test file so it reads as ok.
  const kiraOk: Kilde = { ...kira, helbred: async () => ({ status: 'ok' }) };
  await medApp(async ({ sut, g, hermes }) => {
    await logInd(sut, g);
    const { runId } = (await (await post(sut, '/api/rum/dagen/opdater', { mode: 'opdater' })).json()) as { runId: string };
    await sut.runs.get(runId)!.finished;
    const input = hermes.calls[0]!.input;
    assert.match(input, /Tandlæge med Ella/);
    assert.doesNotMatch(input, /Fra Kira/);
  }, [kiraOk]);
});

test('Dagen with only the host\'s own calendar: the week through the registry beside the morning paper; no paper → Hermes fetches it, as before', async () => {
  const kira: Kilde = { ...kiraKalender({ script: '/x.py', run: async () => ({ code: 0, stdout: JSON.stringify({ generated: '', days: [{ date: '2026-10-31', events: [{ title: 'Fra Kira', start: '2026-10-31T09:00:00+01:00', all_day: false }] }], errors: [] }), stderr: '' }) }), helbred: async () => ({ status: 'ok' }) };
  await medApp(async ({ sut, hermes, dir }) => {
    const opdater = async () => {
      const { runId } = (await (await post(sut, '/api/rum/dagen/opdater', { mode: 'opdater' })).json()) as { runId: string };
      await sut.runs.get(runId)!.finished;
    };
    await opdater();
    assert.match(hermes.calls[0]!.instructions, /morgenavis_cron/, 'no paper: Hermes fetches it (the host\'s calendar does not build the day)');
    await copyFile(path.join(FIX, 'avis_data_sample.json'), path.join(dir, 'avis_2026-10-31.json'));
    const foer = hermes.calls.length;
    await opdater();
    assert.match(hermes.calls[foer]!.input, /Fra Kira/);
  }, [kira]);
});

test('medGoogleKalender: offered unless the host already connects a calendar of its own', () => {
  const g = () => googleKalender({ env: {} });
  const kira = kiraKalender({ script: '/x.py', run: async () => ({ code: 1, stdout: '', stderr: '' }) });
  assert.deepEqual(medGoogleKalender([], g).map((k) => k.id), [GOOGLE_KALENDER_ID]);
  assert.deepEqual(medGoogleKalender([kira], g).map((k) => k.id), ['kira-kalender']);
});

test('kalenderScriptFra: Kira\'s calendar script only where Kira can read the calendar (KC_KALENDER_SCRIPT or its token script)', () => {
  const rod = '/app';
  assert.equal(kalenderScriptFra({}, 'hermes-http', rod, { kiraToken: true }), '/app/scripts/kalender_uge.py');
  assert.equal(kalenderScriptFra({}, 'hermes-http', rod, { kiraToken: false }), '', 'a product install without Kira gets Google instead');
  assert.equal(kalenderScriptFra({ KC_KALENDER_SCRIPT: '/opt/k.py' }, 'hermes-http', rod, { kiraToken: false }), '/opt/k.py');
  assert.equal(kalenderScriptFra({ KC_KALENDER_SCRIPT: '/opt/k.py' }, 'fake', rod, { kiraToken: true }), '');
});

test('egenAdresse: KC_ADRESSE, else http://localhost:<port> on a loopback host, else none', () => {
  assert.equal(egenAdresse({ KC_ADRESSE: ' https://kontrol.example.ts.net/ ' }, '127.0.0.1', 8750), 'https://kontrol.example.ts.net/');
  assert.equal(egenAdresse({}, '127.0.0.1', 8786), 'http://localhost:8786');
  assert.equal(egenAdresse({}, 'localhost', 8786), 'http://localhost:8786');
  assert.equal(egenAdresse({}, '0.0.0.0', 8786), '');
});
