// KC-0149 end to end: a request (forespørgsel) through createApp. Both parties
// see it (recipient: Kræver dig with the blue Ja; asker: I gang, red to ask),
// a third member sees nothing until it is accepted and in the shared week,
// only a party's tap moves it (403 for anyone else), Hermes' suggestion can
// never move it, a double tap is one transition, the clock reminds and expires.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { HusstandState } from '../src/hushold/schema.ts';
import type { LogEntry } from '../src/store/types.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-foresp-'));
after(() => rm(rod, { recursive: true, force: true }));

const START = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const IB = { id: 'ib', login: 'ib@example.com', navn: 'Ib', rolle: 'medlem' as const };
type Hvem = typeof HENRIK | typeof MAJA | typeof IB;

/** Hermes answers the suggestion run with a hostile answer: a state, a verdict and an id beside the advice. */
const OND = '```json\n{"tilstand":"accepteret","svar":"ja","id":"x","anbefaling":"Torsdag ser fri ud.","alternativer":[{"kl":"16:30","tekst":"Kan 16.30"}]}\n```';

async function lav(navn: string) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [HENRIK, MAJA, IB] });
  let ur = START;
  const kald: AgentRunRequest[] = [];
  const store = createFileStore(dataDir);
  const a = createApp({
    store, hermes: createFakeAgent({ answer: (req) => { kald.push(req); return OND; } }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => ur,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent',
  });
  const req = (p: Hvem, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Tailscale-User-Login': p.login, 'content-type': 'application/json' } }, LOOPBACK);
  const side = async (p: Hvem, sti = '/rum/husstand') => (await req(p, sti)).text();
  /** A red button: a one-time yes first, then the action with the token. */
  const aktion = async (p: Hvem, navn: string, body: Record<string, unknown>, medJa = false) => {
    let b = body;
    if (medJa) {
      const ja = (await (await req(p, '/api/graense/ja', { method: 'POST', body: JSON.stringify({ rum: 'husstand', slags: 'aktion', id: navn, body }) })).json()) as { ja: string };
      b = { ...body, ja: ja.ja };
    }
    const res = await req(p, `/api/rum/husstand/aktion/${navn}`, { method: 'POST', body: JSON.stringify(b) });
    const j = (await res.json()) as { runId?: string; error?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    return { status: res.status, ...j };
  };
  const state = async () => (await store.readState<HusstandState>('husstand'))!;
  const log = async () => store.readLog('husstand', 200);
  return { ...a, req, side, aktion, state, log, kald, raa: () => store.readState<unknown>('husstand'), saetUr: (d: Date) => { ur = d; } };
}

const TORSDAG = { dag: '2026-11-05', start: '16:00', slut: '17:00' };
const spoerg = (a: Awaited<ReturnType<typeof lav>>, extra: Record<string, unknown> = {}) =>
  a.aktion(HENRIK, 'opret', { til: 'maja', titel: 'Kan du tage Nora torsdag?', ...TORSDAG, ...extra }, true);
const foersteId = async (a: Awaited<ReturnType<typeof lav>>) => (await a.state()).forespoergsler[0]!.id;

test('asking is red: without a yes nothing is created; with one, a request spurgt and a private log line per party', async () => {
  const a = await lav('opret');
  const uden = await a.aktion(HENRIK, 'opret', { til: 'maja', titel: 'Kan du tage Nora torsdag?', ...TORSDAG });
  assert.equal(uden.status, 403);
  assert.equal(await a.raa(), null);
  const r = await spoerg(a);
  assert.equal(r.status, 202, r.error);
  const s = await a.state();
  assert.equal(s.forespoergsler.length, 1);
  const f = s.forespoergsler[0]!;
  assert.deepEqual([f.fra, f.til, f.tilstand], ['henrik', 'maja', 'spurgt']);
  assert.equal(f.udloeber, '2026-11-04T08:00:00.000Z', '48 h, sooner than Thursday 16.00');
  const linjer = (await a.log()).filter((e) => !e.graense);
  assert.deepEqual(linjer.map((e) => [e.zone, e.ejer]).sort(), [['privat', 'henrik'], ['privat', 'maja']]);
  assert.ok(linjer.every((e) => e.kilde === 'henrik'));
});

test('the create input is validated: a guest, oneself, an unknown member, a bad time are refused', async () => {
  const a = await lav('validering');
  for (const b of [{ til: 'henrik' }, { til: 'nogen' }, { til: 'maja', titel: '' }, { til: 'maja', dag: '2026-11-05', start: '17:00', slut: '16:00' }, { til: 'maja', dag: '2026-10-01', start: '16:00', slut: '17:00' }]) {
    const r = await a.aktion(HENRIK, 'opret', { titel: 'Hjælp', ...b }, true);
    assert.equal(r.status, 400, JSON.stringify(b));
  }
});

test('visibility: the recipient has the blue Ja, the asker waits, a third member sees nothing', async () => {
  const a = await lav('synlig');
  await spoerg(a);
  const maja = await a.side(MAJA);
  assert.match(maja, /data-blok="forespoergsel"/);
  assert.match(maja, /class="btn btn-primary" data-aktion="svar" data-arg="[^"]*&quot;svar&quot;:&quot;ja&quot;/);
  assert.match(maja, /Henrik spørger dig/);
  const henrik = await a.side(HENRIK);
  assert.match(henrik, /Maja har ikke svaret endnu/);
  assert.doesNotMatch(henrik.slice(henrik.indexOf('data-foresp-sektion')), /btn-primary" data-aktion="svar/);
  const ib = await a.side(IB);
  assert.doesNotMatch(ib, /data-foresp="/);
  assert.doesNotMatch(ib, /Nora torsdag/);
  // Nu: Kræver dig for Maja, I gang for Henrik, nothing for Ib.
  assert.match(await a.side(MAJA, '/rum/hjem'), /Henrik spørger: Kan du tage Nora torsdag\?/);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /data-gruppe="Venter på andre"[\s\S]*?Maja har ikke svaret endnu: Kan du tage Nora torsdag\?/);
  assert.doesNotMatch(await a.side(IB, '/rum/hjem'), /Nora torsdag/);
});

test('only a party on their turn moves it: a third member and the asker get 403, an unknown id 404', async () => {
  const a = await lav('403');
  await spoerg(a);
  const id = await foersteId(a);
  assert.equal((await a.aktion(IB, 'svar', { id, svar: 'ja' })).status, 403);
  assert.equal((await a.aktion(IB, 'traek', { id })).status, 403);
  assert.equal((await a.aktion(HENRIK, 'svar', { id, svar: 'ja' })).status, 403);
  assert.equal((await a.aktion(MAJA, 'svar', { id: 'findes-ikke', svar: 'ja' })).status, 404);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'maaske' })).status, 400);
  assert.equal((await a.state()).forespoergsler[0]!.tilstand, 'spurgt');
});

test('Hermes\' suggestion is stored as advice only: its "accepteret" never moves the request', async () => {
  const a = await lav('hermes');
  await spoerg(a);
  assert.equal(a.kald.length, 1, 'one suggestion run');
  assert.match(a.kald[0]!.instructions, /neutral/);
  const f = (await a.state()).forespoergsler[0]!;
  assert.equal(f.tilstand, 'spurgt');
  assert.deepEqual(f.forslag, { anbefaling: 'Torsdag ser fri ud.', alternativer: [{ kl: '16:30', tekst: 'Kan 16.30' }] });
  assert.equal(f.historik.length, 1);
  assert.match(await a.side(MAJA), /data-arg="[^"]*&quot;kl&quot;:&quot;16:30&quot;[^"]*">Kan 16.30</);
});

test('a double tap is one transition; a different answer after it is 409', async () => {
  const a = await lav('dobbelt');
  await spoerg(a);
  const id = await foersteId(a);
  const [x, y] = await Promise.all([a.aktion(MAJA, 'svar', { id, svar: 'ja' }), a.aktion(MAJA, 'svar', { id, svar: 'ja' })]);
  assert.deepEqual([x.status, y.status], [202, 202]);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'ja' })).status, 202, 'later still the same answer: no change');
  const f = (await a.state()).forespoergsler[0]!;
  assert.equal(f.tilstand, 'accepteret');
  assert.equal(f.historik.length, 2);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'nej' })).status, 409);
});

test('accepted: in the shared week for everyone (Ib too), a .ics for each party, and fortryd takes it out again', async () => {
  const a = await lav('accept');
  await spoerg(a);
  const id = await foersteId(a);
  await a.aktion(MAJA, 'svar', { id, svar: 'ja' });
  const ib = await a.side(IB);
  assert.match(ib, /data-post-kilde="aftale"[^>]*>[\s\S]*?Kan du tage Nora torsdag\?/);
  assert.doesNotMatch(ib, /data-foresp="/, 'the third member sees the agreement, not the request');
  const maja = await a.side(MAJA);
  assert.match(maja, /href="\/rum\/husstand\/dok\/aftale-[a-z0-9-]+\.ics"/);
  const ics = await a.req(MAJA, `/rum/husstand/dok/aftale-${id}.ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type') ?? '', /text\/calendar/);
  const tekst = await ics.text();
  assert.match(tekst, /BEGIN:VEVENT[\s\S]*DTSTART:20261105T150000Z[\s\S]*SUMMARY:Kan du tage Nora torsdag\?/);
  assert.doesNotMatch(await a.side(MAJA), /Læg i din kalender/, 'taken: the card is gone for Maja');
  assert.match(await a.side(HENRIK), /Læg i din kalender/, 'still there for Henrik');
  assert.equal((await a.req(IB, `/rum/husstand/dok/aftale-${id}.ics`)).status, 404, 'not a party: no file');
  // Fortryd: Maja's line of her answer; Henrik cannot undo it.
  const linje = (await a.log()).find((e: LogEntry) => e.ejer === 'maja' && e.fortryd && /sagde ja/i.test(e.tekst));
  assert.ok(linje, 'Maja\'s answer is a line with fortryd');
  assert.equal((await a.req(HENRIK, `/api/rum/husstand/log/${linje.id}/fortryd`, { method: 'POST', body: '{}' })).status, 404);
  assert.match(await a.side(MAJA), new RegExp(`data-fortryd="${linje.id}"`));
  const res = await a.req(MAJA, `/api/rum/husstand/log/${linje.id}/fortryd`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 202);
  await a.runs.get(((await res.json()) as { runId: string }).runId)?.finished;
  assert.equal((await a.state()).forespoergsler[0]!.tilstand, 'spurgt');
  assert.doesNotMatch(await a.side(IB), /Nora torsdag/, 'out of the shared week again');
  assert.ok((await a.log()).find((e) => e.id === linje.id)?.fortrudt);
});

test('an alternative: the recipient proposes 16.30, the asker gets the blue Tag imod, the week shows the new time', async () => {
  const a = await lav('alternativ');
  await spoerg(a);
  const id = await foersteId(a);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'alternativ', kl: 'ikke en tid' })).status, 400);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'alternativ', kl: '16.30' })).status, 202);
  const henrik = await a.side(HENRIK);
  assert.match(henrik, /class="btn btn-primary" data-aktion="svar" data-arg="[^"]*tag-imod/);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Maja foreslår et andet tidspunkt: Kan du tage Nora torsdag\?/);
  assert.equal((await a.aktion(HENRIK, 'svar', { id, svar: 'tag-imod' })).status, 202);
  assert.match(await a.side(IB), /16\.30–17\.30<\/span> Kan du tage Nora torsdag\?/);
});

test('the clock: a reminder to the decider at 24 h before expiry, then expiry; the asker can ask again or drop', async () => {
  const a = await lav('ur');
  await spoerg(a);
  a.saetUr(new Date('2026-11-03T09:00:00Z'));
  await a.tikNu();
  const f1 = (await a.state()).forespoergsler[0]!;
  assert.deepEqual(f1.paamindet, ['maja:24t']);
  assert.match(await a.side(MAJA, '/rum/hjem'), /Påmindelse: Henrik spørger: Kan du tage Nora torsdag\?/);
  a.saetUr(new Date('2026-11-04T08:00:00Z'));
  await a.tikNu();
  const f2 = (await a.state()).forespoergsler[0]!;
  assert.equal(f2.tilstand, 'udloebet');
  assert.equal(f2.historik.at(-1)?.af, 'ur');
  const henrik = await a.side(HENRIK);
  assert.match(henrik, /Ingen svar fra Maja: spørg igen eller drop/);
  assert.match(henrik, /class="btn btn-graense" data-aktion="spoerg-igen"[^>]*data-kraever-ja/);
  assert.match(await a.side(HENRIK, '/rum/hjem'), /Ingen svar fra Maja: Kan du tage Nora torsdag\?/);
  assert.equal((await a.aktion(HENRIK, 'spoerg-igen', { id: f2.id })).status, 403, 'asking again is red');
  assert.equal((await a.aktion(HENRIK, 'spoerg-igen', { id: f2.id }, true)).status, 202);
  const s = await a.state();
  assert.equal(s.forespoergsler.length, 2);
  assert.ok(s.forespoergsler.find((x) => x.id === f2.id)?.lukket, 'the old card is gone');
  const ny = s.forespoergsler.find((x) => x.id !== f2.id)!;
  assert.equal(ny.tilstand, 'spurgt');
  assert.equal(ny.udloeber, '2026-11-05T15:00:00.000Z', 'sooner than 48 h: Thursday 16.00');
  assert.equal((await a.aktion(HENRIK, 'drop', { id: ny.id })).status, 409, 'drop only an expired one');
});

test('withdraw: the asker pulls it back; a pulled request is final for the recipient', async () => {
  const a = await lav('traek');
  await spoerg(a);
  const id = await foersteId(a);
  assert.equal((await a.aktion(HENRIK, 'traek', { id })).status, 202);
  const f = (await a.state()).forespoergsler[0]!;
  assert.deepEqual([f.tilstand, f.aarsag], ['udloebet', 'trukket']);
  assert.match(await a.side(MAJA), /Henrik trak forespørgslen tilbage/);
  assert.equal((await a.aktion(MAJA, 'svar', { id, svar: 'ja' })).status, 409);
});
