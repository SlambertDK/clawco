// KC-0096: Senere. Henrik can put a card of Hjem away until tonight (18.00) or tomorrow (07.00),
// Copenhagen time. The card keeps its place in state.kort with `udsatTil` set, so a Kuratoren run
// that stands by or re-emits it changes nothing (mergeKort carries the field). The times and the
// "is it put away" test are pure and live with the card model (rooms/hjem/kort.ts, which the
// room's render also needs); this module is the one rule for "which cards are on screen now".
// The invariant: a card counts as waiting for Henrik only while synligeKort says it is visible.

import { udloebet, udsatNu, type Kort } from '../rooms/hjem/kort.ts';
import type { Senere } from '../rooms/hjem/kort.ts';

export { aftenMulig, SENERE, senereTid, udsatNu, type Senere } from '../rooms/hjem/kort.ts';

/** The stored fortryd of a Senere log line (handlingId `senere:<card id>`): the app brings the card back, no Hermes run. */
export const FORTRYD_SENERE = 'hent-kortet-tilbage';

/** The cards on screen and among those waiting: not expired and not put away. */
export function synligeKort(kort: readonly Kort[], now: Date): Kort[] {
  return kort.filter((k) => !udloebet(k, now) && !udsatNu(k, now));
}

/** The log line of a snooze, e.g. "Udsat til i morgen kl. 07: <title>". */
export const senereTekst = (til: Senere, titel: string): string => `Udsat til ${til === 'aften' ? 'i aften kl. 18' : 'i morgen kl. 07'}: ${titel}`;
