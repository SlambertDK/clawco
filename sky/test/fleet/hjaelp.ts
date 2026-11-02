// Shared fleet test setup: an in-memory Flaade that records calls and can fail on demand, a migrated
// PGlite database with an owner account, and a clock that moves only when told.
import type { Flaade, Klargjort, TenantStatus } from '../../src/fleet/flaade.ts';
import type { FlaadeNoegler } from '../../src/fleet/noegler.ts';
import { nyDb, ur } from '../konto/hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import type { Database } from '../../src/db/pool.ts';

export type FalskFlaade = Flaade & {
  kald: string[];
  containere: Map<string, boolean>;
  volumener: Set<string>;
  husstande: Map<string, string>;
  /** Docker's StartedAt per running container: set on every start (KC-0216). */
  startet: Map<string, string>;
  /** The container restarts on its own (crash, host reboot): running again with a new start time. */
  genstart(id: string): void;
  /** Make the next call of this kind throw (once). */
  fejlNaeste(hvad: 'klargoer' | 'stop' | 'slet' | 'maerkede' | 'startede'): void;
};

export function falskFlaade(start: { volumener?: string[]; containere?: Record<string, boolean> } = {}): FalskFlaade {
  const kald: string[] = [];
  const containere = new Map(Object.entries(start.containere ?? {}));
  const volumener = new Set(start.volumener ?? []);
  const husstande = new Map<string, string>();
  const fejl = new Set<string>();
  let ip = 2;
  let starter = 0;
  const startet = new Map<string, string>();
  const startOp = (id: string) => { containere.set(id, true); startet.set(id, `2026-11-01T00:00:${String(starter++).padStart(2, '0')}Z`); };
  const ips = new Map<string, string>();
  const tjek = (hvad: string) => { if (fejl.delete(hvad)) throw new Error(`falsk ${hvad}-fejl`); };
  return {
    navn: 'lokal',
    kald, containere, volumener, husstande, startet,
    fejlNaeste(hvad) { fejl.add(hvad); },
    genstart(id) { startOp(id); },
    async klargoer(t): Promise<Klargjort> {
      kald.push(`klargoer ${t.id}`);
      tjek('klargoer');
      volumener.add(t.id);
      if (!husstande.has(t.id)) husstande.set(t.id, t.ejer);
      if (containere.get(t.id) !== true) startOp(t.id);
      if (!ips.has(t.id)) ips.set(t.id, `172.18.0.${ip++}`);
      return { tenantId: t.id, container: `clawco-t-${t.id}`, volumen: `clawco-t-${t.id}-data`, adresse: `http://${ips.get(t.id)}:8750`, krypteret: false };
    },
    async stop(id) { kald.push(`stop ${id}`); tjek('stop'); if (containere.has(id)) containere.set(id, false); startet.delete(id); },
    async slet(id) { kald.push(`slet ${id}`); tjek('slet'); containere.delete(id); volumener.delete(id); startet.delete(id); },
    async status(id): Promise<TenantStatus> { const c = containere.get(id); return c === undefined ? 'findes-ikke' : c ? 'koerer' : 'stoppet'; },
    async startede() {
      kald.push('startede');
      tjek('startede');
      return new Map([...startet].map(([id, t]) => [id, { container: `clawco-t-${id}`, startet: t }]));
    },
    async beholder(id) { return containere.get(id) === true ? { billede: `sha256:${'a'.repeat(64)}`, adresse: `http://${ips.get(id)}:8750`, container: `clawco-t-${id}` } : null; },
    async opgrader(t): Promise<Klargjort> {
      kald.push(`opgrader ${t.id} ${t.billede}`);
      if (!volumener.has(t.id)) throw new Error('disken findes ikke');
      startOp(t.id);
      ips.set(t.id, `172.18.0.${ip++}`);
      return { tenantId: t.id, container: `clawco-t-${t.id}`, volumen: `clawco-t-${t.id}-data`, adresse: `http://${ips.get(t.id)}:8750`, krypteret: false };
    },
    async maerkede() { kald.push('maerkede'); tjek('maerkede'); return new Set([...containere.keys(), ...volumener]); },
  };
}

export async function opsaet(email = 'ejer@example.test'): Promise<{ db: Database; kontoId: number; ur: ReturnType<typeof ur> }> {
  const db = await nyDb();
  const u = ur();
  const { konto } = await findEllerOpretKonto(db, email, u.nu());
  return { db, kontoId: konto.id, ur: u };
}

export type FalskNoegler = FlaadeNoegler & { kald: string[]; fejlNaeste(hvad: 'sikr' | 'lever' | 'markerSlettet'): void };

/** A recording key seam; `delt` makes it write into the same call list as a FalskFlaade, so order can be asserted. */
export function falskNoegler(delt: string[] = []): FalskNoegler {
  const fejl = new Set<string>();
  const tjek = (hvad: string) => { if (fejl.delete(hvad)) throw new Error(`falsk ${hvad}-fejl`); };
  return {
    kald: delt,
    fejlNaeste(hvad) { fejl.add(hvad); },
    async sikr(slug) { delt.push(`noegle-sikr ${slug}`); tjek('sikr'); },
    async lever(slug, container) { delt.push(`noegle-lever ${slug} ${container}`); tjek('lever'); },
    async markerSlettet(slug) { delt.push(`noegle-slettet ${slug}`); tjek('markerSlettet'); },
  };
}
