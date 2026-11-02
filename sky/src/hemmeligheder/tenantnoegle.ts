// A tenant's data key in Postgres (KC-0181, table hemmeligheder.tenant_noegle, migration 0005):
// created once when the tenant is made, opened when a purpose key is needed, marked for purge when the
// tenant is deleted (D11 "revoke keys") and destroyed by the daily job 30 days later — the backup
// retention (KC-0185) and the privacy draft (KC-0174). After that the tenant's backups cannot be
// opened (crypto-shredding). Only envelopes ever reach the database.
import type { Database } from '../db/pool.ts';
import { nyDataNoegle, pakInd, pakUd } from './kuvert.ts';
import type { Noeglering } from './masternoegle.ts';
import type { Hemmelig } from './skjul.ts';

export const OPBEVARING_DAGE = 30;
const DAG_MS = 86_400_000;
const TENANT = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

function tjek(tenant: string): string {
  if (!TENANT.test(tenant)) throw new Error('ugyldigt tenant-id');
  return tenant;
}

type Raekke = { tenant: string; kuvert: Uint8Array | null; kek_version: number };
const buf = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/** Makes the tenant's DEK. Idempotent: an existing row (also a deleted one) is never re-keyed. */
export async function opretTenantNoegle(db: Database, r: Noeglering, tenant: string, nu: Date): Promise<'oprettet' | 'findes'> {
  tjek(tenant);
  const dek = nyDataNoegle();
  try {
    const k = pakInd(r, tenant, dek);
    const rows = await db.query(
      'INSERT INTO hemmeligheder.tenant_noegle (tenant, kuvert, kek_version, oprettet) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant) DO NOTHING RETURNING tenant',
      [tenant, k.kuvert, k.version, nu.toISOString()],
    );
    return rows.length ? 'oprettet' : 'findes';
  } finally {
    dek.oedelaeg();
  }
}

/** Opens the tenant's DEK. Fails closed: no row, a destroyed key or an envelope the ring cannot open. */
export async function hentDataNoegle(db: Database, r: Noeglering, tenant: string): Promise<Hemmelig> {
  const [row] = await db.query<Raekke>('SELECT tenant, kuvert, kek_version FROM hemmeligheder.tenant_noegle WHERE tenant = $1', [tjek(tenant)]);
  if (!row) throw new Error(`ingen nøgle for tenant ${tenant}`);
  if (!row.kuvert) throw new Error(`nøglen er destrueret for tenant ${tenant}`);
  return pakUd(r, tenant, { kuvert: buf(row.kuvert), version: row.kek_version });
}

/** Tenant deleted: the DEK waits OPBEVARING_DAGE, then the daily job destroys it. Keeps the first date. Null when unknown. */
export async function markerSlettet(db: Database, tenant: string, nu: Date): Promise<Date | null> {
  const purge = new Date(nu.getTime() + OPBEVARING_DAGE * DAG_MS);
  await db.query(
    "UPDATE hemmeligheder.tenant_noegle SET status = 'slettet', slettet_ved = $2, destrueres = $3 WHERE tenant = $1 AND status = 'aktiv'",
    [tjek(tenant), nu.toISOString(), purge.toISOString()],
  );
  const [row] = await db.query<{ destrueres: Date | string | null }>('SELECT destrueres FROM hemmeligheder.tenant_noegle WHERE tenant = $1', [tenant]);
  return row?.destrueres ? new Date(row.destrueres) : null;
}

/** The daily job: destroys every wrapped DEK whose purge date has come. Returns how many. */
export async function destruerUdloebne(db: Database, nu: Date): Promise<number> {
  const rows = await db.query(
    "UPDATE hemmeligheder.tenant_noegle SET kuvert = NULL, destrueret = $1 WHERE status = 'slettet' AND destrueret IS NULL AND destrueres <= $1 RETURNING tenant",
    [nu.toISOString()],
  );
  return rows.length;
}

/**
 * KEK rotation (`sky/scripts/roter-masternoegle.ts`): re-wraps every live envelope not yet on the
 * ring's current version, in ONE transaction with the rows locked. A crash rolls everything back, so
 * no row is ever half-wrapped; the previous KEK (SKY_MASTERNOEGLE_FORRIGE) keeps opening the old
 * envelopes until this has completed. An envelope the ring cannot open stops the whole job.
 */
export async function roterMasternoegle(db: Database, r: Noeglering, nu: Date): Promise<{ omkuverteret: number; version: number }> {
  const version = r.aktuel.version;
  const omkuverteret = await db.transaction(async (tx) => {
    const rows = await tx.query<Raekke>(
      'SELECT tenant, kuvert, kek_version FROM hemmeligheder.tenant_noegle WHERE kuvert IS NOT NULL AND kek_version <> $1 ORDER BY tenant FOR UPDATE',
      [version],
    );
    for (const row of rows) {
      const dek = pakUd(r, row.tenant, { kuvert: buf(row.kuvert!), version: row.kek_version });
      try {
        const k = pakInd(r, row.tenant, dek);
        await tx.query('UPDATE hemmeligheder.tenant_noegle SET kuvert = $2, kek_version = $3, roteret = $4 WHERE tenant = $1', [row.tenant, k.kuvert, k.version, nu.toISOString()]);
      } finally {
        dek.oedelaeg();
      }
    }
    return rows.length;
  });
  return { omkuverteret, version };
}

/** Live envelopes still under an older KEK than `version`; 0 = the rotation is done and the previous key can go. */
export async function paaAeldreVersion(db: Database, version: number): Promise<number> {
  const [row] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hemmeligheder.tenant_noegle WHERE kuvert IS NOT NULL AND kek_version <> $1', [version]);
  return row?.n ?? 0;
}

/** Deleted tenants' keys (KC-0185): the purge date the backups follow, and whether the key is already destroyed. */
export async function slettedeNoegler(db: Database): Promise<{ tenant: string; destrueres: Date | null; destrueret: boolean }[]> {
  const rows = await db.query<{ tenant: string; destrueres: Date | string | null; destrueret: Date | string | null }>(
    "SELECT tenant, destrueres, destrueret FROM hemmeligheder.tenant_noegle WHERE status = 'slettet' ORDER BY tenant",
  );
  return rows.map((r) => ({ tenant: r.tenant, destrueres: r.destrueres ? new Date(r.destrueres) : null, destrueret: r.destrueret !== null }));
}
