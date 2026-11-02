// KC-0145 through the server: the Sunday card in Nu (bunke, five lines, the number from the ledger), each answer
// recorded once, "Skulle have vist mig det" feeding the KC-0144 proposal flow (a pending proposal, nothing written to the
// rules file; a rule as the reason → a proposal to pause it, which only Henrik's Ja applies), and the stop question.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import { laesKurator } from '../src/kurator/kurator.ts';
import { lavReglerLager } from '../src/tillid/lager.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { lavSkjulte, type Skjult } from '../src/tillid/skjulte.ts';
import { lavStikbog, type Stikbog } from '../src/tillid/stikproeve.ts';
import { createSettings } from '../src/settings.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { udpak } from '../src/agent/udtroet.ts';

const NOW = new Date('2026-11-01T17:30:00Z'); // Sunday 18:30 Copenhagen
const UGE = '2026-10-26';
const REGLER = `# Regler for Clawco

naeste-id: R-0002

## R-0001 · Nyhedsbreve sorteres
- trin: 1
- gaelder: mail / nyhedsbrev
- oprindelse: import 2026-10-01
- status: aktiv

Nyhedsbreve flyttes til deres mapper.
`;
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const post = (i: number, regelId?: string): Skjult => ({ id: `intet:${String(i).padStart(16, '0')}`, tid: '2026-10-28T09:00:00.000Z', titel: `Nyhedsbrev nr. ${i}`, kilde: 'kuratoren', ...(regelId ? { regelId } : {}) });
const UGEN = (over: Partial<Stikbog> = {}): Stikbog => ({ uger: [{ uge: UGE, skjulte: 212, traek: [post(1, 'R-0001'), post(2), post(3), post(4), post(5)], forkerte: 0 }], ...over });

async function opsaet(o: { svar?: (r: AgentRunRequest) => string; bog?: Stikbog; husstand?: boolean; now?: Date } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-stikproeve-srv-'));
  const dataDir = path.join(dir, 'data');
  const vaultRod = path.join(dir, 'vault');
  const store = createFileStore(dataDir);
  await rejsenFaerdig(store);
  if (o.husstand) await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' },
  ] });
  const lager = lavReglerLager({ vaultDir: vaultRod, dataDir });
  await lager.skrivTekst(REGLER);
  if (o.bog) await lavStikbog({ dir: dataDir }).endre(() => o.bog!);
  const hermes = createFakeAgent({ answer: o.svar ?? (() => 'Noteret.') });
  const sut = createApp({ store, hermes, dataDir, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'), now: () => o.now ?? NOW, vaultInbox: path.join(vaultRod, '00-Indbakke') });
  const som = (hvem?: string): Record<string, string> => (hvem ? { 'Tailscale-User-Login': `${hvem}@example.com` } : {});
  const send = async (url: string, body?: unknown, hvem?: string): Promise<Response> =>
    sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...som(hvem) }, body: body === undefined ? null : JSON.stringify(body) }, o.husstand ? LOOPBACK : undefined);
  const nu = async (hvem?: string): Promise<string> => (await sut.app.request('/rum/hjem', { headers: som(hvem) }, o.husstand ? LOOPBACK : undefined)).text();
  const svar = (id: string, s: string, hvem?: string) => send(`/api/tillid/stikproeve/${UGE}/${encodeURIComponent(id)}`, { svar: s }, hvem);
  const bog = () => lavStikbog({ dir: dataDir }).laes();
  return { dir, dataDir, store, hermes, sut, send, nu, svar, bog, lager, reglerFil: () => readFile(lager.fil, 'utf8'), ryd: () => rm(dir, { recursive: true, force: true }) };
}

test('the card: the headline numbers from the ledger and one line per drawn item, each with Rigtigt and Skulle have vist mig det', async () => {
  const t = await opsaet({ bog: UGEN() });
  try {
    const h = await t.nu();
    assert.match(h, /data-stikproeve="2026-10-26"/);
    assert.match(h, /data-blok="bunke"[^>]*data-stikproeve|data-stikproeve[^>]*data-blok="bunke"/);
    assert.match(h, /Denne uge skjulte jeg 212 ting\. Her er 5 tilfældige\. Var det rigtigt\?/);
    assert.equal((h.match(/data-stikproeve-svar="rigtigt"/g) ?? []).length, 5);
    assert.equal((h.match(/data-stikproeve-svar="forkert"/g) ?? []).length, 5);
    assert.match(h, />Skulle have vist mig det</);
    assert.match(h, /Nyhedsbrev nr\. 1/);
    assert.match(h, /regel R-0001/);
  } finally { await t.ryd(); }
});

test('no ledger, a week with nothing hidden, the setting off, a member: no card', async () => {
  const tomUge: Stikbog = { uger: [{ uge: UGE, skjulte: 0, traek: [], forkerte: 0 }] };
  for (const [bog, tekst] of [[undefined, 'no ledger'], [tomUge, 'zero hidden']] as [Stikbog | undefined, string][]) {
    const t = await opsaet(bog ? { bog } : {});
    try { assert.doesNotMatch(await t.nu(), /data-stikproeve=/, tekst); } finally { await t.ryd(); }
  }
  const t = await opsaet({ bog: UGEN(), husstand: true });
  try {
    assert.match(await t.nu('henrik'), /data-stikproeve=/);
    assert.doesNotMatch(await t.nu('maja'), /data-stikproeve=/, 'the owner\'s card only');
    assert.equal((await t.svar(post(2).id, 'rigtigt', 'maja')).status, 403);
    await createSettings(t.dataDir).setSoendagstjek(false);
    assert.doesNotMatch(await t.nu('henrik'), /data-stikproeve=/, 'stopped');
  } finally { await t.ryd(); }
});

test('Rigtigt is recorded once; a second tap is 409; a bad answer is 400, an unknown line 404; all five answered → the card folds away', async () => {
  const t = await opsaet({ bog: UGEN() });
  try {
    assert.equal((await t.svar(post(2).id, 'rigtigt')).status, 200);
    assert.equal((await t.svar(post(2).id, 'forkert')).status, 409);
    assert.equal((await t.svar(post(3).id, 'maaske')).status, 400);
    assert.equal((await t.svar('intet:ukendt', 'rigtigt')).status, 404);
    const b = await t.bog();
    assert.deepEqual(b.uger[0]!.traek.map((x) => x.svar), [undefined, 'rigtigt', undefined, undefined, undefined]);
    assert.equal(b.uger[0]!.forkerte, 0);
    const h = await t.nu();
    assert.equal((h.match(/data-stikproeve-svar="rigtigt"/g) ?? []).length, 4, 'the answered line shows its answer, not buttons');
    for (const i of [1, 3, 4, 5]) assert.equal((await t.svar(post(i).id, 'rigtigt')).status, 200);
    assert.doesNotMatch(await t.nu(), /data-stikproeve=/);
  } finally { await t.ryd(); }
});

const MARKOER = 'skulle have vist';
test('Skulle have vist mig det on an item a rule hid: counted per rule, a pending proposal to pause the rule, Hermes asked with the item as context; nothing written to the rules file', async () => {
  const t = await opsaet({ bog: UGEN() });
  try {
    const foer = await t.reglerFil();
    const res = await t.svar(post(1, 'R-0001').id, 'forkert');
    assert.equal(res.status, 200);
    const { runId } = (await res.json()) as { runId?: string };
    assert.ok(runId);
    assert.equal((await t.sut.runs.get(runId)!.finished).status, 'done');
    const b = await t.bog();
    assert.deepEqual([b.uger[0]!.forkerte, b.uger[0]!.perRegel], [1, { 'R-0001': 1 }]);
    const f = (await laesKurator(t.store)).regelforslag ?? [];
    assert.equal(f.length, 1);
    assert.deepEqual([f[0]!.status, f[0]!.pauser, f[0]!.kunPause, f[0]!.kortId], ['afventer', 'R-0001', true, `skjult:${post(1).id}`]);
    assert.equal(await t.reglerFil(), foer, 'only Henrik\'s Ja changes the rules');
    const kald = t.hermes.calls.at(-1)!;
    assert.ok(kald.instructions.toLowerCase().includes(MARKOER));
    assert.ok(udpak(kald.input).some((d) => d.tekst.includes('Nyhedsbrev nr. 1') && d.tekst.includes('R-0001')), 'the hidden item and its rule as context');
    const h = await t.nu();
    assert.match(h, /Skal jeg sætte reglen på pause\?/);
    assert.match(h, /data-regelforslag-ja="rf-/);
  } finally { await t.ryd(); }
});

test('two wrongs under the same rule give one pause proposal for it, not two', async () => {
  const t = await opsaet({ bog: { uger: [{ uge: UGE, skjulte: 9, traek: [post(1, 'R-0001'), post(2, 'R-0001')], forkerte: 0 }] } });
  try {
    for (const i of [1, 2]) {
      const { runId } = (await (await t.svar(post(i).id, 'forkert')).json()) as { runId: string };
      await t.sut.runs.get(runId)!.finished;
    }
    const f = ((await laesKurator(t.store)).regelforslag ?? []).filter((x) => x.status === 'afventer' && x.pauser === 'R-0001');
    assert.equal(f.length, 1);
    assert.deepEqual((await t.bog()).uger[0]!.perRegel, { 'R-0001': 2 }, 'both counted for the rule');
  } finally { await t.ryd(); }
});

test('Hermes may answer with a narrower rule instead: it replaces the pause proposal and still pauses the old rule on Ja; Fortryd undoes both', async () => {
  const blok = { titel: 'Kun foreningens nyhedsbreve sorteres', tekst: 'Nyhedsbreve fra foreninger sorteres; andre nyhedsbreve vises.', trin: 1, gaelder: { kilde: 'mail', slags: 'foreningsnyhedsbrev' } };
  const t = await opsaet({ bog: UGEN(), svar: () => `Noteret.\n\`\`\`json\n${JSON.stringify({ regelforslag: blok })}\n\`\`\`` });
  try {
    const { runId } = (await (await t.svar(post(1, 'R-0001').id, 'forkert')).json()) as { runId: string };
    await t.sut.runs.get(runId)!.finished;
    const f = (await laesKurator(t.store)).regelforslag!;
    assert.equal(f.length, 1);
    assert.deepEqual([f[0]!.titel, f[0]!.pauser, f[0]!.kunPause], [blok.titel, 'R-0001', undefined]);
    const ja = ((await (await t.send('/api/graense/ja', { rum: 'hjem', slags: 'forslag', id: f[0]!.id })).json()) as { ja: string }).ja;
    const r = await t.send(`/api/tillid/forslag/${f[0]!.id}/godkend`, { ja });
    assert.equal(r.status, 200);
    const fil = await t.reglerFil();
    assert.match(fil, /## R-0001 · Nyhedsbreve sorteres\n- trin: 1\n- gaelder: mail \/ nyhedsbrev\n- oprindelse: import 2026-10-01\n- status: pause/);
    assert.match(fil, /## R-0002 · Kun foreningens nyhedsbreve sorteres[\s\S]*- status: aktiv/);
    const linje = (await t.store.readLog('hjem')).find((e) => e.handlingId === `regelforslag:${f[0]!.id}`)!;
    assert.equal(linje.fortryd, 'lokal:{"fjernRegel":"R-0002","genoptag":"R-0001"}');
    assert.equal((await t.send(`/api/rum/hjem/fortryd/${linje.id}`, {})).status, 200);
    const efter = await t.reglerFil();
    assert.doesNotMatch(efter, /R-0002 ·/);
    assert.match(efter, /## R-0001[^\n]*\n[\s\S]*?- status: aktiv/);
  } finally { await t.ryd(); }
});

test('the pause proposal: Ja (with its one-time yes) pauses the rule, no new rule; Fortryd turns it on again', async () => {
  const t = await opsaet({ bog: UGEN() });
  try {
    const { runId } = (await (await t.svar(post(1, 'R-0001').id, 'forkert')).json()) as { runId: string };
    await t.sut.runs.get(runId)!.finished;
    const f = (await laesKurator(t.store)).regelforslag![0]!;
    assert.equal((await t.send(`/api/tillid/forslag/${f.id}/godkend`, {})).status, 403, 'no yes, nothing changes');
    const ja = ((await (await t.send('/api/graense/ja', { rum: 'hjem', slags: 'forslag', id: f.id })).json()) as { ja: string }).ja;
    assert.equal((await t.send(`/api/tillid/forslag/${f.id}/godkend`, { ja })).status, 200);
    const fil = await t.reglerFil();
    assert.match(fil, /- status: pause/);
    assert.equal(fil.match(/^## R-/gm)?.length, 1, 'no new rule');
    const linje = (await t.store.readLog('hjem')).find((e) => e.handlingId === `regelforslag:${f.id}`)!;
    assert.equal(linje.fortryd, 'lokal:{"genoptag":"R-0001"}');
    assert.match(linje.tekst, /pause.*R-0001/);
    assert.equal((await t.send(`/api/rum/hjem/fortryd/${linje.id}`, {})).status, 200);
    assert.match(await t.reglerFil(), /- status: aktiv/);
  } finally { await t.ryd(); }
});

test('Skulle have vist mig det without a rule: Hermes is asked; its block becomes a pending proposal (a Ret); none without a block', async () => {
  const blok = { titel: 'Banken vises altid', tekst: 'Mails fra banken vises altid i Nu.', trin: 1, gaelder: { kilde: 'mail', slags: 'bank' } };
  let medBlok = false;
  const t = await opsaet({ bog: UGEN(), svar: () => (medBlok ? `Noteret.\n\`\`\`json\n${JSON.stringify({ regelforslag: blok })}\n\`\`\`` : 'Noteret.') });
  try {
    const r1 = (await (await t.svar(post(2).id, 'forkert')).json()) as { runId: string };
    await t.sut.runs.get(r1.runId)!.finished;
    assert.equal((await laesKurator(t.store)).regelforslag, undefined);
    medBlok = true;
    const r2 = (await (await t.svar(post(3).id, 'forkert')).json()) as { runId: string };
    await t.sut.runs.get(r2.runId)!.finished;
    const f = (await laesKurator(t.store)).regelforslag!;
    assert.deepEqual(f.map((x) => [x.titel, x.art, x.pauser]), [[blok.titel, 'ret', undefined]]);
    assert.equal((await t.bog()).uger[0]!.forkerte, 2);
  } finally { await t.ryd(); }
});

test('the stop question: shown when the ledger asks it; Ja turns the Sunday check off with a Fortryd in the log; Nej is remembered', async () => {
  const stop = { uger: [], stop: { uge: UGE, tid: NOW.toISOString() } } as Stikbog;
  const t = await opsaet({ bog: stop });
  try {
    let h = await t.nu();
    assert.match(h, /data-soendagstjek-stop/);
    assert.match(h, /Skal vi stoppe søndagstjekket\?/);
    assert.equal((await t.send('/api/tillid/soendagstjek/stop', { svar: 'maaske' })).status, 400);
    assert.equal((await t.send('/api/tillid/soendagstjek/stop', { svar: 'ja' })).status, 200);
    assert.equal((await createSettings(t.dataDir).read()).soendagstjek, false);
    assert.equal((await t.bog()).stop?.svar, 'ja');
    h = await t.nu();
    assert.doesNotMatch(h, /data-soendagstjek-stop/);
    const linje = (await t.store.readLog('hjem')).find((e) => e.handlingId === 'soendagstjek:stop')!;
    assert.match(linje.tekst, /Stoppede søndagstjekket/);
    assert.equal((await t.send(`/api/rum/hjem/fortryd/${linje.id}`, {})).status, 200);
    assert.equal((await createSettings(t.dataDir).read()).soendagstjek, true);
    assert.equal((await t.send('/api/tillid/soendagstjek/stop', { svar: 'ja' })).status, 409, 'answered once');
  } finally { await t.ryd(); }
  const n = await opsaet({ bog: stop });
  try {
    assert.equal((await n.send('/api/tillid/soendagstjek/stop', { svar: 'nej' })).status, 200);
    assert.equal((await n.bog()).stop?.svar, 'nej');
    assert.equal((await createSettings(n.dataDir).read()).soendagstjek, undefined, 'still on');
    assert.doesNotMatch(await n.nu(), /data-soendagstjek-stop/);
  } finally { await n.ryd(); }
});

test('the last answer of the third clean week asks the stop question; the Sunday tick draws the week from the app\'s records', async () => {
  const ren = (uge: string) => ({ uge, skjulte: 9, traek: [{ ...post(9), svar: 'rigtigt' as const, svaret: 'x' }], forkerte: 0 });
  const t = await opsaet({ bog: { uger: [ren('2026-10-12'), ren('2026-10-19'), { uge: UGE, skjulte: 9, traek: [post(9)], forkerte: 0 }] } });
  try {
    assert.equal((await t.svar(post(9).id, 'rigtigt')).status, 200);
    assert.equal((await t.bog()).stop?.uge, UGE);
    assert.match(await t.nu(), /Skal vi stoppe søndagstjekket\?/);
  } finally { await t.ryd(); }
  const s = await opsaet();
  try {
    await lavSkjulte({ dir: s.dataDir }).noter([post(1), post(2), post(3)]);
    assert.equal(await s.sut.soendagTik(), 'oprettet');
    assert.equal(await s.sut.soendagTik(), 'findes');
    const b = await s.bog();
    assert.deepEqual([b.uger[0]!.uge, b.uger[0]!.skjulte, b.uger[0]!.traek.length], [UGE, 3, 3]);
    assert.match(await s.nu(), /Denne uge skjulte jeg 3 ting\. Her er 3 tilfældige\./);
  } finally { await s.ryd(); }
});
