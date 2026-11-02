// The closed beta's invitation tool (KC-0203). Run on the server (through the root wrapper `npm run beta:invitation`):
//   --antal N [--gyldig-dage D]   N single-use codes (1-50, valid 60 days by default), printed once, one per line
//   --annuller <kode>             revoke one unused code
//   --annuller-alle               revoke every unused code
//   --forlaeng-til YYYY-MM-DD     the beta-end notice: move every beta gift's end to that date (at least 30 days from
//                                 now; never earlier than a gift already has)
// stdout carries the codes (or the one-line result) and nothing else. A code is a credential: the database stores only
// its hash, and no code is ever written to a log, a ticket or a second place by this tool.
import type { Database } from '../src/db/pool.ts';
import type { Priser } from '../src/abonnement/priser.ts';
import { annuller, annullerAlle, forlaengGaver, lavInvitationer } from '../src/beta/invitationer.ts';
import { betaGaver } from '../src/betaforbind.ts';

const BRUG = 'brug: beta-invitation.ts --antal N [--gyldig-dage D] | --annuller <kode> | --annuller-alle | --forlaeng-til YYYY-MM-DD';
export type Udfald = { kode: number; ud: string[]; fejl: string[] };
const fejl = (kode: number, ...f: string[]): Udfald => ({ kode, ud: [], fejl: f });
const HEL = /^\d+$/;

export async function koerInvitation(db: Database, args: string[], nu: Date, priser: Priser): Promise<Udfald> {
  const [flag, vaerdi, ...rest] = args;
  if (flag === '--antal') {
    if (vaerdi === undefined || !HEL.test(vaerdi) || Number(vaerdi) < 1 || Number(vaerdi) > 50) return fejl(2, 'antal skal være et helt tal fra 1 til 50', BRUG);
    let dage: number | undefined;
    if (rest.length) {
      if (rest[0] !== '--gyldig-dage' || rest[1] === undefined || !HEL.test(rest[1]) || Number(rest[1]) < 1 || Number(rest[1]) > 365 || rest.length > 2) return fejl(2, 'gyldighed skal være 1 til 365 dage', BRUG);
      dage = Number(rest[1]);
    }
    const koder = await lavInvitationer(db, Number(vaerdi), nu, dage);
    return { kode: 0, ud: koder, fejl: ['Kodene vises kun denne ene gang; Clawco gemmer kun et aftryk af dem.'] };
  }
  if (flag === '--annuller' && vaerdi !== undefined && rest.length === 0) {
    return (await annuller(db, vaerdi, nu)) ? { kode: 0, ud: ['koden er annulleret'], fejl: [] } : fejl(1, 'koden findes ikke, er allerede brugt eller allerede annulleret');
  }
  if (flag === '--annuller-alle' && vaerdi === undefined) return { kode: 0, ud: [`${await annullerAlle(db, nu)} ubrugte koder er annulleret`], fejl: [] };
  if (flag === '--forlaeng-til' && vaerdi !== undefined && rest.length === 0) {
    const gyldig = /^\d{4}-\d{2}-\d{2}$/.test(vaerdi) && new Date(`${vaerdi}T00:00:00Z`).toISOString().startsWith(vaerdi);
    if (!gyldig) return fejl(2, 'datoen skal være på formen ÅÅÅÅ-MM-DD', BRUG);
    const til = new Date(`${vaerdi}T00:00:00Z`);
    if (til.getTime() < nu.getTime() + 30 * 86_400_000) return fejl(1, 'slutdatoen skal ligge mindst 30 dage ude i fremtiden, så ingen bliver afbrudt uden varsel');
    return { kode: 0, ud: [`${await forlaengGaver({ db, gaver: betaGaver(priser) }, til, nu)} beta-gaver slutter nu tidligst ${vaerdi}`], fejl: [] };
  }
  return fejl(2, BRUG);
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { laesPriser } = await import('../src/abonnement/priser.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    const r = await koerInvitation(db, process.argv.slice(2), new Date(), laesPriser());
    for (const l of r.fejl) console.error(l);
    for (const l of r.ud) console.log(l);
    process.exitCode = r.kode;
  } finally { await db.close(); }
}
