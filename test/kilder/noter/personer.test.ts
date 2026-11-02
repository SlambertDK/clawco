// KC-0136: the people register — one markdown file per person, the folder
// telling who is who (familie/, venner/, arbejde/, andre/). Reads the shape
// Henrik's register already has (relation and fødselsdag in frontmatter,
// "Vigtige fakta" in the body, the name in the file name); writes never
// overwrite (a collision returns a diff); Fortryd removes only a file the
// handling created and nobody has changed since. Synthetic fixtures only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fjernPerson, laesKanaler, laesPersoner, PERSON_MAPPER, skrivPerson, somKanalLinje, type PersonFil } from '../../../src/kilder/noter/personer.ts';
import { fjernProfil, laesProfil, skrivProfil } from '../../../src/kilder/noter/profil.ts';
import { lavNyVault } from '../../../src/kilder/noter/vault.ts';
import { KildeFejl } from '../../../src/kilder/types.ts';

async function medTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-noter-personer-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** A file shaped like the existing register: no navn in frontmatter, Danish key, extra keys, "Vigtige fakta". */
const HENRIK_FORM = '---\nrelation: søster\nfødselsdag: 1975-03-14\ntags: [person]\n---\n# Bodil Prøvesen\n\n## Vigtige fakta\n- Bor i Odense\n- bodil@example.org\n';

test('the relation folders', () => {
  assert.deepEqual(PERSON_MAPPER, ['familie', 'venner', 'arbejde', 'andre']);
});

test('laesPersoner reads the existing shape: name from the file, relation and birthday from frontmatter, the vault zone by default — never the body', () => medTmp(async (dir) => {
  await mkdir(path.join(dir, 'familie'));
  await mkdir(path.join(dir, 'arbejde'));
  await writeFile(path.join(dir, 'familie', 'Bodil Prøvesen.md'), HENRIK_FORM);
  await writeFile(path.join(dir, 'arbejde', 'Kurt Kollega.md'), '# Kurt\n\nIngen frontmatter.\n');
  await writeFile(path.join(dir, 'arbejde', 'noter.txt'), 'ikke en person');
  const p = await laesPersoner(dir, { zone: 'privat' });
  assert.deepEqual(p, [
    { navn: 'Kurt Kollega', relation: 'arbejde', zone: 'privat', mappe: 'arbejde', sti: 'arbejde/Kurt Kollega.md' },
    { navn: 'Bodil Prøvesen', relation: 'søster', foedselsdag: '1975-03-14', zone: 'privat', mappe: 'familie', sti: 'familie/Bodil Prøvesen.md' },
  ]);
  assert.ok(!JSON.stringify(p).includes('Odense'));
}));

test('round-trip: writing Henrik\'s person back as read is unchanged, and the file is not touched', () => medTmp(async (dir) => {
  await mkdir(path.join(dir, 'familie'));
  const fil = path.join(dir, 'familie', 'Bodil Prøvesen.md');
  await writeFile(fil, HENRIK_FORM);
  const [laest] = await laesPersoner(dir, { zone: 'privat' });
  const { mappe, sti, ...person } = laest!;
  assert.deepEqual(await skrivPerson(dir, person, { mappe, zone: 'privat' }), { udfald: 'uaendret', sti });
  assert.equal(await readFile(fil, 'utf8'), HENRIK_FORM);
}));

test('a new person is created in its folder (made on first use) with the documented frontmatter, and reads back the same', () => medTmp(async (dir) => {
  const ny: PersonFil = { navn: 'Søren Ærø', relation: 'ven fra løb', foedselsdag: '1980-02-29', zone: 'privat', kilde: 'chatgpt', importeret: '2026-10-31', tekst: '## Vigtige fakta\n- Løber maraton' };
  const s = await skrivPerson(dir, ny, { mappe: 'venner', zone: 'privat' });
  assert.equal(s.udfald, 'oprettet');
  assert.equal(s.sti, 'venner/Søren Ærø.md');
  assert.equal(await readFile(path.join(dir, 'venner', 'Søren Ærø.md'), 'utf8'),
    '---\nnavn: Søren Ærø\nrelation: ven fra løb\nfoedselsdag: 1980-02-29\nzone: privat\nkilde: chatgpt\nimporteret: 2026-10-31\n---\n## Vigtige fakta\n- Løber maraton\n');
  const [laest] = await laesPersoner(dir, { zone: 'privat' });
  assert.deepEqual(laest, { navn: 'Søren Ærø', relation: 'ven fra løb', foedselsdag: '1980-02-29', zone: 'privat', kilde: 'chatgpt', importeret: '2026-10-31', mappe: 'venner', sti: 'venner/Søren Ærø.md' });
  // A value YAML would misread is quoted, and reads back as written.
  const org: PersonFil = { navn: 'Ib', relation: 'chef: direkte', org: '#1 A/S', zone: 'arbejde' };
  assert.equal((await skrivPerson(dir, org, { mappe: 'arbejde', zone: 'privat' })).udfald, 'oprettet');
  const ib = (await laesPersoner(dir, { zone: 'privat' })).find((x) => x.navn === 'Ib');
  assert.deepEqual([ib?.relation, ib?.org, ib?.zone], ['chef: direkte', '#1 A/S', 'arbejde']);
}));

test('a collision returns a diff and writes nothing — also when the same name is in another folder or another Unicode form', () => medTmp(async (dir) => {
  await mkdir(path.join(dir, 'familie'));
  const fil = path.join(dir, 'familie', 'Bodil Prøvesen.md');
  await writeFile(fil, HENRIK_FORM);
  const s = await skrivPerson(dir, { navn: 'Bodil Prøvesen'.normalize('NFD'), relation: 'kusine', foedselsdag: '1975-03-14', zone: 'privat', tekst: 'Ny tekst' }, { mappe: 'venner', zone: 'privat' });
  assert.equal(s.udfald, 'kollision');
  assert.ok(s.udfald === 'kollision');
  assert.equal(s.sti, 'familie/Bodil Prøvesen.md');
  assert.deepEqual(s.diff, [{ felt: 'relation', nu: 'søster', ny: 'kusine' }, { felt: 'tekst', nu: '# Bodil Prøvesen\n\n## Vigtige fakta\n- Bor i Odense\n- bodil@example.org', ny: 'Ny tekst' }]);
  assert.equal(await readFile(fil, 'utf8'), HENRIK_FORM);
  assert.deepEqual(await readdir(dir), ['familie']);
}));

test('unsafe names, folders and values are refused (400) and nothing is written', () => medTmp(async (dir) => {
  const afvist = (p: Promise<unknown>): Promise<void> => assert.rejects(p, (e: unknown) => e instanceof KildeFejl && e.status === 400);
  await afvist(skrivPerson(dir, { navn: '../ude', relation: 'x', zone: 'privat' }, { mappe: 'familie', zone: 'privat' }));
  await afvist(skrivPerson(dir, { navn: 'Ok', relation: 'x', zone: 'privat' }, { mappe: '../ude', zone: 'privat' }));
  await afvist(skrivPerson(dir, { navn: 'Ok', relation: 'x\ny', zone: 'privat' }, { mappe: 'familie', zone: 'privat' }));
  await afvist(skrivPerson(dir, { navn: 'Ok', relation: '', zone: 'privat' }, { mappe: 'familie', zone: 'privat' }));
  await afvist(skrivPerson(dir, { navn: 'Ok', relation: 'x', zone: 'kontor' as 'privat' }, { mappe: 'familie', zone: 'privat' }));
  assert.deepEqual(await readdir(dir), []);
}));

test('Fortryd removes only a file the handling created and nobody changed since', () => medTmp(async (dir) => {
  const s = await skrivPerson(dir, { navn: 'Ny Person', relation: 'nabo', zone: 'privat' }, { mappe: 'andre', zone: 'privat' });
  assert.ok(s.udfald === 'oprettet');
  const t = await skrivPerson(dir, { navn: 'Rettet Person', relation: 'nabo', zone: 'privat' }, { mappe: 'andre', zone: 'privat' });
  assert.ok(t.udfald === 'oprettet');
  await writeFile(path.join(dir, 'andre', 'Rettet Person.md'), 'Henrik rettede filen');
  await mkdir(path.join(dir, 'familie'));
  await writeFile(path.join(dir, 'familie', 'Bodil Prøvesen.md'), HENRIK_FORM);

  assert.equal(await fjernPerson(dir, s.kvittering), true);
  assert.equal(await fjernPerson(dir, s.kvittering), false); // already gone
  assert.equal(await fjernPerson(dir, t.kvittering), false); // changed since: kept
  assert.equal(await fjernPerson(dir, { sti: 'familie/Bodil Prøvesen.md', sha256: s.kvittering.sha256 }), false); // never created by a handling
  await assert.rejects(fjernPerson(dir, { sti: '../x.md', sha256: s.kvittering.sha256 }), KildeFejl);
  assert.deepEqual((await readdir(path.join(dir, 'andre'))).sort(), ['Rettet Person.md']);
  assert.equal(await readFile(path.join(dir, 'familie', 'Bodil Prøvesen.md'), 'utf8'), HENRIK_FORM);
}));

test('the profile: the untouched template is replaced, a written one collides with a diff, Fortryd restores what was there', () => medTmp(async (dir) => {
  assert.equal(await laesProfil(dir), null);
  await lavNyVault(dir);
  const skabelon = await laesProfil(dir);
  assert.match(skabelon ?? '', /^# Om mig/);
  const s = await skrivProfil(dir, '# Om mig\n\nJeg hedder Henrik.\n');
  assert.ok(s.udfald === 'oprettet');
  assert.equal(await laesProfil(dir), '# Om mig\n\nJeg hedder Henrik.\n');
  assert.deepEqual(await skrivProfil(dir, '# Om mig\n\nJeg hedder Henrik.\n'), { udfald: 'uaendret', sti: 'Clawco/Om mig.md' });
  const k = await skrivProfil(dir, '# Om mig\n\nNoget andet.\n');
  assert.deepEqual(k, { udfald: 'kollision', sti: 'Clawco/Om mig.md', diff: [{ felt: 'tekst', nu: '# Om mig\n\nJeg hedder Henrik.\n', ny: '# Om mig\n\nNoget andet.\n' }] });
  assert.equal(await fjernProfil(dir, s.kvittering), true);
  assert.equal(await laesProfil(dir), skabelon);
}));

test('the profile in a vault without one is created and Fortryd removes it', () => medTmp(async (dir) => {
  const s = await skrivProfil(dir, 'Om mig');
  assert.ok(s.udfald === 'oprettet');
  assert.equal(await fjernProfil(dir, s.kvittering), true);
  assert.equal(await laesProfil(dir), null);
}));

// ---------- KC-0225: per-channel ids ----------

test('laesKanaler reads the one-line map by hand: quoted or bare values, keys case-folded, first of a duplicate wins', () => {
  assert.deepEqual(laesKanaler('{ signal: "+45 12 34 56 78", WhatsApp: \'+4512345678\', telegram: "@maja_dk", telefon: +4512345678 }'), {
    signal: '+45 12 34 56 78', whatsapp: '+4512345678', telegram: '@maja_dk', telefon: '+4512345678',
  });
  assert.deepEqual(laesKanaler('{signal: "a, b", signal: "c"}'), { signal: 'a, b' });
});

test('laesKanaler never throws: anything that is not a one-line map, and every bad pair, is ignored', () => {
  for (const raa of [undefined, '', 'signal', '[signal, whatsapp]', '{', '{ }', '{ signal }', '{ signal: }', '{ : "x" }', '{ "unterminated: 1 }', '+4512345678']) assert.equal(laesKanaler(raa), undefined, String(raa));
  assert.deepEqual(laesKanaler('{ signal: "+4512345678", 9: "x", a: "y", boer-ikke: , whatsapp: "\u0007" }'), { signal: '+4512345678' });
  assert.deepEqual(Object.keys(laesKanaler(`{ ${Array.from({ length: 12 }, (_, i) => `k${i}: "v${i}"`).join(', ')} }`) ?? {}).length, 8);
  assert.equal(laesKanaler(`{ signal: "${'9'.repeat(200)}" }`), undefined);
});

test('somKanalLinje writes what laesKanaler reads, on one line', () => {
  const k = { signal: '+4512345678', telegram: '@maja "dk"' };
  const linje = somKanalLinje(k);
  assert.ok(!linje.includes('\n'));
  assert.match(linje, /^kanaler: \{ signal: /);
  assert.deepEqual(laesKanaler(linje.slice('kanaler: '.length)), k);
});

test('a person file edited by hand with kanaler: is read with the ids, other keys and the body untouched; no kanaler = no field', () => medTmp(async (dir) => {
  await mkdir(path.join(dir, 'familie'));
  await writeFile(path.join(dir, 'familie', 'Maja.md'), '---\nrelation: kone\nkanaler: { signal: "+45 12 34 56 78", whatsapp: "+4512345678" }\ntags: [person]\n---\n## Vigtige fakta\n- Nattevagter\n');
  await writeFile(path.join(dir, 'familie', 'Ella.md'), '---\nrelation: datter\nkanaler: ikke et kort\n---\n');
  await writeFile(path.join(dir, 'familie', 'Soeren.md'), '---\nrelation: ven\n---\n');
  const p = await laesPersoner(dir, { zone: 'privat' });
  assert.deepEqual(p.find((x) => x.navn === 'Maja')?.kanaler, { signal: '+45 12 34 56 78', whatsapp: '+4512345678' });
  assert.ok(!('kanaler' in (p.find((x) => x.navn === 'Ella') ?? {})));
  assert.ok(!('kanaler' in (p.find((x) => x.navn === 'Soeren') ?? {})));
  assert.equal(p.find((x) => x.navn === 'Maja')?.relation, 'kone');
  assert.ok(!JSON.stringify(p).includes('Nattevagter'));
}));
