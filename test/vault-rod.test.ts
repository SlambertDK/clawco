// KC-0213: one vault root. Everything Clawco writes into the user's folders (the rules file, the ledgers, the inbox,
// "Læs senere", the people register) follows ONE answer to "where is the vault", and the ledger paths are data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { noterStier, vaultRodAf } from '../src/kilder/noter/stier.ts';
import { skrivKonfig, type KonfigPost } from '../src/kilder/register.ts';
import { lavReglerLager } from '../src/tillid/lager.ts';
import { regnskabsfil } from '../src/kurator/regnskab.ts';
import { AELDRE_STIER, REGNSKAB_FIL, STANDARD_STIER, adopterAeldreStier, laesRegnskabsstier, lavRegnskabsfil } from '../src/kurator/regnskabssti.ts';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import type { Kort, KuratorState } from '../src/rooms/hjem/kort.ts';

const tmp = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'kc-vaultrod-'));
const NU = new Date('2026-10-27T12:00:00Z');

// ---- Henrik's install: the paths as they were before KC-0213 (literal, taken from the code as it was) -------------

const HENRIK_ENV = { KC_VAULT_INBOX: '/mnt/nas-obsidian/ObsidianVault/00-Indbakke', KC_PEOPLE_DIR: '/mnt/nas-obsidian/ObsidianVault/40-Mennesker/People' };

test('golden: Henrik\'s install (env set, ledgers already in place) resolves every path byte for byte as before', async () => {
  const data = await tmp();
  try {
    const s = noterStier(HENRIK_ENV, '', data);
    assert.equal(s.rod, '/mnt/nas-obsidian/ObsidianVault');
    assert.equal(s.indbakke, '/mnt/nas-obsidian/ObsidianVault/00-Indbakke');
    assert.equal(s.personer, '/mnt/nas-obsidian/ObsidianVault/40-Mennesker/People');
    assert.equal(lavReglerLager({ vaultDir: s.rod, dataDir: data }).fil, '/mnt/nas-obsidian/ObsidianVault/Clawco/regler.md');
    // His ledgers exist at the old places: the app adopts them (one log line) and keeps writing there.
    const finder = (f: string): boolean => f === '/mnt/nas-obsidian/ObsidianVault/30-Projekter/ShelfAtlas/Regnskab.md' || f === '/mnt/nas-obsidian/ObsidianVault/10-Privat/Økonomi/abonnementer.md';
    const linjer: string[] = [];
    const fil = lavRegnskabsfil({ dataDir: data, rod: () => noterStier(HENRIK_ENV, '', data).rod, finder, log: (l) => linjer.push(l) });
    assert.equal(fil('shelfatlas'), '/mnt/nas-obsidian/ObsidianVault/30-Projekter/ShelfAtlas/Regnskab.md');
    assert.equal(fil('privat'), '/mnt/nas-obsidian/ObsidianVault/10-Privat/Økonomi/abonnementer.md');
    assert.equal(linjer.length, 1, 'one line, once');
    assert.match(linjer[0] ?? '', /^regnskab: fandt regnskabsfilerne på de hidtidige steder i \/mnt\/nas-obsidian\/ObsidianVault og beholder dem \(regnskab\.json\)$/);
    assert.deepEqual(JSON.parse(await readFile(path.join(data, REGNSKAB_FIL), 'utf8')), AELDRE_STIER);
    fil('shelfatlas');
    assert.equal(linjer.length, 1, 'adopting happens once');
  } finally { await rm(data, { recursive: true, force: true }); }
});

// ---- the one answer ------------------------------------------------------------------------------------------------

test('vaultRodAf: KC_VAULT_DIR, else the parent of KC_VAULT_INBOX, else the chosen vault, else <dataDir>/vault, else unknown', () => {
  assert.equal(vaultRodAf({ KC_VAULT_DIR: '/v', KC_VAULT_INBOX: '/nas/Vault/00-Indbakke' }, '/valgt', '/d'), path.resolve('/v'));
  assert.equal(vaultRodAf({ KC_VAULT_DIR: ' ', KC_VAULT_INBOX: '/nas/Vault/00-Indbakke' }, '/valgt', '/d'), path.resolve('/nas/Vault'));
  assert.equal(vaultRodAf({}, '/valgt', '/d'), '/valgt');
  assert.equal(vaultRodAf({ KC_VAULT_INBOX: '' }, '', '/d'), path.resolve('/d/vault'));
  assert.equal(vaultRodAf({}, '', ''), '');
});

test('noterStier: rod is the one root; the inbox and the register follow the chosen vault (as before), never the data-dir default', () => {
  assert.deepEqual(noterStier({}, '/v', '/d'), { rod: '/v', valgt: '/v', indbakke: path.join('/v', '00-Indbakke'), personer: path.join('/v', '40-Mennesker', 'People') });
  assert.deepEqual(noterStier({}, '', '/d'), { rod: path.resolve('/d/vault'), valgt: '', indbakke: '', personer: '' });
  assert.deepEqual(noterStier({ KC_VAULT_DIR: '/ejer' }, '/valgt', '/d'), { rod: path.resolve('/ejer'), valgt: '/valgt', indbakke: path.join('/valgt', '00-Indbakke'), personer: path.join('/valgt', '40-Mennesker', 'People') });
  assert.equal(noterStier({ KC_VAULT_INBOX: '/nas/V/00-Indbakke' }, '/valgt', '/d').rod, '/nas/V', 'the env inbox wins over the notes card');
  assert.equal(noterStier({ KC_VAULT_INBOX: '/nas/V/00-Indbakke' }, '', '/d').personer, '', 'an env inbox alone does not invent a register (as before)');
});

// ---- ledger paths are data -----------------------------------------------------------------------------------------

test('regnskabsfil: the default lives under <vault>/Clawco/Regnskab/; a map moves it', () => {
  assert.equal(regnskabsfil('/vault', 'shelfatlas'), '/vault/Clawco/Regnskab/shelfatlas.md');
  assert.equal(regnskabsfil('/vault', 'privat'), '/vault/Clawco/Regnskab/privat.md');
  assert.equal(regnskabsfil('/vault', 'privat', { ...STANDARD_STIER, privat: 'Mit/abon.md' }), '/vault/Mit/abon.md');
});

test('laesRegnskabsstier: defaults without a file; valid entries win; absolute, ".." and empty entries fall back to the default', async () => {
  const data = await tmp();
  try {
    assert.deepEqual(laesRegnskabsstier(data), STANDARD_STIER);
    assert.deepEqual(laesRegnskabsstier(undefined), STANDARD_STIER);
    await writeFile(path.join(data, REGNSKAB_FIL), JSON.stringify({ shelfatlas: 'Okonomi/sa.md', privat: '../uden/for.md' }));
    assert.deepEqual(laesRegnskabsstier(data), { shelfatlas: 'Okonomi/sa.md', privat: STANDARD_STIER.privat });
    await writeFile(path.join(data, REGNSKAB_FIL), JSON.stringify({ shelfatlas: '/etc/x.md', privat: ' ' }));
    assert.deepEqual(laesRegnskabsstier(data), STANDARD_STIER);
    await writeFile(path.join(data, REGNSKAB_FIL), '{ ødelagt');
    assert.deepEqual(laesRegnskabsstier(data), STANDARD_STIER, 'a broken file is the default, never a stray path');
  } finally { await rm(data, { recursive: true, force: true }); }
});

test('adopting: only when a ledger sits at an old path and the default file is not there; never over an existing map', async () => {
  const data = await tmp();
  const rod = await tmp();
  try {
    const linjer: string[] = [];
    const log = (l: string): void => { linjer.push(l); };
    assert.equal(adopterAeldreStier({ dataDir: data, rod, log }), false, 'nothing found: the default applies');
    assert.equal(existsSync(path.join(data, REGNSKAB_FIL)), false);
    await mkdir(path.join(rod, '10-Privat', 'Økonomi'), { recursive: true });
    await writeFile(path.join(rod, '10-Privat', 'Økonomi', 'abonnementer.md'), '# x\n');
    await mkdir(path.join(rod, 'Clawco', 'Regnskab'), { recursive: true });
    await writeFile(path.join(rod, 'Clawco', 'Regnskab', 'privat.md'), '# y\n');
    assert.equal(adopterAeldreStier({ dataDir: data, rod, log }), false, 'the install already uses the default file');
    await rm(path.join(rod, 'Clawco'), { recursive: true });
    assert.equal(adopterAeldreStier({ dataDir: undefined, rod, log }), false, 'no data dir: nowhere to write the map');
    assert.equal(adopterAeldreStier({ dataDir: data, rod: '', log }), false, 'no vault root');
    assert.equal(adopterAeldreStier({ dataDir: data, rod, log }), true);
    assert.deepEqual(laesRegnskabsstier(data), AELDRE_STIER, 'both old paths are kept, also the ledger that does not exist yet');
    assert.equal(adopterAeldreStier({ dataDir: data, rod, log }), false);
    assert.equal(linjer.length, 1);
  } finally { await rm(data, { recursive: true, force: true }); await rm(rod, { recursive: true, force: true }); }
});

test('a product install with no map and no old files writes ledgers under <vault>/Clawco/Regnskab/', async () => {
  const data = await tmp();
  const rod = await tmp();
  try {
    const fil = lavRegnskabsfil({ dataDir: data, rod: () => rod });
    assert.equal(fil('shelfatlas'), path.join(rod, 'Clawco', 'Regnskab', 'shelfatlas.md'));
    assert.equal(existsSync(path.join(data, REGNSKAB_FIL)), false, 'nothing is adopted, nothing is written');
    assert.equal(lavRegnskabsfil({ dataDir: data, rod: () => '' })('privat'), '', 'no vault root, no path');
  } finally { await rm(data, { recursive: true, force: true }); await rm(rod, { recursive: true, force: true }); }
});

// ---- the invariant -------------------------------------------------------------------------------------------------

test('invariant: with a chosen vault and no env, every file Clawco writes outside the data dir is under <vault>/Clawco/, the inbox or the register', async () => {
  const data = await tmp();
  const vault = await tmp();
  try {
    const s = noterStier({}, vault, data);
    const regler = lavReglerLager({ vaultDir: s.rod, dataDir: data }).fil;
    const fil = lavRegnskabsfil({ dataDir: data, rod: () => s.rod });
    const skrivesIPlads = [regler, fil('shelfatlas'), fil('privat'), path.join(s.indbakke, 'Læs senere.md'), path.join(s.indbakke, 'en-note.md'), path.join(s.personer, 'Rikke.md')];
    const clawco = path.join(vault, 'Clawco') + path.sep;
    for (const f of skrivesIPlads) {
      const iClawco = f.startsWith(clawco);
      const iIndbakke = f.startsWith(s.indbakke + path.sep);
      const iPersoner = f.startsWith(s.personer + path.sep);
      assert.ok(iClawco || iIndbakke || iPersoner, `${f} is outside <vault>/Clawco/, the inbox and the register`);
      assert.ok(f.startsWith(vault + path.sep), `${f} is outside the vault`);
    }
    assert.ok(!skrivesIPlads.some((f) => /30-Projekter|10-Privat/.test(f)), 'never into the reference install\'s folders');
  } finally { await rm(data, { recursive: true, force: true }); await rm(vault, { recursive: true, force: true }); }
});

const post = (id: string): KonfigPost => ({ id: 'noter', status: 'forbundet', zone: 'privat', valg: { opsaetning: 'ny', mappe: id }, tid: NU.toISOString(), af: 'henrik' });

test('the app: Kuratoren\'s ledger and the rules file land in the vault chosen on the notes card (no env), and follow a change of vault', async () => {
  const dir = await tmp();
  try {
    const data = path.join(dir, 'data');
    const a = path.join(dir, 'Vault-A');
    const b = path.join(dir, 'Vault-B');
    await skrivKonfig(data, { kilder: [post(a)] });
    const store = createFileStore(data);
    await rejsenFaerdig(store);
    const hermes = createFakeAgent({ answer: () => 'Noteret.' });
    const sut = createApp({ store, dataDir: data, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), mailStateDir: path.join(dir, 'state'), now: () => NU });
    const kort: Kort = { id: 'regning:uklar1', type: 'regning', titel: 'Vercel-regning', betyder: 'En regning.', grundlag: [], kilder: [], anbefaling: 'Intet.', prioritet: 3, regnskabUklart: true };
    const state: KuratorState = { kort: [kort], intet: [], afvist: [], sete: [] };
    await store.writeState('hjem', state);
    const vaelg = async (id: string, hvor: string): Promise<Response> => sut.app.request(`/api/rum/hjem/kort/${encodeURIComponent(id)}/regnskab/${hvor}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await vaelg(kort.id, 'privat')).status, 200);
    assert.match(await readFile(path.join(a, 'Clawco', 'Regnskab', 'privat.md'), 'utf8'), /kc:regning:uklar1/);
    assert.ok(!existsSync(path.join(data, 'vault')), 'the data-dir default is not used when a vault is chosen');
    // The user chooses another vault on the card: the next write follows it.
    await skrivKonfig(data, { kilder: [post(b)] });
    await store.writeState('hjem', { kort: [{ ...kort, id: 'regning:uklar2' }], intet: [], afvist: [], sete: [] });
    assert.equal((await vaelg('regning:uklar2', 'shelfatlas')).status, 200);
    assert.match(await readFile(path.join(b, 'Clawco', 'Regnskab', 'shelfatlas.md'), 'utf8'), /kc:regning:uklar2/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- Nyheder's Fortryd finds the file it wrote -----------------------------------------------------------------------

async function nyhedsApp(dir: string) {
  const data = path.join(dir, 'data');
  await writeFile(path.join(dir, 'avis_2026-10-26.json'), await readFile(new URL('./fixtures/avis_data_sample.json', import.meta.url), 'utf8'));
  const nyheder = { femLinjer: ['L1', 'L2', 'L3', 'L4', 'L5'], baner: [{ navn: 'Energi', nyheder: [{ titel: 'Reserver i vinter', hvorfor: 'Dit system.', kilde: 'Eksempel Energi', url: 'https://example.org/r' }] }], forslag: [], hermesStatus: 'ok' };
  const hermes = createFakeAgent({ answer: () => '```json\n' + JSON.stringify(nyheder) + '\n```' });
  const store = createFileStore(data);
  const sut = createApp({ store, dataDir: data, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: async () => ({ code: 0, stdout: '{"envelopes":[]}', stderr: '' }), mailStateDir: '/nonexistent', now: () => new Date('2026-10-26T07:10:00Z') });
  const send = async (sti: string, b?: unknown): Promise<string> => {
    const res = await sut.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b === undefined ? null : JSON.stringify(b) });
    const tekst = await res.text();
    assert.equal(res.status, 202, tekst);
    const r = await sut.runs.get((JSON.parse(tekst) as { runId: string }).runId)!.finished;
    return `${r.status} ${r.error ?? ''}`;
  };
  return { data, store, send };
}

test('Nyheder: the save logs the absolute file it wrote, and Fortryd uses it after the vault was changed', async () => {
  const dir = await tmp();
  try {
    const a = path.join(dir, 'Vault-A');
    const b = path.join(dir, 'Vault-B');
    const t = await nyhedsApp(dir);
    await skrivKonfig(t.data, { kilder: [post(a)] });
    assert.equal(await t.send('/api/rum/nyheder/opdater', { mode: 'opdater' }), 'done ');
    assert.equal(await t.send('/api/rum/nyheder/aktion/gem', { nyhedId: 'n1' }), 'done ');
    const fil = path.join(a, '00-Indbakke', 'Læs senere.md');
    assert.match(await readFile(fil, 'utf8'), /Reserver i vinter/);
    const e = (await t.store.readLog('nyheder')).find((x) => x.fortryd?.startsWith('lokal:'))!;
    assert.equal((JSON.parse(e.fortryd!.slice(6)) as { fil: string }).fil, fil);
    await skrivKonfig(t.data, { kilder: [post(b)] }); // the vault changes between save and undo
    assert.equal(await t.send(`/api/rum/nyheder/log/${e.id}/fortryd`), 'done ');
    assert.doesNotMatch(await readFile(fil, 'utf8'), /Reserver i vinter/, 'the line is gone from the file that was written');
    assert.ok(!existsSync(path.join(b, '00-Indbakke', 'Læs senere.md')), 'nothing was created in the new vault');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Nyheder: an older log entry without a file still undoes through today\'s derivation; a foreign file name is ignored', async () => {
  const dir = await tmp();
  try {
    const a = path.join(dir, 'Vault-A');
    const t = await nyhedsApp(dir);
    await skrivKonfig(t.data, { kilder: [post(a)] });
    assert.equal(await t.send('/api/rum/nyheder/opdater', { mode: 'opdater' }), 'done ');
    assert.equal(await t.send('/api/rum/nyheder/aktion/gem', { nyhedId: 'n1' }), 'done ');
    const fil = path.join(a, '00-Indbakke', 'Læs senere.md');
    const e = (await t.store.readLog('nyheder')).find((x) => x.fortryd?.startsWith('lokal:'))!;
    const { nyhedId, linje } = JSON.parse(e.fortryd!.slice(6)) as { nyhedId: string; linje: string };
    // Old shape (no file): found from the current paths.
    await t.store.updateLog('nyheder', e.id, { fortryd: `lokal:${JSON.stringify({ nyhedId, linje })}` });
    assert.equal(await t.send(`/api/rum/nyheder/log/${e.id}/fortryd`), 'done ');
    assert.doesNotMatch(await readFile(fil, 'utf8'), /Reserver i vinter/);
    // A stored file that is not a Læs senere file is not touched.
    const fremmed = path.join(dir, 'vigtig.md');
    await writeFile(fremmed, `${linje}\n`);
    assert.equal(await t.send('/api/rum/nyheder/aktion/gem', { nyhedId: 'n1' }), 'done ');
    const e2 = (await t.store.readLog('nyheder')).filter((x) => x.fortryd?.startsWith('lokal:') && !x.fortrudt).at(-1)!;
    await t.store.updateLog('nyheder', e2.id, { fortryd: `lokal:${JSON.stringify({ nyhedId, linje, fil: fremmed })}` });
    assert.equal(await t.send(`/api/rum/nyheder/log/${e2.id}/fortryd`), 'done ');
    assert.equal(await readFile(fremmed, 'utf8'), `${linje}\n`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
