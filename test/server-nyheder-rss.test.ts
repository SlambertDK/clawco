// KC-0137: the connector behind the registry feeds the room Nyheder. Connect through the route, and the Hermes
// refresh carries the feed's items; an install without feeds (or with a dead one) is not asked to fetch anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, standardFrontload } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { nyhederRss } from '../src/kilder/nyheder-rss/kilde.ts';
import { HentFejl } from '../src/kilder/nyheder-rss/hent.ts';
import type { Person } from '../src/identitet/husstand.ts';
import { falskHenter, rss, type Svar } from './kilder/nyheder-rss/hjaelp.ts';

const NOW = new Date('2026-11-01T07:10:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const FEED = 'https://min-feed.example/rss';
const SVAR = { femLinjer: ['a', 'b', 'c', 'd', 'e'], baner: [{ navn: 'Mine', nyheder: [{ titel: 'Nordvik får grønt lys', hvorfor: 'Fra min feed.', kilde: 'Min avis', url: 'https://min-feed.example/1' }] }], forslag: [], hermesStatus: 'Følger mine kilder' };

async function medApp(tabel: Record<string, Svar>, fn: (s: ReturnType<typeof createApp> & { kald: AgentRunRequest[]; dir: string }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-ny-rss-'));
  const hermes = createFakeAgent({ answer: (req) => (req.instructions.includes('Svar med præcis dette skema') ? '```json\n' + JSON.stringify(SVAR) + '\n```' : 'ok') });
  try {
    const app = createApp({
      store: createFileStore(dir), hermes, sourceGlob: path.join(dir, 'ingen-{date}.json'), dataDir: dir, now: () => NOW, identitet: { fast: EJER },
      mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent',
      kilder: [nyhederRss({ dataDir: dir, hent: falskHenter(tabel) })],
    });
    try { await fn({ ...app, kald: hermes.calls, dir }); } finally {
      await Promise.all(app.runs.list().map((r) => r.finished.catch(() => null)));
      await new Promise((res) => setTimeout(res, 50));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const post = (s: { app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> } }, url: string, body: unknown = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const nyhederKald = (kald: AgentRunRequest[]): AgentRunRequest[] => kald.filter((k) => k.instructions.includes('rummet "Nyheder"') && k.instructions.includes('Svar med præcis dette skema'));

test('connecting a feed builds Nyheder from it: the refresh run carries the feed\'s items and the room stores Hermes\' answer', async () => {
  await medApp({ [FEED]: { tekst: rss('Min avis', [['Nordvik får grønt lys', 'https://min-feed.example/1', '2026-11-01T05:00:00Z', 'Kabelkorridoren godkendes.']]) } }, async (s) => {
    const r = await post(s, '/api/kilder/nyheder-rss/forbind', { felter: { adresser: FEED } });
    assert.equal(r.status, 200, await r.clone().text());
    await new Promise((res) => setTimeout(res, 100));
    await Promise.all(s.runs.list().map((x) => x.finished.catch(() => null)));
    const kald = nyhederKald(s.kald);
    assert.equal(kald.length, 1);
    assert.match(kald[0]?.input ?? '', /Nordvik får grønt lys/);
    assert.match(kald[0]?.input ?? '', /Kabelkorridoren godkendes\./);
    assert.match(await (await s.app.request('/rum/nyheder')).text(), /Følger mine kilder/);
  });
});

test('without any feed connected the room is as before: Opdatér asks Hermes to fetch the paper itself', async () => {
  await medApp({}, async (s) => {
    const res = await post(s, '/api/rum/nyheder/opdater', { mode: 'opdater' });
    assert.equal(res.status, 202);
    await Promise.all(s.runs.list().map((x) => x.finished.catch(() => null)));
    assert.match(s.kald.at(-1)?.instructions ?? '', /morgenavis_cron\.py/);
  });
});

test('a connected feed that cannot be read builds nothing and never sends Hermes after the old paper', async () => {
  const tabel: Record<string, Svar> = { [FEED]: { tekst: rss('Min avis', [['X', 'https://min-feed.example/1']]) } };
  await medApp(tabel, async (s) => {
    await post(s, '/api/kilder/nyheder-rss/forbind', { felter: { adresser: FEED } });
    await Promise.all(s.runs.list().map((x) => x.finished.catch(() => null)));
    const foer = nyhederKald(s.kald).length;
    tabel[FEED] = new HentFejl('net', 'Kilden kunne ikke nås.');
    const res = await post(s, '/api/rum/nyheder/opdater', { mode: 'opdater' });
    assert.equal(res.status, 400);
    assert.equal(nyhederKald(s.kald).length, foer, 'no Nyheder run was started');
    assert.ok(!s.kald.some((k) => k.instructions.includes('morgenavis_cron')), 'Hermes was never sent after the paper');
    assert.equal(await s.bygPlanlagt('nyheder'), false);
  });
});

test('planned rebuild: nothing connected and no morning paper means no run; a connected feed means one', async () => {
  await medApp({ [FEED]: { tekst: rss('Min avis', [['X', 'https://min-feed.example/1']]) } }, async (s) => {
    assert.equal(await s.bygPlanlagt('nyheder'), false, 'nothing connected');
    assert.equal(nyhederKald(s.kald).length, 0);
    await post(s, '/api/kilder/nyheder-rss/forbind', { felter: { adresser: FEED } });
    await Promise.all(s.runs.list().map((x) => x.finished.catch(() => null)));
    const foer = nyhederKald(s.kald).length;
    assert.equal(await s.bygPlanlagt('nyheder'), true);
    await Promise.all(s.runs.list().map((x) => x.finished.catch(() => null)));
    assert.equal(nyhederKald(s.kald).length, foer + 1);
  });
});

test('standardFrontload adds the morning rebuild of Nyheder only where there is no morning paper of its own', () => {
  assert.equal(standardFrontload({}), 'mail=06:50,12:00,17:00;nyheder=07:08');
  assert.equal(standardFrontload({ KC_DAGEN_SOURCE_GLOB: '/tmp/avis_data_{date}.json' }), 'mail=06:50,12:00,17:00');
});
