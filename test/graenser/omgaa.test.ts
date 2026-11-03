// KC-0122: model output cannot bypass the policy layer. Whatever Hermes writes
// can raise a denial, never lift one; the routes answer 403 with the Danish
// reason and the room's log says what Clawco did not do.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDagenState } from '../../src/rooms/dagen/schema.ts';
import { afgoer } from '../../src/graenser/afgoer.ts';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';

const NU = new Date('2026-10-26T06:30:00Z');
const dag = (handling: Record<string, unknown>) => ({
  dato: '2026-10-26', treLinjer: ['a'], anbefaling: { tekst: 'Gør det', handling }, kalender: [], morgenavis: [], hermesStatus: 'Klar',
});

test('a handling that claims "laes" but sends mail runs under the app\'s floor, not the claim', () => {
  const s = parseDagenState(dag({ id: 'x', label: 'Læs', instruktion: 'Send en mail til hele firmaet.', verb: 'laes' }), NU);
  assert.equal(s.anbefaling.handling?.verb, 'send-til-andre', 'KC-0270: the floor is read from the instruction, not from a flag');
  const n = parseDagenState(dag({ id: 'x', label: 'Læs', instruktion: 'Læg et udkast i Kladder.', verb: 'laes' }), NU);
  assert.equal(n.anbefaling.handling?.verb, 'udfoer-med-fortryd');
  const t = parseDagenState(dag({ id: 'y', label: 'Svar', instruktion: 'Lav et svar.', verb: 'laes', tilAndre: true }), NU);
  assert.equal(t.anbefaling.handling?.verb, 'send-til-andre', 'tilAndre puts the floor at send-to-others');
});

test('a forged token field in the model\'s JSON is stripped by the schema', () => {
  const s = parseDagenState(dag({ id: 'x', label: 'Gør', instruktion: 'Gør det.', ja: 'forfalsket', tegn: 'forfalsket', token: 'x' }), NU);
  const h = s.anbefaling.handling as Record<string, unknown>;
  assert.equal(h['ja'], undefined);
  assert.equal(h['tegn'], undefined);
  assert.equal(h['token'], undefined);
});

test('a verb outside the enum, or mixed-zone sources, are denied', () => {
  const s = parseDagenState(dag({ id: 'x', label: 'Køb', instruktion: 'Køb det.', verb: 'koeb-nu' }), NU);
  assert.equal(afgoer({ rum: 'dagen', id: 'x', verb: s.anbefaling.handling!.verb!, zoner: ['privat'] }, { person: ENEBRUGER, kanal: 'knap', ja: true }).udfald, 'afvis');
  assert.equal(afgoer({ rum: 'dagen', id: 'x', verb: 'laes', zoner: ['privat', 'arbejde'] }, { person: ENEBRUGER, kanal: 'knap', ja: true }).udfald, 'afvis');
});

// End to end: Hermes builds Dagen with a handling it declares as "betal" (stricter than the floor, so it counts).
let dir = '';
let sut: ReturnType<typeof createApp>;
const fixture = await readFile(new URL('../fixtures/avis_data_sample.json', import.meta.url), 'utf8');
function answer(req: AgentRunRequest): string {
  if (req.instructions.includes('"treLinjer": ["linje 1"')) return '```json\n' + JSON.stringify(dag({ id: 'betal-regning', label: 'Betal regningen', instruktion: 'Betal regningen på 2.600 kr.', verb: 'betal' })) + '\n```';
  return 'ok';
}
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kc-omgaa-'));
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), fixture);
  sut = createApp({ store: createFileStore(path.join(dir, 'data')), hermes: createFakeAgent({ answer }), sourceGlob: path.join(dir, 'avis_{date}.json'), now: () => NU, dataDir: path.join(dir, 'data'),
    mailRunner: async () => ({ code: 1, stdout: '', stderr: '' }), mailStateDir: '/nonexistent' });
  const r = await sut.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"opdater"}' });
  const { runId } = (await r.json()) as { runId: string };
  await sut.runs.get(runId)!.finished;
});
after(() => rm(dir, { recursive: true, force: true }));

test('route: a denied verb is 403 with the Danish reason, nothing runs, and the log says what was not done', async () => {
  const foer = sut.runs.list().length;
  const res = await sut.app.request('/api/rum/dagen/handlinger/betal-regning', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const j = (await res.json()) as { error: string; graense: string };
  assert.match(j.error, /betaler aldrig/);
  assert.equal(j.graense, 'afvist');
  assert.equal(sut.runs.list().length, foer, 'no run was started');
  const log = (await readFile(path.join(dir, 'data', 'rum', 'dagen', 'log.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { tekst: string; graense?: string });
  assert.ok(log.some((l) => l.graense === 'afvist' && /betaler aldrig/.test(l.tekst)));
});

test('route: a token for another button does not lift the denial', async () => {
  const t = await sut.app.request('/api/graense/ja', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rum: 'dagen', slags: 'handling', id: 'betal-regning' }) });
  const { ja } = (await t.json()) as { ja: string };
  const res = await sut.app.request('/api/rum/dagen/handlinger/betal-regning', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ja }) });
  assert.equal(res.status, 403, 'betal is refused even with a yes');
});

test('route: the token route refuses unknown rooms and kinds', async () => {
  for (const b of [{ rum: 'bank', slags: 'handling', id: 'x' }, { rum: 'dagen', slags: 'betal', id: 'x' }, { rum: 'dagen', slags: 'handling', id: '' }]) {
    assert.equal((await sut.app.request('/api/graense/ja', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, 400);
  }
});
