// HTML for the room Nyheder.

import { html, type Markup } from '../../shell/html.ts';
import { fold } from '../../shell/fold.ts';
import type { LogEntry } from '../../store/types.ts';
import type { NyhederState, Nyhed, Bane, RelevansFor } from './schema.ts';
import { dagensLog, resultatBoks, senesteResultater } from '../../shell/log.ts';
import { friskhedEfter } from '../../shell/friskhed.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import { baand, delKnap, igangGruppe, medId, unikIder, spoerg, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';

const FORTRYD_TIMER = 24;
function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

const REL_LABEL: Record<RelevansFor, string> = { mig: 'Mig', familie: 'Familien', arbejde: 'Arbejde', danmark: 'Danmark', holdning: 'Holdning', projekter: 'Projekter' };

function nyhedRow(n: Nyhed, gemt: boolean, id: string): Markup {
  const label = `Nyheden: ${n.titel}`;
  return medId(id, html`<article class="row nyhed" data-element="${label}"${zoneData(n)}>
    <span class="row-main">
      ${n.url ? html`<a class="row-title" href="${n.url}" target="_blank" rel="noopener">${n.titel}</a>` : html`<span class="row-title">${n.titel}</span>`}
      <span class="row-note">${n.hvorfor}${n.kilde ? html` <span class="mono muted">· ${n.kilde}</span>` : ''} ${zoneChip(n)}</span>
      ${n.relevans?.length ? html`<span class="relevans">${n.relevans.map((r) => html`<span class="rel rel-${r.for}"><b>${REL_LABEL[r.for]}</b> ${r.note}</span>`)}</span>` : ''}
      <div class="actions actions-small">
        ${gemt ? html`${tilstandChip('ordnet', 'Gemt')}` : html`<button type="button" class="btn btn-ghost" data-aktion="gem" data-arg="${JSON.stringify({ nyhedId: n.id })}" data-status="gemmer til senere">Gem til senere</button>`}
        ${spoerg(label)}
        ${delKnap(n.titel, n.url)}
      </div>
    </span>
  </article>`);
}

function bane(b: Bane, gemt: Set<string>, unik: (id: string) => string): Markup {
  return html`<section class="card card-list bane" data-element="Banen: ${b.navn}">
    <div class="card-head"><h2 class="eyebrow">${b.navn}</h2><span class="muted mono">${b.nyheder.length}</span></div>
    ${b.nyheder.map((n) => nyhedRow(n, gemt.has(n.id), unik(`nyhed:${n.url ?? n.titel}`)))}
  </section>`;
}

function logRow(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

/** A forslag: waits on Henrik (open handling, or a reply in the chat) until its handling has a result. */
function forslagKort(f: NyhederState['forslag'][number], r: LogEntry | undefined): Markup {
  return html`<article class="card" data-element="Forslaget: ${f.tekst}"><p>${f.tekst}</p>${r ? resultatBoks(r) : f.handling ? html`<div class="actions"><button type="button" class="btn btn-primary" data-handling="${f.handling.id}">${f.handling.label}</button></div>` : html`<p class="row-note">Svar i chatten, hvis du vil.</p>`}</article>`;
}

export function renderNyheder(state: NyhederState, log: LogEntry[], now: Date, igang: IgangRaekke[] = []): Markup {
  const gemt = new Set(state.gemt);
  const unik = unikIder();
  const k = state.kilder;
  const resultater = senesteResultater(log);
  const resultat = (f: NyhederState['forslag'][number]): LogEntry | undefined => (f.handling ? resultater.get(f.handling.id) : undefined);
  const indhold = html`${state.femLinjer.length ? html`<section class="card" data-element="I dag i fem linjer">
    <div class="card-head"><h2>I dag i fem linjer</h2>${spoerg('I dag i fem linjer')}</div>
    <ol class="lines">${state.femLinjer.map((l) => html`<li>${l}</li>`)}</ol>
  </section>` : ''}

  ${fold('Banerne', html`<div class="baner">${state.baner.map((b) => bane(b, gemt, unik))}</div>`)}

  ${k.fejlede.length ? html`<p class="kilder-fejl">Kilder, der ikke svarede i dag: ${k.fejlede.join(', ')}.</p>` : ''}`;
  return html`
  <header class="room-head">
    <div><h1>Nyheder</h1><p class="muted">Morgenavisen, udvalgt af Hermes · ${k.medNyheder} af ${k.antal} kilder svarede, ${k.nyheder} nyheder${friskhedEfter(state.genereret, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="Bed Hermes udvælge igen">Opdatér</button>
  </header>

  ${baand({
    kraever: [{ titel: 'Hermes foreslår', form: 'kort', elementer: state.forslag.filter((f) => !resultat(f)).map((f) => ({ id: `nyheder-forslag:${f.id}`, html: forslagKort(f, undefined) })) }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [
      { titel: 'Hermes foreslog', form: 'kort', elementer: state.forslag.filter((f) => resultat(f)).map((f) => ({ id: `nyheder-forslag:${f.id}`, html: forslagKort(f, resultat(f)) })) },
      { titel: 'Nyhedsbreve arkiveret i dag', form: 'raekker', elementer: state.nyhedsbreve.map((b) => ({ id: `nyhedsbrev:${b.mailId}`, html: html`<div class="row" data-element="Nyhedsbrevet: ${b.emne}"><span class="row-main"><span class="row-title">${b.emne}</span><span class="row-note">${b.fra}</span></span>${spoerg(`Nyhedsbrevet: ${b.emne}`)}</div>` })) },
      { titel: 'Hermes\' arbejde i rummet', form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) },
    ],
  })}`;
}

export function renderNyhederEmpty(grund: string): Markup {
  return html`
  <header class="room-head"><div><h1>Nyheder</h1><p class="muted">Ingen avis endnu</p></div></header>
  <section class="card">
    <h2>Rummet er tomt</h2>
    <p class="muted">${grund}</p>
    <p class="muted">Kiras morgenavis henter normalt kilderne kl. 7. Hermes kan hente dem nu; det tager et par minutter.</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-opdater="hent">Bed Hermes hente avisen</button></div>
  </section>`;
}
