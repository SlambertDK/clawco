// KC-0129: the pure parsers of Start's import step, on tiny synthetic fixtures (invented names only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVcard } from '../../../src/rooms/start/import/parse-vcard.ts';
import { parseCsv } from '../../../src/rooms/start/import/parse-csv.ts';
import { parseNoter } from '../../../src/rooms/start/import/parse-noter.ts';

const fix = (n: string): string => readFileSync(new URL(`../../fixtures/import/${n}`, import.meta.url), 'utf8');

test('vcf: names, org, birthday, escapes, folded lines, quoted-printable; a card without a name is dropped; photos and phones are not read', () => {
  const k = parseVcard(fix('kontakter.vcf'));
  assert.deepEqual(k.map((x) => x.navn), ['Iris Bakke', 'Søren Østergaard', 'Line Fold Eksempel']);
  assert.equal(k[0]?.org, 'Fyrtaarn A/S; Afdeling Syd');
  assert.equal(k[0]?.foedselsdag, '1984-03-12');
  assert.equal(k[0]?.noter, 'Vi spiller badminton\nhver torsdag, kl. 19');
  assert.equal(k[1]?.foedselsdag, '1980-02-29');
  assert.ok(!JSON.stringify(k).includes('+45'), 'no phone numbers');
  assert.ok(!JSON.stringify(k).includes('example.org'), 'no e-mail addresses');
});

test('vcf: garbage and huge input never throw and are bounded', () => {
  assert.deepEqual(parseVcard('hej'), []);
  const mange = Array.from({ length: 5000 }, (_, i) => `BEGIN:VCARD\nFN:Person ${i}\nEND:VCARD`).join('\n');
  assert.ok(parseVcard(mange).length <= 2000);
});

test('csv: Google headers, quoted commas and quotes and newlines, empty rows dropped', () => {
  const k = parseCsv(fix('kontakter.csv'));
  assert.deepEqual(k.map((x) => x.navn), ['Maja Lund', 'Tore Nyvang']);
  assert.equal(k[0]?.org, 'Havbrise, Aps');
  assert.equal(k[0]?.foedselsdag, '1990-07-01');
  assert.equal(k[0]?.noter, 'Kender fra "løbeklubben"\nmødes om tirsdagen');
  assert.ok(!JSON.stringify(k).includes('example.org'));
});

test('csv: a Danish header row and a file with no name column', () => {
  assert.deepEqual(parseCsv('Fornavn,Efternavn\nAnna,Vest\n').map((x) => x.navn), ['Anna Vest']);
  assert.deepEqual(parseCsv('a,b\n1,2\n'), []);
  assert.deepEqual(parseCsv(''), []);
});

test('noter: html becomes text without scripts, styles and comments; md and txt are kept; titles come from the file', () => {
  const n = parseNoter([{ navn: 'note.html', tekst: fix('note.html') }, { navn: 'note.md', tekst: fix('note.md') }, { navn: 'tom.txt', tekst: '   ' }]);
  assert.equal(n.length, 2);
  assert.equal(n[0]?.titel, 'note');
  assert.match(n[0]!.tekst, /Ugens liste/);
  assert.match(n[0]!.tekst, /Mælk & brød/);
  assert.match(n[0]!.tekst, /Kaffe til kontoret/);
  assert.doesNotMatch(n[0]!.tekst, /alert|color|skjult|<p>/);
  assert.match(n[1]!.tekst, /Jeg løber tirsdag og torsdag/);
});
