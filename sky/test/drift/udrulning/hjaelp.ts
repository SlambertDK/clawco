// A fake world for the rollout tests (KC-0186): tenants with containers that run an image, a /health that answers
// with the sha of the image the container runs (unless that image is broken), a stub image runner for the
// compatibility check, recording key delivery — over a real PGlite database whose tenant rows are the fleet's own
// (fleet/tilstand.ts), so the gateway's route table can be asked what it sees.
import { randomBytes } from 'node:crypto';
import { findEllerOpretKonto } from '../../../src/konto/konto.ts';
import { bestil, klareTilUdrulning, noterKoersel, saetHold, saetOpdateres, skift } from '../../../src/fleet/tilstand.ts';
import { falskKopiLager } from '../../../src/drift/backup/lager.ts';
import type { Hold } from '../../../src/drift/udrulning/hold.ts';
import type { BilledKoerer, UdrulDeps } from '../../../src/drift/udrulning/typer.ts';
import type { Database } from '../../../src/db/pool.ts';
import { nyDb, ur, type Ur } from '../../konto/hjaelp.ts';
import { falskNode, falskeNoegler } from '../backup/hjaelp.ts';

export const GAMMEL = { id: `sha256:${'a'.repeat(64)}`, sha: 'aaaaaaa' };
export const NY = { id: `sha256:${'b'.repeat(64)}`, sha: 'bbbbbbb', tag: 'clawco:bbbbbbb' };
export const FORKERT = { id: `sha256:${'e'.repeat(64)}`, sha: 'eeeeeee', tag: 'clawco:eeeeeee' };

type Beholder = { billede: string; adresse: string; koerer: boolean };

export type Verden = {
  db: Database; ur: Ur; d: UdrulDeps; kald: string[]; log: string[];
  beholdere: Map<string, Beholder>;
  /** Images whose /health never answers ok. */
  defekte: Set<string>;
  /** Images whose /health reports another sha than the one baked in. */
  luner: Map<string, string>;
  /** Slugs whose /health stops answering (whatever they run). */
  syge: Set<string>;
  /** Images that do not start on a disk another image has written (the compatibility check fails). */
  uforenelige: Set<string>;
  /** Make the next call of this kind throw (once). */
  fejlNaeste(hvad: 'opgrader' | 'lever' | 'pak' | 'noterKoersel', fejl?: Error): void;
  slugs: string[];
};

export async function verden(tenanter: { slug: string; hold: Hold }[]): Promise<Verden> {
  const db = await nyDb();
  const u = ur('2026-11-01T10:00:00.000Z');
  const kald: string[] = [];
  const log: string[] = [];
  const beholdere = new Map<string, Beholder>();
  const defekte = new Set<string>();
  const luner = new Map<string, string>();
  const syge = new Set<string>();
  const uforenelige = new Set<string>();
  const billeder = new Map<string, string>([[GAMMEL.id, GAMMEL.sha], [NY.id, NY.sha], [FORKERT.id, FORKERT.sha]]);
  const tags = new Map<string, string>([[NY.tag, NY.id], [FORKERT.tag, FORKERT.id], ['clawco:aaaaaaa', GAMMEL.id]]);
  const fejl = new Map<string, Error>();
  const tjek = (hvad: string) => { const e = fejl.get(hvad); if (e) { fejl.delete(hvad); throw e; } };
  let ip = 10;
  const nyAdresse = () => `http://172.18.0.${ip++}:8750`;
  const filer: Record<string, Record<string, string>> = {};

  for (const t of tenanter) {
    const { konto } = await findEllerOpretKonto(db, `${t.slug}@example.test`, u.nu());
    await bestil(db, { kontoId: konto.id, driver: 'lokal', nu: u.nu(), nySlug: () => t.slug });
    const adresse = nyAdresse();
    await skift(db, t.slug, ['bestilt'], 'klar', u.nu(), { adresse, release: GAMMEL.sha, billede: GAMMEL.id });
    if (t.hold !== 'alle') await saetHold(db, t.slug, t.hold);
    beholdere.set(t.slug, { billede: GAMMEL.id, adresse, koerer: true });
    filer[t.slug] = { 'husstand.json': `{"ejer":"${t.slug}"}` };
  }

  // Scratch containers of the compatibility check: disk → the images that have written it.
  const diske = new Map<string, string[]>();
  const kladder = new Map<string, { billede: string; disk: string; adresse: string }>();
  let n = 0;
  const koerer: BilledKoerer & { kald: string[] } = {
    kald: [],
    async info(ref) {
      koerer.kald.push(`info ${ref}`);
      const id = tags.get(ref) ?? (billeder.has(ref) ? ref : null);
      return id ? { id, sha: billeder.get(id)! } : null;
    },
    async nyDisk(billede) { const disk = `clawco-u-${String(n++).padStart(8, '0')}-data`; diske.set(disk, []); koerer.kald.push(`nyDisk ${billede}`); return disk; },
    async start(billede, disk) {
      koerer.kald.push(`start ${billede} ${disk}`);
      const navn = disk.slice(0, -5);
      const adresse = nyAdresse();
      kladder.set(navn, { billede, disk, adresse });
      diske.get(disk)!.push(billede);
      return { navn, adresse };
    },
    async stop(navn) { koerer.kald.push(`stop ${navn}`); kladder.delete(navn); },
    async fjernDisk(disk) { koerer.kald.push(`fjernDisk ${disk}`); diske.delete(disk); },
  };

  const sundhed = async (adresse: string) => {
    for (const [slug, b] of beholdere) {
      if (b.adresse !== adresse) continue;
      if (!b.koerer || syge.has(slug) || defekte.has(b.billede)) return { ok: false, sha: null };
      return { ok: true, sha: luner.get(b.billede) ?? billeder.get(b.billede)! };
    }
    for (const k of kladder.values()) {
      if (k.adresse !== adresse) continue;
      const skrevet = diske.get(k.disk) ?? [];
      if (defekte.has(k.billede) || (uforenelige.has(k.billede) && skrevet.some((b) => b !== k.billede))) return { ok: false, sha: null };
      return { ok: true, sha: billeder.get(k.billede)! };
    }
    return { ok: false, sha: null };
  };

  const node = falskNode(filer);
  const pak = node.pak.bind(node);
  node.pak = async (slug) => { tjek('pak'); return pak(slug); };

  const d: UdrulDeps = {
    db,
    flaade: {
      async beholder(slug) {
        const b = beholdere.get(slug);
        return b?.koerer ? { billede: b.billede, adresse: b.adresse, container: `clawco-t-${slug}` } : null;
      },
      async opgrader(t) {
        kald.push(`opgrader ${t.id} ${t.billede === NY.id ? 'ny' : t.billede === GAMMEL.id ? 'gammel' : t.billede === FORKERT.id ? 'forkert' : t.billede}`);
        tjek('opgrader');
        const adresse = nyAdresse();
        beholdere.set(t.id, { billede: t.billede, adresse, koerer: true });
        return { container: `clawco-t-${t.id}`, adresse };
      },
    },
    noegler: { async lever(slug, container) { kald.push(`lever ${slug} ${container}`); tjek('lever'); } },
    tenanter: {
      klare: () => klareTilUdrulning(db),
      saetHold: (slug, hold) => saetHold(db, slug, hold),
      opdateres: (slug, ja) => saetOpdateres(db, slug, ja ? u.nu() : null),
      async noterKoersel(slug, k) { tjek('noterKoersel'); await noterKoersel(db, slug, k, u.nu()); },
    },
    koerer,
    kopi: { node, noegler: falskeNoegler() },
    lagre: { r2: null, lokal: falskKopiLager() },
    sundhed,
    nu: u.nu,
    vent: async (ms) => { u.frem(ms); },
    tilfaeldig: () => randomBytes(4).toString('hex'),
    log: (s) => log.push(s),
    ejer: 'test',
    saetInterval: () => () => {},
  };
  return {
    db, ur: u, d, kald, log, beholdere, defekte, luner, syge, uforenelige, slugs: tenanter.map((t) => t.slug),
    fejlNaeste(hvad, e = new Error(`falsk ${hvad}-fejl`)) { fejl.set(hvad, e); },
  };
}

/** The tenant's row as the fleet sees it. */
export async function raekke(db: Database, slug: string): Promise<{ billede: string; release: string; adresse: string; opdateres: unknown; hold: string }> {
  const [r] = await db.query<{ billede: string; release: string; adresse: string; opdateres: unknown; hold: string }>('SELECT billede, release, adresse, opdateres, hold FROM flaade.tenant WHERE slug = $1', [slug]);
  return r!;
}

/** Runs the rollout like the operator command does: pass after pass, sleeping through each soak, until it stops. */
export async function tilEnde(v: Verden, fortsaet: (d: UdrulDeps) => Promise<{ tilstand: string | null; ventTil: Date | null }>): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const r = await fortsaet(v.d);
    if (!r.ventTil) return r.tilstand;
    v.ur.frem(r.ventTil.getTime() - v.ur.nu().getTime());
  }
  throw new Error('udrulningen blev ikke færdig');
}
