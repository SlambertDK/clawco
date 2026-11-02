// Delete my account (KC-0177, spec D11: stop the container, wipe the volume, revoke the keys).
// Needs fresh authentication and the email typed. An owner takes the tenant with them (the
// TenantAfvikler seam; the real one is KC-0182); a household member only leaves (KC-0184).
// No grace period in v1: backups keep 30 days (KC-0185), so support can repair an accident.
// KC-0206: the export links and the profile go too, and one receipt row records the deletion (a hash of the id, the
// time, the role, what is kept and why from beholdt.ts, and the date the backups are gone).
import type { Database } from '../db/pool.ts';
import type { Haendelser } from '../delt/haendelser.ts';
import type { Post } from '../delt/post.ts';
import { hentKonto, normaliserEmail } from './konto.ts';
import { emailNoegle } from './graenser.ts';
import { erFrisk, type Session } from './session.ts';
import { BEHOLDT, KOPIER_DAGE, kontoHash } from './beholdt.ts';

export interface TenantAfvikler {
  /** Stops the tenant's container, wipes its volume and revokes its keys. Throws if it could not. */
  afprovisioner(tenantId: string): Promise<void>;
}

/** The account's place in a household: owner of a tenant, or a member of someone else's. */
export type Tilknytning = { tenantId: string; rolle: 'ejer' | 'medlem'; medlemmer: string[] };

export interface Husstand {
  forKonto(kontoId: number): Promise<Tilknytning | null>;
  forlad(kontoId: number): Promise<void>;
}

/** Until KC-0184 there are no households: nobody owns or belongs to a tenant. */
export function ingenHusstand(): Husstand {
  return { async forKonto() { return null; }, async forlad() {} };
}

/** Until KC-0182 nothing can be deprovisioned; refusing keeps an account from vanishing half-way. */
export function ingenAfvikler(): TenantAfvikler {
  return { async afprovisioner() { throw new Error('ingen afvikler endnu (KC-0182)'); } };
}

/** `post` (KC-0178): the receipt to the address the account had; the routes always pass it. */
export type SletDeps = { db: Database; husstand: Husstand; afvikler: TenantAfvikler; haendelser: Haendelser; post?: Post };

export type SletOversigt = { email: string; rolle: Tilknytning['rolle'] | null; medlemmer: string[] };

/** What ends when this account is deleted (the page shows it before the button). */
export async function sletOversigt(d: Pick<SletDeps, 'db' | 'husstand'>, kontoId: number): Promise<SletOversigt | null> {
  const k = await hentKonto(d.db, kontoId);
  if (!k) return null;
  const t = await d.husstand.forKonto(kontoId);
  return { email: k.email, rolle: t?.rolle ?? null, medlemmer: t?.rolle === 'ejer' ? t.medlemmer : [] };
}

export async function sletKonto(
  d: SletDeps,
  a: { kontoId: number; session: Pick<Session, 'autentificeret'>; emailBekraeftelse: unknown; nu: Date },
): Promise<'slettet' | 'ikke-frisk' | 'forkert-email' | 'ukendt'> {
  const k = await hentKonto(d.db, a.kontoId);
  if (!k) return 'ukendt';
  if (!erFrisk(a.session, a.nu)) return 'ikke-frisk';
  if (normaliserEmail(a.emailBekraeftelse) !== k.email) return 'forkert-email';

  // The tenant first: if that fails, the account stays whole and the person can try again.
  const t = await d.husstand.forKonto(k.id);
  if (t?.rolle === 'ejer') await d.afvikler.afprovisioner(t.tenantId);
  else if (t) await d.husstand.forlad(k.id);

  const [p] = await d.db.query<{ sprog: 'da' | 'en' | null }>('SELECT sprog FROM konto WHERE id = $1', [k.id]);
  const kopierVaek = new Date(a.nu.getTime() + KOPIER_DAGE * 86_400_000);
  await d.db.transaction(async (tx) => {
    await tx.query('DELETE FROM eksportlink WHERE konto_id = $1', [k.id]);
    await tx.query('DELETE FROM session WHERE konto_id = $1', [k.id]);
    await tx.query('DELETE FROM passkey WHERE konto_id = $1', [k.id]);
    await tx.query('DELETE FROM udfordring WHERE konto_id = $1', [k.id]);
    await tx.query('DELETE FROM loginkode WHERE email = $1', [k.email]);
    await tx.query('DELETE FROM graense WHERE noegle = $1', [emailNoegle(k.email)]);
    // The row stays as a tombstone without the email, so billing (KC-0173) can still refer to the id.
    // KC-0206: country, language and the sign-up time go too; what stays, and why, is konto/beholdt.ts.
    await tx.query('UPDATE konto SET email = NULL, slettet_ved = $2, land = NULL, sprog = NULL, tilmelding_ms = NULL WHERE id = $1', [k.id, a.nu.toISOString()]);
    await tx.query('INSERT INTO sletkvittering (konto_hash, slettet_ved, rolle, beholdt, kopier_vaek) VALUES ($1, $2, $3, $4, $5)',
      [kontoHash(k.id), a.nu.toISOString(), t?.rolle ?? 'alene', JSON.stringify(BEHOLDT), kopierVaek.toISOString()]);
  });
  d.haendelser.udsend({ navn: 'konto.slettet', kontoId: k.id, tidspunkt: a.nu.toISOString() });
  // One receipt, after the fact: the address is held only in this call. A failed mail never undoes the
  // deletion (the provider logs the masked reason; nothing here names the address).
  if (d.post) {
    try { await d.post.send({ til: k.email, skabelon: 'konto-slettet', sprog: p?.sprog ?? 'da', data: { dage: String(KOPIER_DAGE) } }); } catch {
      console.error('sky konto: kvitteringen for en slettet konto kunne ikke sendes (kontoen er slettet)');
    }
  }
  return 'slettet';
}
