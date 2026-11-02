// KC-0145: the Sunday sample in Nu — one bunke: the week's number (counted by Clawco from its own records when the
// sample was drawn) above five lines, each with Rigtigt and Skulle have vist mig det; and the stop question after three
// clean weeks. Pure: data in, HTML out (every text through the escaper).

import { html, type Markup } from '../../shell/html.ts';
import { handlinger, knap, tilstandChip } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import type { Stikuge, TraekPost } from '../../tillid/stikproeve.ts';
import { SKJULT_KILDE } from '../../tillid/skjulte.ts';

/** "Denne uge skjulte jeg 212 ting. Her er 5 tilfældige. Var det rigtigt?" */
export function stikproeveOverskrift(u: Pick<Stikuge, 'skjulte' | 'traek'>): string {
  const n = u.traek.length;
  return `Denne uge skjulte jeg ${u.skjulte} ting. Her er ${n} ${n === 1 ? 'tilfældig' : 'tilfældige'}. Var det rigtigt?`;
}

function linje(uge: string, p: TraekPost): Markup {
  const note = [SKJULT_KILDE[p.kilde] ?? p.kilde, p.regelId ? `regel ${p.regelId}` : ''].filter(Boolean).join(' · ');
  const svar = p.svar
    ? tilstandChip(p.svar === 'rigtigt' ? 'ordnet' : 'rolig', p.svar === 'rigtigt' ? 'Rigtigt' : 'Skulle have været vist')
    : handlinger(undefined, [
      knap({ label: 'Rigtigt', attrs: { 'data-stikproeve-svar': 'rigtigt', 'data-uge': uge, 'data-id': p.id } }),
      knap({ label: 'Skulle have vist mig det', attrs: { 'data-stikproeve-svar': 'forkert', 'data-uge': uge, 'data-id': p.id } }),
    ]);
  return html`<div class="row stikproeve-linje" data-stikproeve-id="${p.id}"><span class="row-main"><span class="row-title">${p.titel}</span><span class="row-note">${note}</span></span>${svar}</div>`;
}

/** The week's card while a drawn line waits for an answer. */
export function stikproeveKort(u: Stikuge): Markup {
  return html`<section class="card card-list gruppe stikproeve" data-blok="bunke" data-stikproeve="${u.uge}" data-element="Søndagstjek: ${stikproeveOverskrift(u)}">
    ${visHoved({ ikon: 'list-checks' }, stikproeveOverskrift(u), 'Søndagstjek')}
    <p class="row-note">Tallet er talt af Clawco: det, jeg lagde væk i ugen. Svarer du Skulle have vist mig det, foreslår jeg, hvad der skal ændres; intet ændres uden dit ja.</p>
    ${u.traek.map((p) => linje(u.uge, p))}
  </section>`;
}

/** After three clean weeks in a row: may the Sunday check stop? */
export function stopKort(): Markup {
  return html`<article class="card kort" data-blok="beslutning" data-soendagstjek-stop data-element="Skal vi stoppe søndagstjekket?">
    ${visHoved({ ikon: 'circle-check', tone: 'god' }, 'Skal vi stoppe søndagstjekket?', 'Søndagstjek')}
    <p class="betydning">Tre uger i træk var alt det, jeg skjulte, rigtigt. Du kan tænde tjekket igen med Fortryd i loggen.</p>
    ${handlinger(knap({ label: 'Ja, stop det', slags: 'primaer', attrs: { 'data-soendagstjek-stop-svar': 'ja' } }), [knap({ label: 'Nej, fortsæt', attrs: { 'data-soendagstjek-stop-svar': 'nej' } })])}
  </article>`;
}
