// KC-0136: every path the notes connector touches is resolved under the vault
// (or people) root and refused if it escapes — by `..`, by an absolute path or
// by a symlink that leads outside. A person's file name is one safe segment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { filnavn, iRod } from '../../../src/kilder/noter/sti.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

async function medRod(fn: (rod: string, ude: string) => Promise<void>): Promise<void> {
  const top = await mkdtemp(path.join(tmpdir(), 'kc-noter-sti-'));
  const rod = path.join(top, 'vault');
  const ude = path.join(top, 'ude');
  await mkdir(rod); await mkdir(ude);
  try { await fn(rod, ude); } finally { await rm(top, { recursive: true, force: true }); }
}

const afvist = (p: Promise<unknown>): Promise<void> => assert.rejects(p, (e: unknown) => e instanceof KildeFejl && e.status === 400);

test('iRod: a relative path resolves under the root, also when it does not exist yet', () => medRod(async (rod) => {
  assert.equal(await iRod(rod, '00-Indbakke/Ny note.md'), path.join(await realRod(rod), '00-Indbakke', 'Ny note.md'));
  assert.equal(await iRod(rod, '40-Mennesker/People/familie/Søren Ærø.md'), path.join(await realRod(rod), '40-Mennesker', 'People', 'familie', 'Søren Ærø.md'));
}));

test('iRod: traversal and absolute paths are refused', () => medRod(async (rod, ude) => {
  await afvist(iRod(rod, '../ude/x.md'));
  await afvist(iRod(rod, 'a/../../ude/x.md'));
  await afvist(iRod(rod, 'a/../b.md')); // any `..` segment, even one that would stay inside
  await afvist(iRod(rod, path.join(ude, 'x.md')));
  await afvist(iRod(rod, '/etc/passwd'));
  await afvist(iRod(rod, ''));
  await afvist(iRod(rod, 'a\u0000b.md'));
}));

test('iRod: a symlink inside the root that leads outside is refused, for the link and for paths beneath it', () => medRod(async (rod, ude) => {
  await writeFile(path.join(ude, 'hemmelig.md'), 'x');
  await symlink(ude, path.join(rod, 'genvej'));
  await symlink(path.join(ude, 'hemmelig.md'), path.join(rod, 'note.md'));
  await afvist(iRod(rod, 'genvej/hemmelig.md'));
  await afvist(iRod(rod, 'genvej/ny/fil.md'));
  await afvist(iRod(rod, 'note.md'));
}));

test('iRod: a symlink that stays inside the root is fine', () => medRod(async (rod) => {
  await mkdir(path.join(rod, 'a'));
  await symlink(path.join(rod, 'a'), path.join(rod, 'b'));
  assert.equal(await iRod(rod, 'b/x.md'), path.join(await realRod(rod), 'a', 'x.md'));
}));

test('filnavn: unicode names pass, normalised to NFC; unsafe names are refused', () => {
  assert.equal(filnavn('  Søren Ærø  '), 'Søren Ærø');
  assert.equal(filnavn('Zoë'.normalize('NFD')), 'Zoë'.normalize('NFC'));
  assert.equal(filnavn('Zoë'.normalize('NFD')), filnavn('Zoë'.normalize('NFC'))); // the same person collides, whatever form
  for (const ond of ['', '   ', '.', '..', '.skjult', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\nb', 'x'.repeat(121)]) {
    assert.throws(() => filnavn(ond), (e: unknown) => e instanceof KildeFejl && e.status === 400, JSON.stringify(ond));
  }
});

async function realRod(rod: string): Promise<string> { return (await import('node:fs/promises')).realpath(rod); }
