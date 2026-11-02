// KC-0130: the hand-off to E4 (KC-0108). Start owns only the step and the card; the trust ladder,
// the rules file and "Ret → rule proposal" are E4's. E4 hands Start two functions through
// RoomDeps.regelforslag; absent (the default) = Start shows the explanation card alone.
// Spec D6: Start never creates a rule by itself — it shows E4's proposal, and only the user's own
// POST (Ja) for exactly that proposal calls `opretRegel`, once.

import { createHash } from 'node:crypto';
import { html, type Markup } from '../../shell/html.ts';
import { handlinger, knap } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import { forslagFra, type RegelForslag } from '../../graenser/regelforslag.ts';
import type { RoomDeps } from '../module.ts';
import type { RetHaendelse } from '../rethaendelse.ts';
import type { StartState } from './schema.ts';

/**
 * E4's side. `foreslaaRegel` turns the first Ret into a proposal or null (it may think, hence the promise);
 * `opretRegel` makes the rule from a proposal Start showed and the user tapped Ja on.
 */
export type RegelSeam = {
  foreslaaRegel(h: RetHaendelse): RegelForslag | null | Promise<RegelForslag | null>;
  opretRegel(f: RegelForslag): Promise<{ id: string }>;
};

/** What a Ja or Nej names: the declared fields of the proposal, so a stale or forged id never matches. */
export function forslagId(f: RegelForslag): string {
  const felter = [f.titel, f.tekst, f.trin, f.gaelder.kilde, f.gaelder.slags ?? '', f.oprindelse.art, f.oprindelse.kortId ?? ''];
  return createHash('sha256').update(JSON.stringify(felter)).digest('hex').slice(0, 12);
}

export type Tilbud = { id: string; forslag: RegelForslag };

/**
 * The proposal on offer now: E4's answer to the recorded first Ret, cut to its declared fields with the origin set by the
 * app (forslagFra). None when E4 is not wired, there is no Ret yet, the answer was given, or E4 fails or answers junk.
 */
export async function forslagFor(deps: RoomDeps, s: StartState | null): Promise<Tilbud | null> {
  const seam = deps.regelforslag;
  const r = s?.ret;
  if (!seam || !r || s.regel) return null;
  try {
    const raa = await seam.foreslaaRegel({ art: r.art, tid: r.tid, titel: r.titel, ...(r.kortId ? { kortId: r.kortId } : {}), ...(r.tekst ? { tekst: r.tekst } : {}) });
    const f = raa ? forslagFra(raa, { art: r.art, ...(r.kortId ? { kortId: r.kortId } : {}) }) : null;
    return f ? { id: forslagId(f), forslag: f } : null;
  } catch { return null; } // fail closed: no proposal
}

const TRIN_NAVN = ['kigge', 'sortere', 'føre regnskab', 'forberede', 'gøre med fortryd'] as const;

/** The proposal as a beslutning block: what it says, where it applies, Ja behind one tap, Nej. */
export function renderRegelforslag(t: Tilbud): Markup {
  const f = t.forslag;
  const arg = JSON.stringify({ forslagId: t.id });
  return html`<article class="card" data-blok="beslutning" data-regel-forslag="${t.id}" data-element="Regel: ${f.titel}">
    ${visHoved({ ikon: 'list-checks' }, f.titel, 'Forslag til en regel')}
    <p class="betydning">${f.tekst}</p>
    <p class="row-note">Gælder ${f.gaelder.kilde}${f.gaelder.slags ? html` · ${f.gaelder.slags}` : ''} · Hermes må ${TRIN_NAVN[f.trin]}</p>
    ${handlinger(
      knap({ label: 'Ja, gør det', slags: 'primaer', attrs: { 'data-aktion': 'regel-ja', 'data-arg': arg, 'data-status': 'opretter reglen' } }),
      [knap({ label: 'Nej', attrs: { 'data-aktion': 'regel-nej', 'data-arg': arg, 'data-status': 'lægger forslaget væk' } })],
    )}
  </article>`;
}
