// KC-0194: the currency is a pure function of the billing country chosen at sign-up (never an IP lookup):
// Denmark pays in kroner, every other country in euro. The table lives in config/priser.json, so a later
// country list is a config change; this test pins it over every EU country plus countries outside the EU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { LANDE } from '../../src/abonnement/lande.ts';
import { formatBeloeb, valutaForLand } from '../../src/abonnement/valuta.ts';

const priser = laesPriser();
/** The 27 EU member states, written here independently of lande.ts. */
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

test('Denmark pays in DKK; every other EU country in EUR', () => {
  assert.equal(EU.length, 27);
  for (const land of EU) assert.equal(valutaForLand(priser, land), land === 'DK' ? 'dkk' : 'eur', land);
});

test('a country outside the EU also gets EUR (the EEA countries on the list, and one outside both)', () => {
  for (const land of ['NO', 'IS', 'LI', 'US']) assert.equal(valutaForLand(priser, land), 'eur', land);
});

test('the same country always gives the same currency, and every country on the sign-up list has one', () => {
  for (const l of LANDE) {
    const v = valutaForLand(priser, l.kode);
    for (let i = 0; i < 3; i++) assert.equal(valutaForLand(priser, l.kode), v);
    assert.ok(EU.includes(l.kode) || ['NO', 'IS', 'LI'].includes(l.kode), `${l.kode} is EU or EEA`);
  }
});

test('a missing or malformed country is refused, never defaulted (fail closed)', () => {
  for (const land of ['', ' ', 'dk', 'DNK', 'D']) assert.throws(() => valutaForLand(priser, land), /land/, JSON.stringify(land));
  assert.throws(() => valutaForLand(priser, undefined as unknown as string), /land/);
});

test('the table comes from the config: another country list is a config change', () => {
  const p = { ...priser, valuta: { lande: { DK: 'dkk' as const, SE: 'dkk' as const }, ellers: 'eur' as const } };
  assert.equal(valutaForLand(p, 'SE'), 'dkk');
  assert.equal(valutaForLand(p, 'DE'), 'eur');
});

test('amounts are shown in their own currency, in the page language', () => {
  assert.equal(formatBeloeb(7900, 'dkk', 'da'), '79 kr.');
  assert.equal(formatBeloeb(1060, 'eur', 'da'), '10,60 €');
  assert.equal(formatBeloeb(7900, 'dkk', 'en'), 'DKK 79');
  assert.equal(formatBeloeb(1060, 'eur', 'en'), '€10.60');
  assert.equal(formatBeloeb(129000, 'dkk', 'da'), '1.290 kr.');
  assert.equal(formatBeloeb(10600, 'eur', 'en'), '€106');
});
