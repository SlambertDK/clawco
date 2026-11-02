// KC-0170: a status line a room STORED (state.json's hermesStatus) read in the language of the request. A status the room
// wrote itself — a default like "Klar til at skrive", or a template with one slot like `Skriver med på "<titel>"` — is
// mapped to the current table, so an installation whose stored state is Danish still shows English after the language
// changed, and a Danish installation shows exactly what it stored. Anything else (Hermes' own words) is shown as stored.
// Shared by the rooms; depends on nothing in src/ outside src/store/.

import type { Sprog } from '../store/sprog.ts';

/** One kind of status a room writes: its words in each language, plain or with one slot. */
export type StatusArt = Record<Sprog, string | ((slot: string) => string)>;

const PRIK = '\u0000';

/** `lagret` mapped to `nu`'s words when it is one the room wrote (in any language), else `lagret` itself. */
export function statusISprog(lagret: string, arter: readonly StatusArt[], nu: Sprog): string {
  for (const art of arter) {
    for (const sprog of Object.keys(art) as Sprog[]) {
      const f = art[sprog];
      if (typeof f === 'string') {
        if (lagret === f) return typeof art[nu] === 'string' ? art[nu] : lagret;
        continue;
      }
      const [for_, efter] = f(PRIK).split(PRIK) as [string, string];
      if (lagret.length >= for_.length + efter.length && lagret.startsWith(for_) && lagret.endsWith(efter)) {
        const slot = lagret.slice(for_.length, lagret.length - efter.length);
        const maal = art[nu];
        return typeof maal === 'function' ? maal(slot) : lagret;
      }
    }
  }
  return lagret;
}
