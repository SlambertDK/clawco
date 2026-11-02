// The fleet's key seam, wired (KC-0181): the three calls fleet/noegler.ts asks for, over the real envelope code.
// Typed structurally here (Sky's modules never import each other); server.ts is where the two meet.
// Without a master key (SKY_MASTERNOEGLE) every call refuses with the key's NAME — never a tenant is started
// without its key, and never a value is in a message.
import type { Database } from '../db/pool.ts';
import { leverTilTenant, type KoerselMedInput } from './levering.ts';
import type { Noeglering } from './masternoegle.ts';
import { markerSlettet, opretTenantNoegle } from './tenantnoegle.ts';

type Dele = { db: Database; koer: KoerselMedInput; nu: () => Date };

export type FlaadeNoegler = {
  sikr(slug: string): Promise<void>;
  lever(slug: string, container: string): Promise<void>;
  markerSlettet(slug: string): Promise<void>;
};

export function flaadeNoegler(o: Dele & { ring: Noeglering }): FlaadeNoegler {
  return {
    async sikr(slug) { await opretTenantNoegle(o.db, o.ring, slug, o.nu()); },
    lever: (slug, container) => leverTilTenant({ db: o.db, ring: o.ring, tenant: slug, container, koer: o.koer }),
    async markerSlettet(slug) { await markerSlettet(o.db, slug, o.nu()); },
  };
}

/** What a fleet gets when Sky has no (valid) master key: creating a key and delivering one refuse, so
 *  provisioning stops before anything starts. Marking a deletion needs no master key (only a date is written),
 *  so a customer's deletion is never held up by it. */
export function ingenMasternoegle(o: Dele): FlaadeNoegler {
  const nej = (): Promise<never> => Promise.reject(new Error('SKY_MASTERNOEGLE mangler: ingen beholder startes uden en nøgle til kunden (sky/deploy/NOEGLE.md)'));
  return { sikr: nej, lever: nej, async markerSlettet(slug) { await markerSlettet(o.db, slug, o.nu()); } };
}
