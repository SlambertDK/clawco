// Billing's part of "Hent alt" (KC-0206): the account's Stripe customer as we know it, its plan now, the history of
// plan changes and the invoices Stripe holds. Plain JSON for konto/eksport.ts (wired in server.ts; konto never
// imports abonnement/). Fails rather than leaving the invoices out when Stripe cannot be asked: an export that
// silently lacks something is worse than "try again".
import type { Database } from '../db/pool.ts';
import type { BetalingsKlient } from './stripe-klient.ts';
import type { Priser } from './priser.ts';
import { hentKundeRaekke } from './kunde.ts';
import { hentRettigheder } from './synk.ts';

export async function abonnementEksport(d: { db: Database; klient: BetalingsKlient | null; priser: Priser }, kontoId: number, nu: Date): Promise<unknown> {
  const k = await hentKundeRaekke(d.db, kontoId);
  if (!k) return { kunde: null, plan: null, historik: [], fakturaer: [] };
  if (!d.klient) throw new Error('betaling er ikke sat op: fakturaerne kan ikke hentes');
  const historik = await d.db.query<{ fra: unknown; til: unknown; grund: string; tidspunkt: Date }>(
    'SELECT fra, til, grund, tidspunkt FROM abonnement.rettigheds_haendelser WHERE konto_id = $1 ORDER BY id', [kontoId]);
  return {
    kunde: { stripeKunde: k.stripeKunde, land: k.land, proeveBrugt: k.proeveBrugt },
    plan: await hentRettigheder(d.db, kontoId, d.priser, nu),
    historik: historik.map((h) => ({ tidspunkt: new Date(h.tidspunkt), grund: h.grund, fra: h.fra, til: h.til })),
    fakturaer: await d.klient.listFakturaer(k.stripeKunde),
  };
}
