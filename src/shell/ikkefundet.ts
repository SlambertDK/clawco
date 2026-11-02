import { html, type Markup } from './html.ts';
import { PRODUKT } from './navn.ts';

/** KC-0089: what an address that points nowhere is called in the heading. */
const TEKST = {
  rum: { overskrift: 'Det rum findes ikke', linje: `Adressen peger ikke på et rum i ${PRODUKT}. Gå til Nu for at se, hvad der venter.` },
  side: { overskrift: 'Siden findes ikke', linje: `Adressen peger ikke på noget i ${PRODUKT}. Gå til Nu for at komme videre.` },
  dokument: { overskrift: 'Dokumentet findes ikke', linje: 'Det er enten fjernet eller aldrig oprettet. Gå til Nu for at finde frem til det igen.' },
} as const;

export type IkkeFundetSlags = keyof typeof TEKST;

/** The heading, also used as the page title. */
export const ikkeFundetOverskrift = (slags: IkkeFundetSlags): string => TEKST[slags].overskrift;

/** The main of the calm 404 page: the shell wraps it, the way back is one clear link. */
export function renderIkkeFundet(slags: IkkeFundetSlags): Markup {
  const t = TEKST[slags];
  return html`<header class="room-head"><div><h1>${t.overskrift}</h1><p class="muted">${t.linje}</p></div></header>
  <div class="actions"><a class="btn" href="/rum/hjem">Til Nu</a></div>`;
}
