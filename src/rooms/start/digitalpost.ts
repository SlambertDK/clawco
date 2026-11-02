// KC-0233: Start's Danmark-pakke step — how to get a note in Nu when new Digital Post arrives. Pure: data in, Markup
// out; every text through html``. Plain Danish, three steps: switch the notification on in Digital Post, give it the
// address Clawco reads, pick the sender address from the list the inbox itself offers, pick where you read your post.
// Shown only while a mail source is connected and no sender is confirmed (KC-0052); it leaves Start once confirmed.
// The list shows addresses only, never a subject. The free field accepts only an address on a hint domain: the server
// refuses anything else with a plain sentence (src/danmark/vindue.ts). Admin UI copy: Claude's call, for review.

import { html, type Markup } from '../../shell/html.ts';
import { tilstandChip } from '../../shell/sprog.ts';
import { startTekst } from './tekster.ts';

/** What Start is told while the step is open (src/danmark/vindue.ts `PostStart`, restated: rooms import nothing from src/danmark). */
export type PostStartVisning = {
  kandidater: string[];
  laeser: 'ok' | 'kan-ikke-se';
  viser: string;
  visere: { id: string; navn: string }[];
  domaener: readonly string[];
  /** Only the owner confirms; others see the step read-only. */
  kanGemme: boolean;
};

function afsendere(v: PostStartVisning): Markup {
  const T = startTekst().post;
  if (v.kandidater.length === 0) {
    return html`<p class="row-note" data-post-ingen>${v.laeser === 'kan-ikke-se' ? T.ingenKanIkkeSe : T.ingenIkkeSet}</p>`;
  }
  return html`<div class="stack" role="radiogroup" aria-label="${T.afsenderAria}">${v.kandidater.map((a, i) => html`<label class="field-check"><input type="radio" name="afsender" value="${a}"${i === 0 ? html` checked` : ''}><span class="mono">${a}</span></label>`)}</div>`;
}

function formen(v: PostStartVisning): Markup {
  const T = startTekst();
  return html`<form id="post-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <p class="row-title">${T.post.trin2}</p>
    <p class="row-note">${T.post.trin2Note}</p>
    ${afsendere(v)}
    <label class="field"><span class="row-note">${T.post.egen(v.domaener.join(', '))}</span><input name="egen" type="text" inputmode="email" spellcheck="false" maxlength="200" autocomplete="off" data-uden-stemme></label>
    <p class="row-title">${T.post.trin3}</p>
    <p class="row-note">${T.post.trin3Note}</p>
    <div class="stack" role="radiogroup" aria-label="${T.post.postkasseAria}">${v.visere.map((x) => html`<label class="field-check"><input type="radio" name="viser" value="${x.id}"${x.id === v.viser ? html` checked` : ''}><span>${x.navn}</span></label>`)}</div>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="post-afsender-gem" data-form="post-form" data-status="${T.gemmer}">${T.gem}</button><button type="button" class="btn btn-ghost" data-aktion="post-ikke-nu" data-status="${T.laeggerVaekKort}">${T.ikkeNu}</button></div>
  </form>`;
}

export function renderDigitalPostStart(v: PostStartVisning): Markup {
  const T = startTekst();
  const P = T.post;
  return html`<article class="card kort" data-blok="kort" data-post-start data-element="${T.pakkeTitel}: ${P.titel}">
    <div class="kort-head">${tilstandChip('rolig', T.valgfrit)}<span class="row-title">${P.titel}</span></div>
    <p>${P.intro}</p>
    <p class="row-title">${P.trin1}</p>
    <p class="row-note">${P.trin1Note}</p>
    ${v.kanGemme ? formen(v) : html`<p class="row-note">${P.ejeren}</p>`}
    <p class="row-note" data-post-staaende>${P.staaende}</p>
  </article>`;
}
