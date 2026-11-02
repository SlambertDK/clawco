// KC-0136: the notes connector (`noter`, auth local, slags noter) and the
// legacy adapter for Henrik's NAS vault (`kira-noter`). Both pass the
// conformance suite. The card offers the two setups (and the vaults found on
// the machine); connecting runs the setup; read() carries names, relations and
// note titles only; health says when the folder is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { kildeKonformitet } from '../konformitet.ts';
import { kiraNoter, noterKilde, noterKortTilstand } from '../../../src/kilder/noter/noter.ts';
import { NOTER_ID } from '../../../src/kilder/noter/stier.ts';
import { lavNyVault } from '../../../src/kilder/noter/vault.ts';
import { skrivPerson } from '../../../src/kilder/noter/personer.ts';
import { KildeFejl, type KildeKontekst } from '../../../src/kilder/types.ts';
import { lavRegister, laesKonfig } from '../../../src/kilder/register.ts';
import { legacyKilder } from '../../../src/kilder/legacy/legacy.ts';
import { readNyhederSource } from '../../../src/rooms/nyheder/source.ts';
import { parseAll } from '../../../src/rooms/mail/source.ts';
import { medData, NU } from '../hjaelp.ts';
import type { Person } from '../../../src/identitet/husstand.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const ctx = (valg: Record<string, string> = {}, zone: KildeKontekst['zone'] = 'privat'): KildeKontekst => ({ nu: NU, zone, valg, hemmelighed: async () => null });

async function medHjem(fn: (hjem: string) => Promise<void>): Promise<void> {
  const hjem = await mkdtemp(path.join(tmpdir(), 'kc-noter-hjem-'));
  try { await fn(hjem); } finally { await rm(hjem, { recursive: true, force: true }); }
}

/** A vault with two people (one in another zone), two notes, a hidden folder, a symlink out, and Clawco's own file. */
async function fyldVault(rod: string, ude?: string): Promise<void> {
  await lavNyVault(rod);
  await skrivPerson(path.join(rod, '40-Mennesker', 'People'), { navn: 'Anna Prøve', relation: 'kone', zone: 'privat', tekst: 'Hemmelig krop' }, { mappe: 'familie', zone: 'privat' });
  await skrivPerson(path.join(rod, '40-Mennesker', 'People'), { navn: 'Kaj Kollega', relation: 'kollega', zone: 'arbejde' }, { mappe: 'arbejde', zone: 'privat' });
  await writeFile(path.join(rod, '00-Indbakke', 'Idé.md'), 'Noteindhold, der aldrig må med');
  await mkdir(path.join(rod, '10-Projekter'));
  await writeFile(path.join(rod, '10-Projekter', 'Plan.md'), 'Mere indhold');
  await mkdir(path.join(rod, '.obsidian'));
  await writeFile(path.join(rod, '.obsidian', 'workspace.md'), 'x');
  if (ude) { await writeFile(path.join(ude, 'Fremmed.md'), 'ude'); await symlink(ude, path.join(rod, 'genvej')); }
}

test('noter passes the conformance suite (the default new-vault folder; its twin without the folder is down)', () => medHjem(async (hjem) => {
  await fyldVault(path.join(hjem, 'Clawco', 'Vault'));
  const k = noterKilde({ hjem, platform: 'linux' });
  assert.deepEqual([k.id, k.slags, k.auth, k.zone, k.standard], [NOTER_ID, 'noter', 'local', 'privat', undefined]);
  await kildeKonformitet(k, { nede: noterKilde({ hjem: path.join(hjem, 'findes-ikke'), platform: 'linux' }) });
}));

test('kira-noter (Henrik\'s vault from the env) passes the conformance suite and is connected by the host', () => medHjem(async (hjem) => {
  const rod = path.join(hjem, 'NAS');
  await fyldVault(rod);
  const k = kiraNoter({ rod, personer: path.join(rod, '40-Mennesker', 'People') });
  assert.deepEqual([k.id, k.standard, k.auth], ['kira-noter', 'forbundet', 'local']);
  await kildeKonformitet(k, { nede: kiraNoter({ rod: path.join(hjem, 'afmonteret'), personer: path.join(hjem, 'afmonteret', 'P') }) });
}));

test('read: names, relations and folders of the zone\'s people, note titles with path and mtime — no bodies, no hidden, Clawco or linked-out files', () => medHjem(async (hjem) => {
  const rod = path.join(hjem, 'Vault');
  const ude = path.join(hjem, 'ude');
  await mkdir(ude);
  await fyldVault(rod, ude);
  const l = await noterKilde({ hjem }).read(ctx({ opsaetning: 'eksisterende', mappe: rod }));
  assert.equal(l.slags, 'noter');
  assert.equal(l.uklar, true);
  assert.ok(l.slags === 'noter');
  assert.deepEqual(l.data.personer, [{ navn: 'Anna Prøve', relation: 'kone', mappe: '40-Mennesker/People/familie' }]);
  assert.deepEqual(l.data.noter.map((n) => [n.titel, n.sti]).sort(), [['Idé', '00-Indbakke/Idé.md'], ['Plan', '10-Projekter/Plan.md']]);
  assert.ok(l.data.noter.every((n) => !Number.isNaN(Date.parse(n.aendret))));
  const tekst = JSON.stringify(l);
  for (const ord of ['Hemmelig krop', 'Noteindhold', 'Mere indhold', 'Fremmed', 'workspace', 'Om mig']) assert.ok(!tekst.includes(ord), ord);
  // The work zone reads only the work zone's people.
  const arbejde = await noterKilde({ hjem }).read(ctx({ mappe: rod }, 'arbejde'));
  assert.ok(arbejde.slags === 'noter');
  assert.deepEqual(arbejde.data.personer.map((p) => p.navn), ['Kaj Kollega']);
}));

test('helbred: ok when the folder exists and is writable; nede "Mappen kan ikke findes" when it is gone (NAS unmounted)', () => medHjem(async (hjem) => {
  const k = noterKilde({ hjem });
  await lavNyVault(path.join(hjem, 'V'));
  assert.deepEqual(await k.helbred(ctx({ mappe: path.join(hjem, 'V') })), { status: 'ok' });
  assert.deepEqual(await k.helbred(ctx({ mappe: path.join(hjem, 'væk') })), { status: 'nede', tekst: 'Mappen kan ikke findes.' });
  await assert.rejects(k.read(ctx({ mappe: path.join(hjem, 'væk') })), (e: unknown) => e instanceof KildeFejl && e.status === 502);
}));

test('the card: not chosen (the two setups, the vaults found), new, existing, folder missing — text, never HTML', () => medHjem(async (hjem) => {
  await mkdir(path.join(hjem, 'Documents', 'Min vault', '.obsidian'), { recursive: true });
  const k = noterKilde({ hjem, platform: 'darwin' });
  const ikke = await k.kort(ctx());
  assert.equal(noterKortTilstand(ctx(), false), 'ikke-valgt');
  assert.equal(ikke.titel, 'Noter');
  const [opsaetning, mappe] = ikke.felter;
  assert.deepEqual(opsaetning?.muligheder, [{ vaerdi: 'ny', etiket: 'Lav en ny mappe til mig' }, { vaerdi: 'eksisterende', etiket: 'Jeg har allerede en Obsidian-vault' }]);
  assert.equal(opsaetning?.paakraevet, true);
  assert.deepEqual([mappe?.navn, mappe?.type, mappe?.paakraevet, mappe?.forslag], ['mappe', 'mappe', false, [path.join(hjem, 'Documents', 'Min vault')]]);
  assert.match(ikke.tekst, /tilføjer Clawco kun mapperne 00-Indbakke, 40-Mennesker\/People og Clawco, hvis de mangler/);
  assert.match(ikke.tekst, /Clawco fandt 1 Obsidian-vault på maskinen/);

  await lavNyVault(path.join(hjem, 'Ny'));
  const ny = await k.kort(ctx({ opsaetning: 'ny', mappe: path.join(hjem, 'Ny') }));
  assert.match(ny.tekst, /din nye mappe/);
  assert.equal(ny.handling, 'Skift mappe');
  const eks = await k.kort(ctx({ opsaetning: 'eksisterende', mappe: path.join(hjem, 'Ny') }));
  assert.match(eks.tekst, /din Obsidian-vault/);
  const mangler = await k.kort(ctx({ opsaetning: 'eksisterende', mappe: path.join(hjem, 'væk<b>') }));
  assert.match(mangler.tekst, /^Mappen kan ikke findes/);
  assert.equal(mangler.handling, 'Vælg mappen igen');
  for (const c of [ikke, ny, eks, mangler]) for (const t of [c.titel, c.tekst, c.handling]) assert.ok(!/[<>]/.test(t), t);
  assert.deepEqual(
    [noterKortTilstand(ctx({ opsaetning: 'ny', mappe: 'x' }), true), noterKortTilstand(ctx({ opsaetning: 'eksisterende', mappe: 'x' }), true), noterKortTilstand(ctx({ mappe: 'x' }), false)],
    ['ny', 'eksisterende', 'mangler'],
  );
}));

test('connect "ny" without a folder: the vault is made in <home>/Clawco/Vault and that path is stored; the log says what was added', () => medData(async (dir, store) => {
  await medHjem(async (hjem) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(noterKilde({ hjem }));
    const svar = await r.forbind(NOTER_ID, { felter: { opsaetning: 'ny' } }, EJER);
    const rod = path.join(hjem, 'Clawco', 'Vault');
    assert.ok('forbundet' in svar);
    assert.equal(svar.opsat, `Lavede ${rod} med 00-Indbakke, 40-Mennesker/People, Clawco og Clawco/Om mig.md.`);
    assert.deepEqual(svar.foersteLaesning?.slags, 'noter');
    assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, { opsaetning: 'ny', mappe: rod });
    assert.deepEqual((await readdir(rod)).sort(), ['00-Indbakke', '40-Mennesker', 'Clawco']);
  });
}));

test('connect "eksisterende": only the missing folders are added (and said), a typed ~ path works, a relative or missing path is refused', () => medData(async (dir, store) => {
  await medHjem(async (hjem) => {
    const vault = path.join(hjem, 'Obsidian', 'Hjerne');
    await mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await mkdir(path.join(vault, '00-Indbakke'));
    await writeFile(path.join(vault, 'Dagbog.md'), 'kære dagbog');
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(noterKilde({ hjem }));
    const fejl = (status: number) => (e: unknown) => e instanceof KildeFejl && e.status === status;
    await assert.rejects(r.forbind(NOTER_ID, { felter: { opsaetning: 'eksisterende' } }, EJER), fejl(400));
    await assert.rejects(r.forbind(NOTER_ID, { felter: { opsaetning: 'eksisterende', mappe: 'Obsidian/Hjerne' } }, EJER), fejl(400));
    await assert.rejects(r.forbind(NOTER_ID, { felter: { opsaetning: 'eksisterende', mappe: path.join(hjem, 'findes-ikke') } }, EJER), fejl(409));
    assert.deepEqual(await laesKonfig(dir), { kilder: [] });
    const svar = await r.forbind(NOTER_ID, { felter: { opsaetning: 'eksisterende', mappe: '~/Obsidian/Hjerne' } }, EJER);
    assert.ok('forbundet' in svar);
    assert.equal(svar.opsat, `Tilføjede 40-Mennesker/People og Clawco i ${vault}.`);
    assert.deepEqual((await laesKonfig(dir)).kilder[0]?.valg, { opsaetning: 'eksisterende', mappe: vault });
    assert.deepEqual((await readdir(vault)).sort(), ['.obsidian', '00-Indbakke', '40-Mennesker', 'Clawco', 'Dagbog.md']);
    const igen = await r.forbind(NOTER_ID, { felter: { opsaetning: 'eksisterende', mappe: vault } }, EJER);
    assert.ok('forbundet' in igen);
    assert.equal(igen.opsat, `Bruger ${vault}; der manglede ingen mapper.`);
  });
}));

test('legacyKilder registers kira-noter from the vault env (KC_VAULT_DIR or the inbox\'s parent; KC_PEOPLE_DIR wins for people)', () => {
  const deps = { run: async () => ({ code: 0, stdout: '', stderr: '' }), laesNyheder: readNyhederSource, parseMail: parseAll, kalenderScript: '' };
  assert.deepEqual(legacyKilder({}, deps).map((k) => k.id), []);
  assert.deepEqual(legacyKilder({ KC_PEOPLE_DIR: '/p' }, deps).map((k) => k.id), []);
  assert.deepEqual(legacyKilder({ KC_VAULT_INBOX: '/nas/Vault/00-Indbakke', KC_HIMALAYA: 'h' }, deps).map((k) => k.id), ['kira-mail', 'kira-noter']);
  assert.deepEqual(legacyKilder({ KC_VAULT_DIR: '/nas/Vault' }, deps).map((k) => k.id), ['kira-noter']);
});
