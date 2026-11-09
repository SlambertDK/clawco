// KC-0130: the recorder of step 6. A listener on the Ret bus (src/rooms/rethaendelse.ts): the first
// Ret or Ikke relevant heard after Start began is stored in Start's state, which is what makes the
// step Klaret (trin.ts reads state.ret — never a button). Events from before Start's own start
// time are not heard (they happened before the journey asked for it), and neither is anything when
// Start has no state yet (an install in use from before Start existed is Done by rejsen()'s own read).

import type { RoomDeps } from '../module.ts';
import type { RetHaendelse } from '../rethaendelse.ts';
import { KORSEL } from './prompt.ts';
import { endreStart } from './laas.ts';
import { startTekst } from './tekster.ts';

export type { RetHaendelse } from '../rethaendelse.ts';

const RUM = 'start';

/** Records `h` when it is the first, newer than Start, and the journey is not already Done (an install latched before step 6 existed keeps its data untouched). True when it completed the step. */
export async function modtagRet(deps: RoomDeps, h: RetHaendelse): Promise<boolean> {
  const tekst = h.tekst?.trim().slice(0, 300);
  let optaget = false;
  // KC-0281: in Start's queue, so a write that overlaps (a preview retired, a first read) cannot drop the Ret.
  await endreStart(deps, (s) => {
    if (!s || s.faerdig || s.ret || Date.parse(h.tid) < Date.parse(s.startet) || Number.isNaN(Date.parse(h.tid))) return null;
    optaget = true;
    return {
      ...s,
      trin: { ...s.trin, 'foerste-ret': { status: 'klaret', tid: h.tid } },
      ret: { art: h.art, tid: h.tid, titel: h.titel.slice(0, 200), ...(h.kortId ? { kortId: h.kortId } : {}), ...(tekst ? { tekst } : {}) },
    };
  });
  if (!optaget) return false;
  await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: deps.person.id, tekst: startTekst().akt.retLog(h.art, h.titel.slice(0, 80)) });
  deps.live.notify(RUM);
  return true;
}
