// KC-0185: Sky's database dump. pg_dump/pg_restore get the connection through PG* environment variables built
// from SKY_DATABASE_URL — never a password in argv (ps shows argv) — and a restore only ever goes into another,
// named database, never Sky's own. A fake runner stands in for the binaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgDump, pgMiljoe, type KoerselMedMiljoe } from '../../../src/drift/backup/pgdump.ts';

function falsk(svar: (argv: string[]) => { kode: number; ud: Buffer; fejl: string }) {
  const kald: { argv: string[]; input: Buffer | null; env: Record<string, string> }[] = [];
  const koer: KoerselMedMiljoe = async (argv, input, env) => { kald.push({ argv, input: input ?? null, env: env ?? {} }); return svar(argv); };
  return { kald, koer };
}

test('the connection goes into PG* variables: a socket URL and a TCP URL with a password', () => {
  assert.deepEqual(pgMiljoe('postgres:///sky?host=/var/run/postgresql&port=5433'), { PGDATABASE: 'sky', PGHOST: '/var/run/postgresql', PGPORT: '5433' });
  assert.deepEqual(pgMiljoe('postgresql://sky:hemmelig%40kode@127.0.0.1:5432/sky_dev'), { PGDATABASE: 'sky_dev', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'sky', PGPASSWORD: 'hemmelig@kode' });
});

test('dump runs pg_dump in custom format with no connection data in argv', async () => {
  const f = falsk(() => ({ kode: 0, ud: Buffer.from('PGDMP...'), fejl: '' }));
  const d = pgDump({ databaseUrl: 'postgresql://sky:hemmelig@127.0.0.1:5432/sky', koer: f.koer });
  assert.deepEqual(await d.dump(), Buffer.from('PGDMP...'));
  assert.deepEqual(f.kald[0]!.argv, ['pg_dump', '--format=custom', '--no-owner', '--no-privileges']);
  assert.equal(f.kald[0]!.env['PGPASSWORD'], 'hemmelig');
  assert.ok(!f.kald[0]!.argv.join(' ').includes('hemmelig'));
});

test('a failing pg_dump throws with its exit code and short message', async () => {
  const f = falsk(() => ({ kode: 1, ud: Buffer.alloc(0), fejl: 'pg_dump: error: connection failed\n' }));
  await assert.rejects(pgDump({ databaseUrl: 'postgres:///sky', koer: f.koer }).dump(), /pg_dump fejlede \(1\): pg_dump: error: connection failed/);
  const tom = falsk(() => ({ kode: 0, ud: Buffer.alloc(0), fejl: '' }));
  await assert.rejects(pgDump({ databaseUrl: 'postgres:///sky', koer: tom.koer }).dump(), /tomt/);
});

test('tjek reads the archive with pg_restore --list from stdin and counts its entries', async () => {
  const f = falsk(() => ({ kode: 0, ud: Buffer.from(';\n; Archive created\n;\n215; 1259 16390 TABLE public konto sky\n216; 1259 16391 TABLE public session sky\n'), fejl: '' }));
  assert.equal(await pgDump({ databaseUrl: 'postgres:///sky', koer: f.koer }).tjek(Buffer.from('PGDMP')), 2);
  assert.deepEqual(f.kald[0]!.argv, ['pg_restore', '--list']);
  assert.deepEqual(f.kald[0]!.input, Buffer.from('PGDMP'));
});

test("gendan restores into another named database only — never Sky's own, never a connection string", async () => {
  const f = falsk(() => ({ kode: 0, ud: Buffer.alloc(0), fejl: '' }));
  const d = pgDump({ databaseUrl: 'postgres:///sky?host=/var/run/postgresql', koer: f.koer });
  await d.gendan(Buffer.from('PGDMP'), 'sky_proeve');
  assert.deepEqual(f.kald[0]!.argv, ['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=sky_proeve']);
  await assert.rejects(d.gendan(Buffer.from('PGDMP'), 'sky'), /Skys egen database/);
  await assert.rejects(d.gendan(Buffer.from('PGDMP'), 'host=x dbname=sky'), /ugyldigt databasenavn/);
});
