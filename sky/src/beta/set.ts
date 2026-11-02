// The retention signal (KC-0203, measure 3): which UTC days the gateway let a member through to a beta household's
// Clawco. Measured by Sky itself from request metadata, no tenant content and no tenant reporting, so it exists even for
// households that declined the other numbers. One row per household (its owner's account) per day.
//
// Invariants: only beta households leave a row (a paying customer or a hand-given gift never does); a request costs no
// query once its day is noted (an in-memory set, cleared when the UTC day changes, and the beta lookup is cached ten
// minutes per tenant); a failed write never reaches the request and is retried by the next one.
import type { Database } from '../db/pool.ts';
import { betaForTenant } from './invitationer.ts';

export const CACHE_MS = 10 * 60_000;

export function noterSet(d: { db: Database; nu?: () => Date; log?: (linje: string) => void; cacheMs?: number }): (slug: string) => Promise<void> {
  const nu = d.nu ?? (() => new Date());
  const log = d.log ?? ((l: string) => console.error(`sky beta: ${l}`));
  const cacheMs = d.cacheMs ?? CACHE_MS;
  const ejere = new Map<string, { konto: number | null; til: number }>();
  const noteret = new Set<string>();
  let dagen = '';
  return async (slug) => {
    const t = nu();
    const dag = t.toISOString().slice(0, 10);
    if (dag !== dagen) { noteret.clear(); dagen = dag; }
    let e = ejere.get(slug);
    if (!e || e.til <= t.getTime()) {
      try { e = { konto: (await betaForTenant(d.db, slug))?.kontoId ?? null, til: t.getTime() + cacheMs }; } catch (err) {
        log(`hvem ejer ${slug} kunne ikke slås op: ${(err as Error).message.slice(0, 120)}`);
        return;
      }
      if (ejere.size > 5_000) ejere.clear();
      ejere.set(slug, e);
    }
    if (e.konto === null) return;
    const noegle = `${e.konto}:${dag}`;
    if (noteret.has(noegle)) return;
    noteret.add(noegle);
    try { await d.db.query('INSERT INTO beta.set (konto_id, dag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [e.konto, dag]); } catch (err) {
      noteret.delete(noegle);
      log(`dagens besøg kunne ikke noteres: ${(err as Error).message.slice(0, 120)}`);
    }
  };
}
