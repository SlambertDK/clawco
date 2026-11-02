// KC-0130: the one place a Ret or an Ikke relevant is announced. Two things emit it (Luk in
// src/kurator/kortHandlinger.ts, and Hjem's chat when a message points at a card with "Kortet: …");
// whoever cares subscribes (Start records the first one, step 6). A listener is awaited so the
// caller's next read sees its effect, but its failure never fails the user's action.

import type { RoomDeps } from './module.ts';

/** What happened: the kind, when (ISO), the element's title, its card id when known, Henrik's own words (the Ret message, or the reason of a Luk). */
export type RetHaendelse = { art: 'ret' | 'ikke-relevant'; tid: string; titel: string; kortId?: string; tekst?: string };
export type RetLytter = (d: RoomDeps, h: RetHaendelse) => Promise<unknown>;

export type RetBus = {
  /** Subscribes; returns the unsubscribe. */
  lyt(fn: RetLytter): () => void;
  /** Tells every listener, in order, and waits for each. */
  meld(d: RoomDeps, h: RetHaendelse): Promise<void>;
};

export function lavRetBus(): RetBus {
  const lyttere = new Set<RetLytter>();
  return {
    lyt(fn) { lyttere.add(fn); return () => { lyttere.delete(fn); }; },
    async meld(d, h) {
      for (const fn of [...lyttere]) {
        try { await fn(d, h); } catch (err) { console.error('ret: en lytter fejlede:', err instanceof Error ? err.message : err); }
      }
    },
  };
}
