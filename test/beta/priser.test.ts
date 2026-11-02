// KC-0203: the day-14 question quotes the prices from the one price file (config/priser.json, KC-0190), never typed here.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BETA_PRISER_FIL, laesBetaPriser } from '../../src/beta/priser.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-beta-priser-'));
after(() => rm(rod, { recursive: true, force: true }));
const fil = async (navn: string, indhold: unknown): Promise<string> => { const p = path.join(rod, navn); await writeFile(p, typeof indhold === 'string' ? indhold : JSON.stringify(indhold)); return p; };
const planer = (solo: number, husstand: number) => ({ planer: { 'sky-solo': { maanedlig: { dkk: solo, eur: 1 } }, 'sky-husstand': { maanedlig: { dkk: husstand, eur: 1 } } } });

test('the real price file gives the monthly kroner of Solo and Husstand (whatever they are today)', async () => {
  const echte = JSON.parse(await readFile(BETA_PRISER_FIL, 'utf8')) as { planer: Record<string, { maanedlig: { dkk: number } }> };
  assert.deepEqual(await laesBetaPriser(BETA_PRISER_FIL), { solo: echte.planer['sky-solo']!.maanedlig.dkk / 100, husstand: echte.planer['sky-husstand']!.maanedlig.dkk / 100 });
});

test('a changed fixture changes the answer; øre become kroner', async () => {
  assert.deepEqual(await laesBetaPriser(await fil('a.json', planer(6900, 11900))), { solo: 69, husstand: 119 });
  assert.deepEqual(await laesBetaPriser(await fil('b.json', planer(8950, 14900))), { solo: 89.5, husstand: 149 });
});

test('unreadable or odd files give null (the card then leaves the pay question out; no price is ever invented)', async () => {
  assert.equal(await laesBetaPriser(path.join(rod, 'findes-ikke.json')), null);
  assert.equal(await laesBetaPriser(await fil('c.json', '{ ikke json')), null);
  assert.equal(await laesBetaPriser(await fil('d.json', { planer: {} })), null);
  assert.equal(await laesBetaPriser(await fil('e.json', planer(0, 12900))), null);
  assert.equal(await laesBetaPriser(await fil('f.json', planer(7900.5, 12900))), null, 'amounts are whole øre');
  assert.equal(await laesBetaPriser(await fil('g.json', planer(-1, 12900))), null);
});
