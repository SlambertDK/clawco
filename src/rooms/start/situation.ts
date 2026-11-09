// KC-0248: step 0 — "What should Clawco take off your plate?" (spec 2026-11-03 §4 P7, §5). The pick steers two things
// and nothing else: the order in which the sources are offered (step 3's cards, step 4's pile) and the order of the
// optional steps. It never hides a source or a step, and it never connects or reads anything. Pure and dependency-free,
// so the steps (trin.ts), the cards (kilderender.ts) and Start's view (room.ts) share one answer.

import type { Situation } from './schema.ts';

/**
 * Which kinds of source come first, per pick. Step 3 offers the first two (the person still chooses one); step 4 then
 * offers the other of those, then the rest in the order here. Mail and deadlines: mail, then news (the world around the
 * deadlines). The family's logistics: the shared calendar first, then messages. Everything, I run things myself: the journey's own order, nothing reordered.
 */
const SLAGS: Record<Situation, readonly string[]> = {
  mail: ['mail', 'kalender', 'nyheder', 'noter', 'beskeder'],
  familie: ['kalender', 'mail', 'beskeder', 'noter', 'nyheder'],
  alt: ['kalender', 'mail', 'noter', 'nyheder', 'beskeder'],
};

/** The default (no pick yet, or an installation from before step 0): the order the journey always had. */
const STANDARD: readonly string[] = SLAGS.alt;

export const slagsRaekkefoelge = (s: Situation | undefined): readonly string[] => (s ? SLAGS[s] : STANDARD);

/**
 * Sorts anything with a kind of source by the pick's order; kinds not named keep their place at the end (a stable sort).
 * No pick, and "everything, I run things myself", keep the registry's own order: the person chooses for themselves.
 */
export function efterSlags<T>(xs: readonly T[], slags: (x: T) => string, s: Situation | undefined): T[] {
  if (s === undefined || s === 'alt') return [...xs];
  const orden = slagsRaekkefoelge(s);
  const rang = (x: T): number => { const i = orden.indexOf(slags(x)); return i === -1 ? orden.length : i; };
  return [...xs].sort((a, b) => rang(a) - rang(b));
}

/**
 * The optional steps' order. Mail and deadlines: a person who lives in their inbox has most likely told another assistant
 * about their deadlines already, so "bring it along" comes before more sources. The family's logistics and "everything, I
 * run things myself" keep the journey's own order (more sources first). Steps not named keep their place.
 */
export function efterTrinOrden<T>(xs: readonly T[], id: (x: T) => string, s: Situation | undefined): T[] {
  if (s !== 'mail') return [...xs];
  const ud = [...xs];
  const i = ud.findIndex((x) => id(x) === 'import');
  const j = ud.findIndex((x) => id(x) === 'flere-kilder');
  if (i > j && j !== -1) { const [t] = ud.splice(i, 1); ud.splice(j, 0, t as T); }
  return ud;
}
