// KC-0194: which currency a customer pays in, and how an amount is written. The currency is a pure function of the
// billing country the person chose at sign-up (KC-0198), read through the table in config/priser.json; never an IP
// lookup. A missing or malformed country is refused (fail closed, AGENTS §0 r7), so nothing is ever charged in a
// guessed currency. The amounts themselves are explicit per currency in the config (never converted on the fly), so
// what a page promises is what Stripe charges.
import type { Beloeb, Priser, Valuta } from './priser.ts';

export type { Valuta } from './priser.ts';

const LANDEKODE = /^[A-Z]{2}$/;

/** DK → dkk, every other country → the config's `ellers` (eur). Throws on a missing or malformed country code. */
export function valutaForLand(priser: Pick<Priser, 'valuta'>, land: string): Valuta {
  if (typeof land !== 'string' || !LANDEKODE.test(land)) throw new Error(`ukendt land: ${JSON.stringify(land ?? null)} (valutaen følger landet fra tilmeldingen)`);
  return Object.hasOwn(priser.valuta.lande, land) ? priser.valuta.lande[land]! : priser.valuta.ellers;
}

/** The amount of a config price in one currency (øre or cent). */
export const beloebI = (b: Beloeb, valuta: Valuta): number => b[valuta];

/** "79 kr." / "10,60 €" in Danish, "DKK 79" / "€10.60" in English. Whole amounts without decimals. */
export function formatBeloeb(minor: number, valuta: Valuta, sprog: 'da' | 'en'): string {
  const decimaler = minor % 100 === 0 ? 0 : 2;
  if (sprog === 'da' && valuta === 'dkk') return `${(minor / 100).toLocaleString('da-DK', { minimumFractionDigits: decimaler, maximumFractionDigits: decimaler })} kr.`;
  return new Intl.NumberFormat(sprog === 'da' ? 'da-DK' : 'en-GB', { style: 'currency', currency: valuta.toUpperCase(), minimumFractionDigits: decimaler, maximumFractionDigits: decimaler })
    .format(minor / 100).replace(/[  ]/g, ' ');
}
