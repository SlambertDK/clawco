// KC-0281: Start's state is one file that many hands read, change and write back — the room's actions, the listeners
// that record a first read and the first Ret, the rebuild that retires a preview, the Done latch. Two of them that
// overlap must not lose each other's change, so every one of them runs in one queue per store: each reads what the one
// before it wrote. (The same pattern as endreKurator for Nu.) A function given to the queue never enters it again.

import type { RoomDeps } from '../module.ts';
import { parseStartState, type StartState } from './schema.ts';

const RUM = 'start';
const koer = new WeakMap<object, Promise<unknown>>();

/** Runs `fn` after every earlier queued change of this store's Start state has finished (failed ones included). */
export function enAdGangen<T>(deps: RoomDeps, fn: () => Promise<T>): Promise<T> {
  const foer = koer.get(deps.store) ?? Promise.resolve();
  const nu = foer.then(fn, fn);
  koer.set(deps.store, nu.catch(() => undefined));
  return nu;
}

/**
 * Reads Start's state, lets `fn` change it, and writes the result — in the queue. `fn` gets null when Start has no state
 * yet; it returns the new state, or null (or the same object) to write nothing. Resolves to what is stored afterwards.
 */
export function endreStart(deps: RoomDeps, fn: (s: StartState | null) => StartState | null | Promise<StartState | null>): Promise<StartState | null> {
  return enAdGangen(deps, async () => {
    const s = parseStartState(await deps.store.readState(RUM));
    const ny = await fn(s);
    if (ny && ny !== s) await deps.store.writeState(RUM, ny);
    return ny ?? s;
  });
}
