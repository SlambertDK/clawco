import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HJEM, laesKurator, startKurator } from '../../src/kurator/kurator.ts';
import { regnskabsfil, skrivRegnskab } from '../../src/kurator/regnskab.ts';
import { luk, regnskabFortryd, udsaet } from '../../src/kurator/kortHandlinger.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createLiveBus } from '../../src/live.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import type { Runner } from '../../src/rooms/mail/source.ts';
import type { KuratorState } from '../../src/rooms/hjem/kort.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';
import type { Regel, Trin } from '../../src/tillid/regler.ts';
import { regnskabVaelg } from '../../src/kurator/kortHandlinger.ts';

const NOW = new Date('2026-10-27T12:00:00Z');

function envelopes(): Runner {
  return async (_cmd, args) => {
    const mappe = args[args.indexOf('-m') + 1];
    const list = mappe === 'Inbox'
      ? [{ id: 7, subject: 'Your Vercel invoice', date: '2026-10-27T09:00:00Z', from: [{ name: 'Vercel', email: 'billing@vercel.example' }], flags: [] }]
      : [];
    return { code: 0, stdout: JSON.stringify(list), stderr: '' };
  };
}
const ingenMail: Runner = async () => ({ code: 0, stdout: '[]', stderr: '' });

const regningSvar = (hvor = 'shelfatlas', prioritet = 3, ekstra: unknown[] = []): string => '```json\n' + JSON.stringify({
  kort: [...ekstra, {
    id: 'regning:vercel-7', type: 'regning', titel: 'Vercel-regning', betyder: 'En regning på 20 USD.', grundlag: [], kilder: [], anbefaling: 'Intet.', prioritet,
    regnskab: { hvor, dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', art: 'abonnement', emne: 'Your Vercel invoice' },
  }],
  vurderinger: [],
  intet: [],
}) + '\n```';

/** KC-0143: a rules file as the lager reads it; by default the reference install's R-0002 (mail / regning, trin 2). */
const regelFil = (trin: Trin = 2, gaelder: Regel['gaelder'] = { kilde: 'mail', slags: 'regning' }, status: Regel['status'] = 'aktiv'): ReglerLaest =>
  ({ tilstand: 'ok', aendretUdenfor: false, saet: { naesteId: 3, ugyldige: [], regler: [{ id: 'R-0002', titel: 'Regnskab', tekst: '', trin, gaelder, oprindelse: { art: 'import', dato: '2026-10-31' }, status }] } });

async function opsaet(o: { answer?: () => string; runner?: Runner; delayMs?: number; vaultInbox?: string; regler?: ReglerLaest | null } = {}) {
  const rod = await mkdtemp(join(tmpdir(), 'kc-kurator-'));
  const vault = join(rod, 'vault');
  const hermes = createFakeAgent({ answer: o.answer ?? (() => regningSvar()), ...(o.delayMs ? { delayMs: o.delayMs } : {}) });
  const runs = createRunRegistry(hermes);
  runs.setModels({ lille: 'model-lille', taenker: 'model-taenker' });
  const store = createFileStore(join(rod, 'data'));
  const live = createLiveBus();
  const d = {
    store, hermes, runs, live, now: () => NOW,
    mailRunner: o.runner ?? envelopes(), himalaya: 'himalaya', vaultInbox: o.vaultInbox ?? join(vault, '00-Indbakke'),
    // Timers run as INGEN (a guest): the rules, not the role, decide what Kuratoren writes on its own (KC-0143).
    person: { id: 'ingen', login: null, navn: 'Ingen', rolle: 'gaest' },
    ...(o.regler === null ? {} : { regler: { fil: join(vault, 'Clawco', 'regler.md'), laes: async () => o.regler ?? regelFil() } }),
  } as unknown as RoomDeps;
  return { d, hermes, runs, store, live, vault, ryd: () => rm(rod, { recursive: true, force: true }) };
}

test('laesKurator gives an empty state when none is stored', async () => {
  const t = await opsaet();
  try {
    assert.deepEqual(await laesKurator(t.store), { kort: [], intet: [], afvist: [], sete: [] });
  } finally { await t.ryd(); }
});

test('no new mail, no news, not dyb: null and Hermes is not called', async () => {
  const t = await opsaet({ runner: ingenMail });
  try {
    assert.equal(await startKurator(t.d, { dyb: false, nyheder: null }), null);
    assert.equal(t.hermes.calls.length, 0);
  } finally { await t.ryd(); }
});

test('a bill card writes one ledger row, sets skrevet, logs once; the same answer again still gives one row', async () => {
  const t = await opsaet();
  try {
    const r1 = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(r1);
    assert.equal((await r1.finished).status, 'done');
    const fil = regnskabsfil(t.vault, 'shelfatlas');
    const tekst = await readFile(fil, 'utf8');
    assert.equal(tekst.split('\n').filter((l) => l.includes('<!-- kc:regning:vercel-7 -->')).length, 1);
    const s = await laesKurator(t.store);
    assert.equal(s.kort.length, 1);
    assert.deepEqual(s.kort[0]?.skrevet, { hvor: 'shelfatlas', fil });
    assert.equal(s.sidst, NOW.toISOString());
    assert.equal(s.sidstDyb, undefined);
    assert.ok(s.cursor);
    assert.deepEqual(s.sete, ['Inbox:7']);
    const log = await t.store.readLog(HJEM);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.kilde, 'hermes');
    assert.equal(log[0]?.handlingId, 'regnskab:regning:vercel-7');
    assert.equal(log[0]?.tekst, 'Skrev Vercel 20,00 USD ind i ShelfAtlas-regnskabet');

    // Same answer again (a dyb run, so Hermes is called without new mail).
    const r2 = await startKurator(t.d, { dyb: true, nyheder: null });
    assert.ok(r2);
    assert.equal((await r2.finished).status, 'done');
    const igen = await readFile(fil, 'utf8');
    assert.equal(igen.split('\n').filter((l) => l.includes('<!-- kc:regning:vercel-7 -->')).length, 1);
    assert.equal((await t.store.readLog(HJEM)).length, 1);
    const s2 = await laesKurator(t.store);
    assert.deepEqual(s2.kort[0]?.skrevet, { hvor: 'shelfatlas', fil });
    assert.equal(s2.sidstDyb, NOW.toISOString());
  } finally { await t.ryd(); }
});

test('KC-0096: a snoozed card stays away when a Kuratoren run emits the same card id again', async () => {
  const t = await opsaet();
  try {
    await (await startKurator(t.d, { dyb: false, nyheder: null }))?.finished;
    assert.deepEqual((await udsaet(t.d, 'regning:vercel-7', 'morgen')), { ok: true });
    assert.equal((await laesKurator(t.store)).kort[0]?.udsatTil, '2026-10-28T06:00:00.000Z');
    const r = await startKurator(t.d, { dyb: true, nyheder: null }); // Hermes answers with the same card again
    assert.equal((await r?.finished)?.status, 'done');
    const s = await laesKurator(t.store);
    assert.equal(s.kort.length, 1);
    assert.equal(s.kort[0]?.udsatTil, '2026-10-28T06:00:00.000Z', 'the snooze survived the run');
    assert.ok(s.kort[0]?.skrevet, 'and so did the ledger row marker');
  } finally { await t.ryd(); }
});

test('a private bill is logged as the private ledger', async () => {
  const t = await opsaet({ answer: () => regningSvar('privat') });
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    await r?.finished;
    const log = await t.store.readLog(HJEM);
    assert.equal(log[0]?.tekst, 'Skrev Vercel 20,00 USD ind i det private regnskab');
    assert.ok((await readFile(regnskabsfil(t.vault, 'privat'), 'utf8')).includes('<!-- kc:regning:vercel-7 -->'));
  } finally { await t.ryd(); }
});

test('an unclear bill card writes nothing', async () => {
  const svar = '```json\n' + JSON.stringify({ kort: [{ id: 'regning:x', type: 'regning', titel: 'T', betyder: 'B', prioritet: 2, regnskab: { hvor: 'uklart' } }] }) + '\n```';
  const t = await opsaet({ answer: () => svar });
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    const s = await laesKurator(t.store);
    assert.equal(s.kort[0]?.regnskabUklart, true);
    assert.equal(s.kort[0]?.skrevet, undefined);
    assert.equal((await t.store.readLog(HJEM)).length, 0);
  } finally { await t.ryd(); }
});

test('without a vault inbox the ledger is skipped, the card keeps regnskab and there is no skrevet', async () => {
  const t = await opsaet({ vaultInbox: '' });
  const orig = console.error;
  const meldinger: string[] = [];
  console.error = (...a: unknown[]) => { meldinger.push(a.join(' ')); };
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    const s = await laesKurator(t.store);
    assert.ok(s.kort[0]?.regnskab);
    assert.equal(s.kort[0]?.skrevet, undefined);
    assert.equal(meldinger.length, 1);
    assert.equal((await t.store.readLog(HJEM)).length, 0);
  } finally { console.error = orig; await t.ryd(); }
});

test('a garbage answer fails the run and leaves the stored state untouched', async () => {
  const t = await opsaet({ answer: () => 'det her er ikke json' });
  try {
    const for_: KuratorState = { kort: [], intet: [{ titel: 'x', hvorfor: 'y' }], afvist: ['a'], sete: ['Inbox:1'], cursor: '2026-10-26T00:00:00.000Z', sidst: '2026-10-26T10:00:00.000Z' };
    await t.store.writeState(HJEM, for_);
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(r);
    assert.equal((await r.finished).status, 'failed');
    assert.deepEqual(await t.store.readState(HJEM), for_);
    assert.equal((await t.store.readLog(HJEM)).length, 0);
  } finally { await t.ryd(); }
});

test("kind is 'kurator', room hjem, and the model is the taenker tier", async () => {
  const t = await opsaet();
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(r);
    assert.equal(r.kind, 'kurator');
    assert.equal(r.room, 'hjem');
    assert.equal(r.label, 'Kuratoren tænker');
    await r.finished;
    assert.equal(t.hermes.calls[0]?.model, 'model-taenker');
    const dyb = await startKurator(t.d, { dyb: true, nyheder: null });
    assert.equal(dyb?.label, 'Kuratoren tænker grundigt');
    await dyb?.finished;
  } finally { await t.ryd(); }
});

test('one deep run a day: a second dyb start the same day runs without the web-search line, the next day it is deep again', async () => {
  const t = await opsaet();
  const NET = 'søg på nettet efter sikkerhedshuller';
  try {
    const a = await startKurator(t.d, { dyb: true, nyheder: null });
    assert.equal(a?.label, 'Kuratoren tænker grundigt');
    await a?.finished;
    assert.ok(t.hermes.calls[0]?.instructions.includes(NET));
    const forste = (await laesKurator(t.store)).sidstDyb;
    assert.ok(forste);
    assert.equal(await startKurator(t.d, { dyb: true, nyheder: null }), null, 'nothing new and the deep run is spent: no run');
    const b = await startKurator(t.d, { dyb: true, nyheder: ['En nyhed'] });
    assert.equal(b?.label, 'Kuratoren tænker', 'run as non-deep');
    await b?.finished;
    assert.ok(!t.hermes.calls[1]?.instructions.includes(NET));
    assert.equal((await laesKurator(t.store)).sidstDyb, forste, 'a refused deep run does not move sidstDyb');
    t.d.now = () => new Date('2026-10-28T09:00:00Z');
    const c = await startKurator(t.d, { dyb: true, nyheder: null });
    await c?.finished;
    assert.ok(t.hermes.calls[2]?.instructions.includes(NET), 'a new day allows a deep run');
  } finally { await t.ryd(); }
});

test("the 'laer' kind runs on the lille tier", async () => {
  const t = await opsaet();
  try {
    const r = t.runs.start({ kind: 'laer', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({}) });
    await r.finished;
    assert.equal(t.hermes.calls[0]?.model, 'model-lille');
  } finally { await t.ryd(); }
});

test('a second start while one runs gives null, also when started together', async () => {
  const t = await opsaet({ delayMs: 40 });
  try {
    const a = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(a);
    assert.equal(await startKurator(t.d, { dyb: true, nyheder: null }), null);
    await a.finished;

    const t2 = await opsaet({ delayMs: 40 });
    try {
      const [x, y] = await Promise.all([startKurator(t2.d, { dyb: false, nyheder: null }), startKurator(t2.d, { dyb: false, nyheder: null })]);
      assert.equal([x, y].filter((r) => r !== null).length, 1);
      await (x ?? y)?.finished;
    } finally { await t2.ryd(); }
  } finally { await t.ryd(); }
});

test('success notifies the Hjem live bus', async () => {
  const t = await opsaet();
  try {
    const v = t.live.version(HJEM);
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    await r?.finished;
    assert.equal(t.live.version(HJEM), v + 1);
  } finally { await t.ryd(); }
});

const tomtState = (extra: Partial<KuratorState> = {}): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [], ...extra });

test('a bill card whose id is in afvist: no row, no log, no card', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState(HJEM, tomtState({ afvist: ['regning:vercel-7'] }));
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    await assert.rejects(readFile(regnskabsfil(t.vault, 'shelfatlas'), 'utf8'));
    assert.equal((await t.store.readLog(HJEM)).length, 0);
    const s = await laesKurator(t.store);
    assert.equal(s.kort.length, 0);
    assert.equal(s.regnskab, undefined);
  } finally { await t.ryd(); }
});

test('a bill card that overflows past MAX_KORT: no row, no log', async () => {
  const ekstra = Array.from({ length: 8 }, (_, i) => ({ id: `nyhed:${i}`, type: 'nyhed', titel: `N${i}`, betyder: 'B', prioritet: 1 }));
  const t = await opsaet({ answer: () => regningSvar('shelfatlas', 9, ekstra) });
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    const s = await laesKurator(t.store);
    assert.equal(s.kort.length, 7);
    assert.ok(!s.kort.some((k) => k.id === 'regning:vercel-7'));
    await assert.rejects(readFile(regnskabsfil(t.vault, 'shelfatlas'), 'utf8'));
    assert.equal((await t.store.readLog(HJEM)).length, 0);
  } finally { await t.ryd(); }
});

test('an expired bill card writes nothing', async () => {
  const udloebet = '```json\n' + JSON.stringify({ kort: [{ id: 'regning:vercel-7', type: 'regning', titel: 'T', betyder: 'B', prioritet: 2, gyldigTil: '2026-10-01', regnskab: { hvor: 'shelfatlas', dato: '2026-10-01', leverandoer: 'V', beloeb: '1', valuta: 'USD', art: 'koeb', emne: 'e' } }] }) + '\n```';
  const t = await opsaet({ answer: () => udloebet });
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    await assert.rejects(readFile(regnskabsfil(t.vault, 'shelfatlas'), 'utf8'));
    assert.equal((await t.store.readLog(HJEM)).length, 0);
  } finally { await t.ryd(); }
});

test('a card id with a fortrudt entry in state.regnskab is never written again', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState(HJEM, tomtState({ regnskab: { 'regning:vercel-7': { hvor: 'shelfatlas', status: 'fortrudt' } } }));
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    await assert.rejects(readFile(regnskabsfil(t.vault, 'shelfatlas'), 'utf8'));
    assert.equal((await t.store.readLog(HJEM)).length, 0);
    const s = await laesKurator(t.store);
    assert.equal(s.kort[0]?.skrevet, undefined);
    assert.deepEqual(s.regnskab, { 'regning:vercel-7': { hvor: 'shelfatlas', status: 'fortrudt' } });
  } finally { await t.ryd(); }
});

test('a successful write records status skrevet in state.regnskab', async () => {
  const t = await opsaet();
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    await r?.finished;
    assert.deepEqual((await laesKurator(t.store)).regnskab, { 'regning:vercel-7': { hvor: 'shelfatlas', status: 'skrevet', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', zone: 'privat' } }, 'the written line is kept, so the row can be undone after the card retires');
  } finally { await t.ryd(); }
});

test('Henrik dismissing a card and undoing a row while the run writes a bill: both stick, the new bill keeps its ledger status', async () => {
  const gammelLinje = { hvor: 'privat' as const, dato: '2026-10-20', leverandoer: 'Netto', beloeb: '99,00', valuta: 'DKK', art: 'koeb' as const, emne: 'Kvittering' };
  const svar = '```json\n' + JSON.stringify({
    kort: [{ id: 'regning:vercel-7', type: 'regning', titel: 'Vercel-regning', betyder: 'En regning på 20 USD.', anbefaling: 'Intet.', prioritet: 3,
      regnskab: { hvor: 'shelfatlas', dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', art: 'abonnement', emne: 'Your Vercel invoice' } }],
    vurderinger: [{ id: 'k:a', status: 'behold', hvorfor: 'stadig' }, { id: 'regning:netto', status: 'behold', hvorfor: 'stadig' }],
    intet: [],
  }) + '\n```';
  const t = await opsaet({ answer: () => svar });
  try {
    const privat = regnskabsfil(t.vault, 'privat');
    await skrivRegnskab(privat, 'regning:netto', gammelLinje);
    const netto = { id: 'regning:netto', type: 'regning' as const, titel: 'Netto', betyder: 'Kvittering.', grundlag: [], kilder: [], anbefaling: '', prioritet: 4, regnskab: gammelLinje, skrevet: { hvor: 'privat' as const, fil: privat } };
    const a = { id: 'k:a', type: 'tjeneste' as const, titel: 'Cloudflare', betyder: 'Intet.', grundlag: [], kilder: [], anbefaling: '', prioritet: 5 };
    await t.store.writeState(HJEM, { kort: [a, netto], intet: [], afvist: [], sete: [], regnskab: { 'regning:netto': { hvor: 'privat', status: 'skrevet' } } });
    // Hold the run right after it wrote the Vercel row (its log entry), before it stores the state.
    let slip!: () => void;
    const port = new Promise<void>((r) => { slip = r; });
    let ramt!: () => void;
    const iGang = new Promise<void>((r) => { ramt = r; });
    const appendLog = t.store.appendLog.bind(t.store);
    t.store.appendLog = async (rum, e) => {
      if (e.handlingId === 'regnskab:regning:vercel-7') { ramt(); await port; }
      return appendLog(rum, e);
    };
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.ok(r);
    await iGang;
    const afvis = luk(t.d, 'k:a', '');
    const fortryd = regnskabFortryd(t.d, 'regning:netto');
    await new Promise((res) => setTimeout(res, 50));
    slip();
    assert.equal((await r.finished).status, 'done', r.error);
    assert.equal((await afvis).ok, true);
    assert.equal((await fortryd).ok, true);
    const s = await laesKurator(t.store);
    assert.ok(!s.kort.some((k) => k.id === 'k:a'), 'the dismissed card stays dismissed');
    assert.ok(s.afvist.includes('k:a'));
    assert.equal(s.regnskab?.['regning:netto']?.status, 'fortrudt', 'the undone row stays undone');
    assert.equal(s.kort.find((k) => k.id === 'regning:netto')?.skrevet, undefined);
    assert.ok(!(await readFile(privat, 'utf8')).includes('kc:regning:netto'));
    assert.equal(s.regnskab?.['regning:vercel-7']?.status, 'skrevet', 'the bill written by the run keeps its status');
    assert.ok(s.kort.find((k) => k.id === 'regning:vercel-7')?.skrevet);
  } finally { await t.ryd(); }
});

test('two card writes at once (two dismissals) both land', async () => {
  const t = await opsaet();
  try {
    const k = (id: string) => ({ id, type: 'tjeneste' as const, titel: id, betyder: 'B', grundlag: [], kilder: [], anbefaling: '', prioritet: 5 });
    await t.store.writeState(HJEM, { kort: [k('k:a'), k('k:b'), k('k:c')], intet: [], afvist: [], sete: [] });
    await Promise.all([luk(t.d, 'k:a', ''), luk(t.d, 'k:b', '')]);
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort.map((x) => x.id), ['k:c']);
    assert.deepEqual([...s.afvist].sort(), ['k:a', 'k:b']);
  } finally { await t.ryd(); }
});

test("'findes' without a log entry (crash between write and log) appends the log entry", async () => {
  const t = await opsaet();
  try {
    const fil = regnskabsfil(t.vault, 'shelfatlas');
    await skrivRegnskab(fil, 'regning:vercel-7', { hvor: 'shelfatlas', dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', art: 'abonnement', emne: 'Your Vercel invoice' });
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    assert.equal((await r?.finished)?.status, 'done');
    const log = await t.store.readLog(HJEM);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.handlingId, 'regnskab:regning:vercel-7');
    const rader = (await readFile(fil, 'utf8')).split('\n').filter((l) => l.includes('<!-- kc:regning:vercel-7 -->'));
    assert.equal(rader.length, 1);
    assert.equal((await laesKurator(t.store)).kort[0]?.skrevet?.hvor, 'shelfatlas');
  } finally { await t.ryd(); }
});

test('with an empty vaultInbox Hermes is told the vault location is unknown, not "."', async () => {
  const t = await opsaet({ vaultInbox: '' });
  try {
    const r = await startKurator(t.d, { dyb: false, nyheder: null });
    await r?.finished;
    const instr = t.hermes.calls[0]?.instructions ?? '';
    assert.ok(instr.includes('vaultens placering er ukendt'));
  } finally { await t.ryd(); }
});

test('nyhederSet: stored on success when nyheder is passed, kept when it is not, never stored by a failed run', async () => {
  const t = await opsaet({ runner: ingenMail, answer: () => regningSvar() });
  try {
    const r1 = await startKurator(t.d, { dyb: false, nyheder: ['L1'], nyhederStempel: '2026-10-27T05:10:00Z' });
    assert.equal((await r1?.finished)?.status, 'done');
    assert.equal((await laesKurator(t.store)).nyhederSet, '2026-10-27T05:10:00Z');
    // A dyb run without news must not wipe the stamp.
    const r2 = await startKurator(t.d, { dyb: true, nyheder: null });
    assert.equal((await r2?.finished)?.status, 'done');
    assert.equal((await laesKurator(t.store)).nyhederSet, '2026-10-27T05:10:00Z');
  } finally { await t.ryd(); }
  const f = await opsaet({ runner: ingenMail, answer: () => 'not json' });
  try {
    const r = await startKurator(f.d, { dyb: false, nyheder: ['L1'], nyhederStempel: '2026-10-27T05:10:00Z' });
    assert.equal((await r?.finished)?.status, 'failed');
    assert.equal((await laesKurator(f.store)).nyhederSet, undefined, 'a failed run re-reads the same news next time');
  } finally { await f.ryd(); }
});

// KC-0143: the ledger row is trin 2 (bogføre). Without an active rule for mail / regning at trin 2 or above,
// nothing is written on its own: the bill stays a card that asks which rule should cover it.
for (const [navn, regler] of [
  ['no rules lager', null],
  ['no rules file', { tilstand: 'mangler' }],
  ['an unreadable rules file', { tilstand: 'ulaeselig', hvorfor: 'linjen "naeste-id" mangler', aendretUdenfor: false }],
  ['a trin-1 rule', regelFil(1)],
  ['a paused trin-2 rule', regelFil(2, undefined, 'pause')],
  ['a trin-4 rule for another kind of mail', regelFil(4, { kilde: 'mail', slags: 'nyhedsbrev' })],
] as const) {
  test(`KC-0143: ${navn} → no ledger row, no regnskab entry, the card asks for a rule`, async () => {
    const t = await opsaet({ regler: regler as ReglerLaest | null });
    try {
      const r = await startKurator(t.d, { dyb: false, nyheder: null });
      assert.equal((await r?.finished)?.status, 'done');
      await assert.rejects(readFile(regnskabsfil(t.vault, 'shelfatlas'), 'utf8'), { code: 'ENOENT' });
      const s = await laesKurator(t.store);
      assert.equal(s.kort.length, 1);
      assert.equal(s.kort[0]?.skrevet, undefined);
      assert.equal(s.kort[0]?.kraeverRegel, true);
      assert.ok(s.kort[0]?.regnskab, 'the proposed line stays on the card for Henrik');
      assert.equal(s.regnskab?.['regning:vercel-7'], undefined, 'not recorded: a later run under a covering rule may write it');
      assert.equal((await t.store.readLog(HJEM)).filter((e) => e.handlingId?.startsWith('regnskab:')).length, 0, 'nothing written, nothing logged as written');
    } finally { await t.ryd(); }
  });
}

test('KC-0143: a trin-3 rule, or a rule for all of mail, covers the trin-2 write', async () => {
  for (const regler of [regelFil(3), regelFil(2, { kilde: 'mail' }), regelFil(4, { kilde: '*' })]) {
    const t = await opsaet({ regler });
    try {
      await (await startKurator(t.d, { dyb: false, nyheder: null }))?.finished;
      const s = await laesKurator(t.store);
      assert.ok(s.kort[0]?.skrevet);
      assert.equal(s.kort[0]?.kraeverRegel, undefined);
    } finally { await t.ryd(); }
  }
});

test('KC-0143: denied, then a covering rule — the next answer writes it; Henrik\'s own tap writes it and clears the question', async () => {
  let laest: ReglerLaest = { tilstand: 'mangler' };
  const t = await opsaet();
  (t.d as unknown as { regler: { laes: () => Promise<ReglerLaest> } }).regler.laes = async () => laest;
  try {
    await (await startKurator(t.d, { dyb: false, nyheder: null }))?.finished;
    assert.equal((await laesKurator(t.store)).kort[0]?.kraeverRegel, true);
    laest = regelFil();
    await (await startKurator(t.d, { dyb: true, nyheder: null }))?.finished;
    const s = await laesKurator(t.store);
    assert.ok(s.kort[0]?.skrevet, 'written once a rule covers it');
    assert.equal(s.kort[0]?.kraeverRegel, undefined);
  } finally { await t.ryd(); }

  const u = await opsaet({ regler: { tilstand: 'mangler' } });
  try {
    await (await startKurator(u.d, { dyb: false, nyheder: null }))?.finished;
    assert.deepEqual(await regnskabVaelg(u.d, 'regning:vercel-7', 'privat'), { ok: true });
    const s = await laesKurator(u.store);
    assert.equal(s.kort[0]?.skrevet?.hvor, 'privat');
    assert.equal(s.kort[0]?.kraeverRegel, undefined, 'Henrik answered the question with his own tap');
    assert.equal((await u.store.readLog(HJEM)).at(-1)?.kilde, 'henrik');
  } finally { await u.ryd(); }
});
