// KC-0154: inviting a person, two kinds. Own entry: the owner pre-creates the member with her tailnet login; Clawco
// only shows the owner the steps in Tailscale's admin, and her first request through the identity path activates
// the member, once. Phone only: the member gets a channel waiting for her "ja"; the first message is the app's,
// shown to the owner and sent only on his red tap (a one-time yes bound to the hash of that text, the KC-0153
// mechanism), once. No clock ever sends it. Her "ja" opts her in, "stop" ends it. Inviting creates no account,
// password or token of our own; removing a member revokes her entry and her channel.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { laesHusstand, skrivHusstand, type Person } from '../../src/identitet/husstand.ts';
import { lavFakeKanal } from '../../src/hushold/kanal.ts';
import { parseKonfliktPlan } from '../../src/scheduler.ts';
import type { HusstandState, Medlem } from '../../src/hushold/schema.ts';
import {
  aktiverIndgang, fjernPerson, invitationAf, invitationJaId, invitationTekst, InvitationFejl, MAX_PERSONER, nyPerson, parseInvitation, skiftRolle, vurderInvitation,
} from '../../src/hushold/invitation.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

// ---------- pure ----------

const EJER_P: Person = { id: FAMILIE.ejer.id, login: 'ejer@example.com', navn: FAMILIE.ejer.navn, rolle: 'ejer' };
const MAJA_P: Person = { id: FAMILIE.medlem.id, login: 'maja@example.com', navn: FAMILIE.medlem.navn, rolle: 'medlem' };

test('parseInvitation: own entry needs a name, a login and a role below the owner; phone needs a valid handle on a known channel', () => {
  assert.deepEqual(parseInvitation({ slags: 'egen', navn: ' Rikke ', login: ' Rikke@Example.com ', rolle: 'medlem' }), { slags: 'egen', navn: 'Rikke', login: 'rikke@example.com', rolle: 'medlem' });
  assert.deepEqual(parseInvitation({ slags: 'telefon', navn: 'Nora', kanal: 'signal', handle: '+45 00 00 00 04', rolle: 'barn' }), { slags: 'telefon', navn: 'Nora', kanal: 'signal', handle: '+4500000004', rolle: 'barn' });
  for (const bad of [
    { slags: 'egen', navn: 'Rikke', login: 'ikke-en-mail', rolle: 'medlem' },
    { slags: 'egen', navn: 'Rikke', login: 'rikke@example.com', rolle: 'ejer' },
    { slags: 'egen', navn: 'Rikke', login: 'rikke@example.com', rolle: 'admin' },
    { slags: 'egen', navn: '', login: 'rikke@example.com', rolle: 'medlem' },
    { slags: 'telefon', navn: 'Nora', kanal: 'sms', handle: '+4500000004', rolle: 'barn' },
    { slags: 'telefon', navn: 'Nora', kanal: 'signal', handle: 'nora', rolle: 'barn' },
    { slags: 'konto', navn: 'Nora', rolle: 'barn' },
  ]) assert.throws(() => parseInvitation(bad), InvitationFejl, JSON.stringify(bad));
});

test('nyPerson: an id from the name, unique; a login already in the household or a seventh person is refused', () => {
  const p = nyPerson([EJER_P, MAJA_P], parseInvitation({ slags: 'egen', navn: 'Maja', login: 'maja2@example.com', rolle: 'barn' }));
  assert.deepEqual(p, { id: 'maja-2', login: 'maja2@example.com', navn: 'Maja', rolle: 'barn' });
  assert.equal(nyPerson([EJER_P], parseInvitation({ slags: 'telefon', navn: 'Nora', kanal: 'telegram', handle: '100000004', rolle: 'gaest' })).login, null);
  assert.throws(() => nyPerson([EJER_P, MAJA_P], parseInvitation({ slags: 'egen', navn: 'X', login: 'MAJA@example.com', rolle: 'medlem' })), (e: InvitationFejl) => e.status === 409);
  const seks = Array.from({ length: MAX_PERSONER }, (_, i): Person => ({ id: `p${i}`, login: null, navn: `P${i}`, rolle: i ? 'medlem' : 'ejer' }));
  assert.throws(() => nyPerson(seks, parseInvitation({ slags: 'egen', navn: 'X', login: 'x@example.com', rolle: 'medlem' })), (e: InvitationFejl) => e.status === 409);
});

test('the first message: who invites, what Clawco is, ja/nej/stop; a name cannot smuggle a Hermes directive', () => {
  const t = invitationTekst('Henrik', 'Nora');
  assert.match(t, /Henrik/);
  assert.match(t, /Nora/);
  assert.match(t, /Clawco/);
  assert.match(t, /installere/);
  assert.match(t, /\bja\b/);
  assert.match(t, /\bnej\b/);
  assert.match(t, /\bstop\b/);
  assert.doesNotMatch(invitationTekst('MEDIA:/etc/passwd', '[[silent]]'), /MEDIA:|\[\[/);
  assert.notEqual(invitationJaId('nora', t), invitationJaId('nora', `${t}!`), 'another text is another yes');
  assert.match(invitationJaId('nora', t), /^nora:invitation:[0-9a-f]{16}$/);
});

const NORA: Medlem = { id: FAMILIE.barn.id, navn: FAMILIE.barn.navn, rolle: 'barn', kanal: { kanal: 'signal', handle: '+4500000004', status: 'afventer-ja' } };
const EJER_M: Medlem = { id: EJER_P.id, navn: EJER_P.navn, rolle: 'ejer' };

test('vurderInvitation: only the owner, only a pending phone member, only once; never after ja or stop', () => {
  const ok = vurderInvitation([EJER_M, NORA], NORA.id, EJER_P);
  assert.ok(ok.ok);
  assert.deepEqual(ok.til, { medlemId: NORA.id, kanal: 'signal', handle: '+4500000004' });
  assert.equal(ok.tekst, invitationTekst(EJER_P.navn, NORA.navn));
  assert.equal(ok.jaId, invitationJaId(NORA.id, ok.tekst));
  const nej = (m: Medlem[], id: string, af: Person) => { const v = vurderInvitation(m, id, af); assert.ok(!v.ok); return v.status; };
  assert.equal(nej([EJER_M, NORA], NORA.id, MAJA_P), 403, 'a member does not invite');
  assert.equal(nej([EJER_M, NORA], 'ingen', EJER_P), 404);
  const { kanal: _k, ...udenKanal } = NORA;
  assert.equal(nej([EJER_M, udenKanal], NORA.id, EJER_P), 409, 'no channel');
  assert.equal(nej([EJER_M, { ...NORA, kanal: { ...NORA.kanal!, inviteret: '2026-11-02T08:00:00.000Z' } }], NORA.id, EJER_P), 409, 'sent once');
  assert.equal(nej([EJER_M, { ...NORA, kanal: { ...NORA.kanal!, status: 'aktiv' } }], NORA.id, EJER_P), 409, 'she said ja');
  assert.equal(nej([EJER_M, { ...NORA, kanal: { ...NORA.kanal!, status: 'stoppet' } }], NORA.id, EJER_P), 409, 'she said stop');
});

test('invitationAf and aktiverIndgang: a pending own entry activates once; a pending channel is the phone kind', () => {
  const venter: Medlem = { id: 'rikke', navn: 'Rikke', rolle: 'medlem', indgang: { status: 'venter', oprettet: '2026-11-02T08:00:00.000Z' } };
  assert.equal(invitationAf(venter), 'egen');
  assert.equal(invitationAf(NORA), 'telefon');
  assert.equal(invitationAf(EJER_M), null);
  const nu = new Date('2026-11-03T08:00:00Z');
  const aktiv = aktiverIndgang(venter, nu);
  assert.deepEqual(aktiv?.indgang, { status: 'aktiv', oprettet: '2026-11-02T08:00:00.000Z', aktiveret: nu.toISOString() });
  assert.equal(aktiverIndgang(aktiv!, nu), null, 'once');
  assert.equal(invitationAf(aktiv!), null);
});

test('skiftRolle and fjernPerson: the owner only, never on himself, and the household keeps an owner', () => {
  assert.equal(skiftRolle([EJER_P, MAJA_P], EJER_P, MAJA_P.id, 'barn').find((p) => p.id === MAJA_P.id)?.rolle, 'barn');
  assert.throws(() => skiftRolle([EJER_P, MAJA_P], MAJA_P, EJER_P.id, 'gaest'), (e: InvitationFejl) => e.status === 403);
  assert.throws(() => skiftRolle([EJER_P, MAJA_P], EJER_P, EJER_P.id, 'medlem'), (e: InvitationFejl) => e.status === 409);
  assert.throws(() => skiftRolle([EJER_P, MAJA_P], EJER_P, MAJA_P.id, 'admin' as never), InvitationFejl);
  assert.throws(() => skiftRolle([EJER_P, MAJA_P], EJER_P, 'ingen', 'barn'), (e: InvitationFejl) => e.status === 404);
  assert.deepEqual(fjernPerson([EJER_P, MAJA_P], EJER_P, MAJA_P.id), [EJER_P]);
  assert.throws(() => fjernPerson([EJER_P, MAJA_P], EJER_P, EJER_P.id), (e: InvitationFejl) => e.status === 409);
  assert.throws(() => fjernPerson([EJER_P, MAJA_P], MAJA_P, EJER_P.id), (e: InvitationFejl) => e.status === 403);
});

// ---------- end to end ----------

const rod = await mkdtemp(path.join(tmpdir(), 'kc-invitation-'));
after(() => rm(rod, { recursive: true, force: true }));

const START = new Date('2026-11-02T08:00:00Z');
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const RIKKE_LOGIN = 'rikke@example.com';

async function lav(navn: string, personer: Person[] | null = [EJER_P, MAJA_P]) {
  const dataDir = path.join(rod, navn);
  if (personer) await skrivHusstand(dataDir, { personer });
  let ur = START;
  const store = createFileStore(dataDir);
  const kanal = lavFakeKanal();
  const a = createApp({
    store, hermes: createFakeAgent({ answer: () => '```json\n{"alternativer":[]}\n```' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', now: () => ur,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent', kanal,
  });
  const req = (login: string | null, sti: string, init: RequestInit = {}) =>
    a.app.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(login ? { 'Tailscale-User-Login': login } : {}), 'content-type': 'application/json' } }, LOOPBACK);
  const post = async (login: string | null, sti: string, body: Record<string, unknown>) => {
    const res = await req(login, sti, { method: 'POST', body: JSON.stringify(body) });
    const j = (await res.json()) as { runId?: string; error?: string; ja?: string; graense?: string };
    if (j.runId) await a.runs.get(j.runId)?.finished;
    return { status: res.status, ...j };
  };
  const ja = async (login: string | null, rum: string, slags: string, id: string, body?: Record<string, unknown>) =>
    (await post(login, '/api/graense/ja', { rum, slags, id, ...(body ? { body } : {}) })).ja;
  const inviter = (body: Record<string, unknown>, login: string | null = EJER_P.login) => post(login, '/api/rum/husstand/aktion/inviter', body);
  const state = async () => (await store.readState<HusstandState>('husstand'))!;
  const side = async (login: string | null = EJER_P.login) => (await req(login, '/rum/husstand')).text();
  const jaId = async (id: string): Promise<string> => new RegExp(`data-invitation-send="${id}" data-invitation-ja="([^"]+)"`).exec(await side())?.[1] ?? `${id}:invitation:-`;
  /** The owner's red tap: a one-time yes for exactly the text on screen, then the send. */
  const send = async (id: string, medJa = true, login: string | null = EJER_P.login) =>
    post(login, `/api/hushold/medlem/${id}/inviter`, medJa ? { ja: await ja(login, 'husstand', 'invitation', await jaId(id)) } : {});
  const svar = (tekst: string, afsender = '+4500000004') => {
    ur = new Date(ur.getTime() + 60_000);
    kanal.modtag({ kanal: 'signal', afsender, gruppe: false, tid: ur.toISOString(), tekst });
  };
  return { ...a, dataDir, store, kanal, req, post, ja, inviter, state, side, send, svar, saetUr: (d: Date) => { ur = d; } };
}

const linjer = async (a: Awaited<ReturnType<typeof lav>>, ejer: string) => (await a.store.readLog('husstand', 200)).filter((e) => e.ejer === ejer).map((e) => e.tekst);

test('own entry: the owner pre-creates her by login, sees the Tailscale steps; her first visit activates her once', async () => {
  const a = await lav('egen');
  const r = await a.inviter({ slags: 'egen', navn: 'Rikke', login: RIKKE_LOGIN, rolle: 'medlem' });
  assert.equal(r.status, 202, r.error);
  const personer = (await laesHusstand(a.dataDir))!.personer;
  assert.deepEqual(personer.find((p) => p.login === RIKKE_LOGIN), { id: 'rikke', login: RIKKE_LOGIN, navn: 'Rikke', rolle: 'medlem' });
  assert.equal((await a.state()).medlemmer.find((m) => m.id === 'rikke')?.indgang?.status, 'venter');
  const html = await a.side();
  assert.match(html, /data-invitation="egen"[^>]*data-invitation-medlem="rikke"/);
  assert.match(html, /Tailscale/);
  assert.match(html, /<details class="kilde-trin-et"[^>]* open>/, 'one step open at a time');
  assert.doesNotMatch(await a.side(MAJA_P.login), /data-invitation=/, 'a member sees no invitation card');
  // Nothing on disk is a credential of our own: the household file holds login, name and role only.
  assert.doesNotMatch(await readFile(path.join(a.dataDir, 'husstand.json'), 'utf8'), /password|adgangskode|token|secret/i);

  const forste = await a.req(RIKKE_LOGIN, '/rum/husstand');
  assert.equal(forste.status, 200);
  await a.req(RIKKE_LOGIN, '/rum/hjem');
  const m = (await a.state()).medlemmer.find((x) => x.id === 'rikke');
  assert.equal(m?.indgang?.status, 'aktiv');
  assert.equal(m?.indgang?.aktiveret, START.toISOString());
  assert.deepEqual((await linjer(a, EJER_P.id)).filter((t) => /Rikke er kommet ind/.test(t)).length, 1, 'once');
  assert.doesNotMatch(await a.side(), /data-invitation="egen"/, 'the card is gone once she is in');
});

test('an unknown login gets the plain "not invited yet" page, with no data', async () => {
  const a = await lav('ukendt');
  const res = await a.req('fremmed@example.com', '/rum/husstand');
  assert.equal(res.status, 403);
  const h = await res.text();
  assert.match(h, /Du er ikke inviteret endnu/);
  assert.doesNotMatch(h, /Maja|Henrik|data-medlem|data-room/);
  const api = await a.req('fremmed@example.com', '/api/rum/husstand/fragment');
  assert.equal(api.status, 403);
});

test('phone only: the exact first message is shown; no tap, no message; the tap sends it once; no clock sends', async () => {
  const a = await lav('telefon');
  const r = await a.inviter({ slags: 'telefon', navn: 'Nora', kanal: 'signal', handle: '+45 00 00 00 04', rolle: 'barn' });
  assert.equal(r.status, 202, r.error);
  assert.equal((await laesHusstand(a.dataDir))!.personer.find((p) => p.id === 'nora')?.login, null, 'no entry of her own');
  assert.deepEqual((await a.state()).medlemmer.find((m) => m.id === 'nora')?.kanal, { kanal: 'signal', handle: '+4500000004', status: 'afventer-ja' });
  const html = await a.side();
  assert.match(html, /data-invitation="telefon"/);
  assert.match(html, /class="btn btn-graense"[^>]*data-invitation-send="nora"[^>]*data-kraever-ja/, 'Send is red and needs a yes');
  const vist = /data-invitation-tekst="nora"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];
  assert.equal(vist, invitationTekst(EJER_P.navn, 'Nora').replace(/\n/g, '\n'), 'the exact text is on the card');
  assert.equal(a.kanal.sendt.length, 0, 'creating the member sends nothing');

  // No clock sends: every timer path runs while the invitation waits for the tap.
  let kald = 0;
  const foer = a.kanal.send.bind(a.kanal);
  a.kanal.send = async (til, tekst) => { kald += 1; return foer(til, tekst); };
  const plan = parseKonfliktPlan('07:30')!;
  for (const timer of [1, 30, 49, 24 * 7]) {
    a.saetUr(new Date(START.getTime() + timer * 3600_000));
    await a.tikNu();
    await a.konfliktTik(plan);
    await a.soendagTik();
    await a.moedeTikNu();
  }
  assert.equal(kald, 0, 'no scheduler path sent the invitation');
  a.saetUr(START);

  const uden = await a.send('nora', false);
  assert.equal(uden.status, 403);
  assert.equal(uden.graense, 'kraever-ja');
  const forkert = await a.post(EJER_P.login, '/api/hushold/medlem/nora/inviter', { ja: await a.ja(EJER_P.login, 'husstand', 'invitation', 'nora:invitation:0000000000000000') });
  assert.equal(forkert.status, 403, 'a yes for another text is no yes for this one');
  assert.equal(kald, 0);

  const ok = await a.send('nora');
  assert.equal(ok.status, 202, ok.error);
  assert.equal(a.kanal.sendt.length, 1);
  assert.deepEqual(a.kanal.sendt[0]!.til, { medlemId: 'nora', kanal: 'signal', handle: '+4500000004' });
  assert.equal(a.kanal.sendt[0]!.tekst, invitationTekst(EJER_P.navn, 'Nora'));
  assert.equal((await a.state()).medlemmer.find((m) => m.id === 'nora')?.kanal?.inviteret, START.toISOString());
  const igen = await a.post(EJER_P.login, '/api/hushold/medlem/nora/inviter', { ja: await a.ja(EJER_P.login, 'husstand', 'invitation', invitationTekst(EJER_P.navn, 'Nora')) });
  assert.equal(igen.status, 409, 'sent once');
  assert.equal(a.kanal.sendt.length, 1);
  assert.doesNotMatch(await a.side(), /data-invitation-send=/);

  // Her "ja" opts her in (the reply reader of KC-0153); nothing is sent by it.
  a.svar('Ja');
  await a.tikNu();
  assert.equal((await a.state()).medlemmer.find((m) => m.id === 'nora')?.kanal?.status, 'aktiv');
  assert.equal(a.kanal.sendt.length, 1);
});

test('phone only: "stop" ends it at once, "nej" tells the owner; a member cannot send the invitation', async () => {
  const a = await lav('stop');
  await a.inviter({ slags: 'telefon', navn: 'Nora', kanal: 'signal', handle: '+4500000004', rolle: 'gaest' });
  assert.equal((await a.send('nora', true, MAJA_P.login)).status, 403, 'only the owner invites');
  assert.equal((await a.send('nora')).status, 202);
  a.svar('nej');
  await a.tikNu();
  assert.equal((await a.state()).medlemmer.find((m) => m.id === 'nora')?.kanal?.status, 'afventer-ja');
  assert.ok((await linjer(a, EJER_P.id)).some((t) => /Nora sagde nej tak/.test(t)));
  a.svar('stop');
  await a.tikNu();
  assert.equal((await a.state()).medlemmer.find((m) => m.id === 'nora')?.kanal?.status, 'stoppet');
  assert.equal(a.kanal.sendt.length, 1);
});

test('single user: the first invitation writes the household with the owner by his verified login; without one it refuses', async () => {
  const a = await lav('enebruger', null);
  const uden = await a.inviter({ slags: 'telefon', navn: 'Nora', kanal: 'telegram', handle: '100000004', rolle: 'medlem', mitNavn: 'Henrik' }, null);
  assert.equal(uden.status, 409, uden.error);
  assert.equal(await laesHusstand(a.dataDir), null, 'nothing written');
  const r = await a.inviter({ slags: 'telefon', navn: 'Nora', kanal: 'telegram', handle: '100000004', rolle: 'medlem', mitNavn: 'Henrik' }, 'ejer@example.com');
  assert.equal(r.status, 202, r.error);
  assert.deepEqual((await laesHusstand(a.dataDir))!.personer, [
    { id: 'ejer', login: 'ejer@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'nora', login: null, navn: 'Nora', rolle: 'medlem' },
  ]);
  assert.equal((await a.req('ejer@example.com', '/rum/husstand')).status, 200, 'he is still the owner after the file exists');
});

test('removing a member (owner, red yes): her entry and channel end, shared history stays', async () => {
  const a = await lav('fjern');
  await a.inviter({ slags: 'egen', navn: 'Rikke', login: RIKKE_LOGIN, rolle: 'medlem' });
  await a.req(RIKKE_LOGIN, '/rum/husstand');
  const body = { id: MAJA_P.id };
  assert.equal((await a.post(EJER_P.login, '/api/rum/husstand/aktion/fjern-medlem', body)).status, 403, 'needs the red yes');
  assert.equal((await a.post(RIKKE_LOGIN, '/api/rum/husstand/aktion/fjern-medlem', { ...body, ja: await a.ja(RIKKE_LOGIN, 'husstand', 'aktion', 'fjern-medlem', body) })).status, 403, 'a member removes nobody');
  const r = await a.post(EJER_P.login, '/api/rum/husstand/aktion/fjern-medlem', { ...body, ja: await a.ja(EJER_P.login, 'husstand', 'aktion', 'fjern-medlem', body) });
  assert.equal(r.status, 202, r.error);
  assert.equal((await laesHusstand(a.dataDir))!.personer.some((p) => p.id === MAJA_P.id), false);
  const ude = await a.req(MAJA_P.login, '/rum/husstand');
  assert.equal(ude.status, 403);
  assert.match(await ude.text(), /Du er ikke inviteret endnu/);
  assert.ok((await linjer(a, EJER_P.id)).some((t) => /Du fjernede Maja/.test(t)), 'logged');
});
