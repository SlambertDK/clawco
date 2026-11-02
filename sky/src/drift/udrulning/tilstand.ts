// The rollout's state in Postgres (KC-0186, migration 0010): releases, rollouts and one row per tenant per
// rollout. Only this file writes drift.udgave, drift.udrulning and drift.udrulning_tenant. Every tenant step is a
// conditional UPDATE from an expected state, so two runs can never both take the same tenant.
import type { Database } from '../../db/pool.ts';
import type { Hold } from './hold.ts';

export type Udgave = { tag: string; sha: string; billedeId: string };
export type UdrulTilstand = 'koerer' | 'standset' | 'tilbagerulles' | 'faerdig' | 'tilbagerullet';
export type TenantTrin = 'venter' | 'igang' | 'opgraderet' | 'tilbagerullet' | 'fejlet' | 'sprunget-over';
export type Udrulning = { id: number; udgave: Udgave; tilstand: UdrulTilstand; hold: Hold; holdFaerdig: Date | null; grund: string | null; startet: Date; slut: Date | null };
export type UdrulTenant = {
  slug: string; hold: Hold; nr: number; tilstand: TenantTrin;
  fraBillede: string | null; fraSha: string | null; genopret: string | null; genopretLager: 'r2' | 'lokal' | null; fejl: string | null;
};

const AKTIVE: readonly UdrulTilstand[] = ['koerer', 'standset', 'tilbagerulles'];
const dato = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));
const kort = (s: string) => s.slice(0, 500);

export async function hentUdgave(db: Database, tag: string): Promise<Udgave | null> {
  const [r] = await db.query<{ tag: string; sha: string; billede_id: string }>('SELECT tag, sha, billede_id FROM drift.udgave WHERE tag = $1', [tag]);
  return r ? { tag: r.tag, sha: r.sha, billedeId: r.billede_id } : null;
}

/** Records a release. The same tag again is fine only when it still names the same image and sha. */
export async function gemUdgave(db: Database, u: Udgave, nu: Date): Promise<Udgave> {
  await db.query('INSERT INTO drift.udgave (tag, sha, billede_id, oprettet) VALUES ($1, $2, $3, $4) ON CONFLICT (tag) DO NOTHING', [u.tag, u.sha, u.billedeId, nu.toISOString()]);
  const g = (await hentUdgave(db, u.tag))!;
  if (g.billedeId !== u.billedeId || g.sha !== u.sha) throw new Error(`${u.tag} peger nu på et andet billede end det, der blev registreret: byg en ny udgave med sit eget tag`);
  return g;
}

const UDRUL = `SELECT u.id, u.tilstand, u.hold, u.hold_faerdig, u.grund, u.startet, u.slut, g.tag, g.sha, g.billede_id
  FROM drift.udrulning u JOIN drift.udgave g ON g.tag = u.udgave`;

function somUdrulning(r: Record<string, unknown>): Udrulning {
  return {
    id: Number(r['id']), udgave: { tag: r['tag'] as string, sha: r['sha'] as string, billedeId: r['billede_id'] as string },
    tilstand: r['tilstand'] as UdrulTilstand, hold: r['hold'] as Hold, holdFaerdig: dato(r['hold_faerdig']),
    grund: (r['grund'] as string | null) ?? null, startet: dato(r['startet'])!, slut: dato(r['slut']),
  };
}

/** The one active rollout (koerer, standset or tilbagerulles), or null. */
export async function aktivUdrulning(db: Database): Promise<Udrulning | null> {
  const [r] = await db.query(`${UDRUL} WHERE u.tilstand = ANY($1::text[])`, [AKTIVE]);
  return r ? somUdrulning(r) : null;
}

export async function senesteUdrulning(db: Database): Promise<Udrulning | null> {
  const [r] = await db.query(`${UDRUL} ORDER BY u.id DESC LIMIT 1`);
  return r ? somUdrulning(r) : null;
}

export async function hentUdrulning(db: Database, id: number): Promise<Udrulning | null> {
  const [r] = await db.query(`${UDRUL} WHERE u.id = $1`, [id]);
  return r ? somUdrulning(r) : null;
}

/** A new rollout with its plan, in one transaction; the unique index refuses a second active one. */
export async function opretUdrulning(db: Database, a: { udgave: string; hold: Hold; tenanter: { slug: string; hold: Hold }[]; nu: Date }): Promise<number> {
  return db.transaction(async (tx) => {
    const [r] = await tx.query<{ id: number }>(
      "INSERT INTO drift.udrulning (udgave, tilstand, hold, startet, opdateret) VALUES ($1, 'koerer', $2, $3, $3) RETURNING id", [a.udgave, a.hold, a.nu.toISOString()]);
    const id = Number(r!.id);
    for (const [i, t] of a.tenanter.entries()) {
      await tx.query("INSERT INTO drift.udrulning_tenant (udrulning, slug, hold, nr, tilstand) VALUES ($1, $2, $3, $4, 'venter')", [id, t.slug, t.hold, i + 1]);
    }
    return id;
  });
}

export async function tenanterI(db: Database, id: number): Promise<UdrulTenant[]> {
  const rows = await db.query('SELECT slug, hold, nr, tilstand, fra_billede, fra_sha, genopret, genopret_lager, fejl FROM drift.udrulning_tenant WHERE udrulning = $1 ORDER BY nr', [id]);
  return rows.map((r) => ({
    slug: r['slug'] as string, hold: r['hold'] as Hold, nr: Number(r['nr']), tilstand: r['tilstand'] as TenantTrin,
    fraBillede: (r['fra_billede'] as string | null) ?? null, fraSha: (r['fra_sha'] as string | null) ?? null,
    genopret: (r['genopret'] as string | null) ?? null, genopretLager: (r['genopret_lager'] as 'r2' | 'lokal' | null) ?? null, fejl: (r['fejl'] as string | null) ?? null,
  }));
}

/** venter → igang; false when someone else took it first. */
export async function gribTenant(db: Database, id: number, slug: string, nu: Date): Promise<boolean> {
  const r = await db.query("UPDATE drift.udrulning_tenant SET tilstand = 'igang', startet = $3 WHERE udrulning = $1 AND slug = $2 AND tilstand = 'venter' RETURNING slug", [id, slug, nu.toISOString()]);
  return r.length === 1;
}

export async function noterFra(db: Database, id: number, slug: string, fra: { billede: string; sha: string }): Promise<void> {
  await db.query('UPDATE drift.udrulning_tenant SET fra_billede = $3, fra_sha = $4 WHERE udrulning = $1 AND slug = $2', [id, slug, fra.billede, fra.sha]);
}

export async function noterGenopret(db: Database, id: number, slug: string, g: { id: string; lager: 'r2' | 'lokal' }): Promise<void> {
  await db.query('UPDATE drift.udrulning_tenant SET genopret = $3, genopret_lager = $4 WHERE udrulning = $1 AND slug = $2', [id, slug, g.id, g.lager]);
}

/** Ends a tenant's step from one of `fra`; false when it was not in one of them. */
export async function afslutTenant(db: Database, id: number, slug: string, fra: readonly TenantTrin[], til: TenantTrin, nu: Date, fejl: string | null = null): Promise<boolean> {
  const r = await db.query('UPDATE drift.udrulning_tenant SET tilstand = $4, slut = $5, fejl = $6 WHERE udrulning = $1 AND slug = $2 AND tilstand = ANY($3::text[]) RETURNING slug',
    [id, slug, fra, til, nu.toISOString(), fejl === null ? null : kort(fejl)]);
  return r.length === 1;
}

/** A tenant failed: its row and the halt of the rollout in one transaction (a kill between them cannot lose the halt). */
export async function standsVed(db: Database, id: number, slug: string, til: 'tilbagerullet' | 'fejlet', fejl: string, nu: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await afslutTenant(tx, id, slug, ['igang', 'opgraderet'], til, nu, fejl);
    await tx.query("UPDATE drift.udrulning SET tilstand = 'standset', grund = $2, opdateret = $3 WHERE id = $1 AND tilstand = 'koerer'", [id, kort(`${slug}: ${fejl}`), nu.toISOString()]);
  });
}

/** Moves the rollout from one of `fra` and sets the given fields; false when it was not in `fra`. */
export async function saetUdrulning(
  db: Database, id: number, fra: readonly UdrulTilstand[],
  f: { tilstand?: UdrulTilstand; hold?: Hold; holdFaerdig?: Date | null; grund?: string | null; slut?: Date },
  nu: Date,
): Promise<boolean> {
  const saet = ['opdateret = $3'];
  const p: unknown[] = [id, fra, nu.toISOString()];
  const add = (kol: string, v: unknown) => { p.push(v); saet.push(`${kol} = $${p.length}`); };
  if (f.tilstand !== undefined) add('tilstand', f.tilstand);
  if (f.hold !== undefined) add('hold', f.hold);
  if (f.holdFaerdig !== undefined) add('hold_faerdig', f.holdFaerdig ? f.holdFaerdig.toISOString() : null);
  if (f.grund !== undefined) add('grund', f.grund === null ? null : kort(f.grund));
  if (f.slut !== undefined) add('slut', f.slut.toISOString());
  const r = await db.query(`UPDATE drift.udrulning SET ${saet.join(', ')} WHERE id = $1 AND tilstand = ANY($2::text[]) RETURNING id`, p);
  return r.length === 1;
}

/** Takes (or renews, for the same `ejer`) the rollout's lease until `til`; false while another command holds it. */
export async function tagLaas(db: Database, id: number, ejer: string, nu: Date, til: Date): Promise<boolean> {
  const r = await db.query('UPDATE drift.udrulning SET laast_til = $3, laast_af = $2 WHERE id = $1 AND (laast_til IS NULL OR laast_til < $4 OR laast_af = $2) RETURNING id',
    [id, ejer, til.toISOString(), nu.toISOString()]);
  return r.length === 1;
}

export async function slipLaas(db: Database, id: number, ejer: string): Promise<void> {
  await db.query('UPDATE drift.udrulning SET laast_til = NULL, laast_af = NULL WHERE id = $1 AND laast_af = $2', [id, ejer]);
}

/** Restore points of rollouts that ended before `foer` and are not pruned yet. */
export async function genopretTilRydning(db: Database, foer: Date): Promise<{ udrulning: number; slug: string; genopret: string; lager: 'r2' | 'lokal' }[]> {
  const rows = await db.query<{ udrulning: number; slug: string; genopret: string; genopret_lager: 'r2' | 'lokal' }>(
    `SELECT t.udrulning, t.slug, t.genopret, t.genopret_lager FROM drift.udrulning_tenant t JOIN drift.udrulning u ON u.id = t.udrulning
      WHERE t.genopret IS NOT NULL AND t.genopret_ryddet IS NULL AND u.slut IS NOT NULL AND u.slut < $1 ORDER BY t.udrulning, t.nr`, [foer.toISOString()]);
  return rows.map((r) => ({ udrulning: Number(r.udrulning), slug: r.slug, genopret: r.genopret, lager: r.genopret_lager }));
}

export async function noterRyddet(db: Database, udrulning: number, slug: string, nu: Date): Promise<void> {
  await db.query('UPDATE drift.udrulning_tenant SET genopret_ryddet = $3 WHERE udrulning = $1 AND slug = $2', [udrulning, slug, nu.toISOString()]);
}
