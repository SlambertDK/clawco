// KC-0194, gate G6: Henrik is not VAT-registered, so while config/priser.json has moms.aktiv false no page or mail a
// customer sees says "moms" or "VAT" (not even "no VAT"): prices are plain full prices. Every billing surface is
// rendered here in both languages and both currencies. With moms.aktiv true the same surfaces say the price includes
// VAT, so the switch needs no rebuild. The words match the regex below in any case and language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesPriser, type Priser } from '../../src/abonnement/priser.ts';
import { planSide } from '../../src/abonnement/render.ts';
import { bekraeftSide } from '../../src/abonnement/forbrugerret-render.ts';
import { prisTekst } from '../../src/abonnement/kvittering.ts';
import { tilmeldingSide, type PlanVisning } from '../../src/tilmelding/render.ts';
import { valutaForLand } from '../../src/abonnement/valuta.ts';

const MOMS = /moms|\bVAT\b/i;
const uden = laesPriser();
const med: Priser = { ...uden, moms: { ...uden.moms, aktiv: true } };
const tekst = (t: string): string => t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const planer = (p: Priser): PlanVisning[] => Object.entries(p.planer).map(([id, x]) => ({ id, navn: x.navn, medlemmer: x.medlemmer, maaned: x.maanedlig, aar: x.aarlig }));

function flader(p: Priser): { navn: string; html: string }[] {
  const ud: { navn: string; html: string }[] = [];
  for (const land of ['DK', 'DE']) {
    const valuta = valutaForLand(p, land);
    ud.push({ navn: `planside ${land}`, html: planSide({ csrf: 'c', priser: p, valg: { plan: null, interval: null, land }, proeve: true, afbrudt: false }) });
    for (const sprog of ['da', 'en'] as const) {
      ud.push({ navn: `tilmelding plan ${land} ${sprog}`, html: tilmeldingSide({ sprog, csrf: 'c', tilstand: 'open' }, { visning: { trin: 'plan' }, planer: planer(p), proeveDage: 14, valg: { plan: null, interval: null }, land, valuta, moms: p.moms.aktiv, proeve: true, afbrudt: false }) });
      for (const proeve of [true, false]) {
        ud.push({ navn: `bekræft ${land} ${sprog} ${proeve ? 'prøve' : 'betal'}`, html: bekraeftSide({
          sprog, csrf: 'c', plan: { id: 'sky-solo', navn: 'Sky Solo', medlemmer: 1 }, interval: 'maaned', land, prisOere: p.planer['sky-solo']!.maanedlig[valuta], valuta, moms: p.moms.aktiv,
          proeve, proeveDage: 14, vilkaar: { version: '0.1', url: 'https://clawco.example.test/vilkaar' }, retur: 'konto', tilbage: '/konto/abonnement',
        }) });
      }
      ud.push({ navn: `kvittering ${land} ${sprog}`, html: prisTekst({ prisOere: p.planer['sky-solo']!.maanedlig[valuta], interval: 'maaned', valuta }, sprog, p.moms.aktiv) });
    }
  }
  return ud;
}

test('G6: with moms.aktiv false no billing page or receipt says "moms" or "VAT", in either language or currency', () => {
  assert.equal(uden.moms.aktiv, false, 'the real config has VAT off');
  for (const f of flader(uden)) assert.doesNotMatch(tekst(f.html), MOMS, f.navn);
});

test('G6: the price is called the full price instead', () => {
  for (const f of flader(uden)) assert.match(tekst(f.html), /den fulde pris|the full price/i, f.navn);
});

test('with moms.aktiv true the same pages say the price includes VAT (no rebuild needed)', () => {
  for (const f of flader(med)) assert.match(tekst(f.html), /inkl\. moms|incl\. VAT|VAT included/i, f.navn);
});

test('KC-0194: the plan pages show the amounts of the account\'s country: kroner for Denmark, euro elsewhere', () => {
  const dk = tekst(planSide({ csrf: 'c', priser: uden, valg: { plan: null, interval: null, land: 'DK' }, proeve: true, afbrudt: false }));
  assert.match(dk, /79 kr\. om måneden/);
  assert.doesNotMatch(dk, /€/);
  const de = tekst(planSide({ csrf: 'c', priser: uden, valg: { plan: null, interval: null, land: 'DE' }, proeve: true, afbrudt: false }));
  assert.match(de, /10,60 € om måneden/);
  assert.doesNotMatch(de, /\d kr\./);
  const tilmeld = (land: string, sprog: 'da' | 'en') => tekst(tilmeldingSide({ sprog, csrf: 'c', tilstand: 'open' }, { visning: { trin: 'plan' }, planer: planer(uden), proeveDage: 14, valg: { plan: null, interval: null }, land, valuta: valutaForLand(uden, land), moms: false, proeve: true, afbrudt: false }));
  assert.match(tilmeld('DK', 'da'), /79 kr\. om måneden/);
  assert.match(tilmeld('SE', 'en'), /€10\.60 per month · €106 per year/);
  assert.doesNotMatch(tilmeld('SE', 'en'), /DKK/);
});
