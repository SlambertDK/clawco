// Master key rotation 2/3 (KC-0181): re-wraps every tenant's data key under the current master key in
// one transaction (see sky/src/hemmeligheder/tenantnoegle.ts). Run on the Sky host after
// `ny-masternoegle.sh --roter` and a restart:
//   node --env-file=/srv/sky/.env sky/scripts/roter-masternoegle.ts
// Prints counts only. When it reports 0 left, run `ny-masternoegle.sh --afslut` and restart Sky.
import { laesConfig } from '../src/config.ts';
import { pgDatabase } from '../src/db/pool.ts';
import { laesMasternoegle } from '../src/hemmeligheder/masternoegle.ts';
import { paaAeldreVersion, roterMasternoegle } from '../src/hemmeligheder/tenantnoegle.ts';

const db = pgDatabase(laesConfig(process.env).databaseUrl);
const ring = laesMasternoegle(process.env);
try {
  const r = await roterMasternoegle(db, ring, new Date());
  const tilbage = await paaAeldreVersion(db, r.version);
  console.log(`${r.omkuverteret} nøgler omkuverteret til version ${r.version}; ${tilbage} tilbage på en ældre version`);
  if (tilbage === 0 && ring.forrige) console.log('Færdig: kør sky/scripts/ny-masternoegle.sh --afslut og genstart Sky.');
  process.exitCode = tilbage === 0 ? 0 : 1;
} finally {
  await db.close();
}
