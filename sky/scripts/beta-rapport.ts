// The beta report (KC-0203), run on the server through the root wrapper `npm run beta:rapport [-- --json]`: the three
// measures, the feedback and the draft end criteria (a)-(d) evaluated from the numbers (e) and (f) left for a human.
// Plain Danish, one fact per line; --json prints the same as one JSON object. Reads only; changes nothing.
import type { Database } from '../src/db/pool.ts';
import { laesHusstande, lavRapport, rapportTekst, type Rapport } from '../src/beta/rapport.ts';

export async function betaRapport(db: Database, nu: Date): Promise<Rapport> {
  return lavRapport(await laesHusstande(db), nu);
}

export { rapportTekst };

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--json')) { console.error('brug: beta-rapport.ts [--json]'); process.exit(2); }
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    const r = await betaRapport(db, new Date());
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else for (const l of rapportTekst(r)) console.log(l);
  } finally { await db.close(); }
}
