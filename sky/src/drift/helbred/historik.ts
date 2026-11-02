// The status feed's history (KC-0189, migration 0014): each pass's raw rows (7 days), one row per component per whole
// UTC day (90 days), and the daily clean-up that rolls and deletes — logged with its counts, never silent (AGENTS §4 r5).
// Uptime is ok passes over expected passes: a pass that never happened (Sky down) and an unknown status count against.
// Only this file writes the helbred tables (the incidents' is haendelse.ts).
import type { Database } from '../../db/pool.ts';
import type { PostResultat } from './komponenter.ts';
import { KOMPONENTER, type Antal, type KomponentId, type Status, type TenantTilstand } from './vurder.ts';

export const RAA_DAGE = 7;
export const DAG_DAGE = 90;
const DAG = 86_400_000;
const PAS_MS = 60_000;

export type Maaling = { slug: string; tid: Date; ok: boolean; ms: number | null; sha: string | null; tilstand: TenantTilstand };
export type DagTal = { ok: number; nedsat: number; nede: number; ukendt: number };

const SHA = /^[0-9a-f]{7,64}$/;

/** One pass in one transaction: a row per tenant and a row per component, all under the pass's time. */
export async function gemPass(db: Database, tid: Date, maalinger: Maaling[], komponenter: Record<KomponentId, Status>): Promise<void> {
  const t = tid.toISOString();
  await db.transaction(async (tx) => {
    for (const m of maalinger) {
      await tx.query('INSERT INTO drift.helbred_maaling (tid, tenant, tilstand, ok, ms, sha) VALUES ($1, $2, $3, $4, $5, $6)',
        [t, m.slug, m.tilstand, m.ok, m.ms === null ? null : Math.round(m.ms), m.sha && SHA.test(m.sha) ? m.sha : null]);
    }
    for (const [k, s] of Object.entries(komponenter)) await tx.query('INSERT INTO drift.helbred_komponent (tid, komponent, status) VALUES ($1, $2, $3)', [t, k, s]);
  });
}

/** The newest pass: its time, each component's status and the tenants' buckets. null before the first pass. */
export async function senestePass(db: Database): Promise<{ tid: Date; komponenter: Map<string, Status>; antal: Antal } | null> {
  const [r] = await db.query<{ tid: Date | string | null }>('SELECT max(tid) AS tid FROM drift.helbred_komponent');
  if (!r?.tid) return null;
  const tid = new Date(r.tid);
  const k = await db.query<{ komponent: string; status: Status }>('SELECT komponent, status FROM drift.helbred_komponent WHERE tid = $1', [tid.toISOString()]);
  const m = await db.query<{ tilstand: TenantTilstand; n: number }>('SELECT tilstand, count(*)::int AS n FROM drift.helbred_maaling WHERE tid = $1 GROUP BY tilstand', [tid.toISOString()]);
  const antal: Antal = { sund: 0, traeg: 0, syg: 0, opdaterer: 0 };
  for (const x of m) antal[x.tilstand] = x.n;
  return { tid, komponenter: new Map(k.map((x) => [x.komponent, x.status])), antal };
}

export async function noterPost(db: Database, r: PostResultat): Promise<void> {
  await db.query('INSERT INTO drift.helbred_post (tid, ok, kode) VALUES ($1, $2, $3)', [r.tid.toISOString(), r.ok, r.ok ? null : r.kode]);
}

export async function postSiden(db: Database, siden: Date): Promise<PostResultat[]> {
  const rows = await db.query<{ tid: Date | string; ok: boolean; kode: string | null }>('SELECT tid, ok, kode FROM drift.helbred_post WHERE tid >= $1 ORDER BY tid DESC, id DESC LIMIT 200', [siden.toISOString()]);
  return rows.map((r) => ({ tid: new Date(r.tid), ok: r.ok, kode: r.kode ?? null }));
}

/** ok over everything expected, in percent with two decimals; null with nothing expected. */
export function oppetid(dage: DagTal[]): number | null {
  let ok = 0;
  let alt = 0;
  for (const d of dage) { ok += d.ok; alt += d.ok + d.nedsat + d.nede + d.ukendt; }
  return alt ? Math.round((ok / alt) * 10_000) / 100 : null;
}

/** Passes expected on the UTC day starting at `dag`: one a minute from the first pass ever (or the day's start) until
 *  the day's end (or now). */
export function forventedePas(dag: Date, foerste: Date, nu: Date): number {
  const fra = Math.max(dag.getTime(), foerste.getTime());
  const til = Math.min(dag.getTime() + DAG, nu.getTime());
  return til > fra ? Math.floor((til - fra) / PAS_MS) : 0;
}

const dagStart = (t: Date): Date => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
const iso = (t: Date): string => t.toISOString().slice(0, 10);

/** The first pass ever recorded (raw or rolled up). */
async function foersteTid(db: Database): Promise<Date | null> {
  const [r] = await db.query<{ raa: Date | string | null; dag: Date | string | null }>(
    "SELECT (SELECT min(tid) FROM drift.helbred_komponent) AS raa, (SELECT to_char(min(dag), 'YYYY-MM-DD') FROM drift.helbred_dag) AS dag");
  const t = [r?.raa ? new Date(r.raa) : null, r?.dag ? new Date(`${String(r.dag)}T00:00:00.000Z`) : null].filter((x): x is Date => x !== null);
  return t.length ? new Date(Math.min(...t.map((x) => x.getTime()))) : null;
}

/** Passes per component and status between two times, from the raw rows. */
async function raaTal(db: Database, fra: Date, til: Date): Promise<Map<string, Omit<DagTal, 'ukendt'>>> {
  const rows = await db.query<{ komponent: string; status: Status; n: number }>(
    'SELECT komponent, status, count(*)::int AS n FROM drift.helbred_komponent WHERE tid >= $1 AND tid < $2 GROUP BY komponent, status', [fra.toISOString(), til.toISOString()]);
  const m = new Map<string, Omit<DagTal, 'ukendt'>>();
  for (const r of rows) {
    const t = m.get(r.komponent) ?? { ok: 0, nedsat: 0, nede: 0 };
    t[r.status] = r.n;
    m.set(r.komponent, t);
  }
  return m;
}

export type Oprydning = { dage: number; slettet: { maalinger: number; komponenter: number; post: number; dage: number } };

/**
 * The daily job: every whole day of the last 90 since the first pass that has no day row yet is rolled up from the
 * raw rows (a day with no pass at all becomes all unknown), then raw rows older than 7 days and day rows older than
 * 90 days are deleted. Rolling comes first, so a day is always rolled while all its raw rows exist. Idempotent.
 */
export async function rydOp(db: Database, nu: Date, log: (linje: string) => void): Promise<Oprydning> {
  const idag = dagStart(nu);
  const foerste = await foersteTid(db);
  let dage = 0;
  if (foerste) {
    const fra = new Date(Math.max(dagStart(foerste).getTime(), idag.getTime() - (DAG_DAGE - 1) * DAG));
    const findes = new Set((await db.query<{ k: string }>("SELECT to_char(dag, 'YYYY-MM-DD') || ' ' || komponent AS k FROM drift.helbred_dag WHERE dag >= $1", [iso(fra)])).map((r) => r.k));
    for (let d = fra; d < idag; d = new Date(d.getTime() + DAG)) {
      const mangler = KOMPONENTER.filter((k) => !findes.has(`${iso(d)} ${k}`));
      if (!mangler.length) continue;
      const tal = await raaTal(db, d, new Date(d.getTime() + DAG));
      const forventet = forventedePas(d, foerste, nu);
      for (const k of mangler) {
        const t = tal.get(k) ?? { ok: 0, nedsat: 0, nede: 0 };
        const ukendt = Math.max(0, forventet - (t.ok + t.nedsat + t.nede));
        await db.query('INSERT INTO drift.helbred_dag (dag, komponent, ok, nedsat, nede, ukendt) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', [iso(d), k, t.ok, t.nedsat, t.nede, ukendt]);
      }
      dage++;
    }
  }
  const raaGraense = new Date(nu.getTime() - RAA_DAGE * DAG).toISOString();
  const antalSlettet = async (sql: string, p: unknown[]) => (await db.query(`${sql} RETURNING 1`, p)).length;
  const slettet = {
    maalinger: await antalSlettet('DELETE FROM drift.helbred_maaling WHERE tid < $1', [raaGraense]),
    komponenter: await antalSlettet('DELETE FROM drift.helbred_komponent WHERE tid < $1', [raaGraense]),
    post: await antalSlettet('DELETE FROM drift.helbred_post WHERE tid < $1', [raaGraense]),
    dage: await antalSlettet('DELETE FROM drift.helbred_dag WHERE dag < $1', [iso(new Date(idag.getTime() - DAG_DAGE * DAG))]),
  };
  log(`sky helbred: oprullet ${dage} dage; slettet ${slettet.maalinger} målinger, ${slettet.komponenter} komponentrækker, ${slettet.post} postresultater, ${slettet.dage} dagsrækker`);
  return { dage, slettet };
}

/** The 90-day window's numbers: the rolled day rows (the 89 whole days before today) and today live from the raw rows. */
async function dageOgIdag(db: Database, nu: Date): Promise<{ idag: Date; rows: { dag: string; komponent: string; tal: DagTal }[]; idagTal: Map<KomponentId, DagTal> }> {
  const idag = dagStart(nu);
  const rows = await db.query<{ dag: string; komponent: string; ok: number; nedsat: number; nede: number; ukendt: number }>(
    "SELECT to_char(dag, 'YYYY-MM-DD') AS dag, komponent, ok, nedsat, nede, ukendt FROM drift.helbred_dag WHERE dag >= $1 AND dag < $2", [iso(new Date(idag.getTime() - (DAG_DAGE - 1) * DAG)), iso(idag)]);
  const foerste = await foersteTid(db);
  const tal = await raaTal(db, idag, nu);
  const forventet = foerste ? forventedePas(idag, foerste, nu) : 0;
  const idagTal = new Map<KomponentId, DagTal>();
  for (const k of KOMPONENTER) {
    const t = tal.get(k) ?? { ok: 0, nedsat: 0, nede: 0 };
    idagTal.set(k, { ...t, ukendt: Math.max(0, forventet - (t.ok + t.nedsat + t.nede)) });
  }
  return { idag, rows: rows.map((r) => ({ dag: r.dag, komponent: r.komponent, tal: { ok: r.ok, nedsat: r.nedsat, nede: r.nede, ukendt: r.ukendt } })), idagTal };
}

/** Each component's uptime over the last 90 days (today included, live from the raw rows); null without data. */
export async function oppetid90(db: Database, nu: Date): Promise<Record<KomponentId, number | null>> {
  const { rows, idagTal } = await dageOgIdag(db, nu);
  const ud = {} as Record<KomponentId, number | null>;
  for (const k of KOMPONENTER) ud[k] = oppetid([...rows.filter((r) => r.komponent === k).map((r) => r.tal), idagTal.get(k)!]);
  return ud;
}

/** Each component's last 90 days, one entry per UTC day, oldest first, ending today: that day's uptime, or null for a day
 *  with no row (never a made-up 100). Dates and percentages only. */
export async function dage90(db: Database, nu: Date): Promise<Record<KomponentId, { dag: string; oppetid: number | null }[]>> {
  const { idag, rows, idagTal } = await dageOgIdag(db, nu);
  const perDag = new Map(rows.map((r) => [`${r.dag} ${r.komponent}`, r.tal]));
  const ud = {} as Record<KomponentId, { dag: string; oppetid: number | null }[]>;
  for (const k of KOMPONENTER) {
    ud[k] = [];
    for (let i = DAG_DAGE - 1; i >= 0; i--) {
      const dag = iso(new Date(idag.getTime() - i * DAG));
      const t = i === 0 ? idagTal.get(k)! : perDag.get(`${dag} ${k}`);
      ud[k].push({ dag, oppetid: t ? oppetid([t]) : null });
    }
  }
  return ud;
}
