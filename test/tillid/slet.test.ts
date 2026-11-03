// KC-0146: Slet alt removes the contents of the data dir and <vault>/Clawco/ and nothing else.
// Temp dirs only — never a real data dir (§4 r5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { sletAlt } from '../../src/tillid/slet.ts';
import { lavRevisionslog } from '../../src/graenser/revisionslog.ts';

const findes = (p: string): Promise<boolean> => access(p).then(() => true, () => false);
async function skriv(fil: string, tekst = 'x'): Promise<void> {
  await mkdir(path.dirname(fil), { recursive: true });
  await writeFile(fil, tekst, 'utf8');
}

async function fixture() {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-slet-'));
  const data = path.join(rod, 'data');
  const vault = path.join(data, 'vault');
  const ude = path.join(rod, 'ude');
  await skriv(path.join(data, 'rum', 'mail', 'state.json'));
  await skriv(path.join(data, 'kilder.json'));
  await skriv(path.join(data, '.env'), 'KC_X=1');
  await skriv(path.join(data, 'hemmeligheder', 'mail-imap.json'));
  await skriv(path.join(data, 'revision-2026-10.jsonl'), '{}\n');
  await skriv(path.join(vault, 'Clawco', 'regler.md'));
  await skriv(path.join(vault, 'Clawco', 'under', 'noget.md'));
  await skriv(path.join(vault, '00-Indbakke', 'egen note.md'));
  await skriv(path.join(vault, '40-Mennesker', 'People', 'Maja.md'));
  await skriv(path.join(ude, 'fremmed.txt'));
  await skriv(path.join(ude, 'clawco-ude', 'regler.md'));
  await symlink(ude, path.join(data, 'link-ud'));
  await symlink(path.join(ude, 'fremmed.txt'), path.join(vault, 'Clawco', 'fil-ud'));
  return { rod, data, vault, ude, ryd: () => rm(rod, { recursive: true, force: true }) };
}

test('removes the data dir contents and Clawco/ contents; the vault, its notes and everything outside stay', async () => {
  const f = await fixture();
  try {
    const svar = await sletAlt({ dataDir: f.data, vaultDir: f.vault }, { person: 'ejer', kanal: 'knap' });
    assert.ok(svar.filer >= 6);
    assert.deepEqual((await readdir(f.data)).sort(), ['vault'], 'only the vault is left in the data dir');
    assert.deepEqual(await readdir(path.join(f.vault, 'Clawco')), [], 'Clawco/ is empty but still there');
    assert.ok(await findes(path.join(f.vault, '00-Indbakke', 'egen note.md')), 'the user\'s own note');
    assert.ok(await findes(path.join(f.vault, '40-Mennesker', 'People', 'Maja.md')), 'the people register');
    assert.ok(await findes(path.join(f.ude, 'fremmed.txt')), 'the symlinks were removed, not followed');
    assert.ok(await findes(path.join(f.ude, 'clawco-ude', 'regler.md')));
  } finally { await f.ryd(); }
});

test('a Clawco folder that is a symlink is not followed', async () => {
  const f = await fixture();
  try {
    await rm(path.join(f.vault, 'Clawco'), { recursive: true });
    await symlink(path.join(f.ude, 'clawco-ude'), path.join(f.vault, 'Clawco'));
    await sletAlt({ dataDir: f.data, vaultDir: f.vault }, { person: 'ejer', kanal: 'knap' });
    assert.ok(await findes(path.join(f.ude, 'clawco-ude', 'regler.md')));
  } finally { await f.ryd(); }
});

test('beskyt keeps an inbox that lives in the data dir', async () => {
  const f = await fixture();
  try {
    await skriv(path.join(f.data, 'indbakke', 'note.md'));
    await sletAlt({ dataDir: f.data, vaultDir: f.vault, beskyt: [path.join(f.data, 'indbakke')] }, { person: 'ejer', kanal: 'knap' });
    assert.ok(await findes(path.join(f.data, 'indbakke', 'note.md')));
  } finally { await f.ryd(); }
});

test('one audit line is written first, then everything goes, then a tombstone starts a fresh log', async () => {
  const f = await fixture();
  try {
    const raekkefoelge: string[] = [];
    const log = lavRevisionslog(f.data);
    const revision = {
      async skriv(e: Parameters<typeof log.skriv>[0]) {
        raekkefoelge.push(`skriv:${await findes(path.join(f.data, 'kilder.json'))}`);
        assert.equal(e.verb, 'slet');
        assert.equal(e.kilde, 'viden');
        assert.equal(e.person, 'ejer');
        return log.skriv(e);
      },
    };
    await sletAlt({ dataDir: f.data, vaultDir: f.vault }, { person: 'ejer', kanal: 'knap', revision });
    assert.deepEqual(raekkefoelge, ['skriv:true', 'skriv:false'], 'the first line while the data was still there, the tombstone after the wipe');
    const rester = (await readdir(f.data)).filter((n) => n !== 'vault');
    assert.equal(rester.length, 2, 'only the fresh log and its anchor');
    assert.ok(rester.includes('revision.anker') && rester.some((n) => /^revision-\d{4}-\d{2}\.jsonl$/.test(n)));
    const seneste = await log.seneste();
    assert.equal(seneste.length, 1, 'a fresh log: the old lines went with the rest');
    assert.equal(seneste[0]!.verb, 'slet');
    assert.equal(seneste[0]!.person, 'ejer');
    assert.equal(seneste[0]!.forrige, '0'.repeat(64), 'the tombstone is the first line of a new chain');
    assert.deepEqual(await log.tjekKaede(), { ok: true });
  } finally { await f.ryd(); }
});

test('KC-0275: pause.json (a stopped app stays stopped) and husstand.json (no tailnet login becomes the owner) survive the wipe', async () => {
  const f = await fixture();
  try {
    await skriv(path.join(f.data, 'pause.json'), '{"pauset":true}');
    await skriv(path.join(f.data, 'husstand.json'), '{"personer":[{"id":"ejer"}]}');
    await sletAlt({ dataDir: f.data, vaultDir: f.vault }, { person: 'ejer', kanal: 'knap' });
    assert.deepEqual((await readdir(f.data)).sort(), ['husstand.json', 'pause.json', 'vault']);
    assert.equal(await readFile(path.join(f.data, 'pause.json'), 'utf8'), '{"pauset":true}');
    assert.equal(await readFile(path.join(f.data, 'husstand.json'), 'utf8'), '{"personer":[{"id":"ejer"}]}');
  } finally { await f.ryd(); }
});

test('refuses a root that is the file system root or the home folder, before anything is removed', async () => {
  await assert.rejects(sletAlt({ dataDir: '/' }, { person: 'ejer', kanal: 'knap' }), /mappe/);
  await assert.rejects(sletAlt({ dataDir: homedir() }, { person: 'ejer', kanal: 'knap' }), /mappe/);
  await assert.rejects(sletAlt({ dataDir: '' }, { person: 'ejer', kanal: 'knap' }), /mappe/);
});

test('a vault that is the data dir itself is refused, nothing removed', async () => {
  const f = await fixture();
  try {
    await assert.rejects(sletAlt({ dataDir: f.data, vaultDir: f.data }, { person: 'ejer', kanal: 'knap' }), /vault/);
    assert.ok(await findes(path.join(f.data, 'kilder.json')));
  } finally { await f.ryd(); }
});

test('a data dir that does not exist is nothing to delete', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-slet-tom-'));
  try {
    assert.deepEqual(await sletAlt({ dataDir: path.join(rod, 'findes-ikke') }, { person: 'ejer', kanal: 'knap' }), { filer: 0 });
  } finally { await rm(rod, { recursive: true, force: true }); }
});
