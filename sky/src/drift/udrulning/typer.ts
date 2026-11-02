// The seams of a rollout (KC-0186). drift/ imports no other Sky module: server.ts (udrulFra) wires the fleet, the
// key delivery, the tenant rows and the image runner in, as it does for the backup job.
import type { Database } from '../../db/pool.ts';
import type { GenopretDeps } from './genopret.ts';
import type { Hold } from './hold.ts';

export type Sundhed = { ok: boolean; sha: string | null };

/** Local images and scratch containers (fleet/udgave-koerer.ts on the lokal host). Scratch only: no call here can
 *  touch a tenant's container or volume. */
export interface BilledKoerer {
  /** The image's id (sha256:…) and the git sha baked into it; null when there is no such image. */
  info(ref: string): Promise<{ id: string; sha: string } | null>;
  /** A new scratch disk, prepared by `billede` like a new tenant's (a household file). */
  nyDisk(billede: string): Promise<string>;
  /** Runs `billede` on scratch `disk` like a tenant, without a gateway route. */
  start(billede: string, disk: string): Promise<{ navn: string; adresse: string }>;
  /** Removes a scratch container, seen gone; quiet when it is gone. */
  stop(navn: string): Promise<void>;
  fjernDisk(disk: string): Promise<void>;
}

/** The fleet's two calls a rollout uses (fleet/flaade.ts Flaade fits). */
export type UdrulFlaade = {
  beholder(slug: string): Promise<{ billede: string; adresse: string; container: string } | null>;
  opgrader(t: { id: string; billede: string }): Promise<{ container: string; adresse: string }>;
};

/** The fleet's tenant rows (fleet/tilstand.ts). */
export type UdrulTenanter = {
  /** Every klar tenant: the ones with a container and a gateway route. */
  klare(): Promise<{ slug: string; hold: Hold; release: string | null; adresse: string | null }[]>;
  saetHold(slug: string, hold: Hold): Promise<boolean>;
  /** The gateway's "Opdaterer, et øjeblik" flag. */
  opdateres(slug: string, ja: boolean): Promise<void>;
  /** The image id it runs now, the sha its /health reported and its (possibly new) address — the gateway's route. */
  noterKoersel(slug: string, k: { billede: string; release: string; adresse: string }): Promise<void>;
};

export type UdrulDeps = GenopretDeps & {
  db: Database;
  flaade: UdrulFlaade;
  /** The tenant's lager key into its container's tmpfs, after every start (KC-0181). */
  noegler: { lever(slug: string, container: string): Promise<void> };
  tenanter: UdrulTenanter;
  koerer: BilledKoerer;
  /** GET <adresse>/health from Sky. */
  sundhed: (adresse: string) => Promise<Sundhed>;
  vent: (ms: number) => Promise<void>;
  /** Counts and slugs only; never a key. */
  log?: (linje: string) => void;
  /** Who holds the lease (random per command by default). */
  ejer?: string;
  /** Renews the lease while a pass runs (setInterval by default). */
  saetInterval?: (fn: () => void, ms: number) => () => void;
};
