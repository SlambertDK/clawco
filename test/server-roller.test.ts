// KC-0154 end to end: each role against each husstand route, through createApp and the identity path. The server
// decides (src/hushold/rettigheder.ts): a check that fails is a 403 or a 404, never an element hidden in CSS. A guest
// sees only requests addressed to her; a child has a member's rights (G4); only the owner invites, changes a role
// or removes someone. The person comes only from the Serve header of a loopback peer (E1).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { laesHusstand, skrivHusstand, type Person } from '../src/identitet/husstand.ts';
import { lavFakeKanal } from '../src/hushold/kanal.ts';
import { ROLLER, type HusRolle as Rolle } from '../src/identitet/roller.ts';
import { FAMILIE } from '../src/testtilstand/familie.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-srv-roller-'));
after(() => rm(rod, { recursive: true, force: true }));

const NU = new Date('2026-11-02T08:00:00Z');
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const FREMMED_PEER = { incoming: { socket: { remoteAddress: '100.64.0.5' } } };
const P: Record<Rolle, Person> = {
  ejer: { id: FAMILIE.ejer.id, login: 'ejer@example.com', navn: FAMILIE.ejer.navn, rolle: 'ejer' },
  medlem: { id: FAMILIE.medlem.id, login: 'medlem@example.com', navn: FAMILIE.medlem.navn, rolle: 'medlem' },
  barn: { id: FAMILIE.barn.id, login: 'barn@example.com', navn: FAMILIE.barn.navn, rolle: 'barn' },
  gaest: { id: 'gaest', login: 'gaest@example.com', navn: 'Gæst', rolle: 'gaest' },
};

async function lav(navn: string) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: ROLLER.map((r) => P[r]) });
  const store = createFileStore(dataDir);
  const a = createApp({
    store, hermes: createFakeAgent({ answer: () => '```json\n{"alternativer":[]}\n```' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => NU,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent', kanal: lavFakeKanal(),
  });
  const req = (p: Person, sti: string, init: RequestInit = {}, peer: unknown = LOOPBACK) =>
    a.app.request(sti, { ...init, headers: { 'Tailscale-User-Login': p.login!, 'content-type': 'application/json' } }, peer);
  const post = async (p: Person, sti: string, body: Record<string, unknown>) => {
    const res = await req(p, sti, { method: 'POST', body: JSON.stringify(body) });
    const j = (await res.json()) as { runId?: string; error?: string; ja?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    return { status: res.status, ...j };
  };
  /** An action as the browser posts it: a red one with a one-time yes for exactly this body. */
  const aktion = async (p: Person, navn: string, body: Record<string, unknown>, medJa = true) => {
    const ja = medJa ? (await post(p, '/api/graense/ja', { rum: 'husstand', slags: 'aktion', id: navn, body })).ja : undefined;
    return post(p, `/api/rum/husstand/aktion/${navn}`, { ...body, ...(ja ? { ja } : {}) });
  };
  return { ...a, dataDir, store, req, post, aktion };
}

const spoerg = (til: string, titel = 'Kan du vande blomster?') => ({ til, titel });

test('each role × each husstand route: the status the matrix gives', async () => {
  const a = await lav('matrix');
  const forventet: Record<string, Record<Rolle, number[]>> = {
    'GET /rum/husstand': { ejer: [200], medlem: [200], barn: [200], gaest: [404] },
    'GET /api/rum/husstand/fragment': { ejer: [200], medlem: [200], barn: [200], gaest: [404] },
    'GET /rum/husstand/inviter': { ejer: [200], medlem: [403], barn: [403], gaest: [403] },
  };
  for (const [rute, celler] of Object.entries(forventet)) {
    for (const r of ROLLER) {
      const status = (await a.req(P[r], rute.split(' ')[1]!)).status;
      assert.ok(celler[r].includes(status), `${rute} × ${r}: ${status}`);
    }
  }
  // Writes, each role in turn. Only the owner invites; a guest is refused by the policy layer, the others by the matrix.
  for (const r of ROLLER) {
    const inv = await a.aktion(P[r], 'inviter', { slags: 'egen', navn: `Ny ${r}`, login: `ny-${r}@example.com`, rolle: 'medlem' }, false);
    assert.equal(inv.status, r === 'ejer' ? 202 : 403, `inviter × ${r}: ${inv.error}`);
    const rolle = await a.aktion(P[r], 'rolle', { id: 'ny-ejer', rolle: 'barn' }, false);
    assert.equal(rolle.status, r === 'ejer' ? 202 : 403, `rolle × ${r}: ${rolle.error}`);
    const fjern = await a.aktion(P[r], 'fjern-medlem', { id: 'ny-ejer' });
    assert.equal(fjern.status, r === 'ejer' ? 202 : 403, `fjern-medlem × ${r}: ${fjern.error}`);
    if (r === 'ejer') await a.aktion(P.ejer, 'inviter', { slags: 'egen', navn: 'Ny ejer', login: 'ny-ejer@example.com', rolle: 'medlem' }, false);
    const send = await a.post(P[r], '/api/hushold/medlem/ny-ejer/inviter', {});
    assert.ok(r === 'ejer' ? send.status === 409 : [403, 404].includes(send.status), `send-invitation × ${r}: ${send.status}`);
    // Asking someone: every role but the guest; asking the guest is allowed (she sees requests addressed to her).
    const til = r === 'medlem' ? P.ejer.id : P.medlem.id;
    const opret = await a.aktion(P[r], 'opret', spoerg(til, `Fra ${r}`));
    assert.equal(opret.status, r === 'gaest' ? 403 : 202, `opret × ${r}: ${opret.error}`);
  }
  const chat = async (p: Person) => (await a.post(p, '/api/rum/husstand/chat', { besked: 'Hvad skal vi?' })).status;
  assert.deepEqual(await Promise.all(ROLLER.map((r) => chat(P[r]))), [202, 202, 202, 403]);
});

test('a guest sees only the requests addressed to her: no members, no week, no things, no buttons; her shell names nobody', async () => {
  const a = await lav('gaest');
  assert.equal((await a.aktion(P.ejer, 'opret', spoerg(P.gaest.id, 'Kan du passe Nora lørdag?'))).status, 202);
  assert.equal((await a.aktion(P.medlem, 'opret', spoerg(P.barn.id, 'Kan du rydde op?'))).status, 202);
  const res = await a.req(P.gaest, '/rum/husstand');
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.match(h, /Kan du passe Nora lørdag\?/);
  assert.doesNotMatch(h, /Kan du rydde op\?/, 'a request between two others');
  assert.doesNotMatch(h, /data-medlem=|data-husstand-uge|data-ressource-sektion|data-foresp-ny|data-aktion="svar"/);
  assert.doesNotMatch(h, /class="husstand-liste"/, 'the shell lists no household for a guest');
  assert.equal((await a.req(P.gaest, '/rum/husstand/inviter')).status, 403);
  const svar = await a.aktion(P.gaest, 'svar', { id: /data-foresp="([^"]+)"/.exec(h)![1]!, svar: 'ja' });
  assert.equal(svar.status, 403, 'the guest answers on the channel, not here');
});

test('a child has a member\'s screens and rights (G4): the week, the members, asking, Tilføj ting stays the adults\'', async () => {
  const a = await lav('barn');
  const h = await (await a.req(P.barn, '/rum/husstand')).text();
  assert.match(h, /data-husstand-uge/);
  assert.match(h, /data-medlem="gaest"/);
  assert.match(h, /data-foresp-ny/);
  assert.doesNotMatch(h, /data-invitation|data-medlem-ret/, 'no owner tools');
});

test('the owner changes a role (logged), and the change is the access: a member made guest loses the room', async () => {
  const a = await lav('rolle');
  const r = await a.aktion(P.ejer, 'rolle', { id: P.medlem.id, rolle: 'gaest' }, false);
  assert.equal(r.status, 202, r.error);
  assert.equal((await laesHusstand(a.dataDir))!.personer.find((p) => p.id === P.medlem.id)?.rolle, 'gaest');
  assert.equal((await a.req(P.medlem, '/rum/husstand')).status, 404);
  const log = await a.store.readLog('husstand', 50);
  assert.ok(log.some((e) => e.ejer === P.ejer.id && /Maja er nu gæst/.test(e.tekst)), 'the owner\'s line');
  assert.ok(log.some((e) => e.ejer === P.medlem.id && /gæst/.test(e.tekst)), 'her own line');
  assert.equal((await a.aktion(P.ejer, 'rolle', { id: P.ejer.id, rolle: 'medlem' }, false)).status, 409, 'never his own');
  assert.match(await (await a.req(P.ejer, '/rum/husstand')).text(), new RegExp(`data-medlem-ret="${P.barn.id}"`), 'the owner\'s row tools');
});

test('the identity is the Serve header of a loopback peer only: a header from elsewhere is nobody', async () => {
  const a = await lav('spoof');
  assert.equal((await a.req(P.medlem, '/rum/husstand', {}, FREMMED_PEER)).status, 401);
  assert.equal((await a.req(P.ejer, '/rum/husstand/inviter', {}, FREMMED_PEER)).status, 401);
  const ukendt = await a.req({ ...P.medlem, login: 'ukendt@example.com' }, '/rum/husstand');
  assert.equal(ukendt.status, 403);
  assert.match(await ukendt.text(), /Du er ikke inviteret endnu/);
});
