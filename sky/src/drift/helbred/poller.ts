// The health poller (KC-0189, spec §2 `drift/`): every minute Sky asks each klar tenant's /health over the private
// network — the address on the tenant row, the way the rollout and provisioning ask (fleet/provisioner.ts hentSundhed,
// handed in as `sundhed`), never through the public gateway and never any other tenant route. Bounded parallel: a
// pool of `parallel` workers, each call with its own timeout, so a hung tenant holds one slot until its timeout and
// never blocks the others. Each pass judges the components too, stores everything under one time, and hands the
// unbroken syg streaks to KC-0187's rule `tenant-usund` (the alert logic stays in drift/alarm.ts).
import type { Database } from '../../db/pool.ts';
import type { Fejlrapport } from '../../delt/fejlrapport-kerne.ts';
import { aktiveTrin } from '../udrulning/tilstand.ts';
import { gemPass, rydOp, type Maaling } from './historik.ts';
import { maalKomponenter, type KomponentDeps, type KomponentId } from './komponenter.ts';
import { sygeSiden, taelOp, vurder, type Antal, type Status } from './vurder.ts';

export type { Maaling };

export const POLL_MS = 60_000;
export const TIMEOUT_MS = 3_000;
export const PARALLEL = 8;

export type Maal = { slug: string; adresse: string | null; forventetSha: string | null };
type SundhedsKald = (adresse: string) => Promise<{ ok: boolean; sha: string | null }>;

/** Calls `fn` with a timeout of its own; null on timeout or failure. The timer never keeps the process alive. */
async function medFrist<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  let t: NodeJS.Timeout | undefined;
  const frist = new Promise<null>((r) => { t = setTimeout(() => r(null), ms); t.unref(); });
  try {
    return await Promise.race([fn().catch(() => null), frist]);
  } finally {
    clearTimeout(t);
  }
}

/** Measures every tenant, at most `parallel` at once, results in input order. A tenant without an address cannot be
 *  reached at all: syg, without a call. */
export async function maalAlle(maal: Maal[], o: { sundhed: SundhedsKald; opdaterer: ReadonlySet<string>; tid: Date; timeoutMs?: number; parallel?: number; ur?: () => number }): Promise<Maaling[]> {
  const ur = o.ur ?? (() => performance.now());
  const ud: Maaling[] = new Array<Maaling>(maal.length);
  let naeste = 0;
  const arbejder = async (): Promise<void> => {
    while (naeste < maal.length) {
      const i = naeste++;
      const m = maal[i]!;
      const start = ur();
      const svar = m.adresse ? await medFrist(() => o.sundhed(m.adresse!), o.timeoutMs ?? TIMEOUT_MS) : null;
      const ms = svar ? Math.max(0, ur() - start) : null;
      ud[i] = {
        slug: m.slug, tid: o.tid, ok: svar?.ok === true, ms, sha: svar?.sha ?? null,
        tilstand: vurder(svar ? { ok: svar.ok, sha: svar.sha, ms: ms! } : null, m.forventetSha, o.opdaterer.has(m.slug)),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.parallel ?? PARALLEL, maal.length) }, arbejder));
  return ud;
}

export type PollerDeps = {
  db: Database;
  /** The klar tenants with their private address and the sha they should report (fleet/tilstand.ts klareTilUdrulning). */
  tenanter(): Promise<{ slug: string; adresse: string | null; release: string | null }[]>;
  sundhed: SundhedsKald;
  komponenter: KomponentDeps;
  /** KC-0187: every tenant syg without a break, since when (the rule fires after five minutes; an empty list clears). */
  usunde?(liste: { slug: string; siden: Date }[], nu: Date): Promise<void>;
  nu(): Date;
  log?(linje: string): void;
  timeoutMs?: number;
  parallel?: number;
};

export type Pas = { tid: Date; antal: Antal; komponenter: Record<KomponentId, Status> };

export function poller(d: PollerDeps): { gennemloeb(): Promise<Pas> } {
  const log = d.log ?? ((l: string) => { console.log(l); });
  let syge = new Map<string, Date>();
  return {
    async gennemloeb() {
      const tid = d.nu();
      const [liste, opdaterer] = await Promise.all([d.tenanter(), aktiveTrin(d.db)]);
      const maalinger = await maalAlle(liste.map((t) => ({ slug: t.slug, adresse: t.adresse, forventetSha: t.release })), {
        sundhed: d.sundhed, opdaterer, tid, ...(d.timeoutMs ? { timeoutMs: d.timeoutMs } : {}), ...(d.parallel ? { parallel: d.parallel } : {}),
      });
      const antal = taelOp(maalinger.map((m) => m.tilstand));
      const komponenter = await maalKomponenter(d.komponenter, antal, tid);
      await gemPass(d.db, tid, maalinger, komponenter);
      syge = sygeSiden(syge, maalinger, tid);
      if (d.usunde) {
        try { await d.usunde([...syge].map(([slug, siden]) => ({ slug, siden })), tid); } catch {
          log('sky helbred: alarmreglen kunne ikke vurderes i dette gennemløb');
        }
      }
      return { tid, antal, komponenter };
    },
  };
}

/** Every `interval` ms one pass (a pass still running when the next is due is joined, never doubled), and once per
 *  UTC day the history clean-up (historik.ts rydOp). A failing pass is reported and logged, never thrown. */
export function pollerLoekke(d: PollerDeps & { interval?: number; rapport?: Fejlrapport }): { stop(): void; gennemloeb(): Promise<void> } {
  const log = d.log ?? ((l: string) => { console.log(l); });
  const p = poller(d);
  let igang: Promise<void> | null = null;
  let ryddet: string | null = null;
  const koer = async (): Promise<void> => {
    try {
      await p.gennemloeb();
    } catch (err) {
      d.rapport?.rapporter(err, { alarm: 'helbred-gennemloeb' });
      log('sky helbred: et gennemløb fejlede (statussiden viser nedsat, når data bliver gamle)');
    }
    const dag = d.nu().toISOString().slice(0, 10);
    if (ryddet === dag) return;
    try {
      await rydOp(d.db, d.nu(), log);
      ryddet = dag;
    } catch (err) {
      d.rapport?.rapporter(err, { alarm: 'helbred-oprydning' });
      log('sky helbred: den daglige oprydning fejlede, prøver igen ved næste gennemløb');
    }
  };
  const gennemloeb = (): Promise<void> => {
    igang ??= koer().finally(() => { igang = null; });
    return igang;
  };
  void gennemloeb();
  const t = setInterval(() => { void gennemloeb(); }, d.interval ?? POLL_MS);
  t.unref();
  return { stop: () => { clearInterval(t); }, gennemloeb };
}
