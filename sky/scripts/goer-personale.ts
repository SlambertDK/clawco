// Makes an existing account staff (KC-0177 rule, used by KC-0188). The only way to create staff:
// never by sign-up. The person signs up as usual, adds a passkey, then an operator runs on the server
//   node --env-file=/srv/sky/.env sky/scripts/goer-personale.ts <email>
// From then on that account logs in by passkey only (no mail link).
import { laesConfig } from '../src/config.ts';
import { pgDatabase } from '../src/db/pool.ts';
import { goerPersonale, normaliserEmail } from '../src/konto/konto.ts';

const email = normaliserEmail(process.argv[2]);
if (!email) {
  console.error('brug: goer-personale.ts <email>');
  process.exit(2);
}
const db = pgDatabase(laesConfig(process.env).databaseUrl);
try {
  const r = await goerPersonale(db, email);
  const tekst = { ok: 'er nu personale (kun passkey)', ukendt: 'findes ikke', 'ingen-passkey': 'har ingen passkey endnu; tilføj en først' }[r];
  console.log(`${email} ${tekst}`);
  process.exitCode = r === 'ok' ? 0 : 1;
} finally {
  await db.close();
}
