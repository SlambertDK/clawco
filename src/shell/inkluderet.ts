// KC-0265: the included AI of a Sky plan, on screen. Two pure pieces: the month's meter (Start's card and the Kø panel) and
// the one calm card in Nu when the month's allowance is used up, with its one way on ("use the AI you already have", a link to
// Start's provider form). Data in, markup out; every text through the escaper and the language tables (tekst().inkl). Words
// are plain on purpose: no key, no provider, no model name — the people this is for (spec 2026-11-03 §5, Alma and Mette) never
// see those unless they open the form themselves.

import { html, type Markup } from './html.ts';
import { tekst } from './tekster.ts';
import { visHoved } from './visuel.ts';
import type { Forbrug } from '../agent/inkluderet.ts';

/** Where "use the AI you already have" leads: Start's step 2, its provider form opened (public/app.js opens the fold for this hash). */
export const EGEN_AI_HREF = '/rum/start#model-form';

/** "1. december" / "1 December": the reset date (YYYY-MM-DD) as the language writes a day. */
export function datoTekst(iso: string): string {
  return new Intl.DateTimeFormat(tekst().lokale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}

/** The meter: a bar and one line, "12 % af månedens AI er brugt · starter forfra 1. december". */
export function renderMaaler(f: Forbrug): Markup {
  const T = tekst().inkl;
  const p = Math.max(0, Math.min(100, Math.round(f.procent)));
  return html`<div class="inkl-maaler" data-inkluderet-maaler="${String(p)}"><meter class="inkl-meter" min="0" max="100" value="${String(p)}" aria-label="${T.maalerLabel}">${String(p)} %</meter><p class="row-note">${T.maaler(p, datoTekst(f.nulstilles))}</p></div>`;
}

/** The Kø panel's card: the meter under its title (the owner's; only where Clawco's AI is the chosen one). */
export function renderKoeMaaler(f: Forbrug): Markup {
  const T = tekst().inkl;
  return html`<div class="card card-list inkl-panel" data-blok="bunke" data-gruppe="${T.maalerTitel}" data-inkluderet-panel><div class="card-head"><h3 class="eyebrow">${T.maalerTitel}</h3></div><div class="row">${renderMaaler(f)}</div></div>`;
}

/** What Nu is told when the allowance is used up: the reset date when the proxy gave one. */
export type InkluderetBrugt = { nulstilles?: string };

/** The one calm card in Nu: used up, when it starts over, and the way to the AI the person already has. */
export function inkluderetBrugtKort(d: InkluderetBrugt): Markup {
  const T = tekst().inkl;
  return html`<article class="card kort" data-blok="kort" data-inkluderet-kort="brugt" data-element="${T.brugtTitel}">
    ${visHoved({ ikon: 'info' }, T.brugtTitel, T.titel)}
    <p class="betydning">${d.nulstilles ? T.brugtMedDato(datoTekst(d.nulstilles)) : T.brugtUdenDato}</p>
    <div class="actions"><a class="btn btn-primary" href="${EGEN_AI_HREF}" data-inkluderet-egen>${T.brugEgen}</a></div>
  </article>`;
}
