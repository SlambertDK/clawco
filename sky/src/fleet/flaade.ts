// The fleet (KC-0212, spec §2 and D11): where a tenant's container runs. One seam, two drivers:
// `lokal` (Docker on the host Sky runs on — kira-home for the beta, spec D18) and `hetzner`
// (built, refusing until the cost ledger has an active, covered Hetzner line; KC-0182 builds it).

export type TenantStatus = 'koerer' | 'stoppet' | 'findes-ikke';

export type Klargjort = {
  tenantId: string;
  container: string;
  volumen: string;
  /** Where the edge (KC-0183) reaches the tenant; never a public address. */
  adresse: string;
  /** Whether the tenant's volume is encrypted at rest (false until KC-0181 feeds the key). */
  krypteret: boolean;
};

export interface Flaade {
  navn: 'lokal' | 'hetzner';
  /** Creates (or starts) the tenant's container and volume, writing the household file with `ejer` (the
   *  owner's verified email) as the one owner before the first start. Idempotent. */
  klargoer(t: { id: string; ejer: string }): Promise<Klargjort>;
  /** Stops the container; quiet when there is none. */
  stop(tenantId: string): Promise<void>;
  /** Removes the container and wipes the volume; quiet when they are gone. */
  slet(tenantId: string): Promise<void>;
  status(tenantId: string): Promise<TenantStatus>;
  /** Every tenant id that has something (a container, a volume) carrying this fleet's tenant label —
   *  what the reconciler (afstem.ts) compares with the tenant table. */
  maerkede(): Promise<Set<string>>;
  /** Every running tenant container with Docker's start time of its current run (KC-0216): a new time means
   *  the container restarted and lost its tmpfs key. A few calls for the whole fleet, never one per tenant. */
  startede(): Promise<Map<string, { container: string; startet: string }>>;
  /** KC-0186: the tenant's RUNNING container — the image id it runs and its address; null when stopped or gone. */
  beholder(tenantId: string): Promise<{ billede: string; adresse: string; container: string } | null>;
  /** KC-0186: replaces the tenant's container with one from `billede` (an image id, sha256:…, never a tag) on the
   *  SAME volume with the same flags. The volume must exist and is never removed. Idempotent (a run killed between
   *  the remove and the start just starts). The lager key is gone with the old container: deliver it again after. */
  opgrader(t: { id: string; billede: string }): Promise<Klargjort>;
}

/** An image id as Docker prints it: what a tenant runs (KC-0186), immutable, unlike a tag. */
export const BILLED_ID = /^sha256:[0-9a-f]{64}$/;

/** A tenant id becomes part of Docker names: a plain slug, at most 40 characters, checked before any call. */
export const TENANT_ID = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function tjekTenantId(id: string): string {
  if (!TENANT_ID.test(id)) throw new Error('ugyldigt tenant-id: kun små bogstaver, tal og bindestreg (højst 40 tegn)');
  return id;
}
