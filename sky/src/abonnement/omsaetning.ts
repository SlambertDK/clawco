// KC-0194, gate G6: the revenue watch. Henrik sells as a private person without VAT registration, which is lawful
// below the Danish threshold (50,000 kr a year). The control plane sums the invoices paid over the trailing 12 months
// and hands the total to the alert rules (drift/alarm.ts, rule moms-graense), which tell the owner at moms.varselOere
// (40,000 kr) that CVR and VAT registration are due, so moms.aktiv can be switched on in time without a rebuild.
// The whole Stripe account counts, not only Clawco's customers: the threshold is the seller's, and the account is
// Henrik's own (shared with ShelfAtlas, G6). Euro is converted at moms.eurKurs, the rate the EUR prices were set with;
// another currency cannot be converted and is counted apart, so the alert says what it left out. Amounts only: no
// customer, no invoice id is kept or written anywhere.
import type { Priser } from './priser.ts';
import type { BetalingsKlient, BetaltFaktura } from './stripe-klient.ts';
import { skjulNoegler } from './stripe-klient.ts';

/** The signal the alert rule reads: the 12-month total in øre, the threshold, and invoices in a currency not counted. */
export type Omsaetning = { oere: number; graenseOere: number; andreValutaer: number };

const AAR_MS = 365 * 86_400_000;
/** Stripe is read at most this often: a yearly total does not move by the minute. */
export const STANDARD_INTERVAL = 6 * 3_600_000;

/** Pure: the paid invoices (already within the 12 months) summed in øre. */
export function omsaetning12(fakturaer: readonly BetaltFaktura[], priser: Pick<Priser, 'moms'>): Omsaetning {
  let oere = 0;
  let andreValutaer = 0;
  for (const f of fakturaer) {
    const v = f.valuta.toLowerCase();
    if (v === 'dkk') oere += f.beloeb;
    else if (v === 'eur') oere += Math.round(f.beloeb * priser.moms.eurKurs);
    else andreValutaer++;
  }
  return { oere, graenseOere: priser.moms.varselOere, andreValutaer };
}

/** The watch as the alert loop calls it: undefined when there is nothing to watch (VAT already on, no Stripe client)
 *  or the read failed (an unknown signal: the rule neither fires nor clears). Reads Stripe at most once per interval. */
export function omsaetningsVagt(o: { klient: BetalingsKlient | null; priser: Priser; interval?: number; log?: (linje: string) => void }): (nu: Date) => Promise<Omsaetning | undefined> {
  const interval = o.interval ?? STANDARD_INTERVAL;
  const log = o.log ?? ((l: string) => { console.error(l); });
  let sidst: { ved: number; vaerdi: Omsaetning } | null = null;
  return async (nu) => {
    if (o.priser.moms.aktiv || !o.klient) return undefined;
    if (sidst && nu.getTime() - sidst.ved < interval) return sidst.vaerdi;
    try {
      const vaerdi = omsaetning12(await o.klient.listBetalteFakturaer(new Date(nu.getTime() - AAR_MS)), o.priser);
      sidst = { ved: nu.getTime(), vaerdi };
      return vaerdi;
    } catch (err) {
      log(`sky abonnement: omsætningen for de seneste 12 måneder kunne ikke læses: ${skjulNoegler((err as Error).message)}`);
      return undefined;
    }
  };
}
