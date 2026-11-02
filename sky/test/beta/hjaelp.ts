// Shared setup for the beta tests: a migrated database, a controllable clock and beta households (redeemed code,
// a gift, a tenant that is klar). Fictional addresses only (example.test).
import { nyDb, ur, type Ur } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';
import { indloes, lavInvitationer, type IndloesDeps } from '../../src/beta/invitationer.ts';
import { betaIndloesDeps } from '../../src/betaforbind.ts';
import type { Database } from '../../src/db/pool.ts';

export const DAG = 86_400_000;
export type Beta = { db: Database; u: Ur; deps: IndloesDeps; husstand(email: string, slug: string, o?: { samtykke?: boolean; bestilt?: Date; klar?: Date | null; tilmeldingMs?: number | null }): Promise<number> };

export async function opsaetBeta(): Promise<Beta> {
  const db = await nyDb();
  const u = ur('2026-11-01T10:00:00.000Z');
  const deps = betaIndloesDeps(db, laesPriser());
  return {
    db, u, deps,
    async husstand(email, slug, o = {}) {
      const { konto } = await findEllerOpretKonto(db, email, u.nu());
      const [kode] = await lavInvitationer(db, 1, u.nu());
      if (!(await indloes(deps, konto.id, kode!, u.nu(), { samtykke: o.samtykke ?? false }))) throw new Error('indløsning fejlede i testopsætningen');
      const bestilt = o.bestilt ?? u.nu();
      const klar = o.klar === undefined ? new Date(bestilt.getTime() + 60_000) : o.klar;
      await db.query(
        "INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, klar, adresse, oprettet, opdateret) VALUES ($1, $2, 'lokal', $3, $4, $5, $6, $4, $4)",
        [slug, konto.id, klar ? 'klar' : 'bestilt', bestilt.toISOString(), klar ? klar.toISOString() : null, klar ? `http://172.18.0.2:8750` : null]);
      if (o.tilmeldingMs !== undefined) await db.query('UPDATE konto SET tilmelding_ms = $2 WHERE id = $1', [konto.id, o.tilmeldingMs]);
      return konto.id;
    },
  };
}
