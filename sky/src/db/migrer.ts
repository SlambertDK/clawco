// Forward-only migrations: sky/src/db/migrations/NNNN-<slug>.sql, numbered 1..n without gaps,
// applied at start in one transaction under a Postgres advisory lock and recorded in schema_version.
// Two processes starting at once: the second waits for the lock, then finds everything applied.
// A destructive migration (drop, delete, narrowing a type) needs Henrik's explicit yes (AGENTS §0 r1)
// and says so in its header comment.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './pool.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** Fixed advisory lock key for Sky's migrations (any constant; only Sky uses this database). */
const LAAS = 1_766_176;
const NAVN = /^(\d{4})-[a-z0-9-]+\.sql$/;

export type MigreretResultat = { anvendt: number[]; version: number };

async function laesFiler(dir: string): Promise<string[]> {
  const filer = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  filer.forEach((f, i) => {
    const m = NAVN.exec(f);
    if (!m) throw new Error(`ugyldigt migrationsnavn: ${f} (skal være NNNN-navn.sql)`);
    const nr = Number(m[1]);
    if (nr < i + 1) throw new Error(`to migrationer har nummer ${m[1]}`);
    if (nr > i + 1) throw new Error(`migration ${String(i + 1).padStart(4, '0')} mangler`);
  });
  return filer;
}

export async function migrer(db: Database, dir: string = MIGRATIONS_DIR): Promise<MigreretResultat> {
  const filer = await laesFiler(dir);
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LAAS]);
    const [tabel] = await tx.query<{ t: string | null }>("SELECT to_regclass('schema_version')::text AS t");
    const anvendte = new Set(tabel?.t ? (await tx.query<{ version: number }>('SELECT version FROM schema_version')).map((r) => r.version) : []);
    const hoejeste = Math.max(0, ...anvendte);
    if (hoejeste > filer.length) throw new Error(`databasen er nyere end koden (version ${hoejeste}, koden kender ${filer.length}) — Sky starter ikke`);
    const anvendt: number[] = [];
    for (const [i, f] of filer.entries()) {
      const version = i + 1;
      if (anvendte.has(version)) continue;
      await tx.exec(await fs.readFile(path.join(dir, f), 'utf8'));
      await tx.query('INSERT INTO schema_version (version, navn) VALUES ($1, $2)', [version, f]);
      anvendt.push(version);
    }
    return { anvendt, version: filer.length };
  });
}
