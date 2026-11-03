// KC-0264: the owner's view of what the included model costs Clawco, from the ledger (model.forbrug): calls, households,
// tokens and USD per UTC day, and the month so far. Numbers only, no tenant named. Reads; changes nothing.
//   node --env-file=/srv/sky/.env sky/scripts/model-forbrug.ts [--dage 30] [--json]
import type { Database } from '../src/db/pool.ts';
import { dagligt, type Dag } from '../src/model/regnskab.ts';

const DAG_MS = 86_400_000;
const usd = (mikro: number): string => `${(mikro / 1_000_000).toFixed(2).replace('.', ',')} $`;
const k = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)} k` : String(n));

export type ModelOversigt = { dage: Dag[]; maaned: { fra: string; kald: number; mikroUsd: number } };

export async function modelOversigt(db: Database, nu: Date, antalDage: number): Promise<ModelOversigt> {
  const til = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 1));
  const dage = await dagligt(db, new Date(til.getTime() - antalDage * DAG_MS), til);
  const fra = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1));
  const m = await dagligt(db, fra, til);
  return { dage, maaned: { fra: fra.toISOString().slice(0, 10), kald: m.reduce((s, d) => s + d.kald, 0), mikroUsd: m.reduce((s, d) => s + d.mikroUsd, 0) } };
}

export function oversigtTekst(o: ModelOversigt): string[] {
  const l = ['Inkluderet model (rolig): hvad modellen har kostet Clawco, pr. dag (UTC).'];
  if (!o.dage.length) l.push('Ingen kald i perioden.');
  for (const d of o.dage) l.push(`${d.dag}: ${d.kald} kald fra ${d.tenanter} ${d.tenanter === 1 ? 'husstand' : 'husstande'}, ${usd(d.mikroUsd)} (ind ${k(d.input)}, ud ${k(d.output)}, cache læst ${k(d.cacheLaes)}, skrevet ${k(d.cacheSkriv)} tokens)`);
  l.push(`Måneden fra ${o.maaned.fra}: ${o.maaned.kald} kald, ${usd(o.maaned.mikroUsd)}.`);
  return l;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dage');
  const antal = i >= 0 ? Number(args[i + 1]) : 30;
  if (!Number.isInteger(antal) || antal < 1 || antal > 400 || args.some((a, j) => a !== '--json' && a !== '--dage' && j !== i + 1)) { console.error('brug: model-forbrug.ts [--dage N] [--json]'); process.exit(2); }
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    const o = await modelOversigt(db, new Date(), antal);
    if (args.includes('--json')) console.log(JSON.stringify(o, null, 2));
    else for (const x of oversigtTekst(o)) console.log(x);
  } finally { await db.close(); }
}
