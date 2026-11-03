// KC-0269: the roles hold all the way round. A member or a guest never reads the owner's private things (chat
// history, Skrive's documents, the owner's runs), never changes the
// settings, never uses the voice without the right to act, and never feeds the Claude Code worker. The matrix is
// src/identitet/roller.ts; this file holds the routes the review (A5–A11) found asking nobody.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand, type Person } from '../src/identitet/husstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-roller-laes-'));
after(() => rm(rod, { recursive: true, force: true }));
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const EJER: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' };
const GAEST: Person = { id: 'gaest', login: 'gaest@example.com', navn: 'Gæst', rolle: 'gaest' };
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };

async function lav(navn: string) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [EJER, MEDLEM, GAEST] });
  const store = createFileStore(dataDir);
  const a = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', ...noMail });
  const req = (p: Person, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { 'Tailscale-User-Login': p.login!, 'Tailscale-User-Name': p.navn, 'content-type': 'application/json' } }, LOOPBACK);
  const post = (p: Person, sti: string, body: Record<string, unknown> = {}) => req(p, sti, { method: 'POST', body: JSON.stringify(body) });
  return { ...a, store, dataDir, req, post };
}

test('A5: Send til Claude Code (the worker that runs claude -p) is the owner\'s alone, reads included', async () => {
  const a = await lav('udvikling');
  for (const p of [MEDLEM, GAEST]) {
    assert.equal((await a.post(p, '/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'gør noget' })).status, 403, `${p.rolle} send`);
    assert.equal((await a.req(p, '/api/udvikling/opgaver?repo=SlambertDK/kontrolcenter')).status, 403, `${p.rolle} list`);
    assert.equal((await a.post(p, '/api/udvikling/opgaver/op-x/status', { status: 'done' })).status, 403, `${p.rolle} status`);
    assert.equal((await a.post(p, '/api/udvikling/opgaver/op-x/svar', { svar: 'ja' })).status, 403, `${p.rolle} svar`);
    assert.equal((await a.req(p, '/api/udvikling/projekter')).status, 403, `${p.rolle} projekter`);
  }
  const egen = await a.post(EJER, '/api/udvikling/opgaver', { projekt: 'kontrolcenter', saetning: 'gør noget' });
  assert.equal(egen.status, 201);
});

test('A9: the settings (models, voice) change only for the owner, and a non-string tier is 400, never 500', async () => {
  const a = await lav('indstillinger');
  for (const p of [MEDLEM, GAEST]) assert.equal((await a.post(p, '/api/indstillinger', { modeller: { lille: 'x-model' } })).status, 403, p.rolle);
  assert.equal((await a.post(EJER, '/api/indstillinger', { modeller: { lille: 'x-model' } })).status, 200);
  assert.equal((await a.post(EJER, '/api/indstillinger', { modeller: { lille: 5 } })).status, 400);
  const s = (await (await a.req(EJER, '/api/indstillinger')).json()) as { modeller: Record<string, string> };
  assert.equal(s.modeller['lille'], 'x-model', 'the bad body changed nothing');
});

test('A6: the chat history is each person\'s own; the owner\'s lines never render for a member or a guest', async () => {
  const a = await lav('chat');
  await a.store.appendChat('hjem', { fra: 'henrik', tekst: 'OWNER-PRIVATE-CHAT-Q' });
  await a.store.appendChat('hjem', { fra: 'hermes', tekst: 'OWNER-PRIVATE-CHAT-A' });
  await a.store.appendChat('hjem', { fra: 'henrik', tekst: 'MAJAS-EGEN-LINJE', ejer: MEDLEM.id });
  await a.store.appendChat('mail', { fra: 'hermes', tekst: 'OWNER-PRIVATE-MAIL-CHAT' });
  const ejer = await (await a.req(EJER, '/rum/hjem')).text();
  assert.ok(ejer.includes('OWNER-PRIVATE-CHAT-Q') && ejer.includes('OWNER-PRIVATE-CHAT-A'), 'the owner sees his own');
  assert.ok(!ejer.includes('MAJAS-EGEN-LINJE'), 'and not the member\'s');
  const medlem = await (await a.req(MEDLEM, '/rum/hjem')).text();
  assert.ok(!medlem.includes('OWNER-PRIVATE-CHAT'), 'a member never sees the owner\'s chat');
  assert.ok(medlem.includes('MAJAS-EGEN-LINJE'), 'but her own');
  const gaest = await (await a.req(GAEST, '/rum/hjem')).text();
  assert.ok(!gaest.includes('OWNER-PRIVATE-CHAT') && !gaest.includes('MAJAS-EGEN-LINJE'));
  const mail = await (await a.req(MEDLEM, '/rum/mail')).text();
  assert.ok(!mail.includes('OWNER-PRIVATE-MAIL-CHAT'), 'the mail room\'s chat is the owner\'s too');
  // A line a member writes is recorded as hers, so she sees it next time and the owner does not.
  const r = await a.post(MEDLEM, '/api/rum/hjem/chat', { besked: 'MAJA-SPOERGER-NU', aabn: true });
  assert.ok([200, 202].includes(r.status), String(r.status));
  const j = (await r.json()) as { runId?: string };
  if (j.runId) await a.runs.get(j.runId)?.finished;
  const linjer = await a.store.readChat('hjem', 50);
  const hendes = linjer.find((e) => e.tekst === 'MAJA-SPOERGER-NU');
  assert.equal(hendes?.ejer, MEDLEM.id, 'recorded with her id');
});

test('A7: Skrive is the owner\'s private room: a member or a guest sees no document, cannot fetch one and cannot run Hermes on it', async () => {
  const a = await lav('skrive');
  await a.store.writeState('skrive', { dokumenter: [{ id: 'dok-a1', titel: 'OWNER-SECRET-DOC', brief: 'b', afsnit: [], kilder: [], oprettet: '2026-11-01T08:00:00.000Z' }], aktivt: 'dok-a1', forslag: [], hermesStatus: '' });
  assert.ok((await (await a.req(EJER, '/rum/skrive')).text()).includes('OWNER-SECRET-DOC'));
  for (const p of [MEDLEM, GAEST]) {
    const side = await a.req(p, '/rum/skrive');
    assert.ok(!(await side.text()).includes('OWNER-SECRET-DOC'), `${p.rolle} page`);
    const frag = await a.req(p, '/api/rum/skrive/fragment');
    assert.ok(!(await frag.text()).includes('OWNER-SECRET-DOC'), `${p.rolle} fragment`);
    assert.equal((await a.req(p, '/rum/skrive/dok/dok-a1.md')).status, 404, `${p.rolle} dok`);
    assert.equal((await a.post(p, '/api/rum/skrive/aktion/nyt', { titel: 'x', brief: 'y' })).status, 403, `${p.rolle} nyt`);
  }
  assert.equal((await a.req(EJER, '/rum/skrive/dok/dok-a1.md')).status, 200);
});

test('A10: a run\'s events and the live feed reach only whom the run is visible to', async () => {
  const a = await lav('koersler');
  const r = await a.post(EJER, '/api/rum/hjem/chat', { besked: 'OWNER-RUN' });
  const { runId } = (await r.json()) as { runId: string };
  assert.ok(runId);
  assert.equal((await a.req(MEDLEM, `/api/runs/${runId}/events`)).status, 403);
  assert.equal((await a.req(GAEST, `/api/runs/${runId}/events`)).status, 403);
  await a.runs.get(runId)?.finished;
  // The live feed: a member subscribed while the owner's run finishes never gets its run.done.
  const live = await a.req(MEDLEM, '/api/live');
  assert.equal(live.status, 200);
  const reader = live.body!.getReader();
  const r2 = await a.post(EJER, '/api/rum/hjem/chat', { besked: 'OWNER-RUN-2' });
  const id2 = ((await r2.json()) as { runId: string }).runId;
  await a.runs.get(id2)?.finished;
  let set = '';
  const dec = new TextDecoder();
  const frist = Date.now() + 400;
  while (Date.now() < frist) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value?: undefined }>((res) => setTimeout(() => res({ done: true }), 150))]);
    if (chunk.done) break;
    set += dec.decode(chunk.value);
  }
  await reader.cancel();
  assert.ok(set.includes('event: hello'), set);
  assert.ok(!set.includes('run.done'), `the owner's run leaked: ${set}`);
});

test('A11: the voice needs the right to act: a guest is refused before anything else, a member reaches the route', async () => {
  const a = await lav('stemme');
  assert.equal((await a.post(GAEST, '/api/stemme/sig', { tekst: 'hej' })).status, 403);
  assert.equal((await a.req(GAEST, '/api/stemme/oversigt')).status, 403);
  assert.equal((await a.post(MEDLEM, '/api/stemme/sig', { tekst: 'hej' })).status, 503, 'no voice configured in this test: the route itself answers');
});

test('A10 (situation): the meeting that calls on the owner now is his; a member or a guest gets no title, in the API or on the page', async () => {
  const { opretUnivers, endreUnivers, universRum } = await import('../src/rooms/univers/lager.ts');
  const dataDir = path.join(rod, 'situation');
  await skrivHusstand(dataDir, { personer: [EJER, MEDLEM, GAEST] });
  const store = createFileStore(dataDir);
  const NU = new Date('2026-11-03T10:00:00.000Z');
  const a = createApp({ store, hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => NU, ...noMail });
  await opretUnivers(store, { navn: 'Min arena', om: 'x' }, NU);
  await endreUnivers(store, universRum('min-arena'), (s) => ({ ...s, moeder: [{ id: 'moede-1', kilde: 'manuel', titel: 'OWNER-SECRET-MEETING', start: '2026-11-03T10:00:00.000Z', slut: '2026-11-03T11:00:00.000Z', deltagere: [] }] }));
  const som = (p: Person, sti: string) => a.app.request(sti, { headers: { 'Tailscale-User-Login': p.login!, 'Tailscale-User-Name': p.navn } }, LOOPBACK);
  const ejer = (await (await som(EJER, '/api/situation')).json()) as { moede: { titel: string } | null };
  assert.equal(ejer.moede?.titel, 'OWNER-SECRET-MEETING');
  for (const p of [MEDLEM, GAEST]) {
    const j = (await (await som(p, '/api/situation')).json()) as { moede: unknown };
    assert.equal(j.moede, null, `${p.rolle} api`);
    const side = await som(p, '/moede/min-arena/moede-1');
    assert.ok(!(await side.text()).includes('OWNER-SECRET-MEETING'), `${p.rolle} page`);
  }
});
