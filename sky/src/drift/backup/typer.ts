// The seams of the backup job (KC-0185). drift/ imports no other Sky module: server.ts and
// sky/scripts/sikkerhedskopi.ts wire the fleet's node, the key envelope and the database dump in.
import type { Database } from '../../db/pool.ts';
import type { Noegle } from './krypto.ts';
import type { KopiLager } from './lager.ts';

/**
 * Where tenant volumes live. Today the lokal Docker host (fleet/kopi.ts); later a Hetzner node agent with the
 * same calls. Restored and scratch objects are always NEW names (clawco-g-…, clawco-p-…): no call here can
 * write to a tenant's own volume or container.
 */
export interface KopiNode {
  /** A tar of the tenant's live volume, mounted read-only. Throws when the volume is gone. */
  pak(tenant: string): Promise<Buffer>;
  /** Creates the NEW volume `navn` and unpacks `tar` into it. Refuses a name that exists. */
  udpak(navn: string, tenant: string, tar: Buffer): Promise<void>;
  /** Starts a NEW container `navn` on volume `navn` from the tenant image, with no gateway route. */
  start(navn: string, tenant: string): Promise<{ adresse: string }>;
  /** A tar of a restored volume (what the drill compares with the manifest). */
  pakGendannet(navn: string): Promise<Buffer>;
  /** Removes container and volume `navn`, seen gone. Only ever a restored or scratch name. */
  fjern(navn: string): Promise<void>;
}

export type Brugsnoegle = Noegle & { oedelaeg(): void };

export type KopiNoegler = {
  /** The tenant's `backup` key (HKDF from its DEK, KC-0181). Throws when the DEK is destroyed or missing. */
  tenant(slug: string): Promise<Brugsnoegle>;
  /** The control-plane dump key for a master-key version (current when omitted). Throws for an unknown version. */
  db(version?: number): { version: number; noegle: Noegle };
};

export type DbDump = {
  /** pg_dump of Sky's database, custom format. */
  dump(): Promise<Buffer>;
  /** pg_restore --list over a dump: throws when it is not a readable archive; returns its entry count. */
  tjek(dump: Buffer): Promise<number>;
  /** pg_restore into an existing, empty database `maal` (never Sky's own). */
  gendan(dump: Buffer, maal: string): Promise<void>;
};

export type KopiDeps = {
  db: Database;
  lager: KopiLager;
  node: KopiNode;
  noegler: KopiNoegler;
  /** null: no pg_dump on this host; the database is then not copied (and counts as late after 36 h). */
  dump: DbDump | null;
  /** Every tenant row (fleet's table), with when it first had a volume. */
  tenanter: () => Promise<{ slug: string; tilstand: string; siden: Date }[]>;
  /** Deleted tenants' data keys (KC-0181): their purge date and whether the key is already destroyed. */
  slettedeNoegler: () => Promise<{ tenant: string; destrueres: Date | null; destrueret: boolean }[]>;
  nu: () => Date;
  /** 8 hex for a snapshot id (random by default). */
  tilfaeldig?: () => string;
  /** Counts only; never a tenant name or a key. */
  log?: (linje: string) => void;
};
