// KC-0209: the seller's identity on receipts is READ from section 1 of the terms (docs/legal/vilkaar.<sprog>.md),
// the one place it is written (KC-0210); it is never a literal in code. Fail closed: no readable identity, no receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { laesSaelger, laesSaelgere } from '../../src/delt/saelger.ts';
import { JURIDISK_MAPPE } from '../../src/tilmelding/samtykke.ts';

function mappe(da: string, en = da): string {
  const m = fs.mkdtempSync(path.join(os.tmpdir(), 'saelger-'));
  fs.writeFileSync(path.join(m, 'vilkaar.da.md'), da);
  fs.writeFileSync(path.join(m, 'vilkaar.en.md'), en);
  return m;
}
const FM = '---\nversion: 1.0\ndato: 2026-11-02\nstatus: laest\nsprog: da\n---\n';

test('the identity is the first sentence of section 1, per language', () => {
  const m = mappe(`${FM}# Vilkår\n\n## 1. Hvem vi er\n\nClawco Sky drives af Eksempel Person (personligt drevet), Eksempelvej 1, 1000 By, Danmark. Du kan skrive til os. Flere ting.\n\n## 2. Næste\n`,
    `${FM}# Terms\n\n## 1. Who we are\n\nClawco Sky is run by Example Person (a private individual), Example Road 1, 1000 Town, Denmark. You can write to us.\n\n## 2. Next\n`);
  try {
    assert.equal(laesSaelger(m, 'da'), 'Clawco Sky drives af Eksempel Person (personligt drevet), Eksempelvej 1, 1000 By, Danmark.');
    assert.equal(laesSaelger(m, 'en'), 'Clawco Sky is run by Example Person (a private individual), Example Road 1, 1000 Town, Denmark.');
    assert.deepEqual(Object.keys(laesSaelgere(m)), ['da', 'en']);
  } finally { fs.rmSync(m, { recursive: true, force: true }); }
});

test('no readable identity is refused: a missing file, a missing section, a placeholder, an empty paragraph', () => {
  const nej = (indhold: string) => { const m = mappe(indhold); try { assert.throws(() => laesSaelger(m, 'da'), /sælger/i); } finally { fs.rmSync(m, { recursive: true, force: true }); } };
  nej(`${FM}# Vilkår\n\n## 2. Noget andet\n\nTekst.\n`);
  nej(`${FM}# Vilkår\n\n## 1. Hvem vi er\n\n## 2. Næste\n`);
  nej(`${FM}# Vilkår\n\n## 1. Hvem vi er\n\nClawco Sky drives af [Selskab], CVR [CVR]. Mere.\n`);
  assert.throws(() => laesSaelger(path.join(os.tmpdir(), 'findes-ikke-saelger'), 'da'), /sælger/i);
});

test('the real terms give a seller identity in both languages, from the file and not from a literal in code', () => {
  for (const sprog of ['da', 'en'] as const) {
    const s = laesSaelger(JURIDISK_MAPPE, sprog);
    assert.ok(s.length > 20 && s.length <= 300, `${sprog}: ${s.length}`);
    assert.doesNotMatch(s, /[\[\]]/);
    assert.ok(fs.readFileSync(path.join(JURIDISK_MAPPE, `vilkaar.${sprog}.md`), 'utf8').includes(s), 'the text is in the file');
  }
});
