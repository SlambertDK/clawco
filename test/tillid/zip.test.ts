// KC-0146: the store-only zip writer, checked by the system's own unzip (-t tests every CRC).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavZip } from '../../src/tillid/zip.ts';

test('unzip -t accepts the archive, lists every name (also Danish ones) and gives the bytes back', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-zip-'));
  try {
    const filer = [
      { navn: 'data/rum/mail/state.json', data: Buffer.from('{"a":1}') },
      { navn: 'vault/Clawco/Om mig.md', data: Buffer.from('# Om mig\nÆblegrød på søndag\n') },
      { navn: 'data/tom.txt', data: Buffer.alloc(0) },
      { navn: 'data/binaer.bin', data: Buffer.from([0, 255, 1, 254, 10, 13]) },
    ];
    const zip = path.join(dir, 'alt.zip');
    await writeFile(zip, lavZip(filer, { tid: new Date('2026-11-01T10:20:30Z') }));
    const t = execFileSync('unzip', ['-t', zip], { encoding: 'utf8' });
    assert.match(t, /No errors detected/);
    const navne = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(navne, filer.map((f) => f.navn));
    const ud = path.join(dir, 'ud');
    execFileSync('unzip', ['-q', zip, '-d', ud]);
    for (const f of filer) assert.deepEqual(await readFile(path.join(ud, f.navn)), f.data, f.navn);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an empty archive is still a valid zip', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-zip-tom-'));
  try {
    const zip = path.join(dir, 'tom.zip');
    await writeFile(zip, lavZip([]));
    assert.equal((await readFile(zip)).length, 22, 'only the end record');
    execFileSync('zipinfo', [zip], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    // zipinfo exits 1 on an empty archive on some systems; what matters is the 22-byte end record above.
    if ((err as { status?: number }).status !== 1) throw err;
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('names that would escape on unpacking are refused', () => {
  for (const navn of ['../ud.txt', '/etc/passwd', 'data/../../ud', 'C:\\x', 'data\\x', '']) assert.throws(() => lavZip([{ navn, data: Buffer.from('x') }]), /navn/, navn);
});
