// KC-0041: where the opgaver live — rum-lager room `udvikling`. Every write goes
// through one chain per store and re-reads the state inside it, so a click in
// Hjem and a status report from the Mac never overwrite each other.

import type { RumLager } from '../store/types.ts';
import type { Opgave } from './opgaver.ts';

export const UDVIKLING = 'udvikling';
const MAX_OPGAVER = 200;
type UdviklingState = { opgaver: Opgave[] };

export async function laesOpgaver(store: RumLager): Promise<Opgave[]> {
  return (await store.readState<UdviklingState>(UDVIKLING))?.opgaver ?? [];
}

const koer = new WeakMap<RumLager, Promise<unknown>>();

/** `fn` gets the current opgaver and returns the next list (the same array = no write) and what to tell the caller. */
export function endreOpgaver<T>(store: RumLager, fn: (o: Opgave[]) => [Opgave[], T]): Promise<T> {
  const trin = async (): Promise<T> => {
    const nu = await laesOpgaver(store);
    const [ny, ud] = fn(nu);
    if (ny !== nu) await store.writeState<UdviklingState>(UDVIKLING, { opgaver: ny.slice(-MAX_OPGAVER) });
    return ud;
  };
  const naeste = (koer.get(store) ?? Promise.resolve()).then(trin, trin);
  koer.set(store, naeste.catch(() => undefined));
  return naeste;
}
