// HTML for the Univers room family: the overview, one univers (with its task
// board) and the meeting view. Pure: state in, Markup out. Everything from
// Hermes or Henrik goes through html`` (the escaper); presentations are only
// ever shown inside <iframe sandbox> served by the inline `vis` route.
// Buttons follow the client contract in public/app.js: data-aktion +
// data-arg (JSON) and, for forms, data-form="<form id>".

import { html, type Markup } from '../../shell/html.ts';
import { fold } from '../../shell/fold.ts';
import { avatar, billede, ikon, mere, parseIkon, visHoved } from '../../shell/visuel.ts';
import { baand, igangGruppe, medId, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';
import { dagensLog } from '../../shell/log.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import type { LogEntry } from '../../store/types.ts';
import type { Deltager, Dokument, Moede, MoedeKandidat, Opgave, OpgaveStatus, UniversIndeks, UniversInfo, UniversState } from './schema.ts';
import { universRum, type UniversStat } from './lager.ts';
import { universTekst } from './tekster.ts';
import { tekst } from '../../shell/tekster.ts';
import { klokkeIso as klokke } from '../../shell/friskhed.ts';

const arg = (o: Record<string, unknown>): string => JSON.stringify(o);
const TZ = 'Europe/Copenhagen';
const FORTRYD_TIMER = 24;

// ---------- Time and wording ----------


const dagNoegle = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function plusDage(noegle: string, n: number): string {
  const [y, m, d] = noegle.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** "i dag 11.00", "i morgen 09.30", "tirs. 29. okt. 10.00". */
function tid(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dag = dagNoegle(d);
  const i_dag = dagNoegle(now);
  const T = universTekst();
  const label = dag === i_dag ? T.iDag
    : dag === plusDage(i_dag, 1) ? T.iMorgen
      : dag === plusDage(i_dag, -1) ? T.iGaar
        : new Intl.DateTimeFormat(tekst().lokale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${label} ${klokke(iso)}`;
}

const tidsrum = (m: { start: string; slut: string }, now: Date): string => `${tid(m.start, now)}–${klokke(m.slut)}`;

function varighed(min: number): string {
  const T = universTekst();
  if (min < 60) return T.minutter(min);
  const t = Math.floor(min / 60);
  const r = min % 60;
  return r ? T.timerOgMinutter(t, r) : T.timer(t);
}

/** "om 10 min" before the start, "35 min tilbage" while it runs, "slut" after. */
function resterende(m: Moede, now: Date): string {
  const start = Date.parse(m.start);
  const slut = Date.parse(m.slut);
  if (Number.isNaN(start) || Number.isNaN(slut)) return '';
  const T = universTekst();
  if (now.getTime() < start) return T.omVarighed(varighed(Math.max(1, Math.ceil((start - now.getTime()) / 60_000))));
  if (now.getTime() < slut) return T.tilbageVarighed(varighed(Math.max(1, Math.ceil((slut - now.getTime()) / 60_000))));
  return T.slut;
}

const navne = (ds: Deltager[], max = 6): string => (ds.length > max ? `${ds.slice(0, max).map((d) => d.navn).join(', ')} +${ds.length - max}` : ds.map((d) => d.navn).join(', '));
const visUrl = (slug: string, dokId: string): string => `/rum/${universRum(slug)}/vis/${encodeURIComponent(dokId)}.html`;
const kommende = (m: Moede, now: Date): boolean => Date.parse(m.slut) > now.getTime();
const aabne = (os: Opgave[]): Opgave[] => os.filter((o) => o.status !== 'faerdig');

/** KC-0059: the faces of a meeting: avatar + name + (short) role, from the preparation when it has any, else the calendar's list. */
const kortRolle = (hvem: string): string => {
  const foerste = (hvem.split(/[;.]/)[0] ?? '').trim();
  return foerste.length > 40 ? `${foerste.slice(0, 39).trimEnd()}…` : foerste;
};
function ansigter(m: Moede): Markup {
  const f = m.forberedelse;
  const personer = f && f.deltagere.length
    ? f.deltagere.map((d) => ({ navn: d.navn, ...(kortRolle(d.hvem) ? { rolle: kortRolle(d.hvem) } : {}) }))
    : m.deltagere.map((d) => ({ navn: d.navn }));
  return personer.length ? billede({ art: 'personer', personer }) : html`<p class="muted">${universTekst().ingenDeltagere}</p>`;
}

/** The talking points in order, each led by its small round pictogram (chevron-right when it has none). The text is the li's only text: the demo's "Find mere" reads it. */
function talepunkter(f: NonNullable<Moede['forberedelse']>): Markup {
  return html`<ol class="lines">${f.talepunkter.map((t, i) => html`<li><span class="vis-ikon tilstand-rolig tp-ikon">${ikon(parseIkon(f.talepunktIkoner?.[i]) ?? 'chevron-right')}</span><span class="tp-tekst">${t}</span></li>`)}</ol>`;
}

/** Untrusted presentation HTML: sandboxed with no scripts, forms, popups or top
 * navigation (and the `vis` route's CSP blocks scripts again). allow-same-origin
 * alone grants nothing without scripts, and keeps the frame in-process so it
 * renders and can be verified like the rest of the page. */
function ramme(slug: string, dok: Dokument, klasse: string): Markup {
  return html`<iframe class="${klasse}" sandbox="allow-same-origin" src="${visUrl(slug, dok.id)}" loading="lazy" title="${dok.titel}"></iframe>`;
}

// ---------- Forms and small parts ----------

function forberedForm(m: Moede, label = universTekst().forbered, primaer = true): Markup {
  const id = `forbered-${m.id}`;
  const T = universTekst();
  return html`<form id="${id}" class="uv-forbered" onsubmit="return false">
    <label class="field"><span class="row-note">${T.onske}</span><input name="onske" type="text" maxlength="400" placeholder="${T.onskeEksempel}"></label>
    <div class="actions"><button type="button" class="btn${primaer ? ' btn-primary' : ''}" data-aktion="forbered" data-arg="${arg({ moedeId: m.id })}" data-form="${id}" data-status="${T.forbererModet}">${label}</button></div>
  </form>`;
}

const flyt = (): Record<OpgaveStatus, [OpgaveStatus, string][]> => {
  const T = universTekst();
  return {
    aaben: [['igang', T.status.igang], ['faerdig', T.status.faerdig]],
    igang: [['aaben', T.status.aaben], ['faerdig', T.status.faerdig]],
    faerdig: [['aaben', T.aabnIgen]],
  };
};

function opgaveRow(o: Opgave, state: UniversState, kunFaerdigKnap = false): Markup {
  const moede = o.moedeId ? state.moeder.find((m) => m.id === o.moedeId) : undefined;
  const T = universTekst();
  const knapper = flyt()[o.status].filter(([til]) => !kunFaerdigKnap || til === 'faerdig');
  return html`<div class="row uv-opgave" data-element="Opgave: ${o.titel}">
    <span class="row-main"><span class="row-title">${o.titel}</span>${o.note ? html`<span class="row-note">${o.note}</span>` : ''}${moede ? html`<span class="chip chip-muted">${T.moedeChip}${moede.titel}</span>` : ''}</span>
    <span class="actions actions-small">${knapper.map(([til, label]) => html`<button type="button" class="btn btn-ghost" data-aktion="opgaveStatus" data-arg="${arg({ opgaveId: o.id, status: til })}" data-status="${T.flytter}">${label}</button>`)}</span>
  </div>`;
}

function tavle(state: UniversState): Markup {
  const T = universTekst();
  const kol = (status: OpgaveStatus): Markup => {
    const liste = state.opgaver.filter((o) => o.status === status);
    const indhold = liste.length ? html`<div class="card-list">${liste.map((o) => medId(`opg:${o.id}`, opgaveRow(o, state)))}</div>` : html`<p class="muted row">${T.ingen}</p>`;
    return html`<section class="uv-kolonne" data-status="${status}">
      <div class="card-head"><h3 class="eyebrow">${T.status[status]}</h3><span class="muted mono">${liste.length}</span></div>
      ${status === 'faerdig' && liste.length ? fold(T.faerdigeOpgaver, indhold, 'opgaver-faerdig') : indhold}
    </section>`;
  };
  return html`<div class="uv-tavle">${kol('aaben')}${kol('igang')}${kol('faerdig')}</div>`;
}

function moedeKort(slug: string, m: Moede, now: Date): Markup {
  const f = m.forberedelse;
  const kommer = kommende(m, now);
  const T = universTekst();
  return html`<article class="card uv-moede-kort" data-element="Møde: ${m.titel}">
    <div class="card-head"><h3>${m.titel}</h3><span class="mono muted">${tidsrum(m, now)}</span></div>
    ${m.sted ? html`<p class="row-note">${m.sted}</p>` : ''}
    ${ansigter(m)}
    ${f ? html`
      <p>${tilstandChip('ordnet', T.forberedt)}</p>
      ${visHoved({ ikon: 'target' }, f.maal, T.mal)}
      ${fold(T.talepunkterFold, talepunkter(f), `talepunkter-${m.id}`)}
      <div class="actions"><a class="btn btn-primary" href="/moede/${encodeURIComponent(slug)}/${encodeURIComponent(m.id)}">${T.aabnMoedevisningen}</a></div>
      ${kommer ? fold(T.forberedIgenFold, forberedForm(m, T.forberedIgen, false), `forbered-${m.id}`) : ''}
    ` : html`
      ${kommer ? html`<p>${tilstandChip('kraever', T.ikkeForberedt)}</p>${forberedForm(m)}` : html`<p class="muted">${T.ikkeForberedtPunktum}</p>`}
    `}
  </article>`;
}

function dokumentKort(slug: string, d: Dokument, now: Date): Markup {
  const T = universTekst();
  return html`<article class="card uv-dok" data-element="Dokument: ${d.titel}"${zoneData(d)}>
    <div class="card-head"><h3>${d.titel}</h3>${zoneChip(d)}<span class="mono muted">${T.aendret}${tid(d.aendret, now)} · ${T.nVersioner(d.versioner.length + 1)}</span></div>
    ${fold(T.forhaandsvisning, ramme(slug, d, 'uv-forhaand'), `dok-${d.id}`)}
    <div class="actions"><a class="btn" href="${visUrl(slug, d.id)}" target="_blank" rel="noopener noreferrer">${T.aabnKnap}</a></div>
  </article>`;
}

// ---------- Overview ----------

function kandidatKort(k: MoedeKandidat, i: number, aktive: UniversInfo[], now: Date): Markup {
  const id = `placer-${i}`;
  const T = universTekst();
  return html`<form id="${id}" class="card uv-kandidat" onsubmit="return false" data-element="Nyt møde: ${k.titel}">
    <div class="card-head"><h3>${k.titel}</h3><span class="mono muted">${tidsrum(k, now)}</span></div>
    <p class="row-note">${k.deltagere.length ? navne(k.deltagere) : T.ingenDeltagere}${k.sted ? html` · ${k.sted}` : ''}</p>
    ${aktive.length ? html`
      <label class="field"><span class="row-note">${T.nyMoedeHvilket}</span><select name="slug">${aktive.map((u) => html`<option value="${u.id}">${u.navn}</option>`)}</select></label>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-aktion="placerMoede" data-arg="${arg({ eventId: k.eventId })}" data-form="${id}" data-status="${T.laegger}">${T.laegIUnivers}</button>
        <button type="button" class="btn btn-ghost" data-aktion="skjulMoede" data-arg="${arg({ eventId: k.eventId })}" data-status="${T.skjuler}">${T.ikkeEtMoede}</button>
      </div>` : html`
      <p class="row-note">${T.opretForst}</p>
      <div class="actions"><button type="button" class="btn btn-ghost" data-aktion="skjulMoede" data-arg="${arg({ eventId: k.eventId })}" data-status="${T.skjuler}">${T.ikkeEtMoede}</button></div>`}
  </form>`;
}

/** The overview: active universes as tiles, "Nyt univers", and meetings waiting for a univers. */
/** KC-0148: `husstand` — the household universe is there for the person looking; its tile comes first. */
export function renderOversigt(indeks: UniversIndeks, stats: Record<string, UniversStat>, now: Date, igang: IgangRaekke[] = [], o: { husstand?: boolean } = {}): Markup {
  const T = universTekst();
  const aktive = indeks.univers.filter((u) => !u.arkiveret);
  const husstand = o.husstand ? html`<a class="tile" href="/rum/husstand" data-element="Husstanden">
        <span class="tile-name">${tekst().rum['husstand']}</span>
        <span class="row-note">${T.husstandOm}</span>
      </a>` : '';
  const indhold = html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.dineUniverser}</h2><span class="muted mono">${aktive.length}</span></div>
    ${!aktive.length && o.husstand ? html`<div class="tiles">${husstand}</div>` : ''}
    ${aktive.length ? html`<div class="tiles">${husstand}${aktive.map((u) => {
      const s = stats[u.id];
      return medId(`univers:${u.id}`, html`<a class="tile" href="/rum/${universRum(u.id)}" data-element="Univers: ${u.navn}">
        <span class="tile-name">${u.navn}</span>
        ${u.om ? html`<span class="row-note">${u.om}</span>` : ''}
        ${s ? html`<span class="mono muted">${T.nMoeder(s.moeder)} · ${T.nAabneOpgaver(s.aabneOpgaver)}</span>` : ''}
      </a>`);
    })}</div>` : html`<section class="card"><h3>${T.ingenUniverser}</h3><p class="muted">${T.ingenUniverserTekst}</p></section>`}
  </section>

  <form id="nyt-univers" class="card nyt-form" onsubmit="return false">
    <h2>${T.nytUnivers}</h2>
    <label class="field"><span class="row-note">${T.navn}</span><input name="navn" type="text" maxlength="80" placeholder="${T.navnEksempel}" required></label>
    <label class="field"><span class="row-note">${T.omHvad}</span><input name="om" type="text" maxlength="400" placeholder="${T.omEksempel}"></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nytUnivers" data-form="nyt-univers" data-status="${T.opretter}">${T.opretUnivers}</button></div>
  </form>`;
  return html`
  <header class="room-head">
    <div><h1>${tekst().rum['univers']}</h1><p class="muted">${T.rumIntro}</p></div>
  </header>

  ${baand({
    kraever: [{ titel: T.nyeMoeder, form: 'kort', elementer: indeks.nyeMoeder.map((k, i) => ({ id: `kandidat:${k.eventId}`, html: kandidatKort(k, i, aktive, now) })) }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [],
  })}`;
}

// ---------- One univers ----------

function naeste(state: UniversState, slug: string, now: Date): Markup {
  const naesteMoede = state.moeder.filter((m) => kommende(m, now)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const abne = aabne(state.opgaver).length;
  const T = universTekst();
  return html`<section class="card" data-element="Næste i universet">
    <div class="card-head"><h2 class="eyebrow">${T.naeste}</h2><span class="muted mono">${T.nAabneOpgaver(abne)}</span></div>
    ${naesteMoede ? html`<div class="row"><span class="mono time">${tid(naesteMoede.start, now)}</span><span class="row-main"><span class="row-title">${naesteMoede.titel}</span><span class="row-note">${naesteMoede.forberedelse ? T.forberedt : T.ikkeForberedtEndnu}</span></span>${naesteMoede.forberedelse ? html`<a class="btn" href="/moede/${encodeURIComponent(slug)}/${encodeURIComponent(naesteMoede.id)}">${T.aabnKnap}</a>` : ''}</div>` : html`<p class="muted row">${T.ingenKommende}</p>`}
  </section>`;
}

function nytMoedeForm(): Markup {
  const T = universTekst();
  return html`<form id="nyt-moede" class="card nyt-form" onsubmit="return false">
    <h2>${T.nytMoede}</h2>
    <label class="field"><span class="row-note">${T.titel}</span><input name="titel" type="text" maxlength="200" placeholder="${T.moedeEksempel}" required></label>
    <label class="field"><span class="row-note">${T.starter}</span><input name="start" type="datetime-local" required></label>
    <label class="field"><span class="row-note">${T.varighedMin}</span><input name="varighed" type="number" min="5" max="1440" step="5" value="60"></label>
    <label class="field"><span class="row-note">${T.deltagereIndtast}</span><input name="deltagere" type="text" maxlength="500" placeholder="Jonas Holm, Line Berg"></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nytMoede" data-form="nyt-moede" data-status="${T.tilfoejer}">${T.tilfoejMoedet}</button></div>
  </form>`;
}

/** One univers: header, Næste, Møder, Opgaver (board), Dokumenter, Noter and the Nyt møde form. */
/** KC-0093: what waits on Henrik in one univers — its open opgaver and upcoming meetings without a forberedelse; the nav's number and the room's. */
export function venterUnivers(state: UniversState, now: Date): number {
  return state.opgaver.filter((o) => o.status !== 'faerdig').length + state.moeder.filter((m) => kommende(m, now) && !m.forberedelse).length;
}

export function renderUnivers(info: UniversInfo, state: UniversState, now: Date, o: { log?: LogEntry[]; igang?: IgangRaekke[] } = {}): Markup {
  const T = universTekst();
  const kommer = state.moeder.filter((m) => kommende(m, now)).sort((a, b) => a.start.localeCompare(b.start));
  const forbi = state.moeder.filter((m) => !kommende(m, now)).sort((a, b) => b.start.localeCompare(a.start));
  const dokumenter = [...state.dokumenter].sort((a, b) => b.aendret.localeCompare(a.aendret));
  const noter = [...state.noter].sort((a, b) => b.oprettet.localeCompare(a.oprettet));
  // Upcoming meetings without a forberedelse wait on Henrik; prepared ones and past ones are the room's content.
  const ikkeForberedt = kommer.filter((m) => !m.forberedelse);
  const klar = kommer.filter((m) => m.forberedelse);
  const moeder = state.moeder.length === 0
    ? html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.moeder}</h2><span class="muted mono">0</span></div>
    <p class="muted">${T.ingenMoederEndnu}</p>
  </section>`
    : klar.length || forbi.length ? html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.moeder}</h2><span class="muted mono">${klar.length + forbi.length}</span></div>
    ${klar.map((m) => medId(`moede:${m.id}`, moedeKort(info.id, m, now)))}
    ${forbi.length ? fold(T.tidligereMoeder, html`<div class="stack">${forbi.map((m) => medId(`moede:${m.id}`, moedeKort(info.id, m, now)))}</div>`, 'tidligere-moeder') : ''}
  </section>` : '';
  const indhold = html`${naeste(state, info.id, now)}

  ${moeder}

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.opgaver}</h2><span class="muted mono">${state.opgaver.length}</span></div>
    ${state.opgaver.length ? tavle(state) : html`<p class="muted">${T.ingenOpgaverEndnu}</p>`}
  </section>

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.dokumenter}</h2><span class="muted mono">${dokumenter.length}</span></div>
    ${dokumenter.length ? dokumenter.map((d) => medId(`dok:${d.id}`, dokumentKort(info.id, d, now))) : html`<p class="muted">${T.ingenDokumenterEndnu}</p>`}
  </section>

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">${T.noter}</h2><span class="muted mono">${noter.length}</span></div>
    ${noter.length ? noter.map((n) => medId(`note:${n.id}`, html`<article class="card" data-element="Note: ${n.titel}"${zoneData(n)}><div class="card-head"><h3>${n.titel}</h3>${zoneChip(n)}<span class="mono muted">${tid(n.oprettet, now)}</span></div><p>${n.tekst}</p></article>`)) : html`<p class="muted">${T.ingenNoterEndnu}</p>`}
  </section>

  ${nytMoedeForm()}`;
  return html`
  <header class="room-head" data-element="Univers: ${info.navn}">
    <div><a class="muted" href="/rum/univers">${T.alleUniverser}</a><h1>${info.navn}</h1>${info.om ? html`<p class="muted">${info.om}</p>` : ''}</div>
  </header>

  ${baand({
    venter: venterUnivers(state, now),
    kraever: [{ titel: T.ikkeForberedt, form: 'kort', elementer: ikkeForberedt.map((m) => ({ id: `moede:${m.id}`, html: moedeKort(info.id, m, now) })) }],
    indhold,
    igang: [igangGruppe(o.igang ?? [])],
    ordnet: [{ titel: T.hvadErAendret, form: 'raekker', elementer: dagensLog(o.log ?? [], now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) }],
  })}`;
}

/** KC-0064: a log line with its Fortryd while there is something to undo (a young entry). */
function logRow(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const T = universTekst();
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">${T.fortrudtKl}${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">${T.fortryd}</button>` : ''}
  </div>`;
}

// ---------- The meeting view ----------

/** The meeting view (laptop: presentation left, goal/points/people/tasks right; phone: the core, presentation folded). */
export function renderMoedeVisning(info: UniversInfo, moede: Moede, state: UniversState, now: Date): Markup {
  const f = moede.forberedelse;
  const slide = f?.dokumentId ? state.dokumenter.find((d) => d.id === f.dokumentId) : undefined;
  const opgaver = aabne(state.opgaver.filter((o) => o.moedeId === moede.id));
  const rest = resterende(moede, now);
  const T = universTekst();
  return html`
  <header class="room-head uv-moedehoved" data-element="Mødet: ${moede.titel}">
    <div>
      <p class="muted">${info.navn}</p>
      <h1>${moede.titel}</h1>
      <p class="mono muted">${rest ? html`<strong>${rest}</strong> · ` : ''}${tidsrum(moede, now)}${moede.sted ? html` · ${moede.sted}` : ''}</p>
      ${f ? html`<div class="uv-maal">${visHoved({ ikon: 'target' }, f.maal, T.mal)}</div>` : ''}
    </div>
    <div class="actions"><a class="btn" href="/rum/dagen" data-forlad-moede="${moede.id}">${T.tilDagen}</a></div>
  </header>

  ${f ? html`
  <div class="uv-moedevisning">
    ${slide ? html`<section class="uv-slides" data-element="Præsentationen: ${slide.titel}">${fold(T.praesentationenFold, ramme(info.id, slide, 'uv-praesentation'), 'praesentation')}</section>` : ''}
    <div class="uv-side stack">
      <section class="card" data-element="Talepunkter">
        <div class="card-head"><h2 class="eyebrow">${T.talepunkter}</h2></div>
        ${talepunkter(f)}
      </section>
      <section class="card" data-element="Deltagerne">
        <div class="card-head"><h2 class="eyebrow">${T.deltagere}</h2></div>
        ${f.deltagere.length ? f.deltagere.map((d) => html`<div class="row uv-deltager">${avatar(d.navn)}<span class="row-main"><span class="row-title">${d.navn}</span>${d.hvem ? html`<span class="row-note">${d.hvem}</span>` : ''}${d.baggrund || d.vil ? mere(html`${d.baggrund ? html`<p class="row-note">${d.baggrund}</p>` : ''}${d.vil ? html`<p class="row-note">${T.vilSandsynligvis}${d.vil}</p>` : ''}`, T.baggrund) : ''}</span></div>`) : ansigter(moede)}
      </section>
      <section class="card" data-element="Mødets opgaver">
        <div class="card-head"><h2 class="eyebrow">${T.opgaverTilMoedet}</h2><span class="muted mono">${opgaver.length}</span></div>
        ${opgaver.length ? html`<div class="card-list">${opgaver.map((o) => opgaveRow(o, state, true))}</div>` : html`<p class="muted row">${T.ingenAabneTilMoedet}</p>`}
      </section>
    </div>
  </div>` : html`
  <section class="card">
    <h2>${T.ikkeForberedtEndnu}</h2>
    <p class="muted">${T.hermesKanLave}${moede.deltagere.length ? T.deltagereKolon(navne(moede.deltagere)) : ''}</p>
    ${forberedForm(moede)}
  </section>`}`;
}
