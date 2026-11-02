// What sign-up asks on the account (KC-0198, migration 0007): country, language and the consent versions
// accepted, plus the time from account to a ready Clawco. The flow (sky/src/tilmelding/) gets these as seams.
import type { Database } from '../db/pool.ts';

export type Sprog = 'da' | 'en';
export type Profil = { land: string | null; sprog: Sprog | null; vilkaar: string | null; privatliv: string | null; oprettet: Date; tilmeldingMs: number | null };

type Raekke = { land: string | null; sprog: Sprog | null; vilkaar_version: string | null; privatliv_version: string | null; oprettet: Date; tilmelding_ms: number | null };

export async function hentProfil(db: Database, kontoId: number): Promise<Profil | null> {
  const [r] = await db.query<Raekke>(
    'SELECT land, sprog, vilkaar_version, privatliv_version, oprettet, tilmelding_ms FROM konto WHERE id = $1 AND slettet_ved IS NULL', [kontoId]);
  if (!r) return null;
  return { land: r.land, sprog: r.sprog, vilkaar: r.vilkaar_version, privatliv: r.privatliv_version, oprettet: new Date(r.oprettet), tilmeldingMs: r.tilmelding_ms === null ? null : Number(r.tilmelding_ms) };
}

export async function gemProfil(db: Database, kontoId: number, a: { land: string; sprog: Sprog; vilkaar: string; privatliv: string; nu: Date }): Promise<void> {
  await db.query(
    'UPDATE konto SET land = $2, sprog = $3, vilkaar_version = $4, privatliv_version = $5, samtykke_ved = $6 WHERE id = $1 AND slettet_ved IS NULL',
    [kontoId, a.land, a.sprog, a.vilkaar, a.privatliv, a.nu.toISOString()]);
}

/** Account created → tenant klar (from the tenant's own klar stamp). The first write wins. */
export async function noterTilmeldingstid(db: Database, kontoId: number, klar: Date): Promise<void> {
  await db.query(
    `UPDATE konto SET tilmelding_ms = GREATEST(0, round(extract(epoch FROM ($2::timestamptz - oprettet)) * 1000))::int
      WHERE id = $1 AND tilmelding_ms IS NULL`, [kontoId, klar.toISOString()]);
}
