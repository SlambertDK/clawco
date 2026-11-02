// Provisioning (KC-0182, spec D11): a resumable state machine over the Flaade seam, stored in Postgres —
// bestilt → startet → sund → i-gateway → klar on the lokal driver. Each step is idempotent and stamped
// when done; a failed step leaves the state where it was with the error recorded, so running this again
// (afstem.ts does, at start and on every pass) resumes exactly there. A tenant being deleted is never
// moved forward.
import type { Database } from '../db/pool.ts';
import type { Flaade } from './flaade.ts';
import type { FlaadeNoegler } from './noegler.ts';
import { hentTenant, noterFejl, skift, type Laas, type Tenant } from './tilstand.ts';

export type Sundhed = { ok: boolean; sha: string | null };

export type ProvisionerDeps = {
  db: Database;
  flaade: Flaade;
  /** The tenant's key envelope (KC-0181): required, so no code path can start a tenant without it. */
  noegler: FlaadeNoegler;
  /** The tenant image the fleet runs (recorded on the row). */
  billede: string | null;
  /** GET <adresse>/health from Sky (over the Docker network address on lokal). */
  sundhed: (adresse: string) => Promise<Sundhed>;
  /** Puts the tenant in the edge's route table (KC-0183 fills it; a no-op until then). */
  iGateway: (t: { slug: string; adresse: string }) => Promise<void>;
  laas: Laas;
  nu: () => Date;
  vent: (ms: number) => Promise<void>;
  /** How long `sund` waits for /health: attempts × pause. Default 90 × 1 s. */
  sundFrist?: { forsoeg: number; ms: number };
};

/** The tenant's /health, read by Sky. ok only on a 200 whose body says ok:true; never follows a redirect. */
export async function hentSundhed(adresse: string, f: typeof fetch = fetch): Promise<Sundhed> {
  try {
    const r = await f(`${adresse}/health`, { signal: AbortSignal.timeout(2_000), redirect: 'error' });
    if (r.status !== 200) return { ok: false, sha: null };
    const j = (await r.json()) as { ok?: unknown; sha?: unknown };
    if (j.ok !== true) return { ok: false, sha: null };
    return { ok: true, sha: typeof j.sha === 'string' ? j.sha.slice(0, 64) : null };
  } catch {
    return { ok: false, sha: null };
  }
}

async function ejerEmail(db: Database, kontoId: number): Promise<string> {
  const [r] = await db.query<{ email: string | null }>('SELECT email FROM konto WHERE id = $1 AND slettet_ved IS NULL', [kontoId]);
  if (!r?.email) throw new Error('ejeren findes ikke længere: ingen beholder');
  return r.email;
}

async function ventSund(d: ProvisionerDeps, adresse: string): Promise<Sundhed> {
  const { forsoeg, ms } = d.sundFrist ?? { forsoeg: 90, ms: 1_000 };
  for (let i = 0; i < forsoeg; i++) {
    const s = await d.sundhed(adresse);
    if (s.ok) return s;
    if (i < forsoeg - 1) await d.vent(ms);
  }
  throw new Error(`tenantens /health svarede ikke ok inden for ${Math.round((forsoeg * ms) / 1000)} s`);
}

/** Runs the tenant's remaining steps until klar (or until someone else moved it, e.g. a deletion). */
export async function provisioner(d: ProvisionerDeps, slug: string): Promise<Tenant> {
  return d.laas(slug, async () => {
    let t = await hentTenant(d.db, slug);
    if (!t) throw new Error(`ukendt tenant ${slug}`);
    // The address this run saw; a resumed run asks the fleet again (a restarted container can move).
    let adresse: string | null = null;
    // KC-0181: the data key exists before the container does, and the lager key goes into the container's
    // tmpfs right after every start (it is gone with each stop). A failure here leaves the state where it was.
    const start = async (ejerKontoId: number): Promise<string> => {
      await d.noegler.sikr(slug);
      const k = await d.flaade.klargoer({ id: slug, ejer: await ejerEmail(d.db, ejerKontoId) });
      await d.noegler.lever(slug, k.container);
      return k.adresse;
    };
    try {
      for (;;) {
        let naeste: Tenant | null;
        switch (t.tilstand) {
          case 'bestilt': {
            adresse = await start(t.ejerKontoId);
            naeste = await skift(d.db, slug, ['bestilt'], 'startet', d.nu(), { adresse, billede: d.billede });
            break;
          }
          case 'startet': {
            adresse ??= await start(t.ejerKontoId);
            const s = await ventSund(d, adresse);
            naeste = await skift(d.db, slug, ['startet'], 'sund', d.nu(), { adresse, release: s.sha });
            break;
          }
          case 'sund': {
            if (!t.adresse) throw new Error('tenanten har ingen adresse');
            await d.iGateway({ slug, adresse: t.adresse });
            naeste = await skift(d.db, slug, ['sund'], 'i-gateway', d.nu());
            break;
          }
          case 'i-gateway':
            naeste = await skift(d.db, slug, ['i-gateway'], 'klar', d.nu());
            break;
          default:
            return t; // klar, or being deleted / deleted: nothing to do here.
        }
        // null: the row left the expected state under us (a deletion began); report what it is now.
        if (!naeste) return (await hentTenant(d.db, slug)) ?? t;
        t = naeste;
      }
    } catch (err) {
      await noterFejl(d.db, slug, (err as Error).message, d.nu());
      throw err;
    }
  });
}
