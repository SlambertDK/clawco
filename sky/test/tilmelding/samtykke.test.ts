// KC-0198 / KC-0204: the consent versions recorded at sign-up are read from the frontmatter of the texts they
// name (docs/legal/*.da.md): one place, so a bump of a text asks every account again and nothing can drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laesSamtykke, profilErKlar, samtykkeGyldigt, validerSamtykke } from '../../src/tilmelding/samtykke.ts';

const docs = (navn: string) => fs.readFileSync(fileURLToPath(new URL(`../../../docs/legal/${navn}`, import.meta.url)), 'utf8');
const version = (tekst: string) => /^---\n(?:[^\n]*\n)*?version: (\S+)\n(?:[^\n]*\n)*?---\n/.exec(tekst)?.[1];

test('the config names a version and an account-host path for each text', () => {
  const s = laesSamtykke();
  assert.equal(s.vilkaar.sti, '/vilkaar');
  assert.equal(s.privatliv.sti, '/privatliv');
  assert.match(s.vilkaar.version, /\S/);
});

test('the versions equal the frontmatter version of the Danish texts', () => {
  const s = laesSamtykke();
  assert.equal(s.vilkaar.version, version(docs('vilkaar.da.md')));
  assert.equal(s.privatliv.version, version(docs('privatlivspolitik.da.md')));
});

test('validation refuses a missing version or a path that is not on our own host', () => {
  assert.throws(() => validerSamtykke({ vilkaar: { version: '', sti: '/vilkaar' }, privatliv: { version: '1', sti: '/privatliv' } }), /vilkaar\.version/);
  assert.throws(() => validerSamtykke({ vilkaar: { version: '1', sti: 'https://andet.example/v' }, privatliv: { version: '1', sti: '/privatliv' } }), /vilkaar\.sti/);
  assert.throws(() => validerSamtykke({ vilkaar: { version: '1', sti: '//andet.example' }, privatliv: { version: '1', sti: '/privatliv' } }), /vilkaar\.sti/);
  assert.throws(() => validerSamtykke({ vilkaar: { version: '1', sti: '/v' } }), /privatliv/);
});

test('a version bump in the text file is the version Sky asks for (no mirror to forget)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-samtykke-'));
  try {
    for (const f of ['vilkaar', 'privatlivspolitik']) fs.writeFileSync(path.join(dir, `${f}.da.md`), `---\nversion: ${f === 'vilkaar' ? '2.3' : '1.4'}\ndato: 2026-12-01\nstatus: udgivet\nsprog: da\n---\n# x\n`);
    const s = laesSamtykke(dir);
    assert.deepEqual([s.vilkaar.version, s.privatliv.version], ['2.3', '1.4']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a text without a readable version stops Sky at start instead of recording nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-samtykke-'));
  try {
    fs.writeFileSync(path.join(dir, 'vilkaar.da.md'), '# ingen frontmatter\n');
    fs.writeFileSync(path.join(dir, 'privatlivspolitik.da.md'), '---\nversion: 1.0\n---\n');
    assert.throws(() => laesSamtykke(dir), /vilkaar\.da\.md.*version/);
    fs.writeFileSync(path.join(dir, 'vilkaar.da.md'), '---\nversion: 1.0\n---\n');
    assert.doesNotThrow(() => laesSamtykke(dir));
    fs.rmSync(path.join(dir, 'privatlivspolitik.da.md'));
    assert.throws(() => laesSamtykke(dir), /privatlivspolitik\.da\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('samtykkeGyldigt: only the current versions of both texts count; profilErKlar adds country and language', () => {
  const s = laesSamtykke();
  const ok = { land: 'DK', sprog: 'da' as const, vilkaar: s.vilkaar.version, privatliv: s.privatliv.version };
  assert.equal(samtykkeGyldigt(ok, s), true);
  assert.equal(samtykkeGyldigt({ ...ok, vilkaar: '0.0' }, s), false);
  assert.equal(samtykkeGyldigt({ ...ok, privatliv: null }, s), false);
  assert.equal(samtykkeGyldigt(null, s), false);
  assert.equal(profilErKlar({ ...ok, land: '' }, s), false);
  assert.equal(profilErKlar(ok, s), true);
});
