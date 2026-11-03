// HTML for the room Nyheder.

import { html, type Markup } from '../../shell/html.ts';
import { fold } from '../../shell/fold.ts';
import type { LogEntry } from '../../store/types.ts';
import type { NyhederState, Nyhed, Bane, RelevansFor } from './schema.ts';
import { dagensLog, resultatBoks, senesteResultater } from '../../shell/log.ts';
import { friskhedEfter, klokkeIso as klokke } from '../../shell/friskhed.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import { agentKnap, baand, delKnap, igangGruppe, medId, unikIder, spoerg, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';
import { tekst } from '../../shell/tekster.ts';
import { nyhederTekst } from './tekster.ts';
import { handlingensVerb } from '../dagen/schema.ts';

const FORTRYD_TIMER = 24;

function nyhedRow(n: Nyhed, gemt: boolean, id: string): Markup {
  const T = nyhederTekst();
  const label = T.nyhedElement(n.titel);
  return medId(id, html`<article class="row nyhed" data-element="${label}"${zoneData(n)}>
    <span class="row-main">
      ${n.url ? html`<a class="row-title" href="${n.url}" target="_blank" rel="noopener">${n.titel}</a>` : html`<span class="row-title">${n.titel}</span>`}
      <span class="row-note">${n.hvorfor}${n.kilde ? html` <span class="mono muted">· ${n.kilde}</span>` : ''} ${zoneChip(n)}</span>
      ${n.relevans?.length ? html`<span class="relevans">${n.relevans.map((r) => html`<span class="rel rel-${r.for}"><b>${T.relevans[r.for]}</b> ${r.note}</span>`)}</span>` : ''}
      <div class="actions actions-small">
        ${gemt ? html`${tilstandChip('ordnet', T.gemt)}` : html`<button type="button" class="btn btn-ghost" data-aktion="gem" data-arg="${JSON.stringify({ nyhedId: n.id })}" data-status="${T.statusGemmer}">${T.gemTilSenere}</button>`}
        ${spoerg(label)}
        ${delKnap(n.titel, n.url)}
      </div>
    </span>
  </article>`);
}

function bane(b: Bane, gemt: Set<string>, unik: (id: string) => string): Markup {
  return html`<section class="card card-list bane" data-element="${nyhederTekst().baneElement(b.navn)}">
    <div class="card-head"><h2 class="eyebrow">${b.navn}</h2><span class="muted mono">${b.nyheder.length}</span></div>
    ${b.nyheder.map((n) => nyhedRow(n, gemt.has(n.id), unik(`nyhed:${n.url ?? n.titel}`)))}
  </section>`;
}

function logRow(e: LogEntry, now: Date): Markup {
  const T = nyhederTekst();
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">${T.fortrudtKl(klokke(e.fortrudt ?? ''))}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">${T.fortryd}</button>` : ''}
  </div>`;
}

/** A forslag: waits on Henrik (open handling, or a reply in the chat) until its handling has a result. */
function forslagKort(f: NyhederState['forslag'][number], r: LogEntry | undefined): Markup {
  return html`<article class="card" data-element="${nyhederTekst().forslagElement(f.tekst)}"><p>${f.tekst}</p>${r ? resultatBoks(r) : f.handling ? html`<div class="actions">${agentKnap({ h: f.handling, verb: handlingensVerb(f.handling), slags: 'primaer', attrs: { 'data-handling': f.handling.id } })}</div>` : html`<p class="row-note">${nyhederTekst().svarIChatten}</p>`}</article>`;
}

export function renderNyheder(state: NyhederState, log: LogEntry[], now: Date, igang: IgangRaekke[] = []): Markup {
  const T = nyhederTekst();
  const gemt = new Set(state.gemt);
  const unik = unikIder();
  const k = state.kilder;
  const resultater = senesteResultater(log);
  const resultat = (f: NyhederState['forslag'][number]): LogEntry | undefined => (f.handling ? resultater.get(f.handling.id) : undefined);
  const indhold = html`${state.femLinjer.length ? html`<section class="card" data-element="${T.femLinjer}">
    <div class="card-head"><h2>${T.femLinjer}</h2>${spoerg(T.femLinjer)}</div>
    <ol class="lines">${state.femLinjer.map((l) => html`<li>${l}</li>`)}</ol>
  </section>` : ''}

  ${fold(T.banerne, html`<div class="baner">${state.baner.map((b) => bane(b, gemt, unik))}</div>`)}

  ${k.fejlede.length ? html`<p class="kilder-fejl">${T.kilderFejlede(k.fejlede.join(', '))}</p>` : ''}`;
  return html`
  <header class="room-head">
    <div><h1>${tekst().rum['nyheder']}</h1><p class="muted">${T.undertitel(k.medNyheder, k.antal, k.nyheder)}${friskhedEfter(state.genereret, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="${T.opdaterTitel}">${T.opdater}</button>
  </header>

  ${baand({
    kraever: [{ titel: T.hermesForeslaar, form: 'kort', elementer: state.forslag.filter((f) => !resultat(f)).map((f) => ({ id: `nyheder-forslag:${f.id}`, html: forslagKort(f, undefined) })) }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [
      { titel: T.hermesForeslog, form: 'kort', elementer: state.forslag.filter((f) => resultat(f)).map((f) => ({ id: `nyheder-forslag:${f.id}`, html: forslagKort(f, resultat(f)) })) },
      { titel: T.nyhedsbreveArkiveret, form: 'raekker', elementer: state.nyhedsbreve.map((b) => ({ id: `nyhedsbrev:${b.mailId}`, html: html`<div class="row" data-element="${T.nyhedsbrevElement(b.emne)}"><span class="row-main"><span class="row-title">${b.emne}</span><span class="row-note">${b.fra}</span></span>${spoerg(T.nyhedsbrevElement(b.emne))}</div>` })) },
      { titel: T.hermesArbejde, form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) },
    ],
  })}`;
}

export function renderNyhederEmpty(grund: string): Markup {
  const T = nyhederTekst();
  return html`
  <header class="room-head"><div><h1>${tekst().rum['nyheder']}</h1><p class="muted">${T.ingenAvisEndnu}</p></div></header>
  <section class="card">
    <h2>${T.rummetErTomt}</h2>
    <p class="muted">${grund}</p>
    <p class="muted">${T.henterNormalt}</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-opdater="hent">${T.hentAvisen}</button></div>
  </section>`;
}
