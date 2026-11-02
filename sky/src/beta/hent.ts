// The daily pull of the beta measures (KC-0203): for every klar beta tenant, Sky asks GET /api/beta/maal over its
// signed control call (gateway/kontrolkald.ts, handed in as `hent`) and stores what fits the closed schema (maal.ts).
// Nothing flows the other way and nothing is pushed by a tenant: a tenant that never answers simply has no numbers.
//
// Invariants: only a beta household (a redeemed invitation and a gift) is asked; an answer that does not fit the
// schema is refused whole and nothing of it is stored or logged beyond the tenant's slug (Sky's own journal); without
// consent only feedback the person sent on purpose is stored and numbers held from an earlier consent are cleared;
// beta/ imports neither gateway/ nor fleet/ (sky/test/aftryk.test.ts): the call is a seam.
import type { Database } from '../db/pool.ts';
import { valider, type Maal } from './maal.ts';

export const MAAL_STI = '/api/beta/maal';
const TJEK_MS = 30 * 60_000;

export type HentDeps = {
  db: Database;
  /** GET `sti` on the tenant as Sky's signed control call: the parsed JSON of a 200 answer; throws on anything else. */
  hent(t: { slug: string; adresse: string }, sti: string): Promise<unknown>;
  log?: (linje: string) => void;
};
export type HentUdfald = { beta: number; hentet: number; afvist: number; udenSvar: number };

type BetaTenant = { slug: string; adresse: string; kontoId: number; tilmeldingMs: number | null };

async function betaTenanter(db: Database): Promise<BetaTenant[]> {
  const r = await db.query<{ slug: string; adresse: string; konto_id: unknown; tilmelding_ms: number | null }>(
    `SELECT t.slug, t.adresse, t.ejer_konto_id AS konto_id, k.tilmelding_ms
       FROM flaade.tenant t
       JOIN konto k ON k.id = t.ejer_konto_id AND k.slettet_ved IS NULL
       JOIN abonnement.rettigheder r ON r.konto_id = t.ejer_konto_id AND r.kilde = 'gave'
      WHERE t.tilstand = 'klar' AND t.adresse IS NOT NULL
        AND EXISTS (SELECT 1 FROM beta.invitation i WHERE i.brugt_af = t.ejer_konto_id)
      ORDER BY t.id`);
  return r.map((x) => ({ slug: x.slug, adresse: x.adresse, kontoId: Number(x.konto_id), tilmeldingMs: x.tilmelding_ms === null ? null : Number(x.tilmelding_ms) }));
}

async function gem(db: Database, t: BetaTenant, m: Maal, nu: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const fv = m.samtykke ? m.foersteVaerdi : null;
    await tx.query(
      `INSERT INTO beta.maal (konto_id, samtykke, hentet, tilmelding_ms, kilde_forbundet_ms, foerste_vaerdi_ms) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (konto_id) DO UPDATE SET samtykke = EXCLUDED.samtykke, hentet = EXCLUDED.hentet, tilmelding_ms = EXCLUDED.tilmelding_ms,
         kilde_forbundet_ms = EXCLUDED.kilde_forbundet_ms, foerste_vaerdi_ms = EXCLUDED.foerste_vaerdi_ms`,
      [t.kontoId, m.samtykke, nu.toISOString(), m.samtykke ? t.tilmeldingMs : null, fv?.kildeForbundetMs ?? null, fv?.foersteVaerdiMs ?? null]);
    // Consent withdrawn: what was shared under it goes (the tenant has stopped sending; Sky holds nothing of it).
    if (!m.samtykke) await tx.query('DELETE FROM beta.dagtal WHERE konto_id = $1', [t.kontoId]);
    for (const r of m.dage) {
      await tx.query('INSERT INTO beta.dagtal (konto_id, dag, kraever) VALUES ($1, $2, $3) ON CONFLICT (konto_id, dag) DO UPDATE SET kraever = EXCLUDED.kraever', [t.kontoId, r.dag, r.kraever]);
    }
    // An answer is sent once; the first one for a day stands.
    for (const s of m.feedback) {
      await tx.query('INSERT INTO beta.feedback (konto_id, dag, vurdering, tekst, betale, tid) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (konto_id, dag) DO NOTHING',
        [t.kontoId, s.dag, s.vurdering, s.tekst, s.betale, s.tid.toISOString()]);
    }
  });
}

/** One pass over the klar beta tenants, one at a time. Never throws for a tenant: it is counted and the pass goes on. */
export async function hentMaal(d: HentDeps, nu: Date): Promise<HentUdfald> {
  const log = d.log ?? ((l: string) => console.log(`sky beta: ${l}`));
  const tenanter = await betaTenanter(d.db);
  const ud: HentUdfald = { beta: tenanter.length, hentet: 0, afvist: 0, udenSvar: 0 };
  for (const t of tenanter) {
    let raa: unknown;
    try { raa = await d.hent({ slug: t.slug, adresse: t.adresse }, MAAL_STI); } catch (err) {
      ud.udenSvar++;
      log(`${t.slug} svarede ikke på målingerne: ${(err as Error).message.slice(0, 160)}`);
      continue;
    }
    const m = valider(raa);
    if (!m) {
      ud.afvist++;
      log(`${t.slug}: svaret på målingerne passer ikke til skemaet og er afvist (intet gemt)`);
      continue;
    }
    try { await gem(d.db, t, m, nu); ud.hentet++; } catch (err) {
      ud.udenSvar++;
      log(`${t.slug}: målingerne kunne ikke gemmes: ${(err as Error).message.slice(0, 160)}`);
    }
  }
  if (ud.beta > 0) log(`målinger hentet fra ${ud.hentet} af ${ud.beta} beta-husstande (afvist ${ud.afvist}, uden svar ${ud.udenSvar})`);
  return ud;
}

/** The daily job: a pass at start, then a check every 30 minutes that pulls once per UTC day (idempotent, so a restart
 *  costs one extra pull). A pass with no beta household is one query. The loop never dies of a failed pass. */
export function hentLoekke(
  d: HentDeps,
  o: { nu?: () => Date; interval?: number; saetInterval?: (fn: () => void, ms: number) => () => void } = {},
): { foerste: Promise<void>; vent(): Promise<void>; stop(): void } {
  const nu = o.nu ?? (() => new Date());
  const log = d.log ?? ((l: string) => console.log(`sky beta: ${l}`));
  let igang: Promise<void> | null = null;
  let sidsteDag = '';
  const pass = (): Promise<void> => {
    if (igang) return igang;
    const dag = nu().toISOString().slice(0, 10);
    if (dag === sidsteDag) return Promise.resolve();
    igang = (async () => {
      try { await hentMaal(d, nu()); sidsteDag = dag; } catch (err) { log(`målingerne kunne ikke hentes: ${(err as Error).message}`); } finally { igang = null; }
    })();
    return igang;
  };
  const saet = o.saetInterval ?? ((fn, ms) => { const h = setInterval(fn, ms); h.unref(); return () => clearInterval(h); });
  const foerste = pass();
  const stop = saet(() => { void pass(); }, o.interval ?? TJEK_MS);
  return { foerste, vent: async () => { await igang; }, stop };
}
