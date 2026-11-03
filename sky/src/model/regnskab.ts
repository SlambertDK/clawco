// KC-0264: the model ledger (model.forbrug, migration 0019). One row per call, appended after the answer has streamed:
// the tenant, the month, the model and provider, the token counts and the price in micro-USD. Never a prompt, an answer
// or any other content (the reader in forbrug.ts only ever hands over numbers). The cap is checked against the sum here.
// KC-0273: a proxied call's row is written BEFORE the provider is called, as its reservation (afregning.ts), and only
// if it fits under the cap in the same statement; it is updated once, to the settled usage, when the stream ends. A
// failed update leaves the reservation as the price: pessimistic, never a free call. (Migration 0019's header says
// rows are never updated: that held before KC-0273; the one settle update is the only exception.)
import type { Database } from '../db/pool.ts';
import { maanedFor } from './kvote.ts';
import type { Forbrug } from './priser.ts';

export type Kald = { kaldId: string; tenant: string; tid: Date; model: string; udbyder: string; forbrug: Forbrug; prisMikroUsd: number };

export async function noterKald(db: Database, k: Kald): Promise<void> {
  const f = k.forbrug;
  await db.query(
    `INSERT INTO model.forbrug (kald_id, tenant, maaned, model, udbyder, input_tokens, output_tokens, cache_laes_tokens, cache_skriv_5m_tokens, cache_skriv_1t_tokens, pris_mikro_usd, tid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [k.kaldId, k.tenant, maanedFor(k.tid), k.model, k.udbyder, f.input, f.output, f.cacheLaes, f.cacheSkriv5m, f.cacheSkriv1t, k.prisMikroUsd, k.tid.toISOString()],
  );
}

/** Writes the call's reservation row if the month's spend (in-flight reservations included) plus it fits under
 *  `loftMikroUsd`; false = it does not fit (nothing written). One statement: two calls cannot both read the old sum
 *  between a check and a write in this process's order (Postgres may still interleave two at READ COMMITTED; the
 *  route's per-tenant bound on parallel calls limits that to a few reservations). */
export async function reserverKald(db: Database, k: Kald, loftMikroUsd: number): Promise<boolean> {
  const f = k.forbrug;
  const r = await db.query(
    `INSERT INTO model.forbrug (kald_id, tenant, maaned, model, udbyder, input_tokens, output_tokens, cache_laes_tokens, cache_skriv_5m_tokens, cache_skriv_1t_tokens, pris_mikro_usd, tid)
     SELECT $1::uuid, $2::text, $3::date, $4::text, $5::text, $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::bigint, $11::bigint, $12::timestamptz
      WHERE (SELECT COALESCE(sum(pris_mikro_usd), 0) FROM model.forbrug WHERE tenant = $2::text AND maaned = $3::date) + $11::bigint <= $13::bigint
     RETURNING id`,
    [k.kaldId, k.tenant, maanedFor(k.tid), k.model, k.udbyder, f.input, f.output, f.cacheLaes, f.cacheSkriv5m, f.cacheSkriv1t, k.prisMikroUsd, k.tid.toISOString(), loftMikroUsd],
  );
  return r.length === 1;
}

/** Settles a reserved call to what it is billed. Throws when the row is not there (the reservation is then unknown). */
export async function afregnKald(db: Database, kaldId: string, f: Forbrug, prisMikroUsd: number): Promise<void> {
  const r = await db.query(
    `UPDATE model.forbrug SET input_tokens = $2, output_tokens = $3, cache_laes_tokens = $4, cache_skriv_5m_tokens = $5, cache_skriv_1t_tokens = $6, pris_mikro_usd = $7
      WHERE kald_id = $1 RETURNING id`,
    [kaldId, f.input, f.output, f.cacheLaes, f.cacheSkriv5m, f.cacheSkriv1t, prisMikroUsd],
  );
  if (r.length !== 1) throw new Error('reservationen findes ikke');
}

/** The tenant's spend so far in the UTC month of `nu`, micro-USD. */
export async function brugtIMaaned(db: Database, tenant: string, nu: Date): Promise<number> {
  const [r] = await db.query<{ s: unknown }>('SELECT COALESCE(sum(pris_mikro_usd), 0)::bigint AS s FROM model.forbrug WHERE tenant = $1 AND maaned = $2', [tenant, maanedFor(nu)]);
  return Number(r?.s ?? 0);
}

export type Dag = { dag: string; kald: number; tenanter: number; input: number; output: number; cacheLaes: number; cacheSkriv: number; mikroUsd: number };

/** The owner's view (KC-0264): every call from `fra` up to (not including) `til`, summed per UTC day. Numbers only. */
export async function dagligt(db: Database, fra: Date, til: Date): Promise<Dag[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT to_char((tid AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS dag, count(*)::bigint AS kald, count(DISTINCT tenant)::bigint AS tenanter,
            sum(input_tokens)::bigint AS input, sum(output_tokens)::bigint AS output, sum(cache_laes_tokens)::bigint AS cache_laes,
            sum(cache_skriv_5m_tokens + cache_skriv_1t_tokens)::bigint AS cache_skriv, sum(pris_mikro_usd)::bigint AS mikro
       FROM model.forbrug WHERE tid >= $1 AND tid < $2 GROUP BY 1 ORDER BY 1`,
    [fra.toISOString(), til.toISOString()],
  );
  return rows.map((r) => ({ dag: String(r['dag']), kald: Number(r['kald']), tenanter: Number(r['tenanter']), input: Number(r['input']), output: Number(r['output']), cacheLaes: Number(r['cache_laes']), cacheSkriv: Number(r['cache_skriv']), mikroUsd: Number(r['mikro']) }));
}
