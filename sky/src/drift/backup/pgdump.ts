// Sky's own database in the nightly copy (KC-0185): pg_dump in custom format, read back by pg_restore. The
// connection reaches the binaries as PG* environment variables built from SKY_DATABASE_URL (argv shows in ps;
// a password must never be there). A restore goes only into another, existing, empty database named plainly —
// never Sky's own, never a connection string.
import type { DbDump } from './typer.ts';

export type KoerselMedMiljoe = (argv: string[], input?: Buffer, env?: Record<string, string>) => Promise<{ kode: number; ud: Buffer; fejl: string }>;

export function pgMiljoe(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  const env: Record<string, string> = {};
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) env['PGDATABASE'] = db;
  const host = u.searchParams.get('host') ?? (u.hostname ? decodeURIComponent(u.hostname) : '');
  if (host) env['PGHOST'] = host;
  const port = u.searchParams.get('port') ?? u.port;
  if (port) env['PGPORT'] = port;
  if (u.username) env['PGUSER'] = decodeURIComponent(u.username);
  if (u.password) env['PGPASSWORD'] = decodeURIComponent(u.password);
  return env;
}

const NAVN = /^[a-z_][a-z0-9_]{0,62}$/;

export function pgDump(o: { databaseUrl: string; koer: KoerselMedMiljoe }): DbDump {
  const env = pgMiljoe(o.databaseUrl);
  const koer = async (argv: string[], input?: Buffer): Promise<Buffer> => {
    const r = await o.koer(argv, input, env);
    if (r.kode !== 0) throw new Error(`${argv[0]} fejlede (${r.kode}): ${r.fejl.trim().split('\n')[0]!.slice(0, 200)}`);
    return r.ud;
  };
  return {
    async dump() {
      const ud = await koer(['pg_dump', '--format=custom', '--no-owner', '--no-privileges']);
      if (!ud.length) throw new Error('pg_dump gav et tomt dump');
      return ud;
    },
    async tjek(dump) {
      const ud = await koer(['pg_restore', '--list'], dump);
      return ud.toString('utf8').split('\n').filter((l) => l.trim() && !l.startsWith(';')).length;
    },
    async gendan(dump, maal) {
      if (!NAVN.test(maal)) throw new Error('ugyldigt databasenavn: kun små bogstaver, tal og _');
      if (maal === env['PGDATABASE']) throw new Error('nægter at gendanne oven i Skys egen database');
      await koer(['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${maal}`], dump);
    },
  };
}
