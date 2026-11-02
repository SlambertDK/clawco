// The tenant row (KC-0182, migration 0004): one per customer Clawco, in exactly one state of the machine,
// with one timestamp per step. Every state change is a conditional UPDATE (from an expected state), so a
// step is never recorded twice and a deletion that started meanwhile always wins.
import type { Database } from '../db/pool.ts';
import { nySlug as traekSlug } from './slug.ts';

/** The provisioning steps on the lokal driver, in order. The Hetzner steps from the ticket (node-valgt,
 *  volumen-klar, krypteret) join when that driver is enabled (spec D18): on one host without root there is
 *  no node to choose and no LUKS, so `startet` covers volume, household file and container. */
export const TRIN = ['bestilt', 'startet', 'sund', 'i-gateway', 'klar'] as const;
export type Trin = (typeof TRIN)[number];
export type Tilstand = Trin | 'afvikles' | 'slettet';
const ALLE: readonly Tilstand[] = [...TRIN, 'afvikles', 'slettet'];

export type Tenant = {
  id: number;
  slug: string;
  ejerKontoId: number;
  driver: 'lokal' | 'hetzner';
  tilstand: Tilstand;
  tider: Partial<Record<Tilstand, Date>>;
  billede: string | null;
  release: string | null;
  adresse: string | null;
  fejl: string | null;
  fejlVed: Date | null;
  forsoeg: number;
  /** KC-0186: the rollout cohort, and since when the container is being replaced (null when it is not). */
  hold: Hold;
  opdateres: Date | null;
};

export type Hold = 'intern' | 'kanari' | 'alle';

const KOLONNE: Record<Tilstand, string> = {
  bestilt: 'bestilt', startet: 'startet', sund: 'sund', 'i-gateway': 'i_gateway', klar: 'klar', afvikles: 'afvikles', slettet: 'slettet',
};

const FELTER = `id, slug, ejer_konto_id, driver, tilstand, ${ALLE.map((s) => KOLONNE[s]).join(', ')}, billede, release, adresse, fejl, fejl_ved, forsoeg, hold, opdateres`;
type Raekke = Record<string, unknown>;

function somTenant(r: Raekke): Tenant {
  const tider: Partial<Record<Tilstand, Date>> = {};
  for (const s of ALLE) { const v = r[KOLONNE[s]]; if (v !== null && v !== undefined) tider[s] = new Date(v as string); }
  return {
    id: Number(r['id']), slug: r['slug'] as string, ejerKontoId: Number(r['ejer_konto_id']), driver: r['driver'] as Tenant['driver'],
    tilstand: r['tilstand'] as Tilstand, tider,
    billede: (r['billede'] as string | null) ?? null, release: (r['release'] as string | null) ?? null, adresse: (r['adresse'] as string | null) ?? null,
    fejl: (r['fejl'] as string | null) ?? null, fejlVed: r['fejl_ved'] ? new Date(r['fejl_ved'] as string) : null, forsoeg: Number(r['forsoeg']),
    hold: r['hold'] as Hold, opdateres: r['opdateres'] ? new Date(r['opdateres'] as string) : null,
  };
}

export async function hentTenant(db: Database, slug: string): Promise<Tenant | null> {
  const [r] = await db.query(`SELECT ${FELTER} FROM flaade.tenant WHERE slug = $1`, [slug]);
  return r ? somTenant(r) : null;
}

/** The owner's live tenant (anything but a `slettet` tombstone). */
export async function tenantForEjer(db: Database, kontoId: number): Promise<Tenant | null> {
  const [r] = await db.query(`SELECT ${FELTER} FROM flaade.tenant WHERE ejer_konto_id = $1 AND tilstand <> 'slettet'`, [kontoId]);
  return r ? somTenant(r) : null;
}

/** Tenants the reconciler must carry on: anything not `klar` and not `slettet`. */
export async function ufaerdige(db: Database): Promise<Tenant[]> {
  return (await db.query(`SELECT ${FELTER} FROM flaade.tenant WHERE tilstand NOT IN ('klar', 'slettet') ORDER BY id`)).map(somTenant);
}

/** Slugs of every tenant in `klar` (KC-0216: the ones whose key must survive a container restart). */
export async function klare(db: Database): Promise<string[]> {
  return (await db.query<{ slug: string }>("SELECT slug FROM flaade.tenant WHERE tilstand = 'klar' ORDER BY id")).map((r) => r.slug);
}

/** Slugs of deprovisioned tenants among `slugs` (their leftovers are provably ours to remove). */
export async function slettede(db: Database, slugs: string[]): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  const r = await db.query<{ slug: string }>("SELECT slug FROM flaade.tenant WHERE slug = ANY($1::text[]) AND tilstand = 'slettet'", [slugs]);
  return new Set(r.map((x) => x.slug));
}

/** Of `slugs`, the ones with any row at all. */
export async function kendte(db: Database, slugs: string[]): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  const r = await db.query<{ slug: string }>('SELECT slug FROM flaade.tenant WHERE slug = ANY($1::text[])', [slugs]);
  return new Set(r.map((x) => x.slug));
}

/** Orders a tenant for the owner: a new row in `bestilt` with a fresh random slug, or the owner's live one. */
export async function bestil(db: Database, a: { kontoId: number; driver: Tenant['driver']; nu: Date; nySlug?: () => string }): Promise<Tenant> {
  for (let i = 0; i < 8; i++) {
    const fandtes = await tenantForEjer(db, a.kontoId);
    if (fandtes) return fandtes;
    const slug = (a.nySlug ?? traekSlug)();
    const nu = a.nu.toISOString();
    // No conflict target: a taken slug and a concurrent order for the same owner both end here quietly.
    const [r] = await db.query(
      `INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, oprettet, opdateret) VALUES ($1, $2, $3, 'bestilt', $4, $4, $4)
       ON CONFLICT DO NOTHING RETURNING ${FELTER}`,
      [slug, a.kontoId, a.driver, nu],
    );
    if (r) return somTenant(r);
  }
  throw new Error('kunne ikke finde en ledig slug');
}

/** Moves the tenant from one of `fra` to `til`, stamping `til`'s timestamp and clearing the last error.
 *  Returns the new row, or null when the tenant was no longer in `fra` (someone else moved it). */
export async function skift(
  db: Database,
  slug: string,
  fra: readonly Tilstand[],
  til: Tilstand,
  nu: Date,
  felter: { adresse?: string | null; billede?: string | null; release?: string | null } = {},
): Promise<Tenant | null> {
  const saet = [`tilstand = $3`, `${KOLONNE[til]} = $4`, 'opdateret = $4', 'fejl = NULL', 'fejl_ved = NULL'];
  const params: unknown[] = [slug, fra, til, nu.toISOString()];
  for (const k of ['adresse', 'billede', 'release'] as const) {
    if (felter[k] === undefined) continue;
    params.push(felter[k]);
    saet.push(`${k} = $${params.length}`);
  }
  const [r] = await db.query(`UPDATE flaade.tenant SET ${saet.join(', ')} WHERE slug = $1 AND tilstand = ANY($2::text[]) RETURNING ${FELTER}`, params);
  return r ? somTenant(r) : null;
}

/** Records a failed step; the state stays where it was, so the next run resumes that step. */
export async function noterFejl(db: Database, slug: string, fejl: string, nu: Date): Promise<void> {
  await db.query('UPDATE flaade.tenant SET fejl = $2, fejl_ved = $3, forsoeg = forsoeg + 1, opdateret = $3 WHERE slug = $1', [slug, fejl.slice(0, 500), nu.toISOString()]);
}

export type Laas = <T>(slug: string, fn: () => Promise<T>) => Promise<T>;

/** One step at a time per tenant inside this process: provisioning, deprovisioning and the reconciler queue
 *  up behind each other (the conditional UPDATEs above guard across processes). */
export function laase(): Laas {
  const koe = new Map<string, Promise<unknown>>();
  return async (slug, fn) => {
    const foer = koe.get(slug) ?? Promise.resolve();
    const denne = foer.catch(() => {}).then(fn);
    koe.set(slug, denne);
    try { return await denne; } finally { if (koe.get(slug) === denne) koe.delete(slug); }
  };
}

/** Every tenant for the backup job (KC-0185): its state and when it first had a volume (startet, else bestilt). */
export async function tenanterTilKopi(db: Database): Promise<{ slug: string; tilstand: Tilstand; siden: Date }[]> {
  const rows = await db.query<{ slug: string; tilstand: Tilstand; siden: Date | string }>('SELECT slug, tilstand, coalesce(startet, bestilt) AS siden FROM flaade.tenant ORDER BY id');
  return rows.map((r) => ({ slug: r.slug, tilstand: r.tilstand, siden: new Date(r.siden) }));
}

// --- KC-0186: the rollout's view of the tenant rows ---------------------------------------------------------

/** Sets a tenant's cohort (the operator's `udrul.ts hold`). false when there is no such live tenant. */
export async function saetHold(db: Database, slug: string, hold: Hold): Promise<boolean> {
  const r = await db.query("UPDATE flaade.tenant SET hold = $2 WHERE slug = $1 AND tilstand <> 'slettet' RETURNING slug", [slug, hold]);
  return r.length === 1;
}

/** Every klar tenant (the ones with a container and a route) with its cohort, release and address. */
export async function klareTilUdrulning(db: Database): Promise<{ slug: string; hold: Hold; release: string | null; adresse: string | null }[]> {
  const rows = await db.query<{ slug: string; hold: Hold; release: string | null; adresse: string | null }>(
    "SELECT slug, hold, release, adresse FROM flaade.tenant WHERE tilstand = 'klar' ORDER BY id");
  return rows.map((r) => ({ slug: r.slug, hold: r.hold, release: r.release ?? null, adresse: r.adresse ?? null }));
}

/** Marks the tenant as being replaced (the gateway shows the update page) or clears it (null). */
export async function saetOpdateres(db: Database, slug: string, nu: Date | null): Promise<void> {
  await db.query('UPDATE flaade.tenant SET opdateres = $2 WHERE slug = $1', [slug, nu ? nu.toISOString() : null]);
}

/** After an upgrade or a rollback: the image id it runs now, the sha its /health reported and its new address. */
export async function noterKoersel(db: Database, slug: string, k: { billede: string; release: string; adresse: string }, nu: Date): Promise<void> {
  await db.query('UPDATE flaade.tenant SET billede = $2, release = $3, adresse = $4, opdateret = $5 WHERE slug = $1', [slug, k.billede, k.release, k.adresse, nu.toISOString()]);
}
