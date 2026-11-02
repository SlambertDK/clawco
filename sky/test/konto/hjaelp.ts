// Shared test setup for konto/: a migrated PGlite database, a controllable clock, and row dumps
// for "nothing secret / nothing left" assertions.
import { pgliteDatabase } from '../pglite.ts';
import { migrer } from '../../src/db/migrer.ts';
import type { Database } from '../../src/db/pool.ts';

export async function nyDb(): Promise<Database> {
  const db = await pgliteDatabase();
  await migrer(db);
  return db;
}

export type Ur = { nu: () => Date; frem(ms: number): void };

export function ur(start = '2026-10-31T10:00:00.000Z'): Ur {
  let t = new Date(start).getTime();
  return { nu: () => new Date(t), frem(ms) { t += ms; } };
}

/** Every value in every row of the account tables, as one string (for "the secret is not here"). */
export async function alleRaekker(db: Database): Promise<string> {
  const tabeller = ['konto', 'passkey', 'loginkode', 'session', 'udfordring', 'graense'];
  const ud: string[] = [];
  for (const t of tabeller) ud.push(JSON.stringify(await db.query(`SELECT * FROM ${t}`)));
  return ud.join('\n');
}

export async function antal(db: Database, tabel: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabel}`);
  return r?.n ?? 0;
}
