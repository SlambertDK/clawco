// KC-0170: the Kuratoren's refusals, log lines, run labels and results in English or Danish. The Danish is what it said
// before the strings moved (captured first); in English nothing Danish reaches the toast, the log, the I gang label or
// Nu's "nothing to do" line. A run the clock starts (no request) speaks Danish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HJEM, laesKurator, startKurator } from '../../src/kurator/kurator.ts';
import { regnskabsfil } from '../../src/kurator/regnskab.ts';
import { fortrydLog, luk, regnskabFlyt, regnskabFortryd, regnskabVaelg, startKortHandling, udsaet, type Udfald } from '../../src/kurator/kortHandlinger.ts';
import { KURATOR_TEKSTER } from '../../src/kurator/tekster.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import { medSprog } from '../../src/store/sprog.ts';
import type { Sprog } from '../../src/store/profil.ts';
import type { RoomDeps, KuratorBesked } from '../../src/rooms/module.ts';
import type { Kort, KuratorState } from '../../src/rooms/hjem/kort.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';
import { renderHjem } from '../../src/rooms/hjem/render.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';

const NU = new Date('2026-10-27T10:00:00Z');
const SENT = new Date('2026-10-27T17:00:00Z');
const fenced = (o: unknown): string => '```json\n' + JSON.stringify(o) + '\n```';
const regel: ReglerLaest = { tilstand: 'ok', aendretUdenfor: false, saet: { naesteId: 3, ugyldige: [], regler: [{ id: 'R-0002', titel: 'Regnskab', tekst: '', trin: 2, gaelder: { kilde: 'mail', slags: 'regning' }, oprindelse: { art: 'import', dato: '2026-10-31' }, status: 'aktiv' }] } };
const kort = (id: string, o: Partial<Kort> = {}): Kort => ({ id, type: 'tjeneste', titel: `Card ${id}`, betyder: 'It means this.', grundlag: [], kilder: [], anbefaling: 'Do it.', prioritet: 3, ...o });
const linje = { hvor: 'shelfatlas' as const, dato: '2026-10-27', leverandoer: 'Acme', beloeb: '20,00', valuta: 'USD', art: 'abonnement' as const, emne: 'Invoice' };

type Verden = { d: RoomDeps; store: ReturnType<typeof createFileStore>; runs: ReturnType<typeof createRunRegistry>; ryd: () => Promise<void> };
async function verden(svar: (instructions: string) => string, beskeder: KuratorBesked[] = [], o: { vault?: boolean } = {}): Promise<Verden> {
  const rod = await mkdtemp(join(tmpdir(), 'kc-kurator-sprog-'));
  const vault = join(rod, 'vault');
  const hermes = createFakeAgent({ answer: (req) => svar(req.instructions) });
  const runs = createRunRegistry(hermes);
  const store = createFileStore(join(rod, 'data'));
  const vedVault = o.vault !== false;
  const d = {
    store, hermes, runs, live: createLiveBus(), now: () => NU, dagenSourceGlob: '', mailStateDir: '',
    mailRunner: async (_c: string, args: string[]) => ({ code: 0, stdout: args[args.indexOf('-m') + 1] === 'Inbox' ? JSON.stringify([{ id: 7, subject: 'Invoice', date: '2026-10-27T09:00:00Z', from: [{ name: 'Acme', email: 'billing@example.com' }], flags: [] }]) : '[]', stderr: '' }),
    himalaya: 'himalaya', vaultInbox: '', vaultRod: vedVault ? vault : '', regnskabsfil: (h: 'shelfatlas' | 'privat') => (vedVault ? regnskabsfil(vault, h) : ''),
    beskeder: async () => beskeder, person: { id: 'ingen', login: null, navn: 'Ingen', rolle: 'gaest' },
    regler: { fil: join(vault, 'regler.md'), laes: async () => regel },
  } as unknown as RoomDeps;
  return { d, store, runs, ryd: () => rm(rod, { recursive: true, force: true }) };
}

const iSprog = <T>(sprog: Sprog | undefined, fn: () => T): T => (sprog ? medSprog(sprog, fn) : fn());
const u = (x: Udfald): string => (x.ok ? 'ok' : `${x.status}: ${x.error}`);

/** The buttons of Nu's cards: every refusal, every log line, every run label. */
async function knapper(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await verden(() => '', [], {});
  const tomVault = await verden(() => '', [], { vault: false });
  try {
    const k = <T>(fn: () => Promise<T>): Promise<T> => iSprog(sprog, fn);
    const kun = async (x: Udfald): Promise<string> => { if (x.ok && x.run) { const r = await x.run.finished; return `${u(x)} run=${r.status} ${r.result?.text ?? r.error ?? ''}`; } return u(x); };
    const state: KuratorState = {
      kort: [kort('k1', { handling: { id: 'h1', label: 'Pay it', instruktion: 'Pay.', fortryd: 'Unpay.' } }), kort('k2'), kort('k3'), kort('k4'),
        kort('u1', { type: 'regning', regnskabUklart: true, betyder: 'An unclear bill.' }), kort('u2', { type: 'regning', regnskab: linje, regnskabUklart: false })],
      intet: [], afvist: [], sete: [],
    };
    await v.store.writeState(HJEM, state);
    ud.push(`snooze-unknown: ${u(await k(() => udsaet(v.d, 'nej', 'aften')))}`);
    ud.push(`snooze-too-late: ${u(await k(() => udsaet({ ...v.d, now: () => SENT }, 'k2', 'aften')))}`);
    ud.push(`snooze: ${u(await k(() => udsaet(v.d, 'k2', 'aften')))} / ${u(await k(() => udsaet(v.d, 'k3', 'morgen')))}`);
    ud.push(`action-unknown: ${u(await k(() => startKortHandling(v.d, 'nej')))}`);
    ud.push(`action-none: ${u(await k(() => startKortHandling(v.d, 'k2')))}`);
    ud.push(`action: ${await kun(await k(() => startKortHandling(v.d, 'k1')))}`);
    ud.push(`close-unknown: ${u(await k(() => luk(v.d, 'nej', '')))}`);
    ud.push(`close: ${await kun(await k(() => luk(v.d, 'k4', '')))}`);
    ud.push(`close-with-reason: ${await kun(await k(() => luk(v.d, 'k3', 'not for me')))}`);
    // Ledger rows
    ud.push(`choose-unknown: ${u(await k(() => regnskabVaelg(v.d, 'nej', 'privat')))}`);
    ud.push(`choose-no-vault: ${u(await k(async () => { await tomVault.store.writeState(HJEM, state); return regnskabVaelg(tomVault.d, 'u1', 'privat'); }))}`);
    ud.push(`undo-no-vault: ${u(await k(() => regnskabFortryd(tomVault.d, 'u2')))}`);
    ud.push(`move-not-written: ${u(await k(() => regnskabFlyt(v.d, 'u2')))}`);
    ud.push(`undo-not-written: ${u(await k(() => regnskabFortryd(v.d, 'u2')))}`);
    ud.push(`choose: ${u(await k(() => regnskabVaelg(v.d, 'u1', 'privat')))}`);
    ud.push(`choose-again: ${u(await k(() => regnskabVaelg(v.d, 'u1', 'privat')))}`);
    ud.push(`move: ${u(await k(() => regnskabFlyt(v.d, 'u1')))}`);
    ud.push(`undo: ${u(await k(() => regnskabFortryd(v.d, 'u1')))}`);
    ud.push(`undo-again: ${u(await k(() => regnskabFortryd(v.d, 'u1')))}`);
    ud.push(`move-after-undo: ${u(await k(() => regnskabFlyt(v.d, 'u1')))}`);
    // Undo from the log
    const log = await v.store.readLog(HJEM, 100);
    ud.push(`log-unknown: ${u(await k(() => fortrydLog(v.d, 'nej')))}`);
    ud.push(`log-undo-action: ${await kun(await k(() => fortrydLog(v.d, log.find((e) => e.handlingId === 'h1')?.id ?? 'nej')))}`);
    const hid = log.find((e) => e.handlingId === 'h1')?.id ?? 'nej';
    ud.push(`log-already: ${u(await k(() => fortrydLog(v.d, hid)))}`);
    ud.push(`log-no-undo: ${u(await k(() => fortrydLog(v.d, log.find((e) => !e.fortryd)!.id)))}`);
    await v.store.appendLog(HJEM, { kilde: 'henrik', tekst: 'local', fortryd: 'lokal:x' });
    const lokal = (await v.store.readLog(HJEM, 1))[0]!.id;
    ud.push(`log-local: ${u(await k(() => fortrydLog(v.d, lokal)))}`);
    const senere = log.find((e) => e.handlingId === 'senere:k2')!.id;
    ud.push(`log-snooze: ${u(await k(() => fortrydLog(v.d, senere)))}`);
    const senere3 = log.find((e) => e.handlingId === 'senere:k3')!.id;
    ud.push(`log-snooze-gone: ${u(await k(() => fortrydLog(v.d, senere3)))}`);
    ud.push(`log: ${(await v.store.readLog(HJEM, 100)).map((e) => e.tekst).reverse().join(' | ')}`);
    ud.push(`labels: ${v.runs.list().map((r) => r.label).filter(Boolean).sort().join(' | ')}`);
  } finally { await v.ryd(); await tomVault.ryd(); }
  return ud;
}

/** The runs: privat (cards, the overflow line, a ledger row), a deep one, and a zone run. */
async function koersler(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const besked: KuratorBesked = { id: 'b-0000000000000001', kanal: 'signal', samtaleNavn: 'Work chat', afsender: { navn: 'Tom' }, tid: '2026-10-27T09:00:00.000Z', tekst: 'Can you look at this?', zone: 'arbejde' };
  const svar = (instr: string): string => /Zone: arbejde\./.test(instr)
    ? fenced({ kort: [{ id: 'besked:a', type: 'familie', titel: 'Work card', betyder: 'Tom asks.', anbefaling: 'Reply.', prioritet: 3, beskedId: besked.id }], vurderinger: [], intet: [] })
    : fenced({ kort: [...Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, type: 'tjeneste', titel: `Card ${i}`, betyder: 'Means.', anbefaling: 'Do.', prioritet: i + 1 })), { id: 'regning:acme', type: 'regning', titel: 'Acme bill', betyder: 'A bill.', anbefaling: 'None.', prioritet: 1, regnskab: linje }], vurderinger: [], intet: [] });
  const v = await verden(svar, [besked]);
  try {
    const privat = await iSprog(sprog, () => startKurator(v.d, { dyb: true, nyheder: null }));
    const r = await privat!.finished;
    await Promise.all(v.runs.list().filter((x) => x.kind === 'kurator').map((x) => x.finished));
    ud.push(`privat-run: ${r.status} ${r.result?.text ?? r.error ?? ''}`);
    const s = await laesKurator(v.store);
    ud.push(`nothing: ${s.intet.map((i) => `${i.titel}=${i.hvorfor}`).join(', ')}`);
    ud.push(`render-nothing: ${[...String(iSprog(sprog, () => renderHjem({ hilsen: 'Hi', venter: [], hermes: [], intet: s.intet }))).matchAll(/row-title">Card \d<\/span><span class="row-note">([^<]*)</g)].map((m) => m[1]).join(', ')}`);
    ud.push(`log: ${(await v.store.readLog(HJEM, 100)).map((e) => e.tekst).reverse().join(' | ')}`);
    ud.push(`labels: ${v.runs.list().map((x) => x.label).filter(Boolean).sort().join(' | ')}`);
    ud.push(`card-zones: ${s.kort.map((k) => k.zone ?? 'privat').sort().join(',')}`);
    // The unclear amount: Hermes could not place the bill, the owner picks a ledger
    await v.store.writeState(HJEM, { ...s, kort: [kort('u1', { type: 'regning', regnskabUklart: true, betyder: 'Unclear.' })], regnskab: {} });
    ud.push(`choose: ${u(await iSprog(sprog, () => regnskabVaelg(v.d, 'u1', 'privat')))}`);
    ud.push(`unclear-line: ${JSON.stringify((await laesKurator(v.store)).kort[0]?.regnskab?.beloeb)}`);
  } finally { await v.ryd(); }
  return ud;
}

test('Kuratoren: English has exactly Danish\'s keys and shapes; no string is empty; none is a Danish string copied over', async () => {
  const { form, tomme, ensStrenge } = await import('../fixtures/sprog-tjek.ts');
  const rec = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
  assert.deepEqual(form(KURATOR_TEKSTER.en), form(KURATOR_TEKSTER.da));
  for (const t of [KURATOR_TEKSTER.da, KURATOR_TEKSTER.en]) assert.deepEqual(tomme(rec(t)), []);
  assert.deepEqual(ensStrenge(rec(KURATOR_TEKSTER.da), rec(KURATOR_TEKSTER.en)), []);
});

test('Nu: the overflow reason stored in either language reads in the language of the request; Hermes\' own reasons stay as they are', () => {
  const vis = (sprog: Sprog | undefined, hvorfor: string): string => [...String(iSprog(sprog, () => renderHjem({ hilsen: 'Hi', venter: [], hermes: [], intet: [{ titel: 'Card X', hvorfor }] }))).matchAll(/row-title">Card X<\/span><span class="row-note">([^<]*)</g)].map((m) => m[1]).join('');
  assert.equal(vis(undefined, 'plads'), 'plads');
  assert.equal(vis('en', 'plads'), 'no room');
  assert.equal(vis('da', 'no room'), 'plads');
  assert.equal(vis('en', 'Ingen handling'), 'Ingen handling');
});

test('Kuratoren: Danish (no language, and da) is what the buttons and runs said before', async () => {
  const a = await knapper(undefined);
  assert.deepEqual(await knapper('da'), a);
  assert.deepEqual(a, DANSK_KNAPPER);
  const b = await koersler(undefined);
  assert.deepEqual(await koersler('da'), b);
  assert.deepEqual(b, DANSK_KOERSLER);
});

test('Kuratoren: English says everything in English, and no Danish line is left', async () => {
  const k = await knapper('en');
  assert.deepEqual(k.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(k, ENGELSK_KNAPPER);
  const r = await koersler('en');
  assert.deepEqual(r.filter((l) => DANSK.test(l)), []);
  assert.deepEqual(r, ENGELSK_KOERSLER);
});

const DANSK_KNAPPER: string[] = [
  "snooze-unknown: 404: Kortet findes ikke",
  "snooze-too-late: 409: I aften kan kun vælges før kl. 17",
  "snooze: ok / ok",
  "action-unknown: 404: Kortet findes ikke",
  "action-none: 404: Kortet har ingen handling",
  "action: ok run=done Pay it: gjort.",
  "close-unknown: 404: Kortet findes ikke",
  "close: ok",
  "close-with-reason: ok run=done Noteret.",
  "choose-unknown: 404: Kortet findes ikke",
  "choose-no-vault: 503: Ingen vault sat op",
  "undo-no-vault: 503: Ingen vault sat op",
  "move-not-written: 409: Kortet er ikke skrevet i et regnskab",
  "undo-not-written: 409: Kortet er ikke skrevet i et regnskab",
  "choose: ok",
  "choose-again: 409: Kortet venter ikke på et valg af regnskab",
  "move: ok",
  "undo: ok",
  "undo-again: 409: Kortet er ikke skrevet i et regnskab",
  "move-after-undo: 409: Kortet er ikke skrevet i et regnskab",
  "log-unknown: 404: Linjen findes ikke",
  "log-undo-action: ok run=done Fortrudt.",
  "log-already: 409: Allerede fortrudt",
  "log-no-undo: 404: Kan ikke fortrydes",
  "log-local: 404: Kan ikke fortrydes her",
  "log-snooze: ok",
  "log-snooze-gone: 409: Kortet er væk, så der er intet at hente tilbage",
  "log: Udsat til i aften kl. 18: Card k2 | Udsat til i morgen kl. 07: Card k3 | Pay it: gjort. | Lukkede \"Card k4\" | Lukkede \"Card k3\": not for me | Noteret. | Skrev Card u1 se mail  ind i det private regnskab | Flyttede Card u1 se mail  til ShelfAtlas-regnskabet | Fortrudt. | local",
  "labels: Nu: Pay it | Nu: fortryder | Nu: lærer af dit svar",
];
const ENGELSK_KNAPPER: string[] = [
  "snooze-unknown: 404: The card does not exist",
  "snooze-too-late: 409: Tonight can only be chosen before 17:00",
  "snooze: ok / ok",
  "action-unknown: 404: The card does not exist",
  "action-none: 404: The card has no action",
  "action: ok run=done Pay it: done.",
  "close-unknown: 404: The card does not exist",
  "close: ok",
  "close-with-reason: ok run=done Noted.",
  "choose-unknown: 404: The card does not exist",
  "choose-no-vault: 503: No vault is set up",
  "undo-no-vault: 503: No vault is set up",
  "move-not-written: 409: The card has not been written to a ledger",
  "undo-not-written: 409: The card has not been written to a ledger",
  "choose: ok",
  "choose-again: 409: The card is not waiting for a choice of ledger",
  "move: ok",
  "undo: ok",
  "undo-again: 409: The card has not been written to a ledger",
  "move-after-undo: 409: The card has not been written to a ledger",
  "log-unknown: 404: The line does not exist",
  "log-undo-action: ok run=done Undone.",
  "log-already: 409: Already undone",
  "log-no-undo: 404: Cannot be undone",
  "log-local: 404: Cannot be undone here",
  "log-snooze: ok",
  "log-snooze-gone: 409: The card is gone, so there is nothing to bring back",
  "log: Snoozed until tonight at 18:00: Card k2 | Snoozed until tomorrow at 07:00: Card k3 | Pay it: done. | Closed \"Card k4\" | Closed \"Card k3\": not for me | Noted. | Wrote Card u1 see mail  into the private ledger | Moved Card u1 see mail  to the ShelfAtlas ledger | Undone. | local",
  "labels: Now: Pay it | Now: learning from your answer | Now: undoing",
];
const DANSK_KOERSLER: string[] = [
  "privat-run: done 7 kort",
  "nothing: Card 5=plads, Card 6=plads, Card 7=plads",
  "render-nothing: plads, plads, plads",
  "log: Skrev Acme 20,00 USD ind i ShelfAtlas-regnskabet | Kuratoren (Arbejde): et kort fra beskeder er lagt øverst.",
  "labels: Kuratoren tænker (arbejde) | Kuratoren tænker grundigt",
  "card-zones: arbejde,privat,privat,privat,privat,privat,privat",
  "choose: ok",
  "unclear-line: \"se mail\"",
];
const ENGELSK_KOERSLER: string[] = [
  "privat-run: done 7 cards",
  "nothing: Card 5=no room, Card 6=no room, Card 7=no room",
  "render-nothing: no room, no room, no room",
  "log: Wrote Acme 20,00 USD into the ShelfAtlas ledger | The curator (Work): a card from messages put at the top.",
  "labels: The curator is thinking (work) | The curator is thinking hard",
  "card-zones: arbejde,privat,privat,privat,privat,privat,privat",
  "choose: ok",
  "unclear-line: \"see mail\"",
];
