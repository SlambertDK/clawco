// KC-0275 (E4): the one atomic write — mode 0600, a unique temp name, no temp file left behind on a failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { skrivAtomisk } from '../../src/store/atomisk.ts';

async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-atomisk-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('writes the content with mode 0600 and leaves no temp file', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, 'a.json');
    await skrivAtomisk(fil, '{"a":1}');
    await skrivAtomisk(fil, '{"a":2}');
    assert.equal(await readFile(fil, 'utf8'), '{"a":2}');
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(dir), ['a.json']);
  });
});

test('a failed rename removes the temp file and rethrows', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, 'mappe');
    await mkdir(path.join(fil, 'indhold'), { recursive: true }); // the target is a non-empty directory: rename fails
    await assert.rejects(skrivAtomisk(fil, 'x'));
    assert.deepEqual(await readdir(dir), ['mappe'], 'no mappe.tmp-… left');
  });
});

test('many parallel writes to one file never collide on the temp name', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, 'p.json');
    await Promise.all(Array.from({ length: 30 }, (_, i) => skrivAtomisk(fil, String(i))));
    assert.deepEqual(await readdir(dir), ['p.json']);
  });
});
