import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { fjernFraMountTekst, valider } from '../src/store/arkiv.ts';
import { listSikkerhedskopi } from '../src/tillid/brugermappe.ts';

// KC-0159: scripts/arkiv.mjs (backup, restore) against fixture folders in a temp dir. No server, no network, no real data.
const ROD = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROD, 'scripts', 'arkiv.mjs');

let tmp = '';
let n = 0;
const nyMappe = (): string => { const d = path.join(tmp, `t${++n}`); mkdirSync(d, { recursive: true }); return d; };

before(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'kc-backup-')); });
after(() => { rmSync(tmp, { recursive: true, force: true }); });

type Verden = { rod: string; data: string; vault: string; envFil: string; til: string };

const skriv = (fil: string, tekst: string): void => { mkdirSync(path.dirname(fil), { recursive: true }); writeFileSync(fil, tekst); };

/** A fixture: a data folder with rooms, settings and fake secrets, a local vault beside it, a fake env file. */
function verden(): Verden {
  const rod = nyMappe();
  const data = path.join(rod, 'data');
  const vault = path.join(rod, 'noter');
  const envFil = path.join(rod, '.env');
  skriv(path.join(data, 'rum', 'mail', 'state.json'), '{"elementer":[{"id":"a1"}]}\n');
  skriv(path.join(data, 'rum', 'mail', 'log.jsonl'), '{"t":1}\n{"t":2}\n');
  skriv(path.join(data, 'rum', 'mail', 'chat.jsonl'), '{"hej":1}\n');
  skriv(path.join(data, 'rum', 'dagen', 'state.json'), '{"dag":"i dag"}\n');
  skriv(path.join(data, 'indstillinger.json'), '{"tier":"lille"}\n');
  skriv(path.join(data, 'kilder.json'), '{"kilder":[]}\n');
  skriv(path.join(data, 'rum', 'skrive', 'æøå dybt', 'x'.repeat(60), 'y'.repeat(60), 'lang-sti-over-hundrede-tegn.json'), '{"lang":true}\n');
  skriv(path.join(data, '.env'), 'KC_HERMES_API_KEY=falsk-nogle-kun-til-test\n');
  skriv(path.join(data, 'hemmeligheder', 'google.json'), '{"x":"falsk"}\n');
  skriv(path.join(data, 'hemmeligheder.enc'), 'falsk-chiffer');
  skriv(path.join(vault, '00-Indbakke', 'a.md'), '# a\n');
  skriv(path.join(vault, 'Clawco', 'regler.md'), '# regler\n');
  skriv(path.join(vault, 'Dagbog', 'æble.md'), '# æble\n');
  skriv(path.join(vault, 'Monkey business.md'), '# en note, hvis navn indeholder key\n');
  skriv(envFil, 'KC_PORT=8750\nKC_HERMES_API_KEY=falsk-nogle-kun-til-test\n');
  return { rod, data, vault, envFil, til: path.join(rod, 'kopier') };
}

type Koersel = { code: number | null; ud: string; fejl: string };

function koer(arbejd: string, args: string[], env: Record<string, string> = {}): Koersel {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: arbejd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', HOME: arbejd, CLAWCO_HOME: path.join(arbejd, 'ingen-hjem'), ...env },
  });
  return { code: r.status, ud: r.stdout, fejl: r.stderr };
}

const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

/** rel path → "sha256 size mtime" for every file; symlinks are listed as such. Used to prove "nothing changed". */
function trae(rod: string, medTid = true): Record<string, string> {
  const ud: Record<string, string> = {};
  const gaa = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = path.relative(rod, abs);
      if (e.isSymbolicLink()) ud[rel] = 'link';
      else if (e.isDirectory()) { ud[rel + '/'] = 'mappe'; gaa(abs); }
      else { const s = statSync(abs); ud[rel] = `${sha(abs)} ${s.size}${medTid ? ` ${Math.floor(s.mtimeMs)}` : ''}`; }
    }
  };
  if (existsSync(rod)) gaa(rod);
  return ud;
}

const filerOnly = (t: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(t).filter(([k]) => !k.endsWith('/')).map(([k, v]) => [k, v.split(' ').slice(0, 2).join(' ')]));

const SKJULT = new Set(['.env', path.join('hemmeligheder', 'google.json'), 'hemmeligheder.enc']);

function backup(v: Verden, ekstra: string[] = [], env: Record<string, string> = {}): { k: Koersel; fil: string } {
  const k = koer(v.rod, ['backup', '--data-mappe', v.data, '--vault-mappe', v.vault, '--til', v.til, '--env-fil', v.envFil, ...ekstra], env);
  const navne = existsSync(v.til) ? readdirSync(v.til).filter((f) => f.endsWith('.tar.gz')) : [];
  return { k, fil: navne.length ? path.join(v.til, navne[navne.length - 1] as string) : '' };
}

// ---- tar helpers for hostile archives ------------------------------------------------------------------------

function blok(navn: string, o: { type?: string; size?: number; link?: string } = {}): Buffer {
  const h = Buffer.alloc(512);
  h.write(navn, 0, 'utf8');
  h.write('0000600\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write((o.size ?? 0).toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(o.type ?? '0', 156);
  if (o.link) h.write(o.link, 157);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

type Post = { navn: string; data?: string; type?: string; link?: string };

function tar(poster: Post[]): Buffer {
  const dele: Buffer[] = [];
  for (const p of poster) {
    const data = Buffer.from(p.data ?? '');
    dele.push(blok(p.navn, { ...(p.type ? { type: p.type } : {}), size: data.length, ...(p.link ? { link: p.link } : {}) }));
    if (data.length) { dele.push(data); dele.push(Buffer.alloc((512 - (data.length % 512)) % 512)); }
  }
  dele.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(dele));
}

const MANIFEST: Post = { navn: 'MANIFEST.json', data: JSON.stringify({ format: 'clawco-backup', version: 1 }) };
const GOD = (): Post[] => [MANIFEST, { navn: 'data/rum/mail/state.json', data: '{"ok":true}\n' }];

// ---- the round trip ------------------------------------------------------------------------------------------

test('backup then restore into an empty folder gives the same files and checksums (secrets left out)', () => {
  const v = verden();
  const { k, fil } = backup(v);
  assert.equal(k.code, 0, k.fejl);
  assert.match(path.basename(fil), /^clawco-backup-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/);
  assert.equal(statSync(fil).mode & 0o777, 0o600, 'the archive is readable by the owner only');
  assert.ok(k.ud.indexOf('MB') >= 0 || k.ud.indexOf('KB') >= 0 || k.ud.indexOf(' B') >= 0, 'the size is reported');
  assert.ok(k.ud.indexOf('Skriver') < k.ud.indexOf('Færdig'), 'size is reported before the archive is written');

  const ny = nyMappe();
  const maal = path.join(ny, 'data');
  const nyVault = path.join(ny, 'noter');
  const r = koer(ny, ['restore', fil, '--data-mappe', maal, '--vault-mappe', nyVault]);
  assert.equal(r.code, 0, r.fejl);

  const kilde = filerOnly(trae(v.data, false));
  for (const s of SKJULT) delete kilde[s];
  assert.deepEqual(filerOnly(trae(maal, false)), kilde, 'data folder: same file list and checksums');
  assert.deepEqual(filerOnly(trae(nyVault, false)), filerOnly(trae(v.vault, false)), 'vault: same file list and checksums, also a note with "key" in its name');
  assert.match(r.ud, /3 rum/, 'counts of restored rooms');
  assert.match(r.ud, /4 noter/, 'counts of restored notes');
  assert.ok(!r.ud.includes('"id"') && !r.ud.includes('falsk'), 'no file bodies are printed');
});

test('restore also works into an existing empty folder', () => {
  const v = verden();
  const { fil } = backup(v);
  const ny = nyMappe();
  mkdirSync(path.join(ny, 'data'));
  mkdirSync(path.join(ny, 'noter'));
  const r = koer(ny, ['restore', fil, '--data-mappe', path.join(ny, 'data'), '--vault-mappe', path.join(ny, 'noter')]);
  assert.equal(r.code, 0, r.fejl);
  assert.ok(existsSync(path.join(ny, 'data', 'rum', 'mail', 'state.json')));
});

test('invariant: a backup never changes the live data (files, checksums, times)', () => {
  const v = verden();
  const foer = trae(v.rod);
  const { k } = backup(v);
  assert.equal(k.code, 0, k.fejl);
  const efter = trae(v.rod);
  for (const k2 of Object.keys(efter)) if (k2 === 'kopier' || k2.startsWith('kopier' + path.sep) || k2 === 'kopier/') delete efter[k2];
  assert.deepEqual(efter, foer);
  const medNoegler = backup(v, ['--med-noegler']);
  assert.equal(medNoegler.k.code, 0, medNoegler.k.fejl);
  const efter2 = trae(v.rod);
  for (const k2 of Object.keys(efter2)) if (k2.startsWith('kopier')) delete efter2[k2];
  assert.deepEqual(efter2, foer);
});

test('a second backup in the same minute never overwrites the first', () => {
  const v = verden();
  const a = backup(v);
  const b = backup(v);
  assert.equal(a.k.code, 0);
  assert.equal(b.k.code, 0);
  assert.equal(readdirSync(v.til).filter((f) => f.endsWith('.tar.gz')).length, 2);
  assert.equal(readdirSync(v.til).filter((f) => f.includes('.tmp')).length, 0, 'no temp file is left behind');
});

// ---- secrets -------------------------------------------------------------------------------------------------

test('.env and key files are absent by default and present with --med-noegler (which says the archive is now a secret)', async () => {
  const v = verden();
  const std = backup(v);
  assert.equal(std.k.code, 0, std.k.fejl);
  const navneStd = (await valider(std.fil)).navne;
  assert.ok(!navneStd.some((x) => /\.env$|hemmelig|google\.json/.test(x)), 'no secret by default');
  assert.ok(navneStd.includes('data/rum/mail/state.json'));
  assert.ok(navneStd.includes('vault/Monkey business.md'), 'a note is never taken for a secret because of a word in its name');
  assert.match(std.k.ud, /3 filer med nøgler.*ikke med|ikke med.*3/i, 'the count of left-out secret files is reported');

  rmSync(v.til, { recursive: true });
  const med = backup(v, ['--med-noegler']);
  assert.equal(med.k.code, 0, med.k.fejl);
  const navneMed = (await valider(med.fil)).navne;
  assert.ok(navneMed.includes('data/.env'));
  assert.ok(navneMed.includes('data/hemmeligheder/google.json'));
  assert.ok(navneMed.includes('data/hemmeligheder.enc'));
  assert.ok(navneMed.some((x) => x.startsWith('miljoe/') && x.endsWith('.env')), 'the install settings file travels with the keys');
  assert.match(med.k.ud, /hemmelig/i, 'warns that the archive is now a secret');
});

test('KC-0245: the installer\'s key file (outside the data folder) is in no default backup and travels under miljoe/ with --med-noegler, so the encrypted store can be opened after a restore', async () => {
  const v = verden();
  const noeglefil = path.join(v.rod, 'hemmeligheder.key');
  skriv(noeglefil, `${'A'.repeat(43)}=\n`);
  const env = { KC_HEMMELIGHEDER_FIL: noeglefil };
  const std = backup(v, [], env);
  assert.equal(std.k.code, 0, std.k.fejl);
  assert.ok(!(await valider(std.fil)).navne.some((x) => x.endsWith('hemmeligheder.key')), 'not by default');
  rmSync(v.til, { recursive: true });
  const med = backup(v, ['--med-noegler'], env);
  assert.equal(med.k.code, 0, med.k.fejl);
  const navne = (await valider(med.fil)).navne;
  assert.ok(navne.includes('miljoe/hemmeligheder.key'), 'with the keys');
  assert.ok(navne.includes('data/hemmeligheder.enc'), 'next to the store it opens');
});

// ---- refusing and replacing ------------------------------------------------------------------------------------

test('restore over a non-empty data folder without --erstat exits non-zero and changes nothing', () => {
  const v = verden();
  const { fil } = backup(v);
  const ny = nyMappe();
  const maal = path.join(ny, 'data');
  skriv(path.join(maal, 'rum', 'mail', 'state.json'), '{"gammelt":true}\n');
  const foer = trae(ny);
  const r = koer(ny, ['restore', fil, '--data-mappe', maal, '--vault-mappe', path.join(ny, 'noter')]);
  assert.notEqual(r.code, 0);
  assert.match(r.fejl + r.ud, /--erstat/);
  assert.deepEqual(trae(ny), foer, 'nothing was added, moved or removed');
});

test('--erstat moves the old folder aside (never deletes), then restores', () => {
  const v = verden();
  const { fil } = backup(v);
  const ny = nyMappe();
  const maal = path.join(ny, 'data');
  skriv(path.join(maal, 'rum', 'mail', 'state.json'), '{"gammelt":true}\n');
  skriv(path.join(maal, 'rum', 'ekstra', 'state.json'), '{"kun-i-det-gamle":true}\n');
  const gammelt = filerOnly(trae(maal, false));
  const r = koer(ny, ['restore', fil, '--data-mappe', maal, '--vault-mappe', path.join(ny, 'noter'), '--erstat']);
  assert.equal(r.code, 0, r.fejl);
  const flyttet = readdirSync(ny).filter((f) => /^data\.foer-gendannelse-\d{4}-\d{2}-\d{2}/.test(f));
  assert.equal(flyttet.length, 1);
  const rel = (m: string): Record<string, string> => Object.fromEntries(Object.entries(filerOnly(trae(m, false))));
  assert.deepEqual(rel(path.join(ny, flyttet[0] as string)), gammelt, 'the old folder is intact');
  assert.equal(readFileSync(path.join(maal, 'rum', 'mail', 'state.json'), 'utf8'), '{"elementer":[{"id":"a1"}]}\n');
  assert.ok(!existsSync(path.join(maal, 'rum', 'ekstra')), 'the restored folder holds only the backup');
});

test('a restore that fails half way leaves the old folder untouched and no staging folder', () => {
  const ny = nyMappe();
  const maal = path.join(ny, 'data');
  skriv(path.join(maal, 'gammelt.json'), '{}\n');
  const fil = path.join(ny, 'afkortet.tar.gz');
  const hel = tar([...GOD(), { navn: 'data/stor.bin', data: 'x'.repeat(5000) }]);
  writeFileSync(fil, hel.subarray(0, hel.length - 40));
  const flere = trae(ny);
  const r = koer(ny, ['restore', fil, '--data-mappe', maal, '--erstat']);
  assert.notEqual(r.code, 0);
  assert.deepEqual(trae(ny), flere);
  assert.deepEqual(readdirSync(ny).sort(), ['afkortet.tar.gz', 'data']);
});

// ---- hostile archives ------------------------------------------------------------------------------------------

const HOSTILE: [string, Post[]][] = [
  ['a ../ entry', [...GOD(), { navn: '../evil.txt', data: 'x' }]],
  ['a nested ../ entry', [...GOD(), { navn: 'data/../../evil.txt', data: 'x' }]],
  ['an absolute path', [...GOD(), { navn: '/tmp/evil-absolut.txt', data: 'x' }]],
  ['a backslash path', [...GOD(), { navn: 'data\\..\\evil.txt', data: 'x' }]],
  ['a symlink to somewhere outside', [...GOD(), { navn: 'data/snyd', type: '2', link: '/etc' }]],
  ['a symlink with ../ target', [...GOD(), { navn: 'data/snyd', type: '2', link: '../../evil' }]],
  ['a hardlink to a file outside', [...GOD(), { navn: 'data/hard', type: '1', link: '/etc/hosts' }]],
  ['a device entry', [...GOD(), { navn: 'data/dev', type: '3' }]],
  ['an unknown top-level folder', [...GOD(), { navn: 'andet/fil.txt', data: 'x' }]],
  ['a duplicate entry', [...GOD(), { navn: 'data/rum/mail/state.json', data: '{}' }]],
  ['a file that is also a folder', [...GOD(), { navn: 'data/rum/mail/state.json/under.txt', data: 'x' }]],
];

for (const [navn, poster] of HOSTILE) {
  test(`hostile archive: ${navn} is rejected before anything is written`, () => {
    const ny = nyMappe();
    const maal = path.join(ny, 'data');
    const fil = path.join(ny, 'ond.tar.gz');
    writeFileSync(fil, tar(poster));
    const foer = trae(ny);
    const r = koer(ny, ['restore', fil, '--data-mappe', maal, '--vault-mappe', path.join(ny, 'noter')]);
    assert.notEqual(r.code, 0, `${r.ud}${r.fejl}`);
    assert.deepEqual(trae(ny), foer, 'nothing was written, not even the good entries before the bad one');
    assert.deepEqual(readdirSync(ny).sort(), ['ond.tar.gz']);
    assert.ok(!existsSync(path.join(path.dirname(ny), 'evil.txt')));
    assert.ok(!existsSync('/tmp/evil-absolut.txt'));
  });
}

test('hostile archive: valider names the first bad entry in its error but never the archive body', async () => {
  const ny = nyMappe();
  const fil = path.join(ny, 'ond.tar.gz');
  writeFileSync(fil, tar([MANIFEST, { navn: '../evil.txt', data: 'hemmeligt-indhold' }]));
  await assert.rejects(valider(fil), (e: Error) => /evil\.txt/.test(e.message) && !/hemmeligt-indhold/.test(e.message));
});

test('a file that is not a gzip tar archive is rejected', () => {
  const ny = nyMappe();
  const fil = path.join(ny, 'rod.tar.gz');
  writeFileSync(fil, 'det her er ikke et arkiv');
  const r = koer(ny, ['restore', fil, '--data-mappe', path.join(ny, 'data')]);
  assert.notEqual(r.code, 0);
  assert.deepEqual(readdirSync(ny), ['rod.tar.gz']);
});

test('restore of a missing file exits non-zero', () => {
  const ny = nyMappe();
  const r = koer(ny, ['restore', path.join(ny, 'findes-ikke.tar.gz'), '--data-mappe', path.join(ny, 'data')]);
  assert.notEqual(r.code, 0);
});

// ---- the vault, other guards ------------------------------------------------------------------------------------

test('a vault on a network mount is left out ("ikke med") unless --med-vault; the helper decides, not a copy of the list', async () => {
  const v = verden();
  const men = { dataDir: v.data, vaultDir: v.vault };
  const fjern = await listSikkerhedskopi(men, { vaultFjern: true });
  assert.equal(fjern.vault.status, 'ikke-lokal');
  assert.ok(!fjern.filer.some((f) => f.sti.startsWith('vault/')));
  const med = await listSikkerhedskopi(men, { vaultFjern: true, medVault: true });
  assert.equal(med.vault.status, 'med');
  assert.ok(med.filer.some((f) => f.sti === 'vault/Dagbog/æble.md'));
  const lokal = await listSikkerhedskopi(men, {});
  assert.equal(lokal.vault.status, 'med');
  assert.equal(lokal.udeladt, 3, 'three secret files in the data folder, counted not named');
});

test('a vault inside the data folder is part of the data folder, once', async () => {
  const rod = nyMappe();
  const data = path.join(rod, 'data');
  skriv(path.join(data, 'vault', 'Clawco', 'regler.md'), '# r\n');
  skriv(path.join(data, 'rum', 'mail', 'state.json'), '{}\n');
  const l = await listSikkerhedskopi({ dataDir: data, vaultDir: path.join(data, 'vault') }, {});
  assert.deepEqual(l.filer.map((f) => f.sti).sort(), ['data/rum/mail/state.json', 'data/vault/Clawco/regler.md']);
  assert.equal(l.vault.sti, 'data/vault');
});

test('a symlink in the data folder is never followed into the archive', async () => {
  const v = verden();
  symlinkSync('/etc', path.join(v.data, 'peger-ud'));
  const l = await listSikkerhedskopi({ dataDir: v.data, vaultDir: v.vault }, {});
  assert.ok(!l.filer.some((f) => f.sti.includes('peger-ud')));
});

test('mount tables from Linux and macOS are read: only network file systems count', () => {
  const linux = ['/dev/sda1 / ext4 rw 0 0', 'nas:/export /mnt/nas-obsidian nfs4 rw,relatime 0 0', '//nas/share /mnt/smb\\040mappe cifs rw 0 0'].join('\n');
  assert.equal(fjernFraMountTekst(linux, '/mnt/nas-obsidian/ObsidianVault'), true);
  assert.equal(fjernFraMountTekst(linux, '/mnt/smb mappe/x'), true);
  assert.equal(fjernFraMountTekst(linux, '/home/bruger/noter'), false);
  const mac = ['/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)', '//bruger@nas._smb._tcp.local/Noter on /Volumes/Noter (smbfs, nodev, nosuid, mounted by bruger)', 'nas:/exp on /Volumes/exp (nfs, nodev)'].join('\n');
  assert.equal(fjernFraMountTekst(mac, '/Volumes/Noter/Vault'), true);
  assert.equal(fjernFraMountTekst(mac, '/Volumes/exp'), true);
  assert.equal(fjernFraMountTekst(mac, '/Users/bruger/Noter'), false);
});

test('the backup folder may not lie inside the data folder (the copy would swallow itself)', () => {
  const v = verden();
  const r = koer(v.rod, ['backup', '--data-mappe', v.data, '--vault-mappe', v.vault, '--til', path.join(v.data, 'kopier')]);
  assert.notEqual(r.code, 0);
  assert.ok(!existsSync(path.join(v.data, 'kopier')));
});

test('without a data folder there is nothing to back up', () => {
  const rod = nyMappe();
  const r = koer(rod, ['backup', '--data-mappe', path.join(rod, 'findes-ikke'), '--til', path.join(rod, 'kopier')]);
  assert.notEqual(r.code, 0);
  assert.ok(!existsSync(path.join(rod, 'kopier')));
});

test('KC_DATA_DIR and KC_BACKUP_DIR are read from the environment', () => {
  const v = verden();
  const r = koer(v.rod, ['backup'], { KC_DATA_DIR: v.data, KC_VAULT_DIR: v.vault, KC_BACKUP_DIR: v.til });
  assert.equal(r.code, 0, r.fejl);
  assert.equal(readdirSync(v.til).length, 1);
});

test('no command or an unknown one prints usage and exits 2', () => {
  const rod = nyMappe();
  assert.equal(koer(rod, []).code, 2);
  assert.equal(koer(rod, ['slet']).code, 2);
  assert.equal(koer(rod, ['restore']).code, 2);
});
