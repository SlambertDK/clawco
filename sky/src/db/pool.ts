// The Database seam: real `pg` in production, PGlite in tests (sky/test/pglite.ts), the same SQL in both.
// Only db/ and the code it is handed to touch the database; nothing here knows about Sky's modules.
import pg from 'pg';

export type Raekke = Record<string, unknown>;

export interface Database {
  /** One statement, with $1.. parameters. */
  query<R extends Raekke = Raekke>(sql: string, params?: unknown[]): Promise<R[]>;
  /** A script of several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Runs fn inside BEGIN/COMMIT on one connection; any throw rolls back. Nested calls join the outer one. */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Forbindelse = pg.Pool | pg.PoolClient;

function omkring(f: Forbindelse, transaction: Database['transaction'], close: () => Promise<void>): Database {
  return {
    async query<R extends Raekke = Raekke>(sql: string, params: unknown[] = []) { return (await f.query(sql, params)).rows as R[]; },
    // Without parameters pg uses the simple protocol, which runs several statements in one call.
    async exec(sql: string) { await f.query(sql); },
    transaction,
    close,
  };
}

export function pgDatabase(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  // An idle client losing its connection must not crash the process; /health reports the database instead.
  pool.on('error', (err) => { console.error('sky db: forbindelse tabt:', err.message); });
  return omkring(pool, async (fn) => {
    const c = await pool.connect();
    let oedelagt = false;
    try {
      await c.query('BEGIN');
      const tx: Database = omkring(c, async (fn2) => fn2(tx), async () => {});
      const r = await fn(tx);
      await c.query('COMMIT');
      return r;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => { oedelagt = true; });
      throw err;
    } finally {
      c.release(oedelagt);
    }
  }, async () => { await pool.end(); });
}
