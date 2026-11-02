// KC-0130: the one card that explains the trust ladder (spec §4) in plain Danish, shown once the user
// has made a first Ret. Pure and static: the ladder itself, the rules and the levels a user has
// granted are E4's (KC-0108); this only says how it works. Copy is admin UI copy (Claude's call,
// marked for Henrik's review); public-site wording is E9. Budget: about 70 words in all.

import { html, type Markup } from '../../shell/html.ts';
import { visHoved } from '../../shell/visuel.ts';

export type TillidNiveau = { id: '0' | '1' | '2' | '3' | '4' | 'graense'; navn: string; tekst: string };

/** Spec §4: 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo · the limit (never). */
export const TILLID_NIVEAUER: readonly TillidNiveau[] = [
  { id: '0', navn: 'Kigge', tekst: 'Hermes læser og viser.' },
  { id: '1', navn: 'Sortere', tekst: 'Lægger ting i bunker.' },
  { id: '2', navn: 'Føre regnskab', tekst: 'Skriver linjer i regnskabet.' },
  { id: '3', navn: 'Forberede', tekst: 'Gør udkast klar.' },
  { id: '4', navn: 'Gøre med fortryd', tekst: 'Små ting, du kan fortryde.' },
  { id: 'graense', navn: 'Aldrig', tekst: 'Betale, skrive til andre, slette eller kopiere mellem privat, arbejde og husstand.' },
];

export function renderTillidskort(): Markup {
  return html`<article class="card kort tillidskort" data-blok="kort" data-tillidskort data-element="Sådan får Hermes mere frihed">
    ${visHoved({ ikon: 'lightbulb' }, 'Hermes får kun mere frihed, når du siger ja')}
    <div class="card-list">${TILLID_NIVEAUER.map((n) => html`<div class="row" data-niveau="${n.id}">
      <span class="mono time">${n.id === 'graense' ? '×' : n.id}</span>
      <span class="row-main"><span class="row-title">${n.navn}</span><span class="row-note">${n.tekst}</span></span>
    </div>`)}</div>
  </article>`;
}
