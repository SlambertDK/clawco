// The first hour's "cut the access" step (KC-0230, docs/beredskab/README.md step 3): ends every live session and every
// unused login link, of one account or of all, so a stolen cookie or link stops working at once. Run on the Sky host
// as `sky` (it needs no root, so Claude can run it over ssh while the owner is away from the terminal):
//   node --env-file=/srv/sky/.env sky/scripts/afbryd-sessioner.ts --konto <id>
//   node --env-file=/srv/sky/.env sky/scripts/afbryd-sessioner.ts --alle
// Ends, never deletes: a session's and a link's expiry is set to now, which is exactly what both lookups check
// (hentSession, the gateway's sessionLever, findLink and bekraeftLink all require udloeber > now), and the rows stay as the
// evidence the runbook asks us to keep. Passkeys are not touched (only their public half is held here). It prints counts
// and the account number only, never an address. Exit 0 done, 1 unknown account, 2 usage.
import type { Database } from '../src/db/pool.ts';

const BRUG = 'brug: afbryd-sessioner.ts --konto <id> | --alle';

export type Afbrudt = { sessioner: number; loginkoder: number };

/** Ends the live sessions and unused login links of `kontoId`, or of everyone when it is left out. */
export async function afbrydSessioner(db: Database, o: { kontoId?: number; nu: Date }): Promise<Afbrudt> {
  const nu = o.nu.toISOString();
  return db.transaction(async (tx) => {
    const enKonto = o.kontoId !== undefined;
    const sessioner = await tx.query(
      `UPDATE session SET udloeber = $1 WHERE udloeber > $1${enKonto ? ' AND konto_id = $2' : ''} RETURNING id`,
      enKonto ? [nu, o.kontoId] : [nu],
    );
    // A login link belongs to an address, not to an account id (the person may not have an account yet).
    const loginkoder = await tx.query(
      `UPDATE loginkode SET udloeber = $1 WHERE brugt IS NULL AND udloeber > $1${enKonto ? ' AND email = (SELECT email FROM konto WHERE id = $2)' : ''} RETURNING hash`,
      enKonto ? [nu, o.kontoId] : [nu],
    );
    return { sessioner: sessioner.length, loginkoder: loginkoder.length };
  });
}

export async function kommando(argv: string[], db: Database, nu: Date, ud: (linje: string) => void): Promise<number> {
  const alle = argv.length === 1 && argv[0] === '--alle';
  const konto = argv.length === 2 && argv[0] === '--konto' && /^[1-9]\d{0,15}$/.test(argv[1]!) ? Number(argv[1]) : null;
  if (!alle && konto === null) { ud(BRUG); return 2; }
  if (konto !== null) {
    const [k] = await db.query('SELECT 1 FROM konto WHERE id = $1', [konto]);
    if (!k) { ud(`kontoen findes ikke: ${konto}`); return 1; }
  }
  const r = await afbrydSessioner(db, { ...(konto !== null ? { kontoId: konto } : {}), nu });
  ud(`${konto !== null ? `konto ${konto}` : 'alle konti'}: ${r.sessioner} sessioner og ${r.loginkoder} login-link afbrudt (rækkerne er bevaret som bevis)`);
  return 0;
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    process.exitCode = await kommando(process.argv.slice(2), db, new Date(), (l) => console.log(l));
  } finally { await db.close(); }
}
