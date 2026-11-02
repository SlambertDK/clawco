// The daily purge (KC-0181, D11 "revoke keys" + the 30-day backup retention): destroys every wrapped data key
// whose purge date has come, so a deleted tenant's backups can no longer be opened (crypto-shredding). A pass
// at start and then every `interval` (default 6 h — the job is idempotent, so a restart or an extra pass
// costs nothing, and a purge is never later than 6 h past its date). Logs a count only when something was
// destroyed, or once when a pass fails; the loop never dies of a failed pass.
import type { Database } from '../db/pool.ts';
import { destruerUdloebne } from './tenantnoegle.ts';

export const SEKS_TIMER = 6 * 3_600_000;

export function destruktionsLoekke(
  db: Database,
  o: { nu?: () => Date; interval?: number; log?: (linje: string) => void; saetInterval?: (fn: () => void, ms: number) => () => void } = {},
): { foerste: Promise<void>; vent(): Promise<void>; stop(): void } {
  const nu = o.nu ?? (() => new Date());
  const log = o.log ?? ((s: string) => console.log(`sky nøgler: ${s}`));
  let igang: Promise<void> | null = null;
  let sidsteFejl = '';
  const pass = (): Promise<void> => {
    if (igang) return igang;
    igang = (async () => {
      try {
        const n = await destruerUdloebne(db, nu());
        if (n > 0) log(`destruerede ${n} ${n === 1 ? 'nøgle' : 'nøgler'} efter 30 dages opbevaring`);
        sidsteFejl = '';
      } catch (err) {
        const l = `destruktion fejlede: ${(err as Error).message}`;
        if (l !== sidsteFejl) log(l);
        sidsteFejl = l;
      } finally { igang = null; }
    })();
    return igang;
  };
  const saet = o.saetInterval ?? ((fn, ms) => { const h = setInterval(fn, ms); h.unref(); return () => clearInterval(h); });
  const foerste = pass();
  const stop = saet(() => { void pass(); }, o.interval ?? SEKS_TIMER);
  return { foerste, vent: async () => { await igang; }, stop };
}
