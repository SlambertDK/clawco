// KC-0235: the Aula reader in the app — offered after the other sources, connected through the card's route (the link goes
// to the secret store only), read into the household's week (zone husstand), and never hiding the host's own calendar in
// Dagen: a household-zone source belongs to the shared week, a personal calendar of the host still builds the day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, medAulaKalender } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { aulaKalender, AULA_KALENDER_ID } from '../src/kilder/aula-kalender/kilde.ts';
import { kiraKalender } from '../src/kilder/legacy/legacy.ts';
import type { Kilde } from '../src/kilder/types.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { falskHenter, ics, LINK, TOKEN } from './kilder/aula-kalender/hjaelp.ts';

const NOW = new Date('2026-10-31T07:00:00Z');
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

type App = ReturnType<typeof createApp>;
async function medApp(fn: (o: { sut: App; hermes: ReturnType<typeof createFakeAgent>; dir: string }) => Promise<void>, ekstra: Kilde[] = []): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-aula-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    await rejsenFaerdig(store);
    const hermes = createFakeAgent({ answer: () => 'Ingen JSON.' });
    const sut = createApp({
      store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir: dir, now: () => NOW,
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent',
      kilder: [...ekstra, aulaKalender({ hent: falskHenter({ tekst: ics() }) })],
    });
    await fn({ sut, hermes, dir });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (sut: App, url: string, body: unknown = {}) => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('medAulaKalender: offered after the others, once', () => {
  const kira = kiraKalender({ script: '/x.py', run: async () => ({ code: 1, stdout: '', stderr: '' }) });
  assert.deepEqual(medAulaKalender([kira], () => aulaKalender()).map((k) => k.id), ['kira-kalender', AULA_KALENDER_ID]);
});

test('the card\'s route connects with the link: the answer, kilder.json and the overview never carry it; the secret file does; the zone is husstand', async () => {
  await medApp(async ({ sut, dir }) => {
    const r = await post(sut, `/api/kilder/${AULA_KALENDER_ID}/forbind`, { felter: { link: LINK } });
    assert.equal(r.status, 200);
    const svar = await r.text();
    assert.match(svar, /"forbundet":true/);
    const oversigt = await (await sut.app.request('/api/kilder')).text();
    const json = await readFile(path.join(dir, 'kilder.json'), 'utf8');
    for (const t of [svar, oversigt, json]) assert.ok(!t.includes(TOKEN));
    assert.match(await readFile(path.join(dir, 'hemmeligheder', `${AULA_KALENDER_ID}.json`), 'utf8'), new RegExp(TOKEN));
    const o = ((JSON.parse(oversigt) as { kilder: { id: string; zone: string; forbundet: boolean; helbred: { status: string } | null }[] }).kilder).find((k) => k.id === AULA_KALENDER_ID)!;
    assert.deepEqual([o.zone, o.forbundet, o.helbred?.status], ['husstand', true, 'ok']);
  });
});

test('a link that is not an Aula link is refused with 400 and nothing is connected', async () => {
  await medApp(async ({ sut, dir }) => {
    for (const link of ['https://example.com/kalender.ics', 'http://www.aula.dk/x', 'https://www.aula.dk.evil.example/x']) {
      const r = await post(sut, `/api/kilder/${AULA_KALENDER_ID}/forbind`, { felter: { link } });
      assert.equal(r.status, 400, link);
      assert.ok(!(await r.text()).includes('evil.example'));
    }
    await assert.rejects(readFile(path.join(dir, 'kilder.json'), 'utf8'));
  });
});

test('Dagen: the host\'s own calendar still builds the day when Aula is connected (a household source never hides it)', async () => {
  const kira: Kilde = { ...kiraKalender({ script: '/nonexistent/kalender_uge.py', run: async () => ({ code: 0, stdout: JSON.stringify({ generated: '', days: [{ date: '2026-10-31', events: [{ title: 'Fra Kira', start: '2026-10-31T09:00:00+01:00' }] }], errors: [] }), stderr: '' }) }), helbred: async () => ({ status: 'ok' }) };
  await medApp(async ({ sut, hermes, dir }) => {
    await copyFile(path.join(FIX, 'avis_data_sample.json'), path.join(dir, 'avis_2026-10-31.json'));
    assert.equal((await post(sut, `/api/kilder/${AULA_KALENDER_ID}/forbind`, { felter: { link: LINK } })).status, 200);
    const { runId } = (await (await post(sut, '/api/rum/dagen/opdater', { mode: 'opdater' })).json()) as { runId: string };
    await sut.runs.get(runId)!.finished;
    const input = hermes.calls[0]!.input;
    assert.match(input, /Fra Kira/);
    assert.doesNotMatch(input, /Forældremøde i 2\.B/);
  }, [kira]);
});
