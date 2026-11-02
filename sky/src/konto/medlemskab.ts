// Household membership (KC-0184, spec D12): who besides the owner may enter a tenant, and with which role (KC-0154's
// medlem, barn, gaest). A membership is made only by accepting an invitation with an account whose verified email is
// the invited one (an account's email is proven by construction: it was made from a mail link to that address);
// only the owner removes a member or changes a role; a member may leave on her own.
//
// Invariant (AGENTS §0 r2/r12): Sky's rows and the tenant's household never disagree after a completed operation.
// Every change runs in one transaction that also makes the signed control call to the tenant (gateway/kontrolkald.ts,
// handed in as a seam: konto/ never imports gateway/); if the call fails the transaction rolls back — the invitation
// stays pending, the membership stays as it was. The tenant's side is idempotent, so a retry is safe. A removal also
// drops the account's unspent one-time codes for that tenant and the gateway's membership cache (`glem`), so the next
// request is refused at once instead of within 30 seconds.
import type { Database } from '../db/pool.ts';
import { hentKonto } from './konto.ts';
import type { Husstand, Tilknytning } from './slet.ts';
import { ejersTenant, findInvitation, pladser, type Entitlements, type InviterRolle } from './invitation.ts';

export type MedlemOp =
  | { op: 'tilfoej'; email: string; navn: string; rolle: InviterRolle }
  | { op: 'fjern'; email: string }
  | { op: 'rolle'; email: string; rolle: InviterRolle };
/** The signed call to the tenant (gateway/kontrolkald.ts). Throws when the tenant did not confirm. */
export type HusstandKald = { medlem(t: { slug: string; adresse: string }, op: MedlemOp): Promise<unknown> };

export type MedlemskabDeps = { db: Database; kald: HusstandKald; entitlements: Entitlements; glem(slug: string): void };

/** Thrown inside a transaction when the tenant did not confirm: the transaction rolls back. */
class TenantNede extends Error {}

async function tenantAdresse(db: Database, slug: string): Promise<{ slug: string; adresse: string; ejerKontoId: number } | null> {
  const [r] = await db.query<{ adresse: string | null; ejer_konto_id: unknown }>("SELECT adresse, ejer_konto_id FROM flaade.tenant WHERE slug = $1 AND tilstand = 'klar'", [slug]);
  return r?.adresse ? { slug, adresse: r.adresse, ejerKontoId: Number(r.ejer_konto_id) } : null;
}

async function kaldTenant(d: MedlemskabDeps, t: { slug: string; adresse: string }, op: MedlemOp): Promise<void> {
  try { await d.kald.medlem({ slug: t.slug, adresse: t.adresse }, op); } catch (err) {
    console.error(`sky husstand: ${t.slug} bekræftede ikke ${op.op}:`, (err as Error).message);
    throw new TenantNede();
  }
}

export type Medlemskab = { tenantId: string; rolle: InviterRolle; navn: string };
export async function medlemskabFor(db: Database, kontoId: number): Promise<Medlemskab | null> {
  const [r] = await db.query<{ tenant_id: string; rolle: InviterRolle; navn: string }>('SELECT tenant_id, rolle, navn FROM medlemskab WHERE konto_id = $1', [kontoId]);
  return r ? { tenantId: r.tenant_id, rolle: r.rolle, navn: r.navn } : null;
}

/** The household's owner account for a member (for the sign-up flow's entitlement), or null. */
export async function husstandensEjer(db: Database, kontoId: number): Promise<{ tenantId: string; ejerKontoId: number } | null> {
  const [r] = await db.query<{ tenant_id: string; ejer_konto_id: unknown }>(
    'SELECT m.tenant_id, t.ejer_konto_id FROM medlemskab m JOIN flaade.tenant t ON t.slug = m.tenant_id WHERE m.konto_id = $1', [kontoId]);
  return r ? { tenantId: r.tenant_id, ejerKontoId: Number(r.ejer_konto_id) } : null;
}

export type MedlemVisning = { kontoId: number; email: string; navn: string; rolle: InviterRolle; oprettet: Date };
export async function medlemmer(db: Database, slug: string): Promise<MedlemVisning[]> {
  const r = await db.query<{ konto_id: unknown; email: string; navn: string; rolle: InviterRolle; oprettet: Date | string }>(
    'SELECT m.konto_id, k.email, m.navn, m.rolle, m.oprettet FROM medlemskab m JOIN konto k ON k.id = m.konto_id WHERE m.tenant_id = $1 ORDER BY m.oprettet, m.konto_id', [slug]);
  return r.map((x) => ({ kontoId: Number(x.konto_id), email: x.email, navn: x.navn, rolle: x.rolle, oprettet: new Date(x.oprettet) }));
}

export type AccepterUdfald = 'ok' | 'ugyldig' | 'anden-email' | 'allerede-medlem' | 'anden-husstand' | 'ejer-selv' | 'fuld' | 'tenant-nede';

/** The invited person's "Tag imod": the membership row and the tenant's household entry, both or neither. */
export async function accepter(d: MedlemskabDeps, a: { token: unknown; kontoId: number; nu: Date }): Promise<{ udfald: AccepterUdfald; tenantId?: string }> {
  const konto = await hentKonto(d.db, a.kontoId);
  const inv = await findInvitation(d.db, a.token, a.nu);
  if (!konto || !inv) return { udfald: 'ugyldig' };
  // The accepting account's verified email must be the invited one; a different account spends nothing.
  if (konto.email !== inv.email) return { udfald: 'anden-email' };
  const m = await medlemskabFor(d.db, a.kontoId);
  if (m) return { udfald: m.tenantId === inv.tenantId ? 'allerede-medlem' : 'anden-husstand', tenantId: m.tenantId };
  if ((await d.db.query("SELECT 1 FROM flaade.tenant WHERE ejer_konto_id = $1 AND tilstand <> 'slettet'", [a.kontoId])).length) return { udfald: 'ejer-selv' };
  const t = await tenantAdresse(d.db, inv.tenantId);
  if (!t) return { udfald: 'tenant-nede' };
  // This invitation is one of the pending ones counted; accepting it moves it from pending to member.
  const p = await pladser(d, t.slug, a.nu);
  if (p.brugt > p.max) return { udfald: 'fuld' };
  try {
    const ok = await d.db.transaction(async (tx) => {
      const [brugt] = await tx.query(
        'UPDATE invitation SET brugt = $2, brugt_af = $3 WHERE id = $1 AND sendt IS NOT NULL AND brugt IS NULL AND annulleret IS NULL AND udloeber > $2 RETURNING id',
        [inv.id, a.nu.toISOString(), a.kontoId]);
      if (!brugt) return false;
      await tx.query('INSERT INTO medlemskab (konto_id, tenant_id, rolle, navn, oprettet) VALUES ($1, $2, $3, $4, $5)', [a.kontoId, t.slug, inv.rolle, inv.navn, a.nu.toISOString()]);
      await kaldTenant(d, t, { op: 'tilfoej', email: inv.email, navn: inv.navn, rolle: inv.rolle });
      return true;
    });
    if (!ok) return { udfald: 'ugyldig' };
  } catch (err) {
    if (err instanceof TenantNede) return { udfald: 'tenant-nede' };
    throw err;
  }
  d.glem(t.slug);
  return { udfald: 'ok', tenantId: t.slug };
}

/** Ends one membership: the row, the account's unspent codes for the tenant, and the tenant's entry — or nothing. */
async function afslut(d: MedlemskabDeps, t: { slug: string; adresse: string }, kontoId: number): Promise<'ok' | 'ukendt' | 'tenant-nede'> {
  try {
    const ok = await d.db.transaction(async (tx) => {
      const [m] = await tx.query<{ email: string }>(
        'DELETE FROM medlemskab m USING konto k WHERE m.tenant_id = $1 AND m.konto_id = $2 AND k.id = m.konto_id RETURNING k.email', [t.slug, kontoId]);
      if (!m) return false;
      await tx.query('DELETE FROM gateway.kode WHERE konto_id = $1 AND slug = $2', [kontoId, t.slug]);
      await kaldTenant(d, t, { op: 'fjern', email: m.email });
      return true;
    });
    if (!ok) return 'ukendt';
  } catch (err) {
    if (err instanceof TenantNede) return 'tenant-nede';
    throw err;
  }
  d.glem(t.slug);
  return 'ok';
}

/** The owner removes a member: her access ends with the next request. */
export async function fjernMedlem(d: MedlemskabDeps, a: { ejerKontoId: number; medlemKontoId: number }): Promise<'ok' | 'ikke-ejer' | 'ukendt' | 'tenant-nede'> {
  const t = await ejersTenant(d.db, a.ejerKontoId);
  if (!t) return 'ikke-ejer';
  return afslut(d, t, a.medlemKontoId);
}

/** A member leaves on her own. */
export async function forlad(d: MedlemskabDeps, a: { kontoId: number }): Promise<'ok' | 'ingen' | 'tenant-nede'> {
  const m = await medlemskabFor(d.db, a.kontoId);
  if (!m) return 'ingen';
  const t = await tenantAdresse(d.db, m.tenantId);
  if (!t) {
    // The household's Clawco is gone (deleted or being replaced): there is no entry left to remove, only the row.
    await d.db.query('DELETE FROM medlemskab WHERE konto_id = $1', [a.kontoId]);
    d.glem(m.tenantId);
    return 'ok';
  }
  const r = await afslut(d, t, a.kontoId);
  return r === 'ukendt' ? 'ingen' : r;
}

/** The owner gives a member another role (medlem, barn, gæst; never ejer: no transfer of ownership). */
export async function skiftRolle(d: MedlemskabDeps, a: { ejerKontoId: number; medlemKontoId: number; rolle: InviterRolle }): Promise<'ok' | 'ikke-ejer' | 'ukendt' | 'tenant-nede'> {
  const t = await ejersTenant(d.db, a.ejerKontoId);
  if (!t) return 'ikke-ejer';
  try {
    const ok = await d.db.transaction(async (tx) => {
      const [m] = await tx.query<{ email: string }>(
        'UPDATE medlemskab m SET rolle = $3 FROM konto k WHERE m.tenant_id = $1 AND m.konto_id = $2 AND k.id = m.konto_id RETURNING k.email', [t.slug, a.medlemKontoId, a.rolle]);
      if (!m) return false;
      await kaldTenant(d, t, { op: 'rolle', email: m.email, rolle: a.rolle });
      return true;
    });
    return ok ? 'ok' : 'ukendt';
  } catch (err) {
    if (err instanceof TenantNede) return 'tenant-nede';
    throw err;
  }
}

/** konto/slet.ts' Husstand from the real rows: the owner of a live tenant (the fleet's table) or a member. */
export function medlemskabHusstand(d: MedlemskabDeps): Husstand {
  return {
    async forKonto(kontoId): Promise<Tilknytning | null> {
      const [ejet] = await d.db.query<{ slug: string }>("SELECT slug FROM flaade.tenant WHERE ejer_konto_id = $1 AND tilstand <> 'slettet'", [kontoId]);
      if (ejet) return { tenantId: ejet.slug, rolle: 'ejer', medlemmer: (await medlemmer(d.db, ejet.slug)).map((m) => m.email) };
      const m = await medlemskabFor(d.db, kontoId);
      return m ? { tenantId: m.tenantId, rolle: 'medlem', medlemmer: [] } : null;
    },
    async forlad(kontoId) {
      if ((await forlad(d, { kontoId })) === 'tenant-nede') throw new Error('husstandens Clawco svarede ikke: medlemskabet er ikke afsluttet');
    },
  };
}
