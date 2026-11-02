// HTML for the room Dagen: main column from state + log. Pure: state in,
// markup out. Element attributes the client script relies on:
//   data-element="…"      the text for the context chip ("Om: …")
//   data-handling="<id>"  a button that runs a stored handling
//   data-fortryd="<id>"   a button that undoes a log entry
//   data-opdater="hent"   the button that asks Hermes to fetch today

import { html, type Markup } from '../../shell/html.ts';
import { fold } from '../../shell/fold.ts';
import { billede, ikon, mere, visHoved, type IkonNavn } from '../../shell/visuel.ts';
import { dagenGammel, handlingensVerb, venterDagen, type DagenState, type Handling, type KalenderPost } from './schema.ts';
import { kraeverJa } from '../../graenser/verber.ts';
import { aldrigTilladt } from '../../graenser/afgoer.ts';
import type { LogEntry } from '../../store/types.ts';
import { dagensLog, resultatBoks, senesteResultater } from '../../shell/log.ts';
import { friskhedEfter, kildeFriskhedEfter, type KildeFriskhed } from '../../shell/friskhed.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import { sigAnbefaling, sigKalender } from './stemme.ts';
import { afvistLinje, baand, delKnap, handlinger, medId, unikIder, igangGruppe, knap, spoerg, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';

const FORTRYD_TIMER = 24;
const DAGE = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
const MDR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function datoLinje(dato: string): string {
  const d = new Date(`${dato}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dato;
  return `${DAGE[d.getUTCDay()]} ${d.getUTCDate()}. ${MDR[d.getUTCMonth()]}`;
}

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

/** KC-0059: the weather's pictogram, chosen from its text. */
function vejrIkon(vejr: string): IkonNavn {
  const t = vejr.toLowerCase();
  if (/regn|byge|støv|sjap/.test(t)) return 'cloud-rain';
  if (/sol/.test(t)) return 'sun';
  return 'cloud-sun';
}

function handlingKnap(h: Handling, primary: boolean): Markup {
  const aldrig = aldrigTilladt(handlingensVerb(h)); // KC-0122: never a button for what Clawco never does
  if (aldrig) return afvistLinje(h.label, aldrig);
  return knap({ label: h.label, slags: kraeverJa(handlingensVerb(h)) ? 'graense' : primary ? 'primaer' : 'normal', attrs: { 'data-handling': h.id } });
}

function statusChip(status: KalenderPost['status']): Markup | '' {
  if (!status) return '';
  return tilstandChip(status === 'klar' || status === 'flyttet' ? 'ordnet' : 'rolig', status);
}

function kalenderRaekke(k: KalenderPost, resultater: Map<string, LogEntry>, id: string): Markup {
  const label = `Mødet kl. ${k.tid}: ${k.titel}`;
  const r = k.handling ? resultater.get(k.handling.id) : undefined;
  return medId(id, html`<div class="row" data-element="${label}"${zoneData(k)}${k.handling && !r ? html` data-sig="${sigKalender(k)}"` : ''}>
    <span class="kal-ikon">${ikon(k.ikon ?? 'calendar')}</span>
    <span class="mono time">${k.tid}${k.slut ? html`<span class="muted">–${k.slut}</span>` : ''}</span>
    <span class="row-main"><span class="row-title">${k.titel}</span>${zoneChip(k)}${k.note ? html`<span class="row-note">${k.note}</span>` : ''}${r ? resultatBoks(r) : ''}</span>
    ${statusChip(k.status)}
    ${k.handling && !r ? handlingKnap(k.handling, false) : ''}
  </div>`);
}

function logRaekke(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const forAeldet = now.getTime() - new Date(e.tid).getTime() > FORTRYD_TIMER * 3600_000;
  const kanFortrydes = Boolean(e.fortryd) && !fortrudt && !forAeldet;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kanFortrydes ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

export function renderDagen(state: DagenState, log: LogEntry[], now: Date, igang: IgangRaekke[] = [], kilde?: KildeFriskhed | null): Markup {
  const a = state.anbefaling;
  const resultater = senesteResultater(log);
  const aRes = a.handling ? resultater.get(a.handling.id) : undefined;
  // KC-0095: a Dagen from an earlier day waits only to be built again; its anbefaling is yesterday's.
  const gammel = dagenGammel(state, now);
  // KC-0064 rule 6: while the anbefaling has a handling still to press, the overblik waits on Henrik and is the room's one large element.
  const staerkt = !gammel && Boolean(a.handling && !aRes);
  const overblik = html`<section class="card dagen-overblik${staerkt ? ' kort-stor' : ''}">
    ${state.visuel?.billede ? billede(state.visuel.billede, { nu: now, dag: state.dato }) : ''}
    <div class="dagen-anbefaling" data-element="Anbefalingen: ${a.tekst}"${a.handling && !aRes ? html` data-sig="${sigAnbefaling(a)}"` : ''}>${visHoved({ ikon: a.ikon ?? 'lightbulb', ...(staerkt ? { tone: 'adv' as const } : {}) }, a.overskrift ?? a.tekst, 'Anbefaling')}</div>
    ${aRes ? resultatBoks(aRes) : a.handling ? handlinger(handlingKnap(a.handling, !gammel)) : ''}
    ${mere(html`${a.overskrift ? html`<p class="betydning">${a.tekst}</p>` : ''}<div data-element="Dagen i tre linjer">${spoerg('Dagen i tre linjer')}<ul class="lines">${state.treLinjer.map((l) => html`<li>${l}</li>`)}</ul></div>`, 'Dagen i tre linjer')}
  </section>`;
  const unik = unikIder();
  const indhold = html`${staerkt ? '' : medId('dagen:anbefaling', overblik)}
  <section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">Kalender</h2><span class="muted mono">${state.kalender.length} aftaler</span></div>
    ${state.kalender.length ? state.kalender.map((k) => kalenderRaekke(k, resultater, unik(`aftale:${k.tid}|${k.titel}`))) : html`<p class="muted row">Ingen tidsatte aftaler i dag.</p>`}
  </section>

  ${fold('Morgenavisen', html`<section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">Morgenavisen</h2><span class="muted mono">${state.morgenavis.length} valgt</span></div>
    ${state.morgenavis.map((n) => medId(unik(`avis:${n.url ?? n.titel}`), html`<article class="row news" data-element="Nyheden: ${n.titel}"${zoneData(n)}>
      <span class="row-main">
        ${n.url ? html`<a class="row-title" href="${n.url}" target="_blank" rel="noopener">${n.titel}</a>` : html`<span class="row-title">${n.titel}</span>`}${zoneChip(n)}
        <span class="row-note">${n.hvorfor}${n.kilde ? html` <span class="mono muted">· ${n.kilde}</span>` : ''}</span>
      </span>
      <span class="actions">${spoerg(`Nyheden: ${n.titel}`)}${delKnap(n.titel, n.url)}</span>
    </article>`))}
  </section>`)}

  ${state.ugen?.length ? fold('Ugen frem', html`<section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">Ugen frem</h2><span class="muted mono">${state.ugen.length} dage</span></div>
    ${state.ugen.map((d) => { const label = datoLinje(d.dato); return medId(unik(`uge:${d.dato}`), html`<div class="row uge-dag" data-element="${label}">
      <span class="row-main">
        <span class="row-title">${label}</span>
        ${d.note ? html`<span class="uge-note">${d.note}</span>` : ''}
        ${d.aftaler.length ? html`<span class="uge-aftaler">${d.aftaler.map((a) => html`<span class="uge-aftale"><span class="mono muted">${a.tid}${a.slut ? `–${a.slut}` : ''}</span> ${a.titel}${a.kalender ? html` <span class="mono muted">· ${a.kalender}</span>` : ''}</span>`)}</span>` : ''}
      </span>
    </div>`); })}
  </section>`) : ''}`;
  return html`
  <header class="room-head">
    <div><h1>Dagen</h1><p class="muted">${datoLinje(state.dato)}${state.vejr ? html` · <span class="vejr-ikon">${ikon(vejrIkon(state.vejr))}</span> ${state.vejr}` : ''}${friskhedEfter(state.genereret, now)}${kildeFriskhedEfter(kilde, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="Bed Hermes bygge dagen igen">Opdatér</button>
  </header>

  ${baand({
    // KC-0093: the calendar's handlinger wait on Henrik too (the nav counts them) though they stay in the plan below.
    venter: venterDagen(state, log, now),
    kraever: [
      { titel: 'Dagen er ikke bygget', form: 'kort', elementer: gammel === 'byg' ? [{ id: 'dagen:byg', html: bygKort() }] : [] },
      { titel: 'Anbefaling', form: 'kort', elementer: staerkt ? [{ id: 'dagen:anbefaling', html: overblik }] : [] },
    ],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [{ titel: 'Hermes\' arbejde i dag', form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRaekke(e, now) })) }],
  })}`;
}

/** KC-0095: the morning build has not made today's Dagen — one press asks Hermes to build it now. */
function bygKort(): Markup {
  return html`<section class="card" data-element="Dagen er ikke bygget i dag">
    <h3>Dagen er ikke bygget i dag</h3>
    <p class="muted">Morgenbygningen har ikke lavet dagen for i dag. Hermes kan bygge den nu; det tager et par minutter.</p>
    ${handlinger(knap({ label: 'Byg Dagen nu', slags: 'primaer', attrs: { 'data-opdater': 'opdater' } }))}
  </section>`;
}

export function renderDagenEmpty(grund: string): Markup {
  return html`
  <header class="room-head"><div><h1>Dagen</h1><p class="muted">Ingen data endnu</p></div></header>
  <section class="card">
    <h2>Rummet er tomt</h2>
    <p class="muted">${grund}</p>
    <p class="muted">Kiras morgenavis bygger normalt dagens data kl. 7. Hermes kan hente dem nu med sine egne værktøjer; det tager et par minutter.</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-opdater="hent">Bed Hermes hente dagen</button></div>
  </section>`;
}
