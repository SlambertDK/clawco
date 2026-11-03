// Makes an existing account staff (KC-0177 rule, used by KC-0188). The only way to create staff:
// never by sign-up. The person signs up as usual, adds a passkey, then an operator runs on the server
//   node --env-file=/srv/sky/.env sky/scripts/goer-personale.ts <email> [--alle]
// From then on that account logs in by passkey only (no mail link), and every passkey it has is a staff login. So
// (KC-0272) the script names each passkey it promotes, and refuses an account with more than one unless --alle: check
// the list on the account's passkey page, remove a device you do not know, then run it again.
// Exit 0 done, 1 refused (unknown account, no passkey, more than one without --alle), 2 usage.
import type { Database } from '../src/db/pool.ts';
import { goerPersonale, normaliserEmail } from '../src/konto/konto.ts';

const BRUG = 'brug: goer-personale.ts <email> [--alle]';

export async function kommando(argv: string[], db: Database, ud: (linje: string) => void): Promise<number> {
  const [adresse, flag, ...resten] = argv;
  const email = normaliserEmail(adresse);
  if (!email || resten.length || (flag !== undefined && flag !== '--alle')) { ud(BRUG); return 2; }
  const r = await goerPersonale(db, email, { alle: flag === '--alle' });
  for (const p of r.passkeys) ud(`  passkey ${p.id} "${p.navn.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')}" (tilføjet ${p.oprettet.toISOString().slice(0, 10)})`);
  const tekst = {
    ok: 'er nu personale (kun passkey); passkeys ovenfor er nu personale-login',
    ukendt: 'findes ikke',
    'ingen-passkey': 'har ingen passkey endnu; tilføj en først',
    'flere-passkeys': `har ${r.passkeys.length} passkeys, som alle ville blive personale-login; tjek dem, fjern ukendte, eller kør igen med --alle`,
  }[r.udfald];
  ud(`${email} ${tekst}`);
  return r.udfald === 'ok' ? 0 : 1;
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    process.exitCode = await kommando(process.argv.slice(2), db, (l) => console.log(l));
  } finally { await db.close(); }
}
