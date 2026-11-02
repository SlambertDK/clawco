// KC-0203: the closed beta's two cards in Nu — only under KC_BETA=ja, only for the owner, only while one is due. Pure:
// data in, HTML out (every text through the escaper). A card is gone once answered (KC-0052), never greyed. The preview
// line under the rating is drawn by public/beta.js from the very object it sends; here it is only the first state.

import { html, type Markup } from '../../shell/html.ts';
import { handlinger, knap } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import type { BetaPriser } from '../../beta/priser.ts';
import { BETALE, TEKST_MAKS, type FeedbackDag } from '../../beta/tilstand.ts';
import { hjemTekst } from './tekster.ts';

/** What Nu is told about the beta (the server builds it only for the owner and only when a card is due). */
export type BetaVisning = { kort?: true; feedback?: { dag: FeedbackDag; priser: BetaPriser | null } };

/** The plain card: "Det her er en lukket beta …" and one button. */
export function betaKort(): Markup {
  const t = hjemTekst();
  return html`<article class="card kort" data-blok="kort" data-beta-kort data-element="${t.betaTitel}">
    ${visHoved({ ikon: 'info' }, t.betaTitel, t.betaGruppe)}
    <p class="betydning">${t.betaTekst}</p>
    ${handlinger(knap({ label: t.forstaaet, slags: 'primaer', attrs: { 'data-beta-luk': '' } }))}
  </article>`;
}

/** The feedback card of day 3, 7 or 14: a rating, one optional line, (day 14) the pay question, what will be sent, and Send. */
export function feedbackKort(dag: FeedbackDag, priser: BetaPriser | null): Markup {
  const t = hjemTekst();
  const ord = JSON.stringify(t.fbOrd);
  return html`<article class="card kort" data-blok="beslutning" data-beta-feedback="${String(dag)}" data-beta-ord="${ord}" data-beta-tak="${t.fbTak}" data-element="${t.fbTitel(dag)}">
    ${visHoved({ ikon: 'message-circle' }, t.fbTitel(dag), t.betaGruppe)}
    <p class="betydning">${t.fbSpoergsmaal}</p>
    <div class="actions" role="group" aria-label="${t.fbVurderingGruppe}">${[1, 2, 3, 4, 5].map((n) => knap({ label: String(n), attrs: { 'data-beta-vurdering': String(n), 'aria-pressed': 'false' } }))}</div>
    <label class="field"><span class="row-note">${t.fbDrillede}</span><input type="text" maxlength="${String(TEKST_MAKS)}" data-beta-tekst autocomplete="off"></label>
    <p class="row-note">${t.fbDrilledeNote}</p>
    ${dag === 14 && priser ? html`<p class="betydning">${t.fbBetale(priser.solo, priser.husstand)}</p>
    <div class="actions" role="group">${BETALE.map((v) => knap({ label: t.fbBetaleSvar[v], attrs: { 'data-beta-betale': v, 'aria-pressed': 'false' } }))}</div>` : ''}
    <p class="row-note" data-beta-forhaand aria-live="polite">${t.fbOrd.sendes}: ${t.fbOrd.vaelg}</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-beta-send="${String(dag)}" disabled>${t.fbSend}</button>${knap({ label: t.fbIkkeNu, attrs: { 'data-beta-ikkenu': String(dag) } })}</div>
  </article>`;
}
