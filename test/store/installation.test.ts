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

// KC-0246: under Clawco Sky the container is told the owner's sign-up language (KC_SPROG), so Start's step 1 does not ask
// again. Only a NEW installation reads it. Sky seeds husstand.json before the first start, so that file alone does not make
// a folder "in use"; anything else does, and then the folder keeps Danish. A record, once written, is never changed by it.
import { sprogFraMiljoe } from '../../src/store/installation.ts';

test('KC-0246 sprogFraMiljoe: da and en only; anything else is no wish', () => {
  assert.equal(sprogFraMiljoe({ KC_SPROG: 'da' }), 'da');
  assert.equal(sprogFraMiljoe({ KC_SPROG: ' en ' }), 'en');
  for (const v of [undefined, '', 'DA', 'de', 'da,en']) assert.equal(sprogFraMiljoe({ KC_SPROG: v }), null, String(v));
  assert.equal(sprogFraMiljoe({}), null);
});

test('KC-0246: a new folder starts in the language it was told; without a wish it is English as before', async () => {
  for (const sprog of ['da', 'en'] as const) {
    await medMappe(async (dir) => {
      const ny = path.join(dir, 'frisk');
      assert.deepEqual(laesInstallation(ny, NU, sprog), { standardSprog: sprog, oprettet: '2026-11-02T20:00:00.000Z', grund: 'ny' });
      assert.equal(JSON.parse(await readFile(path.join(ny, INSTALLATION_FIL), 'utf8')).standardSprog, sprog);
    });
  }
  await medMappe(async (dir) => { assert.equal(laesInstallation(path.join(dir, 'x'), NU, null).standardSprog, 'en'); });
});

test('KC-0246: a Sky tenant folder holding only the seeded household is still new: the told language wins (and without one it stays as it was, Danish)', async () => {
  for (const sprog of ['da', 'en'] as const) {
    await medMappe(async (dir) => {
      await writeFile(path.join(dir, 'husstand.json'), '{}');
      assert.deepEqual(laesInstallation(dir, NU, sprog), { standardSprog: sprog, oprettet: '2026-11-02T20:00:00.000Z', grund: 'ny' });
    });
  }
  await medMappe(async (dir) => {
    await writeFile(path.join(dir, 'husstand.json'), '{}');
    assert.deepEqual(laesInstallation(dir, NU, null), { standardSprog: 'da', oprettet: '2026-11-02T20:00:00.000Z', grund: 'foer-sproget' });
  });
});

test('KC-0246: a folder already in use never takes its language from the env (room state, a profile, settings, anything but the seeded household)', async () => {
  for (const tegn of ['rum', 'profil.json', 'indstillinger.json', 'kilder.json', 'pause.json', 'tillid']) {
    await medMappe(async (dir) => {
      if (tegn.endsWith('.json')) await writeFile(path.join(dir, tegn), '{}'); else await mkdir(path.join(dir, tegn));
      await writeFile(path.join(dir, 'husstand.json'), '{}');
      assert.deepEqual(laesInstallation(dir, NU, 'en'), { standardSprog: 'da', oprettet: '2026-11-02T20:00:00.000Z', grund: 'foer-sproget' }, tegn);
    });
  }
});

test('KC-0246: a stored record is never changed by the env, in either direction; an unreadable one is left alone', async () => {
  for (const [gemt, ensket] of [['da', 'en'], ['en', 'da']] as const) {
    await medMappe(async (dir) => {
      await writeFile(path.join(dir, INSTALLATION_FIL), JSON.stringify({ standardSprog: gemt, oprettet: 'x', grund: 'ny' }));
      assert.equal(laesInstallation(dir, NU, ensket).standardSprog, gemt);
      assert.equal(JSON.parse(await readFile(path.join(dir, INSTALLATION_FIL), 'utf8')).standardSprog, gemt);
    });
  }
  await medMappe(async (dir) => {
    await writeFile(path.join(dir, INSTALLATION_FIL), '{not json');
    assert.equal(laesInstallation(dir, NU, 'en').standardSprog, 'da');
    assert.equal(await readFile(path.join(dir, INSTALLATION_FIL), 'utf8'), '{not json');
  });
});
