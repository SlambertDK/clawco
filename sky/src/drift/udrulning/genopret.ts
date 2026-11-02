// An upgrade's restore point (KC-0186): taken right before a tenant's container is replaced, so no upgrade ever
// runs without one. The same sealed copy as the nightly backup (backup/koer.ts forseglTenant: the volume read
// read-only, gzip, AES-GCM under the tenant's own backup key), stored through the KopiLager seam: R2 when it is set
// up, else the local directory store (on the Sky host's disk: a restore point, not an offsite backup). It is never
// recorded as a nightly copy (drift.kopi / drift.snapshot), so the night's schedule is not fooled by it; its id and
// store are on the rollout's tenant row, and it is pruned GENOPRET_DAGE after the rollout ended.
import { randomBytes } from 'node:crypto';
import type { Database } from '../../db/pool.ts';
import { forseglTenant } from '../backup/koer.ts';
import type { KopiLager } from '../backup/lager.ts';
import type { Manifest } from '../backup/manifest.ts';
import { snapshotId } from '../backup/opbevaring.ts';
import type { KopiNode, KopiNoegler } from '../backup/typer.ts';
import { GENOPRET_DAGE } from './hold.ts';
import { genopretTilRydning, noterRyddet } from './tilstand.ts';

export type Lagre = { r2: KopiLager | null; lokal: KopiLager };
export type GenopretDeps = {
  kopi: { node: Pick<KopiNode, 'pak'>; noegler: Pick<KopiNoegler, 'tenant'> };
  lagre: Lagre;
  nu: () => Date;
  tilfaeldig?: () => string;
};

export function genopretNoegle(slug: string, id: string): string {
  return `genopret/${slug}/${id}.ckb`;
}

/** Seals the tenant's volume now and stores it; read back before it counts. Throws when it cannot be made. */
export async function genopretningspunkt(d: GenopretDeps, slug: string): Promise<{ id: string; lager: 'r2' | 'lokal'; manifest: Manifest }> {
  const id = snapshotId(d.nu(), (d.tilfaeldig ?? (() => randomBytes(4).toString('hex')))());
  const { blob, manifest } = await forseglTenant(d.kopi, slug, id);
  const lager = d.lagre.r2 ? 'r2' : 'lokal';
  const l = d.lagre.r2 ?? d.lagre.lokal;
  await l.put(genopretNoegle(slug, id), blob);
  const tilbage = await l.hent(genopretNoegle(slug, id));
  if (!tilbage || !tilbage.equals(blob)) throw new Error('genopretningspunktet kunne ikke læses tilbage');
  return { id, lager, manifest };
}

/** Deletes the restore points of rollouts that ended GENOPRET_DAGE ago, each from its own store; returns how many.
 *  One in R2 while R2 is not set up (any more) waits; nothing is ever deleted from the wrong store. */
export async function rydGenopretning(d: { db: Database; lagre: Lagre; nu: () => Date }): Promise<number> {
  const nu = d.nu();
  let n = 0;
  for (const g of await genopretTilRydning(d.db, new Date(nu.getTime() - GENOPRET_DAGE * 86_400_000))) {
    const l = g.lager === 'r2' ? d.lagre.r2 : d.lagre.lokal;
    if (!l) continue;
    await l.slet(genopretNoegle(g.slug, g.genopret));
    await noterRyddet(d.db, g.udrulning, g.slug, nu);
    n++;
  }
  return n;
}
