// KC-0170: English is a new installation's language until Start's step 1; a data folder in use before the language
// existed (Henrik's) stays Danish. Decided once, written to installation.json, read from then on; never destructive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INSTALLATION_FIL, laesInstallation, laesInstallationsfil } from '../../src/store/installation.ts';

const NU = () => new Date('2026-11-02T20:00:00.000Z');
async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-installation-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('an empty data folder is a new installation: English, and the record is written once', async () => {
  await medMappe(async (dir) => {
    const ny = path.join(dir, 'frisk');
    assert.deepEqual(laesInstallation(ny, NU), { standardSprog: 'en', oprettet: '2026-11-02T20:00:00.000Z', grund: 'ny' });
    const gemt = JSON.parse(await readFile(path.join(ny, INSTALLATION_FIL), 'utf8'));
    assert.equal(gemt.standardSprog, 'en');
    // A second read, later, is the file, not a new guess.
    assert.equal(laesInstallation(ny, () => new Date('2027-01-01T00:00:00.000Z')).oprettet, '2026-11-02T20:00:00.000Z');
  });
});

test('a folder in use before the language existed (room state, a profile, a household…) stays Danish', async () => {
  for (const tegn of ['rum', 'profil.json', 'husstand.json', 'indstillinger.json', 'tillid']) {
    await medMappe(async (dir) => {
      if (tegn.endsWith('.json')) await writeFile(path.join(dir, tegn), '{}'); else await mkdir(path.join(dir, tegn));
      assert.deepEqual(laesInstallation(dir, NU), { standardSprog: 'da', oprettet: '2026-11-02T20:00:00.000Z', grund: 'foer-sproget' }, tegn);
      assert.equal(JSON.parse(await readFile(path.join(dir, INSTALLATION_FIL), 'utf8')).standardSprog, 'da');
    });
  }
});

test('a stored record wins over the folder\'s looks; an unreadable one is left alone and reads as Danish', async () => {
  await medMappe(async (dir) => {
    await mkdir(path.join(dir, 'rum'));
    await writeFile(path.join(dir, INSTALLATION_FIL), JSON.stringify({ standardSprog: 'en', oprettet: 'x', grund: 'ny' }));
    assert.equal(laesInstallation(dir, NU).standardSprog, 'en');
  });
  await medMappe(async (dir) => {
    await writeFile(path.join(dir, INSTALLATION_FIL), '{not json');
    assert.equal(laesInstallationsfil(dir), 'ulaeselig');
    assert.equal(laesInstallation(dir, NU).standardSprog, 'da');
    assert.equal(await readFile(path.join(dir, INSTALLATION_FIL), 'utf8'), '{not json');
  });
});
