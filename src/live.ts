// Live updates: rooms call notify(roomId) after they change state or log;
// browsers subscribe (SSE) and refetch the room fragment on `changed`.

export type LiveBus = {
  notify(roomId: string): void;
  subscribe(roomId: string, listener: (version: number) => void): () => void;
  version(roomId: string): number;
};

// KC-0071: versions count up from `start` (the server passes its start time), so a restarted
// process never repeats a version an open page already showed — the page refetches on any other.
export function createLiveBus(start = 0): LiveBus {
  const versions = new Map<string, number>();
  const listeners = new Map<string, Set<(v: number) => void>>();
  return {
    notify(roomId) {
      const v = (versions.get(roomId) ?? start) + 1;
      versions.set(roomId, v);
      for (const l of listeners.get(roomId) ?? []) { try { l(v); } catch { /* listener bug must not break the room */ } }
    },
    subscribe(roomId, listener) {
      let set = listeners.get(roomId);
      if (!set) { set = new Set(); listeners.set(roomId, set); }
      set.add(listener);
      return () => { set?.delete(listener); };
    },
    version(roomId) { return versions.get(roomId) ?? start; },
  };
}
