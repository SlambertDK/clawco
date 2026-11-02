// KC-0233: Start's Danmark-pakke step — how to get a note in Nu when new Digital Post arrives. Pure: data in, Markup
// out; every text through html``. Plain Danish, three steps: switch the notification on in Digital Post, give it the
// address Clawco reads, pick the sender address from the list the inbox itself offers, pick where you read your post.
// Shown only while a mail source is connected and no sender is confirmed (KC-0052); it leaves Start once confirmed.
// The list shows addresses only, never a subject. The free field accepts only an address on a hint domain: the server
// refuses anything else with a plain sentence (src/danmark/vindue.ts). Admin UI copy: Claude's call, for review.

import { html, type Markup } from '../../shell/html.ts';
import { tilstandChip } from '../../shell/sprog.ts';

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

const TITEL = 'Få besked, når der er ny Digital Post';
const STAAENDE = 'Clawco ser kun notifikationen: hverken brevet eller mailens tekst.';

function afsendere(v: PostStartVisning): Markup {
  if (v.kandidater.length === 0) {
    return html`<p class="row-note" data-post-ingen>${v.laeser === 'kan-ikke-se' ? 'Clawco kan ikke se din indbakke lige nu, så der er ingen liste. Skriv adressen selv herunder.' : 'Clawco har ikke set nogen notifikationsmail endnu. Når den første er kommet, står dens adresse her. Du kan også skrive adressen selv.'}</p>`;
  }
  return html`<div class="stack" role="radiogroup" aria-label="Afsenderadresse">${v.kandidater.map((a, i) => html`<label class="field-check"><input type="radio" name="afsender" value="${a}"${i === 0 ? html` checked` : ''}><span class="mono">${a}</span></label>`)}</div>`;
}

function formen(v: PostStartVisning): Markup {
  return html`<form id="post-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <p class="row-title">2. Vælg afsenderen</p>
    <p class="row-note">Det er adressen, notifikationsmailen kommer fra. Her er de adresser i din indbakke, der ligner Digital Post.</p>
    ${afsendere(v)}
    <label class="field"><span class="row-note">Eller skriv adressen (den skal slutte på ${v.domaener.join(', ')})</span><input name="egen" type="text" inputmode="email" spellcheck="false" maxlength="200" autocomplete="off" data-uden-stemme></label>
    <p class="row-title">3. Hvor læser du din Digital Post?</p>
    <p class="row-note">Det er dit link i kortet i Nu. Clawco logger aldrig ind dér.</p>
    <div class="stack" role="radiogroup" aria-label="Postkasse">${v.visere.map((x) => html`<label class="field-check"><input type="radio" name="viser" value="${x.id}"${x.id === v.viser ? html` checked` : ''}><span>${x.navn}</span></label>`)}</div>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="post-afsender-gem" data-form="post-form" data-status="gemmer">Gem</button><button type="button" class="btn btn-ghost" data-aktion="post-ikke-nu" data-status="lægger væk">Ikke nu</button></div>
  </form>`;
}

export function renderDigitalPostStart(v: PostStartVisning): Markup {
  return html`<article class="card kort" data-blok="kort" data-post-start data-element="Danmark-pakke: ${TITEL}">
    <div class="kort-head">${tilstandChip('rolig', 'Valgfrit')}<span class="row-title">${TITEL}</span></div>
    <p>Clawco kan lægge et kort i Nu, når Digital Post har sendt dig en notifikation om ny post. Det sker ved at læse den mail, Digital Post selv sender.</p>
    <p class="row-title">1. Slå notifikationen til</p>
    <p class="row-note">Åbn Digital Post (på mit.dk, e-Boks eller borger.dk), og slå «Notifikation på e-mail» til. Giv den e-mailadresse, som Clawco læser.</p>
    ${v.kanGemme ? formen(v) : html`<p class="row-note">Ejeren vælger afsenderen og postkassen.</p>`}
    <p class="row-note" data-post-staaende>${STAAENDE}</p>
  </article>`;
}
