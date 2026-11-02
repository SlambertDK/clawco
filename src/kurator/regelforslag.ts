// KC-0144: where Hermes' rule proposal (the block in the answer to a Ret or an Ikke relevant) becomes a PENDING
// proposal in Hjem's state — and nothing more. This file never touches the rules file (the structural test in
// test/graenser/regelforslag.test.ts keeps it that way): the only writer is the approve route in server.ts, which
// needs Henrik's own tap. Only the owner is offered proposals: the rules file is the household's.

import type { RoomDeps } from '../rooms/module.ts';
import type { Zoneret } from '../identitet/zoner.ts';
import { laegTil, lavForslag, parseRegelforslag, type Art, type LagtUdfald } from '../tillid/forslag.ts';
import { endreKurator, HJEM } from './kurator.ts';

/** Whether this request may produce a proposal: the owner, with a rules store to approve into. Call in the request, not in a run's callback. */
export const kanForeslaa = (d: RoomDeps): boolean => (d.regler ? d.person.rolle === 'ejer' : false);

/**
 * Hermes' `blok` for card `kort` → a pending proposal. `blok` undefined or null is no proposal; a bad one is dropped and
 * logged (journal), never stored. Resolves to what happened; never throws on Hermes' text.
 */
/** KC-0145: `pauser` = the rule that hid the item (the Sunday sample): the proposal is a narrower rule that replaces it, so a Ja also pauses it. */
export async function gemRegelforslag(d: RoomDeps, o: { kort: { id: string; titel: string } & Zoneret; art: Art; blok: unknown; pauser?: string }): Promise<LagtUdfald | 'droppet' | 'intet'> {
  if (o.blok === undefined || o.blok === null) return 'intet';
  const regler = d.regler ? await d.regler.laes() : undefined;
  const r = parseRegelforslag(o.blok, { regler, art: o.art, kortId: o.kort.id });
  if ('droppet' in r) {
    console.error(`regelforslag: droppet for ${o.kort.id}: ${r.droppet}`);
    return 'droppet';
  }
  const nu = d.now();
  const f = { ...lavForslag(r.forslag, { kort: o.kort, art: o.art, nu }), ...(o.pauser ? { pauser: o.pauser } : {}) };
  let udfald: LagtUdfald = 'lagt';
  await endreKurator(d.store, (s) => {
    const l = laegTil(s.regelforslag, f, nu);
    udfald = l.udfald;
    return l.udfald === 'lagt' || l.udfald === 'erstattet' ? { ...s, regelforslag: l.liste } : s;
  });
  if (udfald === 'lagt' || udfald === 'erstattet') d.live.notify(HJEM);
  return udfald;
}
