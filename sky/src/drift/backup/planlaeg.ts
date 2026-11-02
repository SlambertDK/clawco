// The night schedule (KC-0185). Level-triggered like the fleet's reconciler: nothing depends on Sky being up
// at a given minute. Each scope (a tenant slug, or `db` for Sky's own database) has its own minute in the
// night window, from a hash of its name, so the volumes are not all read at once; it is due once that
// minute has passed today with no success since. A failed attempt is retried after an hour. A Sky that was
// down through the window catches up on its next tick.

export const VINDUE = { fraTime: 0, tilTime: 4 } as const; // UTC: 01–05 in Copenhagen winter, 02–06 summer
const T = 3_600_000;
const SEN_MS = 36 * T;
const GENTAG_MS = T;
/** R2's free tier (10 GB stored); the warning comes at 80 % so the cost ledger can be updated in time. */
export const GRATIS_BYTES = 10_000_000_000;

export type Omfang = { omfang: string; siden: Date };
export type KopiTilstand = { sidsteForsoeg: Date | null; sidsteSucces: Date | null };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The scope's slot on the UTC day of `dag`. */
export function planlagtTid(omfang: string, dag: Date): Date {
  const start = Date.UTC(dag.getUTCFullYear(), dag.getUTCMonth(), dag.getUTCDate(), VINDUE.fraTime);
  const minutter = (VINDUE.tilTime - VINDUE.fraTime) * 60;
  return new Date(start + (hash(omfang) % minutter) * 60_000);
}

/** The tenants that have a volume worth copying: provisioned and not being (or already) deleted. */
export function levendeOmfang(tenanter: { slug: string; tilstand: string; siden: Date }[]): Omfang[] {
  return tenanter.filter((t) => !['bestilt', 'afvikles', 'slettet'].includes(t.tilstand)).map((t) => ({ omfang: t.slug, siden: t.siden }));
}

export function skyldige(omfang: Omfang[], tilstand: Map<string, KopiTilstand>, nu: Date): string[] {
  return omfang.filter(({ omfang: o }) => {
    let slot = planlagtTid(o, nu);
    if (slot > nu) slot = new Date(slot.getTime() - 24 * T); // before tonight's slot: yesterday's is the one that counts
    const s = tilstand.get(o);
    if (s?.sidsteSucces && s.sidsteSucces >= slot) return false;
    if (s?.sidsteForsoeg && s.sidsteForsoeg >= slot && nu.getTime() - s.sidsteForsoeg.getTime() < GENTAG_MS) return false;
    return true;
  }).map((o) => o.omfang);
}

/** How many scopes have had no success for 36 hours (a new scope gets its own 36 hours first). A count only. */
export function forsinkede(omfang: Omfang[], tilstand: Map<string, KopiTilstand>, nu: Date): number {
  return omfang.filter(({ omfang: o, siden }) => {
    const sidst = tilstand.get(o)?.sidsteSucces ?? siden;
    return nu.getTime() - sidst.getTime() > SEN_MS;
  }).length;
}

export function naerGratisGraense(bytes: number): boolean {
  return bytes >= GRATIS_BYTES * 0.8;
}
