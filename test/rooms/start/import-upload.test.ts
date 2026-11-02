// KC-0129: the upload guard (size, type, names) and the temp dir raw uploads live in — nowhere else, one hour at most.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modtagUpload, rydTmp, TMP_LEVETID_MS, UPLOAD_MAKS } from '../../../src/rooms/start/import/upload.ts';
import { ActionError } from '../../../src/rooms/module.ts';

const NU = new Date('2026-10-31T09:00:00Z');
async function medBase(fn: (base: string) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-upload-'));
  try { await fn(path.join(rod, 'import')); } finally { await rm(rod, { recursive: true, force: true }); }
}
const ingenRester = async (base: string): Promise<void> => assert.deepEqual(await readdir(base).catch(() => []), [], 'nothing left in the temp dir');
const afvist = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof ActionError && e.status === 400);

test('a good upload lands in its own folder under the temp base, once per file, with no name from the user in any path', async () => {
  await medBase(async (base) => {
    const r = await modtagUpload(base, NU, [{ navn: 'kontakter.vcf', tekst: 'BEGIN:VCARD' }, { navn: 'Ørsted æble.md', tekst: '# hej' }]);
    assert.equal(path.dirname(r.dir), base);
    assert.match(path.basename(r.dir), new RegExp(`^${NU.getTime()}-[0-9a-f]+$`));
    assert.deepEqual(r.filer.map((f) => f.navn), ['kontakter.vcf', 'Ørsted æble.md']);
    const paa = (await readdir(r.dir)).sort();
    assert.deepEqual(paa, ['0.vcf', '1.md']);
    assert.equal(await readFile(path.join(r.dir, '0.vcf'), 'utf8'), 'BEGIN:VCARD');
  });
});

test('wrong type, a path in the name, an empty list, malformed entries, too many files: 400 and nothing left behind', async () => {
  await medBase(async (base) => {
    for (const filer of [
      [{ navn: 'virus.exe', tekst: 'x' }], [{ navn: 'arkiv.zip', tekst: 'x' }], [{ navn: '../x.vcf', tekst: 'x' }], [{ navn: 'a/b.vcf', tekst: 'x' }], [{ navn: 'a\\b.vcf', tekst: 'x' }],
      [{ navn: '..', tekst: 'x' }], [{ navn: 'x\u0000.vcf', tekst: 'x' }], [{ navn: '.vcf', tekst: 'x' }], [], 'ikke en liste', null, [7], [{ navn: 'a.vcf' }], [{ navn: 'a.vcf', tekst: 5 }],
      Array.from({ length: 201 }, (_, i) => ({ navn: `n${i}.md`, tekst: 'x' })),
    ]) await afvist(modtagUpload(base, NU, filer));
    await ingenRester(base);
  });
});

test('over the cap (10 MB in total) is refused; just under it is taken', async () => {
  await medBase(async (base) => {
    await afvist(modtagUpload(base, NU, [{ navn: 'stor.csv', tekst: 'x'.repeat(UPLOAD_MAKS + 1) }]));
    await afvist(modtagUpload(base, NU, [{ navn: 'a.csv', tekst: 'x'.repeat(UPLOAD_MAKS - 10) }, { navn: 'b.csv', tekst: 'x'.repeat(20) }]));
    await ingenRester(base);
    const ok = await modtagUpload(base, NU, [{ navn: 'a.csv', tekst: 'x'.repeat(UPLOAD_MAKS) }]);
    assert.equal(ok.filer.length, 1);
  });
});

test('rydTmp removes everything on request, and by age otherwise (an hour, by the folder\'s own time stamp)', async () => {
  await medBase(async (base) => {
    const gammel = path.join(base, `${NU.getTime() - TMP_LEVETID_MS - 1}-aaaaaaaa`);
    const frisk = path.join(base, `${NU.getTime() - TMP_LEVETID_MS + 60_000}-bbbbbbbb`);
    const fremmed = path.join(base, 'ikke-vores');
    for (const d of [gammel, frisk, fremmed]) await mkdir(d, { recursive: true });
    assert.equal(await rydTmp(base, { foer: new Date(NU.getTime() - TMP_LEVETID_MS) }), 1);
    assert.deepEqual((await readdir(base)).sort(), [path.basename(fremmed), path.basename(frisk)].sort());
    assert.equal(await rydTmp(base, { alle: true }), 1, 'our folders only; a folder that is not ours is left alone');
    assert.deepEqual(await readdir(base), [path.basename(fremmed)]);
    assert.equal(await rydTmp(path.join(base, 'findes-ikke'), { alle: true }), 0);
  });
});
