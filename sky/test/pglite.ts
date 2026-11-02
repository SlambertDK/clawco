// Test-only Database on PGlite (in-process Postgres): same SQL as production `pg`, no server.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Database, Raekke } from '../src/db/pool.ts';

type Forbindelse = Pick<Transaction, 'query' | 'exec'>;

function omkring(f: Forbindelse, transaction: Database['transaction'], close: () => Promise<void>): Database {
  return {
    async query<R extends Raekke = Raekke>(sql: string, params: unknown[] = []) { return (await f.query<R>(sql, params)).rows; },
    async exec(sql: string) { await f.exec(sql); },
    transaction,
    close,
  };
}

export async function pgliteDatabase(): Promise<Database> {
  const pg = await PGlite.create();
  const db: Database = omkring(pg, async (fn) => pg.transaction(async (tx) => {
    // Nested transaction calls run inside the outer one.
    const indre: Database = omkring(tx, async (fn2) => fn2(indre), async () => {});
    return fn(indre);
  }), async () => { await pg.close(); });
  return db;
}
