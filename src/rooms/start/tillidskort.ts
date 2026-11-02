// KC-0130: the one card that explains the trust ladder (spec §4) in plain words (Danish or English, Start's table),
// shown once the user has made a first Ret. Pure and static: the ladder itself, the rules and the levels a user has
// granted are E4's (KC-0108); this only says how it works. Copy is admin UI copy (Claude's call,
// marked for Henrik's review); public-site wording is E9. Budget: about 70 words in all.

import { html, type Markup } from '../../shell/html.ts';
import { visHoved } from '../../shell/visuel.ts';
import { START_TEKSTER, startTekst } from './tekster.ts';

export type TillidNiveau = { id: '0' | '1' | '2' | '3' | '4' | 'graense'; navn: string; tekst: string };

/** Spec §4: 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo · the limit (never). The ids are the contract and the order. */
const IDER: readonly TillidNiveau['id'][] = ['0', '1', '2', '3', '4', 'graense'];

const niveauer = (T: { niveau: Record<TillidNiveau['id'], { navn: string; tekst: string }> }): TillidNiveau[] => IDER.map((id) => ({ id, ...T.niveau[id] }));

/** The ladder in Danish (the reference the ids and the order are tested against); the card shows it in the language being rendered. */
export const TILLID_NIVEAUER: readonly TillidNiveau[] = niveauer(START_TEKSTER.da.tillid);

export function renderTillidskort(): Markup {
  const T = startTekst().tillid;
  return html`<article class="card kort tillidskort" data-blok="kort" data-tillidskort data-element="${T.element}">
    ${visHoved({ ikon: 'lightbulb' }, T.hoved)}
    <div class="card-list">${niveauer(T).map((n) => html`<div class="row" data-niveau="${n.id}">
      <span class="mono time">${n.id === 'graense' ? '×' : n.id}</span>
      <span class="row-main"><span class="row-title">${n.navn}</span><span class="row-note">${n.tekst}</span></span>
    </div>`)}</div>
  </article>`;
}
