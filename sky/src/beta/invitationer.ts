// The closed beta's invitations (KC-0203). An operator makes single-use codes with `npm run beta:invitation`; they are
// printed once and only their SHA-256, an expiry and the state are stored. A household types one into the sign-up
// flow's invitation step (tilmelding/); redeeming spends it and gives that account a gift (no Stripe) on the Husstand
// plan that ends no earlier than 90 days out. Nothing here contacts anyone: Henrik hands the codes out himself.
//
// Invariants (AGENTS §0 r2/r7): a code is stored as a hash only; it is spent once, atomically (one UPDATE ... WHERE
// brugt IS NULL); an expired or revoked code grants nothing; revoking never touches a used code or an existing tenant.
// A beta household is an account that redeemed a code AND still holds a gift; a gift given by hand is not one.
// Beta never imports konto/ or abonnement/ (sky/test/aftryk.test.ts): the gift and the attempt counter are handed in
// (Gaver, begraens), wired by sky/src/betaforbind.ts.
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/pool.ts';

/** The plan a beta household gets: Husstand-level limits (KC-0203). */
export const BETA_PLAN = 'sky-husstand';
/** A gift from redemption ends 90 days out; the beta-end notice (forlaengGaver) can only move it later. */
export const BETA_DAGE = 90;
/** An unused code expires after this many days by default. */
export const GYLDIG_DAGE = 60;
/** Redemption attempts one account may make per counting window (konto/graenser.ts' 15 minutes). */
export const KODER_PR_VINDUE = 10;
const DAG_MS = 86_400_000;

export type Gaver = {
  /** Gives the account the beta gift (plan Husstand, active, no Stripe) ending at `slutter`, inside `tx`. */
  giv(tx: Database, kontoId: number, slutter: Date, nu: Date): Promise<void>;
  /** Moves the account's gift end to `til` when it is later than now. True when it changed. Never shortens. */
  forlaeng(tx: Database, kontoId: number, til: Date, nu: Date): Promise<boolean>;
};
export type IndloesDeps = {
  db: Database;
  gaver: Gaver;
  /** Counts one attempt for the key; true while within the limit (konto/graenser.ts taelOp). */
  begraens(noegle: string, graense: number, nu: Date): Promise<boolean>;
};

// Same shape as konto/token.ts (32 random bytes out, SHA-256 in the database); that module is not importable from here.
const nyKode = (): string => randomBytes(32).toString('base64url');
const hashKode = (kode: string): string => createHash('sha256').update(kode).digest('hex');
const iso = (d: Date): string => d.toISOString();

/** `antal` (1..50) new single-use codes. The plain codes are returned here and nowhere else. */
export async function lavInvitationer(db: Database, antal: number, nu: Date, gyldigDage: number = GYLDIG_DAGE): Promise<string[]> {
  if (!Number.isInteger(antal) || antal < 1 || antal > 50) throw new Error('antal skal være et helt tal fra 1 til 50');
  if (!Number.isFinite(gyldigDage) || gyldigDage <= 0) throw new Error('gyldighed skal være et positivt antal dage');
  const udloeber = new Date(nu.getTime() + gyldigDage * DAG_MS);
  const koder = Array.from({ length: antal }, nyKode);
  await db.transaction(async (tx) => {
    for (const k of koder) await tx.query('INSERT INTO beta.invitation (hash, oprettet, udloeber) VALUES ($1, $2, $3)', [hashKode(k), iso(nu), iso(udloeber)]);
  });
  return koder;
}

/** Spends `kode` for the account and gives it the gift; stores the consent it ticked. False for anything that is not a
 *  live, unused code (wrong, expired, revoked, spent) and when the account has tried too often. */
export async function indloes(d: IndloesDeps, kontoId: number, kode: string, nu: Date, o: { samtykke: boolean }): Promise<boolean> {
  if (typeof kode !== 'string' || kode.length === 0 || kode.length > 64) return false;
  if (!(await d.begraens(hashKode(`beta-kode:${kontoId}`), KODER_PR_VINDUE, nu))) return false;
  return d.db.transaction(async (tx) => {
    const r = await tx.query(
      'UPDATE beta.invitation SET brugt = $2, brugt_af = $3 WHERE hash = $1 AND brugt IS NULL AND annulleret IS NULL AND udloeber > $2 RETURNING id',
      [hashKode(kode), iso(nu), kontoId]);
    if (r.length === 0) return false;
    await tx.query('INSERT INTO beta.maal (konto_id, samtykke) VALUES ($1, $2) ON CONFLICT (konto_id) DO UPDATE SET samtykke = EXCLUDED.samtykke', [kontoId, o.samtykke]);
    await d.gaver.giv(tx, kontoId, new Date(nu.getTime() + BETA_DAGE * DAG_MS), nu);
    return true;
  });
}

/** Revokes one unused code (the operator knows the text he handed out). A used code is never touched. */
export async function annuller(db: Database, kode: string, nu: Date): Promise<boolean> {
  const r = await db.query('UPDATE beta.invitation SET annulleret = $2 WHERE hash = $1 AND brugt IS NULL AND annulleret IS NULL RETURNING id', [hashKode(kode), iso(nu)]);
  return r.length > 0;
}

/** Revokes every code that is still unused and unexpired; returns how many. */
export async function annullerAlle(db: Database, nu: Date): Promise<number> {
  const r = await db.query('UPDATE beta.invitation SET annulleret = $1 WHERE brugt IS NULL AND annulleret IS NULL AND udloeber > $1 RETURNING id', [iso(nu)]);
  return r.length;
}

/** A beta household: the account redeemed a code and still holds a gift. A gift made by hand (giv-gave) is not one. */
export async function erBetaKonto(db: Database, kontoId: number): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM beta.invitation i JOIN abonnement.rettigheder r ON r.konto_id = i.brugt_af AND r.kilde = 'gave' WHERE i.brugt_af = $1 LIMIT 1", [kontoId]);
  return r.length > 0;
}

/** The tenant's owner and consent when the tenant belongs to a beta household and is not being removed; else null. */
export async function betaForTenant(db: Database, slug: string): Promise<{ kontoId: number; samtykke: boolean } | null> {
  const [r] = await db.query<{ konto_id: unknown; samtykke: boolean }>(
    `SELECT t.ejer_konto_id AS konto_id, COALESCE(m.samtykke, false) AS samtykke
       FROM flaade.tenant t
       JOIN beta.invitation i ON i.brugt_af = t.ejer_konto_id
       JOIN abonnement.rettigheder r ON r.konto_id = t.ejer_konto_id AND r.kilde = 'gave'
       LEFT JOIN beta.maal m ON m.konto_id = t.ejer_konto_id
      WHERE t.slug = $1 AND t.tilstand NOT IN ('afvikles', 'slettet') LIMIT 1`, [slug]);
  return r ? { kontoId: Number(r.konto_id), samtykke: r.samtykke } : null;
}

/** The beta-end notice path (KC-0203: no earlier than 30 days after the end is announced): every beta gift whose end is
 *  earlier than `til` moves to `til`. Returns how many changed. Hand-given gifts are not beta gifts and are left alone. */
export async function forlaengGaver(d: Pick<IndloesDeps, 'db' | 'gaver'>, til: Date, nu: Date): Promise<number> {
  return d.db.transaction(async (tx) => {
    const ider = await tx.query<{ konto_id: unknown }>(
      `SELECT DISTINCT r.konto_id FROM abonnement.rettigheder r JOIN beta.invitation i ON i.brugt_af = r.konto_id
        WHERE r.kilde = 'gave' AND (r.periode_slutter IS NULL OR r.periode_slutter < $1) ORDER BY r.konto_id`, [iso(til)]);
    let n = 0;
    for (const r of ider) if (await d.gaver.forlaeng(tx, Number(r.konto_id), til, nu)) n++;
    return n;
  });
}
