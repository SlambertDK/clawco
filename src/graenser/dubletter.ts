// KC-0270 (B4): the button a person sees is the instruction that runs. Handlings
// are looked up by id; when an agent's answer carries the same id twice, the
// first wins and the later one is dropped and counted (the room logs it). A
// later entry never silently takes the place of the first.

/** Handlings by id, the first with an id kept; every later one with that id goes to `droppet`. */
export function foersteVinder<T extends { id: string }>(xs: Iterable<T>, droppet?: (id: string) => void): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of xs) {
    if (m.has(x.id)) droppet?.(x.id);
    else m.set(x.id, x);
  }
  return m;
}
