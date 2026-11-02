// The buttons the account page and the subscription page offer (KC-0209): "Opsig abonnement" while there is something
// running that is not already cancelled, "Fortryd aftale" while the 14 days of the newest purchase run. From our own
// rows only (no Stripe call on a page view). One list, two pages, so they never disagree.
import type { Database } from '../db/pool.ts';
import { F } from './forbrugerret-tekster.ts';
import { senesteFortrydbare } from './bestilling.ts';
import type { Rettighed } from './rettigheder.ts';

export type Handling = { href: string; tekst: string };

export const OPSIG_STI = '/konto/abonnement/opsig';
export const FORTRYD_STI = '/konto/abonnement/fortryd';

const AABNE = new Set(['proeve', 'aktiv', 'forfalden', 'pause']);

export async function kontoHandlinger(db: Database, kontoId: number, r: Rettighed, nu: Date): Promise<Handling[]> {
  // A gift (private beta) has no Stripe subscription to end; its owner writes to us.
  if (r.kilde !== 'stripe') return [];
  const ud: Handling[] = [];
  if (AABNE.has(r.status) && r.opsiges === null) ud.push({ href: OPSIG_STI, tekst: F.da.handlingOpsig });
  if (await senesteFortrydbare(db, kontoId, nu)) ud.push({ href: FORTRYD_STI, tekst: F.da.handlingFortryd });
  return ud;
}
