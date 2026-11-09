// KC-0136: the two setups of the notes connector. A new vault gets the inbox,
// the people register and Clawco's own folder; an existing vault gets only what
// is missing and not one of its notes is touched. Detection finds Obsidian
// vaults (a folder holding `.obsidian/`) at depth ≤ 3 under the candidate roots
// by reading directory names only — never a file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adopterVault, findVaults, kandidatRoedder, lavNyVault, manglerI, STRUKTUR } from '../../../src/kilder/noter/vault.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

async function medTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-noter-vault-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const erMappe = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false;

test('the structure: inbox, people register and Clawco\'s own folder', () => {
  assert.deepEqual(STRUKTUR, { indbakke: '00-Indbakke', personer: '40-Mennesker/People', clawco: 'Clawco' });
});

test('lavNyVault creates the inbox, the people register, Clawco/ and Clawco/Om mig.md, and says what it added', () => medTmp(async (dir) => {
  const rod = path.join(dir, 'Clawco', 'Vault');
  const lagt = await lavNyVault(rod);
  assert.deepEqual(lagt, ['00-Indbakke', '40-Mennesker/People', 'Clawco', 'Clawco/Om mig.md']);
  for (const m of ['00-Indbakke', '40-Mennesker/People', 'Clawco']) assert.ok(await erMappe(path.join(rod, m)), m);
  assert.match(await readFile(path.join(rod, 'Clawco', 'Om mig.md'), 'utf8'), /^# Om mig/);
  // The relation folders are made on first use, not up front.
  assert.deepEqual(await readdir(path.join(rod, '40-Mennesker', 'People')), []);
  assert.deepEqual(await manglerI(rod), []);
}));

test('lavNyVault on a vault it made before adds nothing and keeps the profile', () => medTmp(async (dir) => {
  await lavNyVault(dir);
  await writeFile(path.join(dir, 'Clawco', 'Om mig.md'), '# Om mig\n\nMin egen tekst.\n');
  assert.deepEqual(await lavNyVault(dir), []);
  assert.equal(await readFile(path.join(dir, 'Clawco', 'Om mig.md'), 'utf8'), '# Om mig\n\nMin egen tekst.\n');
}));

test('lavNyVault refuses a folder that already holds someone\'s files (409), touching nothing', () => medTmp(async (dir) => {
  await writeFile(path.join(dir, 'regnskab.xlsx'), 'x');
  await assert.rejects(lavNyVault(dir), (e: unknown) => e instanceof KildeFejl && e.status === 409);
  assert.deepEqual(await readdir(dir), ['regnskab.xlsx']);
}));

test('adopterVault adds only the missing folders and touches no note', () => medTmp(async (dir) => {
  await mkdir(path.join(dir, '.obsidian'));
  await mkdir(path.join(dir, '00-Indbakke'));
  await writeFile(path.join(dir, '00-Indbakke', 'Idé.md'), 'min idé');
  await writeFile(path.join(dir, 'Dagbog.md'), 'kære dagbog');
  assert.deepEqual(await manglerI(dir), ['40-Mennesker/People', 'Clawco']);
  assert.deepEqual(await adopterVault(dir), ['40-Mennesker/People', 'Clawco']);
  assert.equal(await readFile(path.join(dir, '00-Indbakke', 'Idé.md'), 'utf8'), 'min idé');
  assert.equal(await readFile(path.join(dir, 'Dagbog.md'), 'utf8'), 'kære dagbog');
  assert.deepEqual((await readdir(dir)).sort(), ['.obsidian', '00-Indbakke', '40-Mennesker', 'Clawco', 'Dagbog.md']);
  assert.deepEqual(await readdir(path.join(dir, 'Clawco')), []); // no profile is written into someone's vault
  assert.deepEqual(await adopterVault(dir), []);
}));

test('adopterVault refuses a folder that does not exist (409) and creates nothing', () => medTmp(async (dir) => {
  await assert.rejects(adopterVault(path.join(dir, 'findes-ikke')), (e: unknown) => e instanceof KildeFejl && e.status === 409);
  assert.deepEqual(await readdir(dir), []);
}));

test('findVaults finds .obsidian/ at depth ≤ 3 and nothing deeper, skips hidden folders, and reads directory names only', () => medTmp(async (dir) => {
  const vault = async (...dele: string[]): Promise<void> => {
    await mkdir(path.join(dir, ...dele, '.obsidian'), { recursive: true });
    await writeFile(path.join(dir, ...dele, '.obsidian', 'app.json'), '{}');
    await writeFile(path.join(dir, ...dele, 'Note.md'), 'privat');
  };
  await vault('Noter');                           // depth 1
  await vault('Documents', 'Arbejde', 'Vault');   // depth 3
  await vault('a', 'b', 'c', 'For dyb');          // depth 4
  await vault('.skjult', 'Vault');                // under a hidden folder
  await vault('Noter', 'Indlejret');              // inside a vault: not a vault of its own
  await writeFile(path.join(dir, 'løs.md'), 'x');
  const kald: string[] = [];
  const fs = { readdir: (p: string, o: { withFileTypes: true }) => { kald.push(p); return readdir(p, o); } };
  const fundet = await findVaults([dir, path.join(dir, 'Documents'), path.join(dir, 'findes-ikke')], { fs });
  assert.deepEqual(fundet, [path.join(dir, 'Documents', 'Arbejde', 'Vault'), path.join(dir, 'Noter')]);
  assert.ok(kald.length > 0);
  for (const p of kald) assert.ok((await erMappe(p)) || p.endsWith('findes-ikke'), `opened something that is not a folder: ${p}`);
  assert.ok(!kald.some((p) => p.includes('.obsidian')), 'never looks inside .obsidian');
}));

test('the candidate roots are the fixed list, nothing else', () => {
  assert.deepEqual(kandidatRoedder('/Users/a', 'darwin'), ['/Users/a', '/Users/a/Documents', '/Users/a/Obsidian', '/Users/a/Library/Mobile Documents/iCloud~md~obsidian/Documents']);
  assert.deepEqual(kandidatRoedder('/home/a', 'linux'), ['/home/a', '/home/a/Documents', '/home/a/Dokumenter', '/home/a/Obsidian', '/noter']);
  // KC-0284: /noter is where compose.noter.yaml mounts a host's vault folder; a missing /noter is skipped by findVaults (unreadable root).
});
