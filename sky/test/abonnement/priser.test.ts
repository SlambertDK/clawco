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
  assert.deepEqual(p.moms, { aktiv: false, varselOere: 4_000_000, eurKurs: 7.46 });
  assert.deepEqual(p.valuta, { lande: { DK: 'dkk' }, ellers: 'eur' });
  assert.deepEqual(p.proeve, { dage: 14, kort: false });
  assert.equal(p.fristVedFejl, 14);
  assert.equal(p.paamindelseVedFejl, 7);
  assert.deepEqual(Object.keys(p.planer), ['sky-solo', 'sky-husstand']);
  // KC-0264 (Henrik 2026-11-03, D1): every Sky plan includes the Calm model up to a monthly cap; a household shares its cap.
  assert.deepEqual(p.planer['sky-solo'], { navn: 'Sky Solo', medlemmer: 1, maanedlig: { dkk: 7900, eur: 1060 }, aarlig: { dkk: 79000, eur: 10600 }, inkluderetModel: { loftMikroUsd: 4_000_000, modeller: ['claude-haiku-5-5'] } });
  assert.deepEqual(p.planer['sky-husstand'], { navn: 'Sky Husstand', medlemmer: 6, maanedlig: { dkk: 12900, eur: 1730 }, aarlig: { dkk: 129000, eur: 17300 }, inkluderetModel: { loftMikroUsd: 8_000_000, modeller: ['claude-haiku-5-5'] } });
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

test('KC-0194 (G6): VAT is a config switch: true is accepted (Stripe Tax on without a rebuild), anything else is refused', () => {
  const r = raa();
  r.moms.aktiv = true;
  assert.equal(validerPriser(r).moms.aktiv, true);
  afviser((x) => { x.moms.aktiv = 'ja'; }, 'moms.aktiv');
  afviser((x) => { delete x.moms.varselOere; }, 'moms.varselOere');
  afviser((x) => { x.moms.varselOere = 0; }, 'moms.varselOere');
  afviser((x) => { x.moms.eurKurs = 0; }, 'moms.eurKurs');
  afviser((x) => { x.moms.eurKurs = '7,46'; }, 'moms.eurKurs');
});

test('KC-0194: the currency table names ISO country codes and the two currencies only', () => {
  afviser((r) => { delete r.valuta; }, 'valuta');
  afviser((r) => { r.valuta.lande.dk = 'dkk'; }, 'valuta.lande.dk');
  afviser((r) => { r.valuta.lande.SE = 'sek'; }, 'valuta.lande.SE');
  afviser((r) => { r.valuta.ellers = 'usd'; }, 'valuta.ellers');
});

test('trial, grace period and add-ons are checked', () => {
  afviser((r) => { r.proeve.dage = -1; }, 'proeve.dage');
  afviser((r) => { r.proeve.kort = 'nej'; }, 'proeve.kort');
  afviser((r) => { r.fristVedFejl = 0; }, 'fristVedFejl');
  // KC-0196: the second (sharper) mail comes after the first and before the read-only day.
  afviser((r) => { r.paamindelseVedFejl = 0; }, 'paamindelseVedFejl');
  afviser((r) => { r.paamindelseVedFejl = r.fristVedFejl; }, 'paamindelseVedFejl');
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

test('KC-0264: inkluderetModel is optional per plan, and when present needs a whole positive cap and at least one model id', () => {
  const r = raa(); delete r.planer['sky-solo'].inkluderetModel;
  assert.equal(validerPriser(r).planer['sky-solo']!.inkluderetModel, undefined, 'a plan without it includes no model');
  afviser((x) => { x.planer['sky-solo'].inkluderetModel.loftMikroUsd = 0; }, 'planer.sky-solo.inkluderetModel.loftMikroUsd');
  afviser((x) => { x.planer['sky-solo'].inkluderetModel.loftMikroUsd = 1.5; }, 'planer.sky-solo.inkluderetModel.loftMikroUsd');
  afviser((x) => { x.planer['sky-solo'].inkluderetModel.modeller = []; }, 'planer.sky-solo.inkluderetModel.modeller');
  afviser((x) => { x.planer['sky-solo'].inkluderetModel.modeller = ['Claude Haiku']; }, 'planer.sky-solo.inkluderetModel.modeller');
  afviser((x) => { x.planer['sky-solo'].inkluderetModel.ekstra = 1; }, 'planer.sky-solo.inkluderetModel.ekstra');
  afviser((x) => { x.planer['sky-solo'].ekstra = 1; }, 'planer.sky-solo.ekstra');
});

test('KC-0264: the add-on "Inkluderet model" is superseded by the included Calm model, and says so; its line stays for the price page', () => {
  const r = raa();
  assert.match(r.tilvalg['inkluderet-model']._note, /KC-0264/);
  assert.match(r.tilvalg['inkluderet-model']._note, /superseded/i);
});
