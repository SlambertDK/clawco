// Gives a beta household a gift (KC-0203): an active entitlement on a plan without Stripe — the only way to set
// kilde 'gave' (webhooks never change it). The person signs up as usual first; then an operator runs on the server
//   node --env-file=/srv/sky/.env sky/scripts/giv-gave.ts <email> <plan>
// The fleet's reconciler then provisions their Clawco within one pass.
import type { Database } from '../src/db/pool.ts';
import type { Priser } from '../src/abonnement/priser.ts';
import { kontoForEmail, normaliserEmail } from '../src/konto/konto.ts';
import { saetGave } from '../src/abonnement/synk.ts';

export async function givGave(db: Database, email: string, plan: string, priser: Priser, nu: Date): Promise<'ok' | 'ukendt-konto' | 'ukendt-plan'> {
  const e = normaliserEmail(email);
  const konto = e ? await kontoForEmail(db, e) : null;
  if (!konto) return 'ukendt-konto';
  if (!Object.hasOwn(priser.planer, plan)) return 'ukendt-plan';
  await saetGave(db, konto.id, plan, priser, nu);
  return 'ok';
}

if (import.meta.main) {
  const { laesConfig } = await import('../src/config.ts');
  const { pgDatabase } = await import('../src/db/pool.ts');
  const { laesPriser } = await import('../src/abonnement/priser.ts');
  const [email, plan] = process.argv.slice(2);
  if (!email || !plan) { console.error('brug: giv-gave.ts <email> <plan>'); process.exit(2); }
  const db = pgDatabase(laesConfig(process.env).databaseUrl);
  try {
    const r = await givGave(db, email, plan, laesPriser(), new Date());
    console.log({ ok: `gave på ${plan} givet`, 'ukendt-konto': 'kontoen findes ikke (tilmeld dig først)', 'ukendt-plan': `ukendt plan: ${plan}` }[r]);
    process.exitCode = r === 'ok' ? 0 : 1;
  } finally { await db.close(); }
}
