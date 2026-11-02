import { html, type Markup } from './html.ts';
import { tekst } from './tekster.ts';

/** KC-0089: what an address that points nowhere is called in the heading (the words: tekster.ts ikkeFundet). */
export type IkkeFundetSlags = 'rum' | 'side' | 'dokument';

/** The heading, also used as the page title. */
export const ikkeFundetOverskrift = (slags: IkkeFundetSlags): string => tekst().ikkeFundet[slags].overskrift;

/** The main of the calm 404 page: the shell wraps it, the way back is one clear link. */
export function renderIkkeFundet(slags: IkkeFundetSlags): Markup {
  const t = tekst().ikkeFundet[slags];
  return html`<header class="room-head"><div><h1>${t.overskrift}</h1><p class="muted">${t.linje}</p></div></header>
  <div class="actions"><a class="btn" href="/rum/hjem">${tekst().tilNu}</a></div>`;
}
