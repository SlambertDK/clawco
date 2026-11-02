// KC-0145: the Sunday sample in Nu — one bunke: the week's number (counted by Clawco from its own records when the
// sample was drawn) above five lines, each with Rigtigt and Skulle have vist mig det; and the stop question after three
// clean weeks. Pure: data in, HTML out (every text through the escaper).

import { html, type Markup } from '../../shell/html.ts';
import { handlinger, knap, tilstandChip } from '../../shell/sprog.ts';
import { visHoved } from '../../shell/visuel.ts';
import type { Stikuge, TraekPost } from '../../tillid/stikproeve.ts';
import { hjemTekst } from './tekster.ts';

/** "Denne uge skjulte jeg 212 ting. Her er 5 tilfældige. Var det rigtigt?" */
export function stikproeveOverskrift(u: Pick<Stikuge, 'skjulte' | 'traek'>): string {
  return hjemTekst().stikOverskrift(u.skjulte, u.traek.length);
}

function linje(uge: string, p: TraekPost): Markup {
  const t = hjemTekst();
  const note = [t.skjultKilde[p.kilde] ?? p.kilde, p.regelId ? t.regelId(p.regelId) : ''].filter(Boolean).join(' · ');
  const svar = p.svar
    ? tilstandChip(p.svar === 'rigtigt' ? 'ordnet' : 'rolig', p.svar === 'rigtigt' ? t.rigtigt : t.skulleHaveVaeretVist)
    : handlinger(undefined, [
      knap({ label: t.rigtigt, attrs: { 'data-stikproeve-svar': 'rigtigt', 'data-uge': uge, 'data-id': p.id } }),
      knap({ label: t.skulleHaveVistMig, attrs: { 'data-stikproeve-svar': 'forkert', 'data-uge': uge, 'data-id': p.id } }),
    ]);
  return html`<div class="row stikproeve-linje" data-stikproeve-id="${p.id}"><span class="row-main"><span class="row-title">${p.titel}</span><span class="row-note">${note}</span></span>${svar}</div>`;
}

/** The week's card while a drawn line waits for an answer. */
export function stikproeveKort(u: Stikuge): Markup {
  const t = hjemTekst();
  return html`<section class="card card-list gruppe stikproeve" data-blok="bunke" data-stikproeve="${u.uge}" data-element="${t.stikElement(stikproeveOverskrift(u))}">
    ${visHoved({ ikon: 'list-checks' }, stikproeveOverskrift(u), t.soendagstjek)}
    <p class="row-note">${t.stikTekst}</p>
    ${u.traek.map((p) => linje(u.uge, p))}
  </section>`;
}

/** After three clean weeks in a row: may the Sunday check stop? */
export function stopKort(): Markup {
  const t = hjemTekst();
  return html`<article class="card kort" data-blok="beslutning" data-soendagstjek-stop data-element="${t.stopTitel}">
    ${visHoved({ ikon: 'circle-check', tone: 'god' }, t.stopTitel, t.soendagstjek)}
    <p class="betydning">${t.stopTekst}</p>
    ${handlinger(knap({ label: t.jaStop, slags: 'primaer', attrs: { 'data-soendagstjek-stop-svar': 'ja' } }), [knap({ label: t.nejFortsaet, attrs: { 'data-soendagstjek-stop-svar': 'nej' } })])}
  </article>`;
}
