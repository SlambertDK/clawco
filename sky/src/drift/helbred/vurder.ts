// The state table of one tenant's health answer (KC-0189), the count of buckets the public feed shows instead of a
// list, and the unbroken syg streak the KC-0187 rule `tenant-usund` reads. Pure: no clock, no database.

export const TENANT_TILSTANDE = ['sund', 'traeg', 'syg', 'opdaterer'] as const;
export type TenantTilstand = (typeof TENANT_TILSTANDE)[number];
export type Status = 'ok' | 'nedsat' | 'nede';
/** The status page's components, in the feed's order (judged in komponenter.ts; mirrored by migration 0014's CHECKs). */
export const KOMPONENTER = ['login', 'adgang', 'oprettelse', 'sikkerhedskopi', 'mail', 'clawco'] as const;
export type KomponentId = (typeof KOMPONENTER)[number];
export type Antal = Record<TenantTilstand, number>;

/** An answer slower than this is traeg. */
export const TRAEG_MS = 1_000;

/** What one tenant answered: null = no answer within the timeout (or the call failed). */
export type Svar = { ok: boolean; sha: string | null; ms: number } | null;

/** A rollout step wins (an upgrade is not an outage); then anything but ok with exactly the expected sha is syg
 *  (an unknown expected sha cannot be confirmed, so it is syg too: never a false sund); then slow is traeg. */
export function vurder(svar: Svar, forventetSha: string | null, opdaterer: boolean): TenantTilstand {
  if (opdaterer) return 'opdaterer';
  if (!svar || !svar.ok || !forventetSha || svar.sha !== forventetSha) return 'syg';
  return svar.ms > TRAEG_MS ? 'traeg' : 'sund';
}

export function taelOp(tilstande: Iterable<TenantTilstand>): Antal {
  const a: Antal = { sund: 0, traeg: 0, syg: 0, opdaterer: 0 };
  for (const t of tilstande) a[t]++;
  return a;
}

/** Percent of the measured tenants that answer (sund or traeg), upgrading ones left out; null when there are none. */
export function andelSund(a: Antal): number | null {
  const n = a.sund + a.traeg + a.syg;
  return n ? Math.round(((a.sund + a.traeg) / n) * 1000) / 10 : null;
}

/** The tenants component: no tenant measured is unknown (nedsat) unless all of them are upgrading; any syg or traeg is
 *  nedsat; half or more syg is nede. */
export function kunderStatus(a: Antal): Status {
  const n = a.sund + a.traeg + a.syg;
  if (!n) return a.opdaterer ? 'ok' : 'nedsat';
  if (a.syg * 2 >= n) return 'nede';
  return a.syg || a.traeg ? 'nedsat' : 'ok';
}

/** Since when each tenant has been syg without a break: a syg pass keeps (or starts) its time, anything else ends it,
 *  and a tenant no longer measured leaves the map. */
export function sygeSiden(foer: ReadonlyMap<string, Date>, maalinger: Iterable<{ slug: string; tilstand: TenantTilstand }>, nu: Date): Map<string, Date> {
  const ny = new Map<string, Date>();
  for (const m of maalinger) if (m.tilstand === 'syg') ny.set(m.slug, foer.get(m.slug) ?? nu);
  return ny;
}
