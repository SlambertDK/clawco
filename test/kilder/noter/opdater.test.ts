// KC-0219: the update writer of the people register. An existing person is changed only in the fields the user saw in
// the diff, only while the file still says what the diff said; everything else in the file stays byte for byte; the
// write is atomic (tmp + rename) and returns what Fortryd needs. Synthetic fixtures only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gendanPerson, laesPersoner, opdaterPerson, sha256 } from '../../../src/kilder/noter/personer.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

async function medTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-noter-opdater-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const lav = async (dir: string, rel: string, indhold: string): Promise<string> => {
  const fil = path.join(dir, rel);
  await mkdir(path.dirname(fil), { recursive: true });
  await writeFile(fil, indhold);
  return fil;
};

/** The shape Henrik's register has, plus a section and a key Clawco knows nothing about. */
const BODIL = '---\nrelation: søster\nfødselsdag: 1975-03-14\ntags: [person]\nzone: privat\n---\n# Bodil Prøvesen\n\n## Vigtige fakta\n- Bor i Odense\n- bodil@example.org\n\n## Mine egne tanker\nHun ringer om søndagen.\n';

test('only the fields in the diff change, in place: unknown keys, their order and the whole body stay byte for byte', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  const r = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }, { felt: 'org', nu: '', ny: 'Fyrtaarn A/S' }] });
  assert.equal(r.udfald, 'opdateret');
  const nu = await readFile(fil, 'utf8');
  assert.equal(nu, '---\nrelation: din søster\nfødselsdag: 1975-03-14\ntags: [person]\nzone: privat\norg: Fyrtaarn A/S\n---\n# Bodil Prøvesen\n\n## Vigtige fakta\n- Bor i Odense\n- bodil@example.org\n\n## Mine egne tanker\nHun ringer om søndagen.\n');
  assert.equal(nu.slice(nu.indexOf('# Bodil')), BODIL.slice(BODIL.indexOf('# Bodil')), 'the body is untouched');
  if (r.udfald === 'opdateret') {
    assert.equal(r.sti, 'familie/Bodil Prøvesen.md');
    assert.deepEqual(r.kvittering, { sti: 'familie/Bodil Prøvesen.md', sha256: sha256(nu), forrige: BODIL });
    assert.deepEqual(r.felter, ['relation', 'org']);
  }
  assert.deepEqual((await laesPersoner(dir, { zone: 'privat' }))[0], { navn: 'Bodil Prøvesen', relation: 'din søster', org: 'Fyrtaarn A/S', foedselsdag: '1975-03-14', zone: 'privat', mappe: 'familie', sti: 'familie/Bodil Prøvesen.md' });
}));

test('the Danish key of a birthday is changed where it stands, never added a second time', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'foedselsdag', nu: '1975-03-14', ny: '14. marts' }] });
  assert.equal(await readFile(fil, 'utf8'), BODIL.replace('fødselsdag: 1975-03-14', 'fødselsdag: 14. marts'));
}));

test('a value YAML would misread is written quoted, like skrivPerson does', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'andre/Kurt.md', '---\nrelation: kollega\n---\nTekst\n');
  await opdaterPerson(dir, { navn: 'Kurt', diff: [{ felt: 'org', nu: '', ny: 'A: B #1' }] });
  assert.equal(await readFile(fil, 'utf8'), '---\nrelation: kollega\norg: "A: B #1"\n---\nTekst\n');
}));

test('a file without frontmatter gets a block with the changed fields on top; the text under it is byte for byte', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'arbejde/Kurt Kollega.md', '# Kurt\n\nIngen frontmatter.\n');
  await opdaterPerson(dir, { navn: 'Kurt Kollega', diff: [{ felt: 'relation', nu: 'arbejde', ny: 'kollega' }] });
  assert.equal(await readFile(fil, 'utf8'), '---\nrelation: kollega\n---\n# Kurt\n\nIngen frontmatter.\n');
}));

test('Windows line endings stay Windows line endings', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'andre/Kurt.md', '---\r\nrelation: kollega\r\n---\r\nTekst\r\n');
  await opdaterPerson(dir, { navn: 'Kurt', diff: [{ felt: 'relation', nu: 'kollega', ny: 'chef' }, { felt: 'org', nu: '', ny: 'Fyrtaarn' }] });
  assert.equal(await readFile(fil, 'utf8'), '---\r\nrelation: chef\r\norg: Fyrtaarn\r\n---\r\nTekst\r\n');
}));

test('the person is found like skrivPerson finds one: any folder, any case', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'venner/maja.md', '---\nrelation: ven\n---\n');
  const r = await opdaterPerson(dir, { navn: 'Maja', diff: [{ felt: 'relation', nu: 'ven', ny: 'kone' }] });
  assert.equal(r.udfald, 'opdateret');
  assert.match(await readFile(fil, 'utf8'), /relation: kone/);
}));

test('only the diff of the pile counts: name, zone, source and body are never changed, even when asked', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  const r = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'zone', nu: 'privat', ny: 'arbejde' }, { felt: 'navn', nu: 'x', ny: 'y' }, { felt: 'tekst', nu: 'a', ny: 'b' }, { felt: 'kilde', nu: '', ny: 'z' }] });
  assert.equal(r.udfald, 'uaendret');
  assert.equal(await readFile(fil, 'utf8'), BODIL);
}));

test('a field that has changed since the proposal is not written over: only what the user saw is applied', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL.replace('relation: søster', 'relation: lillesøster'));
  const r = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }, { felt: 'org', nu: '', ny: 'Fyrtaarn' }] });
  assert.equal(r.udfald, 'opdateret');
  if (r.udfald === 'opdateret') { assert.deepEqual(r.felter, ['org']); assert.deepEqual(r.sprunget, ['relation']); }
  assert.match(await readFile(fil, 'utf8'), /relation: lillesøster\n[\s\S]*org: Fyrtaarn\n/);
  // …and when nothing is left to apply, nothing is written at all.
  const foer = await readFile(fil, 'utf8');
  const r2 = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }] });
  assert.deepEqual(r2, { udfald: 'forandret', sti: 'familie/Bodil Prøvesen.md', sprunget: ['relation'] });
  assert.equal(await readFile(fil, 'utf8'), foer);
}));

test('a file that already says what the import says is uaendret and is not rewritten', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  const foer = await stat(fil);
  const r = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'søster' }] });
  assert.deepEqual(r, { udfald: 'uaendret', sti: 'familie/Bodil Prøvesen.md' });
  assert.equal((await stat(fil)).ino, foer.ino);
}));

test('the write is tmp + rename: a new inode, the file mode kept, no leftover in the folder', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  await chmod(fil, 0o640);
  const foer = await stat(fil);
  await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }] });
  const efter = await stat(fil);
  assert.notEqual(efter.ino, foer.ino, 'renamed over, not written in place');
  assert.equal(efter.mode & 0o777, 0o640);
  assert.deepEqual(await readdir(path.join(dir, 'familie')), ['Bodil Prøvesen.md']);
}));

test('Fortryd puts the previous bytes back, atomically, only while the file still holds what was written', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'familie/Bodil Prøvesen.md', BODIL);
  const r = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }, { felt: 'org', nu: '', ny: 'Fyrtaarn' }] });
  assert.equal(r.udfald, 'opdateret');
  if (r.udfald !== 'opdateret') return;
  assert.equal(await gendanPerson(dir, r.kvittering), true);
  assert.equal(await readFile(fil, 'utf8'), BODIL, 'byte for byte as before');
  assert.deepEqual(await readdir(path.join(dir, 'familie')), ['Bodil Prøvesen.md']);
  // Updated again, then edited by the user: Fortryd keeps the user's version.
  const r2 = await opdaterPerson(dir, { navn: 'Bodil Prøvesen', diff: [{ felt: 'relation', nu: 'søster', ny: 'din søster' }] });
  await writeFile(fil, 'Jeg har rettet den.\n');
  if (r2.udfald === 'opdateret') assert.equal(await gendanPerson(dir, r2.kvittering), false);
  assert.equal(await readFile(fil, 'utf8'), 'Jeg har rettet den.\n');
}));

test('Fortryd refuses a receipt that is not an update of a person file', () => medTmp(async (dir) => {
  await assert.rejects(gendanPerson(dir, { sti: 'familie/x.txt', sha256: sha256('a'), forrige: 'b' }), KildeFejl);
  await assert.rejects(gendanPerson(dir, { sti: 'familie/x.md', sha256: sha256('a') }), KildeFejl);
  await assert.rejects(gendanPerson(dir, { sti: '../x.md', sha256: sha256('a'), forrige: 'b' }), KildeFejl);
}));

test('refusals leave the file alone: a person that is gone (404), a file too big to undo safely (409), bytes that are not text (409)', () => medTmp(async (dir) => {
  await assert.rejects(opdaterPerson(dir, { navn: 'Ingen', diff: [{ felt: 'relation', nu: '', ny: 'x' }] }), (e: unknown) => e instanceof KildeFejl && e.status === 404);
  const stor = `---\nrelation: ven\n---\n${'a'.repeat(20_000)}\n`;
  const f1 = await lav(dir, 'venner/Stor.md', stor);
  await assert.rejects(opdaterPerson(dir, { navn: 'Stor', diff: [{ felt: 'relation', nu: 'ven', ny: 'kone' }] }), (e: unknown) => e instanceof KildeFejl && e.status === 409);
  assert.equal(await readFile(f1, 'utf8'), stor);
  const raa = Buffer.concat([Buffer.from('---\nrelation: ven\n---\n'), Buffer.from([0xff, 0xfe, 0x41])]);
  const f2 = path.join(dir, 'venner', 'Rod.md');
  await writeFile(f2, raa);
  await assert.rejects(opdaterPerson(dir, { navn: 'Rod', diff: [{ felt: 'relation', nu: 'ven', ny: 'kone' }] }), (e: unknown) => e instanceof KildeFejl && e.status === 409);
  assert.ok((await readFile(f2)).equals(raa));
}));

test('bad values and bad names are refused (400) before anything is written', () => medTmp(async (dir) => {
  const fil = await lav(dir, 'venner/Ida.md', '---\nrelation: ven\n---\n');
  for (const ny of ['a\nb', 'x'.repeat(81)]) await assert.rejects(opdaterPerson(dir, { navn: 'Ida', diff: [{ felt: 'relation', nu: 'ven', ny }] }), (e: unknown) => e instanceof KildeFejl && e.status === 400);
  await assert.rejects(opdaterPerson(dir, { navn: '../Ida', diff: [{ felt: 'relation', nu: 'ven', ny: 'x' }] }), KildeFejl);
  assert.equal(await readFile(fil, 'utf8'), '---\nrelation: ven\n---\n');
}));

test('a key with a list under it is not overwritten blindly: refused (409), the file untouched', () => medTmp(async (dir) => {
  const s = '---\nrelation: ven\norg:\n  - A\n  - B\n---\n';
  const fil = await lav(dir, 'venner/Ida.md', s);
  await assert.rejects(opdaterPerson(dir, { navn: 'Ida', diff: [{ felt: 'org', nu: '', ny: 'C' }] }), (e: unknown) => e instanceof KildeFejl && e.status === 409);
  assert.equal(await readFile(fil, 'utf8'), s);
}));
