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
import { aldrigTilladt } from '../../graenser/afgoer.ts';
import type { LogEntry } from '../../store/types.ts';
import { dagensLog, resultatBoks, senesteResultater } from '../../shell/log.ts';
import { friskhedEfter, kildeFriskhedEfter, klokkeIso as klokke, type KildeFriskhed } from '../../shell/friskhed.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import { sigAnbefaling, sigKalender } from './stemme.ts';
import { dagenTekst } from './tekster.ts';
import { afvistLinje, agentKnap, fortrydKnap, baand, delKnap, handlinger, medId, unikIder, igangGruppe, knap, spoerg, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';

const FORTRYD_TIMER = 24;

function datoLinje(dato: string): string {
  const d = new Date(`${dato}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dato;
  const t = dagenTekst();
  return t.datoLinje(t.dage[d.getUTCDay()]!, d.getUTCDate(), t.maaneder[d.getUTCMonth()]!);
}


/** KC-0059: the weather's pictogram, chosen from its text. */
function vejrIkon(vejr: string): IkonNavn {
  const t = vejr.toLowerCase();
  if (/regn|byge|støv|sjap|rain|shower|drizzle|sleet/.test(t)) return 'cloud-rain';
  if (/sol|sun/.test(t)) return 'sun';
  return 'cloud-sun';
}

function handlingKnap(h: Handling, primary: boolean): Markup {
  const aldrig = aldrigTilladt(handlingensVerb(h)); // KC-0122: never a button for what Clawco never does
  if (aldrig) return afvistLinje(h.label, aldrig);
  return agentKnap({ h, verb: handlingensVerb(h), slags: primary ? 'primaer' : 'normal', attrs: { 'data-handling': h.id } });
}

function statusChip(status: KalenderPost['status']): Markup | '' {
  if (!status) return '';
  return tilstandChip(status === 'klar' || status === 'flyttet' ? 'ordnet' : 'rolig', dagenTekst().kalenderStatus[status]);
}

function kalenderRaekke(k: KalenderPost, resultater: Map<string, LogEntry>, id: string): Markup {
  const label = dagenTekst().moedet(k.tid, k.titel);
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
  const t = dagenTekst();
  const fortrudt = Boolean(e.fortrudt);
  const forAeldet = now.getTime() - new Date(e.tid).getTime() > FORTRYD_TIMER * 3600_000;
  const kanFortrydes = Boolean(e.fortryd) && !fortrudt && !forAeldet;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">${t.fortrudtKl}${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kanFortrydes ? fortrydKnap({ id: e.id, fortryd: e.fortryd, label: t.fortryd }) : ''}
  </div>`;
}

export function renderDagen(state: DagenState, log: LogEntry[], now: Date, igang: IgangRaekke[] = [], kilde?: KildeFriskhed | null): Markup {
  const t = dagenTekst();
  const a = state.anbefaling;
  const resultater = senesteResultater(log);
  const aRes = a.handling ? resultater.get(a.handling.id) : undefined;
  // KC-0095: a Dagen from an earlier day waits only to be built again; its anbefaling is yesterday's.
  const gammel = dagenGammel(state, now);
  // KC-0064 rule 6: while the anbefaling has a handling still to press, the overblik waits on Henrik and is the room's one large element.
  const staerkt = !gammel && Boolean(a.handling && !aRes);
  const overblik = html`<section class="card dagen-overblik${staerkt ? ' kort-stor' : ''}">
    ${state.visuel?.billede ? billede(state.visuel.billede, { nu: now, dag: state.dato }) : ''}
    <div class="dagen-anbefaling" data-element="${t.anbefalingen(a.tekst)}"${a.handling && !aRes ? html` data-sig="${sigAnbefaling(a)}"` : ''}>${visHoved({ ikon: a.ikon ?? 'lightbulb', ...(staerkt ? { tone: 'adv' as const } : {}) }, a.overskrift ?? a.tekst, t.anbefaling)}</div>
    ${aRes ? resultatBoks(aRes) : a.handling ? handlinger(handlingKnap(a.handling, !gammel)) : ''}
    ${mere(html`${a.overskrift ? html`<p class="betydning">${a.tekst}</p>` : ''}<div data-element="${t.dagenITreLinjer}">${spoerg(t.dagenITreLinjer)}<ul class="lines">${state.treLinjer.map((l) => html`<li>${l}</li>`)}</ul></div>`, t.dagenITreLinjer)}
  </section>`;
  const unik = unikIder();
  const indhold = html`${staerkt ? '' : medId('dagen:anbefaling', overblik)}
  <section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">${t.kalender}</h2><span class="muted mono">${t.antalAftaler(state.kalender.length)}</span></div>
    ${state.kalender.length ? state.kalender.map((k) => kalenderRaekke(k, resultater, unik(`aftale:${k.tid}|${k.titel}`))) : html`<p class="muted row">${t.ingenAftaler}</p>`}
  </section>

  ${fold(t.morgenavisen, html`<section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">${t.morgenavisen}</h2><span class="muted mono">${t.antalValgt(state.morgenavis.length)}</span></div>
    ${state.morgenavis.map((n) => medId(unik(`avis:${n.url ?? n.titel}`), html`<article class="row news" data-element="${t.nyheden(n.titel)}"${zoneData(n)}>
      <span class="row-main">
        ${n.url ? html`<a class="row-title" href="${n.url}" target="_blank" rel="noopener">${n.titel}</a>` : html`<span class="row-title">${n.titel}</span>`}${zoneChip(n)}
        <span class="row-note">${n.hvorfor}${n.kilde ? html` <span class="mono muted">· ${n.kilde}</span>` : ''}</span>
      </span>
      <span class="actions">${spoerg(t.nyheden(n.titel))}${delKnap(n.titel, n.url)}</span>
    </article>`))}
  </section>`)}

  ${state.ugen?.length ? fold(t.ugenFrem, html`<section class="card card-list">
    <div class="card-head"><h2 class="eyebrow">${t.ugenFrem}</h2><span class="muted mono">${t.antalDage(state.ugen.length)}</span></div>
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
    <div><h1>${t.rum}</h1><p class="muted">${datoLinje(state.dato)}${state.vejr ? html` · <span class="vejr-ikon">${ikon(vejrIkon(state.vejr))}</span> ${state.vejr}` : ''}${friskhedEfter(state.genereret, now)}${kildeFriskhedEfter(kilde, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="${t.opdaterTitel}">${t.opdater}</button>
  </header>

  ${baand({
    // KC-0093: the calendar's handlinger wait on Henrik too (the nav counts them) though they stay in the plan below.
    venter: venterDagen(state, log, now),
    kraever: [
      { titel: t.dagenErIkkeBygget, form: 'kort', elementer: gammel === 'byg' ? [{ id: 'dagen:byg', html: bygKort() }] : [] },
      { titel: t.anbefaling, form: 'kort', elementer: staerkt ? [{ id: 'dagen:anbefaling', html: overblik }] : [] },
    ],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [{ titel: t.hermesArbejdeIDag, form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRaekke(e, now) })) }],
  })}`;
}

/** KC-0095: the morning build has not made today's Dagen — one press asks Hermes to build it now. */
function bygKort(): Markup {
  const t = dagenTekst();
  return html`<section class="card" data-element="${t.nuIkkeBygget}">
    <h3>${t.nuIkkeBygget}</h3>
    <p class="muted">${t.ikkeByggetTekst}</p>
    ${handlinger(knap({ label: t.bygNu, slags: 'primaer', attrs: { 'data-opdater': 'opdater' } }))}
  </section>`;
}

export function renderDagenEmpty(grund: string): Markup {
  const t = dagenTekst();
  return html`
  <header class="room-head"><div><h1>${t.rum}</h1><p class="muted">${t.ingenData}</p></div></header>
  <section class="card">
    <h2>${t.rummetErTomt}</h2>
    <p class="muted">${grund}</p>
    <p class="muted">${t.tomForklaring}</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-opdater="hent">${t.bedHermesHente}</button></div>
  </section>`;
}
