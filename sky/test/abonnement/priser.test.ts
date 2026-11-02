// KC-0190: config/priser.json is the one price source; the loader refuses anything malformed
// before a single Stripe call is made, and names the JSON path that is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { laesPriser, validerPriser, PRISFIL } from '../../src/abonnement/priser.ts';

const raa = (): Record<string, any> => JSON.parse(fs.readFileSync(PRISFIL, 'utf8'));

function afviser(muter: (r: Record<string, any>) => void, sti: string): void {
  const r = raa();
  muter(r);
  assert.throws(() => validerPriser(r), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes(sti), `fejlen nævner ikke ${sti}: ${err.message}`);
    return true;
  });
}

test('the real price file is approved and carries the prices Henrik said yes to', () => {
  const p = laesPriser();
  assert.equal(p.status, 'godkendt');
  assert.deepEqual(p.moms, { aktiv: false });
  assert.deepEqual(p.proeve, { dage: 14, kort: false });
  assert.equal(p.fristVedFejl, 14);
  assert.deepEqual(Object.keys(p.planer), ['sky-solo', 'sky-husstand']);
  assert.deepEqual(p.planer['sky-solo'], { navn: 'Sky Solo', medlemmer: 1, maanedlig: { dkk: 7900, eur: 1060 }, aarlig: { dkk: 79000, eur: 10600 } });
  assert.deepEqual(p.planer['sky-husstand'], { navn: 'Sky Husstand', medlemmer: 6, maanedlig: { dkk: 12900, eur: 1730 }, aarlig: { dkk: 129000, eur: 17300 } });
  assert.equal(p.tilvalg['inkluderet-model']?.status, 'senere');
  assert.equal(p.tilvalg['inkluderet-model']?.fraMaanedlig.dkk, 4900);
});

test('PRISFIL points at config/priser.json in the repo root', () => {
  assert.match(PRISFIL, /[\\/]config[\\/]priser\.json$/);
  assert.ok(!/[\\/]sky[\\/]config[\\/]/.test(PRISFIL));
});

test('comment keys (starting with _) are ignored, not returned', () => {
  const p = validerPriser(raa()) as Record<string, unknown>;
  assert.equal(p['_note'], undefined);
});

test('every plan needs all four amounts', () => {
  for (const plan of ['sky-solo', 'sky-husstand']) {
    for (const interval of ['maanedlig', 'aarlig']) {
      for (const valuta of ['dkk', 'eur']) {
        afviser((r) => { delete r.planer[plan][interval][valuta]; }, `planer.${plan}.${interval}.${valuta}`);
      }
    }
    afviser((r) => { delete r.planer[plan].aarlig; }, `planer.${plan}.aarlig`);
  }
});

test('amounts are positive whole øre/cent', () => {
  afviser((r) => { r.planer['sky-solo'].maanedlig.dkk = 79.5; }, 'planer.sky-solo.maanedlig.dkk');
  afviser((r) => { r.planer['sky-solo'].maanedlig.eur = 0; }, 'planer.sky-solo.maanedlig.eur');
  afviser((r) => { r.planer['sky-solo'].aarlig.dkk = '79000'; }, 'planer.sky-solo.aarlig.dkk');
});

test('member limits are positive integers', () => {
  afviser((r) => { r.planer['sky-husstand'].medlemmer = 0; }, 'planer.sky-husstand.medlemmer');
  afviser((r) => { r.planer['sky-husstand'].medlemmer = 2.5; }, 'planer.sky-husstand.medlemmer');
});

test('status is udkast or godkendt, nothing else', () => {
  afviser((r) => { r.status = 'klar'; }, 'status');
  const r = raa();
  r.status = 'udkast';
  assert.equal(validerPriser(r).status, 'udkast');
});

test('plan ids are lower-case slugs and there is at least one plan', () => {
  afviser((r) => { r.planer['Sky-Pro'] = r.planer['sky-solo']; }, 'planer.Sky-Pro');
  afviser((r) => { r.planer = {}; }, 'planer');
});

test('VAT on is refused until KC-0194 builds tax behaviour', () => {
  afviser((r) => { r.moms.aktiv = true; }, 'moms.aktiv');
});

test('trial, grace period and add-ons are checked', () => {
  afviser((r) => { r.proeve.dage = -1; }, 'proeve.dage');
  afviser((r) => { r.proeve.kort = 'nej'; }, 'proeve.kort');
  afviser((r) => { r.fristVedFejl = 0; }, 'fristVedFejl');
  afviser((r) => { r.tilvalg['inkluderet-model'].status = 'måske'; }, 'tilvalg.inkluderet-model.status');
  afviser((r) => { delete r.tilvalg['inkluderet-model'].fraMaanedlig.eur; }, 'tilvalg.inkluderet-model.fraMaanedlig.eur');
});

test('an unknown key is a typo, not silently ignored', () => {
  afviser((r) => { r.statsu = 'godkendt'; }, 'statsu');
  afviser((r) => { r.planer['sky-solo'].maanedig = r.planer['sky-solo'].maanedlig; }, 'planer.sky-solo.maanedig');
});

test('a missing or broken file names the path, not a stack of JSON internals', () => {
  assert.throws(() => laesPriser('/findes/ikke/priser.json'), /priser\.json/);
});
