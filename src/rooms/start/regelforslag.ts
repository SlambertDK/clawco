// KC-0227: Start shows the rule proposals Nu asks about ("Skal jeg gøre det til en regel?") under step 6's explanation card.
// Start owns neither a proposal nor an answer: the seam hands it the SAME pending list Nu draws its card from (the app wires
// it in server.ts: owner only, what the person looking may see), the card is the shared one (src/shell/regelforslagkort.ts)
// and its three buttons are served by the one handler in public/app.js, which posts to /api/tillid/forslag/:id/godkend|afvis
// (a one-time Ja for exactly that proposal, spec D6). Rendering never creates a rule.

import { html, type Markup } from '../../shell/html.ts';
import { regelforslagKort } from '../../shell/regelforslagkort.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import type { RoomDeps } from '../module.ts';
import type { StartState } from './schema.ts';

/** What the app hands Start: the proposals waiting for this person's answer, newest last. Absent = Start shows the explanation card alone. */
export type RegelSeam = { afventer(): Promise<Regelforslag[]> };

/** The proposals on offer now: only once a first Ret has been heard (the explanation card stands), only the pending ones; none when the list cannot be read. */
export async function ventendeForslag(deps: RoomDeps, s: StartState | null): Promise<Regelforslag[]> {
  const seam = deps.regelforslag;
  if (!seam || !s?.ret) return [];
  try { return (await seam.afventer()).filter((f) => f.status === 'afventer'); } catch { return []; } // fail closed: no proposal
}

/** Nu's card, once per proposal, with Start's coverage mark on the root tag (test world: data-regelforslag-start). */
export function renderRegelforslag(liste: readonly Regelforslag[]): Markup {
  return html`${liste.map((f) => regelforslagKort(f, html` data-regelforslag-start="${f.id}"`))}`;
}
