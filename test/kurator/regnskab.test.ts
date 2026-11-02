import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUKT } from '../../src/shell/navn.ts';
import { fjernRegnskab, harRegnskab, regnskabsfil, regnskabsRaekke, skrivRegnskab } from '../../src/kurator/regnskab.ts';
import type { Regnskabslinje } from '../../src/rooms/hjem/kort.ts';

const HEADER = '| Dato | Leverandør | Beløb | Valuta | Periode | Art | Mail (emne) |';

const linje: Regnskabslinje = {
  hvor: 'shelfatlas',
  dato: '2026-10-20',
  leverandoer: 'Vercel',
  beloeb: '20,00',
  valuta: 'USD',
  periode: '2026-10',
  art: 'abonnement',
  emne: 'Your Vercel invoice',
};

async function medTempRod(fn: (rod: string) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(join(tmpdir(), 'kc-regnskab-'));
  try {
    await fn(rod);
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
}

function raekker(tekst: string): string[] {
  return tekst.split('\n').filter((l) => l.includes('<!-- kc:'));
}

test('writes header + one row with marker in a new file', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    assert.equal(await skrivRegnskab(fil, 'a1', linje), 'skrevet');
    const tekst = await readFile(fil, 'utf8');
    assert.ok(tekst.startsWith(`# Regnskab — ShelfAtlas\n\nSkrevet af Kuratoren i ${PRODUKT}. Hver linje kan fortrydes i Nu.\n\n`));
    assert.ok(tekst.includes(`${HEADER}\n| --- | --- | --- | --- | --- | --- | --- |\n`));
    assert.deepEqual(raekker(tekst), [
      '| 2026-10-20 | Vercel | 20,00 | USD | 2026-10 | abonnement | Your Vercel invoice | <!-- kc:a1 -->',
    ]);
  });
});

test('private ledger gets its own title, køb renders as "køb", missing periode is empty', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'privat');
    const privat: Regnskabslinje = { ...linje, hvor: 'privat', art: 'koeb' };
    delete privat.periode;
    await skrivRegnskab(fil, 'p1', privat);
    const tekst = await readFile(fil, 'utf8');
    assert.ok(tekst.startsWith('# Regnskab — Abonnementer (privat)\n'));
    assert.equal(regnskabsRaekke('p1', privat), '| 2026-10-20 | Vercel | 20,00 | USD |  | køb | Your Vercel invoice | <!-- kc:p1 -->');
  });
});

test('second skrivRegnskab with the same id returns "findes" and the file has one row', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    assert.equal(await skrivRegnskab(fil, 'a1', linje), 'skrevet');
    assert.equal(await skrivRegnskab(fil, 'a1', linje), 'findes');
    assert.equal(raekker(await readFile(fil, 'utf8')).length, 1);
  });
});

test('concurrent writes of different ids all land', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => skrivRegnskab(fil, id, linje)));
    assert.equal(raekker(await readFile(fil, 'utf8')).length, 4);
  });
});

test('fjernRegnskab removes exactly that row and keeps others and the header', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    await skrivRegnskab(fil, 'a1', linje);
    await skrivRegnskab(fil, 'a2', { ...linje, leverandoer: 'Cloudflare' });
    await skrivRegnskab(fil, 'a10', { ...linje, leverandoer: 'Sentry' });
    assert.equal(await fjernRegnskab(fil, 'a1'), true);
    const tekst = await readFile(fil, 'utf8');
    assert.ok(tekst.includes(HEADER));
    const r = raekker(tekst);
    assert.equal(r.length, 2);
    assert.ok(r[0]!.includes('Cloudflare') && r[0]!.endsWith('<!-- kc:a2 -->'));
    assert.ok(r[1]!.includes('Sentry') && r[1]!.endsWith('<!-- kc:a10 -->'));
    assert.equal(await fjernRegnskab(fil, 'a1'), false);
  });
});

test('a row an editor left with trailing spaces or CRLF is still found: findes, harRegnskab, fjernRegnskab', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    await skrivRegnskab(fil, 'a1', linje);
    await skrivRegnskab(fil, 'a2', { ...linje, leverandoer: 'Cloudflare' });
    const tekst = await readFile(fil, 'utf8');
    await writeFile(fil, tekst.replace('<!-- kc:a1 -->', '<!-- kc:a1 -->  ').replace(/\n/g, '\r\n'), 'utf8');
    assert.equal(await harRegnskab(fil, 'a1'), true);
    assert.equal(await skrivRegnskab(fil, 'a1', linje), 'findes');
    assert.equal(await fjernRegnskab(fil, 'a1'), true);
    assert.equal(await harRegnskab(fil, 'a1'), false);
    assert.equal(await harRegnskab(fil, 'a2'), true, 'the other row stays');
    assert.equal(await harRegnskab(regnskabsfil(rod, 'privat'), 'a2'), false, 'a missing file has no row');
  });
});

test('fjernRegnskab on a missing file returns false', async () => {
  await medTempRod(async (rod) => {
    assert.equal(await fjernRegnskab(regnskabsfil(rod, 'privat'), 'x'), false);
  });
});

test('a value with "|" and "\\n" stays one row', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    await skrivRegnskab(fil, 'a1', { ...linje, leverandoer: 'A | B\nC\r\nD', emne: 'Re: x | y\nz' });
    const r = raekker(await readFile(fil, 'utf8'));
    assert.equal(r.length, 1);
    assert.equal(r[0]!.split(' | ').length, 8); // 7 cells + marker
    assert.ok(!r[0]!.includes('\n'));
  });
});

test('a leverandoer with a forged marker does not create a second marker; fjernRegnskab("other") removes nothing', async () => {
  await medTempRod(async (rod) => {
    const fil = regnskabsfil(rod, 'shelfatlas');
    await skrivRegnskab(fil, 'a1', { ...linje, leverandoer: '<!-- kc:other -->', emne: 'x --> <!-- kc:other' });
    const foer = await readFile(fil, 'utf8');
    assert.equal((foer.match(/<!-- kc:/g) ?? []).length, 1);
    assert.equal(await fjernRegnskab(fil, 'other'), false);
    assert.equal(await readFile(fil, 'utf8'), foer);
    assert.equal(await skrivRegnskab(fil, 'other', linje), 'skrevet');
  });
});

test('regnskabsfil maps shelfatlas and privat to their vault paths', () => {
  assert.equal(regnskabsfil('/vault', 'shelfatlas'), '/vault/30-Projekter/ShelfAtlas/Regnskab.md');
  assert.equal(regnskabsfil('/vault', 'privat'), '/vault/10-Privat/Økonomi/abonnementer.md');
});
