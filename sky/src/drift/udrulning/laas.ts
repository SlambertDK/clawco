// One operator command at a time per rollout (KC-0186): a lease on the rollout row, renewed while a pass runs and
// released after it. A killed command's lease simply expires (LAAS_MS), so `udrul.ts fortsaet` can take over.
import { randomBytes } from 'node:crypto';
import { LAAS_MS } from './hold.ts';
import { slipLaas, tagLaas } from './tilstand.ts';
import type { UdrulDeps } from './typer.ts';

export async function medLaas<T>(d: UdrulDeps, id: number, fn: () => Promise<T>): Promise<T> {
  const ejer = d.ejer ?? randomBytes(8).toString('hex');
  const til = () => new Date(d.nu().getTime() + LAAS_MS);
  if (!(await tagLaas(d.db, id, ejer, d.nu(), til()))) throw new Error('en anden udrul.ts arbejder på udrulningen lige nu (prøv igen om et par minutter)');
  const saet = d.saetInterval ?? ((f, ms) => { const h = setInterval(f, ms); h.unref(); return () => clearInterval(h); });
  const stop = saet(() => { void tagLaas(d.db, id, ejer, d.nu(), til()).catch(() => {}); }, LAAS_MS / 4);
  try { return await fn(); } finally {
    stop();
    await slipLaas(d.db, id, ejer);
  }
}
