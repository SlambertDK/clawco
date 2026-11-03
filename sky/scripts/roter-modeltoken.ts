// KC-0264: rotate one tenant's model token and deliver the new one to its running container at once:
//   node --env-file=/srv/sky/.env sky/scripts/roter-modeltoken.ts <slug>
// The old token stops working when the new one is stored; a stopped tenant gets the new one at its next start (the
// reconciler delivers after every start). Prints what happened, never a token.
import type { Database } from '../src/db/pool.ts';
import type { KoerselMedInput } from '../src/hemmeligheder/levering.ts';
import type { Noeglering } from '../src/hemmeligheder/masternoegle.ts';
import { leverModelToken, roterModelToken } from '../src/hemmeligheder/modeltoken.ts';

export async function roterOgLever(d: { db: Database; ring: Noeglering; koer: KoerselMedInput; beholder(slug: string): Promise<{ container: string } | null>; nu: Date }, slug: string): Promise<string> {
  const token = await roterModelToken(d.db, d.ring, slug, d.nu);
  const b = await d.beholder(slug);
  if (!b) return `${slug}: ny modelnøgle gemt; beholderen kører ikke, så den får nøglen ved næste start`;
  await leverModelToken({ koer: d.koer, container: b.container, token });
  return `${slug}: ny modelnøgle gemt og leveret til ${b.container}`;
}

if (import.meta.main) {
  const slug = process.argv[2] ?? '';
  if (!/^hus-[a-z2-7]{8}$/.test(slug)) { console.error('brug: roter-modeltoken.ts <slug>'); process.exit(2); }
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { laesMasternoegle } = await import('../src/hemmeligheder/masternoegle.ts');
  const { koerMedInput } = await import('../src/hemmeligheder/levering.ts');
  const { flaadeFra } = await import('../src/server.ts');
  const config = laesConfig(process.env);
  const db = pgDatabase(config.databaseUrl);
  try {
    const flaade = flaadeFra(config, db);
    console.log(await roterOgLever({ db, ring: laesMasternoegle(process.env), koer: koerMedInput, beholder: async (s) => (flaade ? flaade.beholder(s) : null), nu: new Date() }, slug));
  } finally { await db.close(); }
}
