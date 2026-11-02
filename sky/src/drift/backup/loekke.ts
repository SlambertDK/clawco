// The backup loop (KC-0185), inside the Sky process like the reconciler and the key purge: a pass at start and
// then every five minutes. Each pass runs whatever the night schedule says is due (planlaeg.ts: a spread slot
// per scope, catch-up after downtime, hourly retry after a failure), then the monthly restore drill when it is
// due. The pass is idempotent; a tick while one runs is skipped; a failing pass is logged once, never fatal.
import { koerNat } from './koer.ts';
import { proevMaaned, proeveSkyldig, type ProeveDeps } from './proeve.ts';

export const FEM_MINUTTER = 5 * 60_000;

export function kopiLoekke(
  d: ProeveDeps,
  o: { interval?: number; saetInterval?: (fn: () => void, ms: number) => () => void } = {},
): { foerste: Promise<void>; vent(): Promise<void>; stop(): void } {
  const log = d.log ?? ((s: string) => console.log(`sky kopi: ${s}`));
  const dd: ProeveDeps = { ...d, log };
  let igang: Promise<void> | null = null;
  let sidsteFejl = '';
  const pass = (): Promise<void> => {
    if (igang) return igang;
    igang = (async () => {
      try {
        await koerNat(dd);
        if (await proeveSkyldig(dd.db, dd.nu())) await proevMaaned(dd);
        sidsteFejl = '';
      } catch (err) {
        const l = `sikkerhedskopiering fejlede: ${(err as Error).message}`;
        if (l !== sidsteFejl) log(l);
        sidsteFejl = l;
      } finally { igang = null; }
    })();
    return igang;
  };
  const saet = o.saetInterval ?? ((fn, ms) => { const h = setInterval(fn, ms); h.unref(); return () => clearInterval(h); });
  const foerste = pass();
  const stop = saet(() => { void pass(); }, o.interval ?? FEM_MINUTTER);
  return { foerste, vent: async () => { await igang; }, stop };
}
