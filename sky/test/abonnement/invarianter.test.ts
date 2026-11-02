// KC-0192 invariants checked structurally over sky/src/abonnement/:
// (1) only synk.ts writes abonnement.rettigheder, and only the webhook calls synkKunde;
// (3) billing has no import path to deletion or wipe (konto/slet.ts, any other module's code) and no
//     destructive SQL — deleting data is E10/E12 under the retention rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { specifikationer } from '../aftryk.test.ts';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const abonnement = path.join(src, 'abonnement');
const filer = fs.readdirSync(abonnement).filter((f) => f.endsWith('.ts')).map((f) => path.join(abonnement, f));
const laes = (f: string): string => fs.readFileSync(f, 'utf8');

/** Every file reachable from `start` by relative imports. */
function lukning(start: string[]): Set<string> {
  const set = new Set<string>();
  const stak = [...start];
  while (stak.length) {
    const f = stak.pop()!;
    if (set.has(f)) continue;
    set.add(f);
    for (const s of specifikationer(laes(f))) if (s.startsWith('.')) stak.push(path.resolve(path.dirname(f), s));
  }
  return set;
}

test('invariant (3): nothing in abonnement/ reaches konto/ (where deletion lives) or any wipe code by import', () => {
  const naaet = [...lukning(filer)].map((f) => path.relative(src, f));
  assert.ok(naaet.includes(path.join('abonnement', 'webhook.ts')));
  const udenfor = naaet.filter((f) => !f.startsWith(`abonnement${path.sep}`) && !f.startsWith(`delt${path.sep}`) && !f.startsWith(`db${path.sep}pool`));
  assert.deepEqual(udenfor, []);
  for (const f of naaet) assert.doesNotMatch(f, /slet|wipe|afvikl/i, f);
});

test('invariant (3): no destructive SQL in billing code', () => {
  for (const f of filer) assert.doesNotMatch(laes(f), /\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|SCHEMA))\b/i, path.basename(f));
});

test('invariant (1): abonnement.rettigheder is written in synk.ts only, and synkKunde is called by the webhook only', () => {
  const skrivere = filer.filter((f) => /(INSERT INTO|UPDATE)\s+abonnement\.rettigheder\b/i.test(laes(f))).map((f) => path.basename(f));
  assert.deepEqual(skrivere, ['synk.ts']);
  const kaldere = filer.filter((f) => /\bsynkKunde\(/.test(laes(f)) && !f.endsWith('synk.ts')).map((f) => path.basename(f));
  assert.deepEqual(kaldere, ['webhook.ts']);
});
