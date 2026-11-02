// The test world's history of "things that required you" (KC-0147): eight completed weeks falling from 14 to 6 a day,
// Fortryd flat except one week (the fifth) where it rose while the number still fell, and the current week so far at 6.
// All invented. Dates follow the moment's clock, so every moment (and the Monday moment) reads as eight weeks of history.

import type { Dagstal } from '../../tillid/dagstal.ts';
import { mandagFor } from '../../tillid/dagstal.ts';
import { plusDag } from './fakta.ts';

/** Oldest first. */
export const UGE_SNIT = [14, 13, 12, 11, 10, 9, 7, 6] as const;
export const UGE_FORTRYD = [2, 2, 2, 1, 4, 1, 1, 1] as const;

/** The snapshots up to (not including) `idag`, the day the moment's clock is on. */
export function dagstalFroe(idag: string): Dagstal[] {
  const mandag = mandagFor(idag);
  const dage: Dagstal[] = [];
  UGE_SNIT.forEach((snit, i) => {
    const start = plusDag(mandag, -7 * (UGE_SNIT.length - i));
    for (let d = 0; d < 7; d++) dage.push({ dato: plusDag(start, d), kraevede: snit, fortryd: d === 0 ? UGE_FORTRYD[i]! : 0 });
  });
  for (let dato = mandag; dato < idag; dato = plusDag(dato, 1)) dage.push({ dato, kraevede: 6, fortryd: 0 });
  return dage;
}
