// The owner's refund tasks (KC-0209). A person who withdraws ("Fortryd aftale") within the 14 days leaves a task here:
// refund this amount in Stripe by hand (Dashboard → the payment → Refund), then mark it done. This script only lists the
// open tasks and marks one done; it never calls Stripe, and no code in Sky issues a refund (AGENTS §9).
//   node --env-file=/srv/sky/.env sky/scripts/refusioner.ts                 the open tasks, oldest due first
//   node --env-file=/srv/sky/.env sky/scripts/refusioner.ts udfoert <id>    mark one done after refunding it
import type { Database } from '../src/db/pool.ts';
import { aabneRefusioner, markerRefusionUdfoert } from '../src/abonnement/bestilling.ts';
import { beloeb, dato } from '../src/abonnement/forbrugerret.ts';

export async function refusioner(db: Database, args: string[], nu: Date): Promise<{ linjer: string[]; kode: number }> {
  if (args.length === 0) {
    const aabne = await aabneRefusioner(db);
    if (aabne.length === 0) return { linjer: ['Ingen åbne refusionsopgaver.'], kode: 0 };
    return {
      linjer: ['opgave  konto      beløb         frist',
        ...aabne.map((o) => `${o.id}  konto ${o.kontoId}  ${beloeb(o.beloebOere, 'da')}  senest ${dato(o.forfald, 'da')}`)],
      kode: 0,
    };
  }
  if (args[0] === 'udfoert' && args.length === 2 && /^[1-9]\d{0,15}$/.test(args[1]!)) {
    const id = Number(args[1]);
    return (await markerRefusionUdfoert(db, id, nu))
      ? { linjer: [`Opgave ${id} er markeret som udført.`], kode: 0 }
      : { linjer: [`Opgave ${id} findes ikke eller er allerede udført.`], kode: 1 };
  }
  return { linjer: ['brug: refusioner.ts [udfoert <opgavenummer>]'], kode: 2 };
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    const r = await refusioner(db, process.argv.slice(2), new Date());
    for (const l of r.linjer) console.log(l);
    process.exitCode = r.kode;
  } finally { await db.close(); }
}
