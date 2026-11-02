// Deprovisioning (KC-0182, spec D11: "stop container, wipe volume, revoke keys"): the tenant is marked
// `afvikles` first (so provisioning never moves it forward again), taken out of the edge's route table,
// stopped, its container and volume removed and seen gone, then left as a `slettet` tombstone that keeps
// the slug from ever being handed out again. Idempotent; a failure leaves it in `afvikles` with the error,
// and running it again (or afstem.ts) finishes the job. Revoking the tenant's keys is KC-0181 (the data key moves to
// `slettet` and is destroyed 30 days on); revoking its gateway sessions is part of udAfGateway (KC-0183).
import type { Database } from '../db/pool.ts';
import type { Flaade } from './flaade.ts';
import type { FlaadeNoegler } from './noegler.ts';
import { hentTenant, noterFejl, skift, type Laas } from './tilstand.ts';

export type AfprovisionerDeps = {
  db: Database;
  flaade: Flaade;
  /** KC-0181: "revoke keys" — the data key is marked for its 30-day purge once nothing of the tenant runs. */
  noegler: FlaadeNoegler;
  /** Removes the tenant's route and sessions from the edge (KC-0183 fills it; a no-op until then). */
  udAfGateway: (slug: string) => Promise<void>;
  /** KC-0206: the tenant's own KC-0146 Slet alt, run inside the container while it still runs (server.ts wires it
   *  through gateway/tenantkald.ts). Best effort: a crashed tenant must still be deletable, and the volume removal
   *  right after is what guarantees the data is gone. */
  toem?: (slug: string, adresse: string) => Promise<void>;
  laas: Laas;
  nu: () => Date;
};

export async function afprovisioner(d: AfprovisionerDeps, slug: string): Promise<void> {
  await d.laas(slug, async () => {
    const t = await hentTenant(d.db, slug);
    if (!t) throw new Error(`ukendt tenant ${slug}: intet slettet`);
    if (t.tilstand === 'slettet') return;
    if (t.tilstand !== 'afvikles') {
      const ok = await skift(d.db, slug, ['bestilt', 'startet', 'sund', 'i-gateway', 'klar'], 'afvikles', d.nu());
      if (!ok) throw new Error(`tenant ${slug} skiftede tilstand undervejs; prøv igen`);
    }
    try {
      await d.udAfGateway(slug);
      if (d.toem && t.adresse) {
        try { await d.toem(slug, t.adresse); } catch (err) {
          console.error(`sky flåde: kundens egen Slet alt fejlede, disken slettes alligevel: ${(err as Error).message}`);
        }
      }
      await d.flaade.stop(slug);
      await d.flaade.slet(slug);
      await d.noegler.markerSlettet(slug);
    } catch (err) {
      await noterFejl(d.db, slug, (err as Error).message, d.nu());
      throw err;
    }
    await skift(d.db, slug, ['afvikles'], 'slettet', d.nu(), { adresse: null });
  });
}
