// "Delete my account" for an owner (KC-0177's TenantAfvikler seam, spec D11) backed by the fleet
// (KC-0212, KC-0182): the owner's tenant is found in the fleet's own table and deprovisioned through
// afprovisioner.ts. The shapes are konto/slet.ts' TenantAfvikler and Husstand, written structurally
// because fleet/ never imports konto/.
import type { Database } from '../db/pool.ts';
import { afprovisioner, type AfprovisionerDeps } from './afprovisioner.ts';
import { tenantForEjer } from './tilstand.ts';

export function flaadeAfvikler(d: AfprovisionerDeps): { afprovisioner(tenantId: string): Promise<void> } {
  return { afprovisioner: (slug) => afprovisioner(d, slug) };
}

type Tilknytning = { tenantId: string; rolle: 'ejer' | 'medlem'; medlemmer: string[] };
type Husstand = { forKonto(kontoId: number): Promise<Tilknytning | null>; forlad(kontoId: number): Promise<void> };

/** Until households (KC-0184) exist, the fleet is what knows that an account owns a tenant: the owner of a
 *  live tenant is its `ejer`, with no members yet. Anything else is asked of the seam behind it. */
export function flaadeHusstand(o: { db: Database; basedomain: string; reserve: Husstand }): Husstand {
  return {
    async forKonto(kontoId) {
      const t = await tenantForEjer(o.db, kontoId);
      if (!t) return o.reserve.forKonto(kontoId);
      return { tenantId: t.slug, rolle: 'ejer', medlemmer: [] };
    },
    forlad: (kontoId) => o.reserve.forlad(kontoId),
  };
}

/** What /konto shows about the account's own Clawco: its address once klar, a waiting line while it is
 *  being made (also after a failed step: the reconciler keeps trying), nothing while it is deleted. */
export function clawcoFor(o: { db: Database; basedomain: string }): (kontoId: number) => Promise<{ url: string } | { venter: true } | null> {
  return async (kontoId) => {
    const t = await tenantForEjer(o.db, kontoId);
    if (!t || t.tilstand === 'afvikles') return null;
    return t.tilstand === 'klar' ? { url: `https://${t.slug}.${o.basedomain}/` } : { venter: true };
  };
}
