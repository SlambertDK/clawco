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

const arg = (o: Record<string, unknown>): string => JSON.stringify(o);
const TZ = 'Europe/Copenhagen';
const FORTRYD_TIMER = 24;

// ---------- Time and wording ----------

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

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
  const label = dag === i_dag ? 'i dag'
    : dag === plusDage(i_dag, 1) ? 'i morgen'
      : dag === plusDage(i_dag, -1) ? 'i går'
        : new Intl.DateTimeFormat('da-DK', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${label} ${klokke(iso)}`;
}

const tidsrum = (m: { start: string; slut: string }, now: Date): string => `${tid(m.start, now)}–${klokke(m.slut)}`;

function varighed(min: number): string {
  if (min < 60) return `${min} min`;
  const t = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${t} t ${r} min` : `${t} t`;
}

/** "om 10 min" before the start, "35 min tilbage" while it runs, "slut" after. */
function resterende(m: Moede, now: Date): string {
  const start = Date.parse(m.start);
  const slut = Date.parse(m.slut);
  if (Number.isNaN(start) || Number.isNaN(slut)) return '';
  if (now.getTime() < start) return `om ${varighed(Math.max(1, Math.ceil((start - now.getTime()) / 60_000)))}`;
  if (now.getTime() < slut) return `${varighed(Math.max(1, Math.ceil((slut - now.getTime()) / 60_000)))} tilbage`;
  return 'slut';
}

const antal = (n: number, en: string, flere: string): string => `${n} ${n === 1 ? en : flere}`;
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
  return personer.length ? billede({ art: 'personer', personer }) : html`<p class="muted">Ingen deltagere noteret</p>`;
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

function forberedForm(m: Moede, label = 'Forbered med Hermes', primaer = true): Markup {
  const id = `forbered-${m.id}`;
  return html`<form id="${id}" class="uv-forbered" onsubmit="return false">
    <label class="field"><span class="row-note">Hvad vil du have ud af mødet? (valgfrit)</span><input name="onske" type="text" maxlength="400" placeholder="Fx at få rollen afklaret"></label>
    <div class="actions"><button type="button" class="btn${primaer ? ' btn-primary' : ''}" data-aktion="forbered" data-arg="${arg({ moedeId: m.id })}" data-form="${id}" data-status="forbereder mødet">${label}</button></div>
  </form>`;
}

const STATUS_NAVN: Record<OpgaveStatus, string> = { aaben: 'Åben', igang: 'I gang', faerdig: 'Færdig' };
const FLYT: Record<OpgaveStatus, [OpgaveStatus, string][]> = {
  aaben: [['igang', 'I gang'], ['faerdig', 'Færdig']],
  igang: [['aaben', 'Åben'], ['faerdig', 'Færdig']],
  faerdig: [['aaben', 'Åben igen']],
};

function opgaveRow(o: Opgave, state: UniversState, kunFaerdigKnap = false): Markup {
  const moede = o.moedeId ? state.moeder.find((m) => m.id === o.moedeId) : undefined;
  const knapper = FLYT[o.status].filter(([til]) => !kunFaerdigKnap || til === 'faerdig');
  return html`<div class="row uv-opgave" data-element="Opgave: ${o.titel}">
    <span class="row-main"><span class="row-title">${o.titel}</span>${o.note ? html`<span class="row-note">${o.note}</span>` : ''}${moede ? html`<span class="chip chip-muted">Møde: ${moede.titel}</span>` : ''}</span>
    <span class="actions actions-small">${knapper.map(([til, label]) => html`<button type="button" class="btn btn-ghost" data-aktion="opgaveStatus" data-arg="${arg({ opgaveId: o.id, status: til })}" data-status="flytter">${label}</button>`)}</span>
  </div>`;
}

function tavle(state: UniversState): Markup {
  const kol = (status: OpgaveStatus): Markup => {
    const liste = state.opgaver.filter((o) => o.status === status);
    const indhold = liste.length ? html`<div class="card-list">${liste.map((o) => medId(`opg:${o.id}`, opgaveRow(o, state)))}</div>` : html`<p class="muted row">Ingen</p>`;
    return html`<section class="uv-kolonne" data-status="${status}">
      <div class="card-head"><h3 class="eyebrow">${STATUS_NAVN[status]}</h3><span class="muted mono">${liste.length}</span></div>
      ${status === 'faerdig' && liste.length ? fold('færdige opgaver', indhold, 'opgaver-faerdig') : indhold}
    </section>`;
  };
  return html`<div class="uv-tavle">${kol('aaben')}${kol('igang')}${kol('faerdig')}</div>`;
}

function moedeKort(slug: string, m: Moede, now: Date): Markup {
  const f = m.forberedelse;
  const kommer = kommende(m, now);
  return html`<article class="card uv-moede-kort" data-element="Møde: ${m.titel}">
    <div class="card-head"><h3>${m.titel}</h3><span class="mono muted">${tidsrum(m, now)}</span></div>
    ${m.sted ? html`<p class="row-note">${m.sted}</p>` : ''}
    ${ansigter(m)}
    ${f ? html`
      <p>${tilstandChip('ordnet', 'Forberedt')}</p>
      ${visHoved({ ikon: 'target' }, f.maal, 'Mål')}
      ${fold('talepunkter', talepunkter(f), `talepunkter-${m.id}`)}
      <div class="actions"><a class="btn btn-primary" href="/moede/${encodeURIComponent(slug)}/${encodeURIComponent(m.id)}">Åbn mødevisningen</a></div>
      ${kommer ? fold('forbered igen', forberedForm(m, 'Forbered igen', false), `forbered-${m.id}`) : ''}
    ` : html`
      ${kommer ? html`<p>${tilstandChip('kraever', 'Ikke forberedt')}</p>${forberedForm(m)}` : html`<p class="muted">Ikke forberedt.</p>`}
    `}
  </article>`;
}

function dokumentKort(slug: string, d: Dokument, now: Date): Markup {
  return html`<article class="card uv-dok" data-element="Dokument: ${d.titel}"${zoneData(d)}>
    <div class="card-head"><h3>${d.titel}</h3>${zoneChip(d)}<span class="mono muted">ændret ${tid(d.aendret, now)} · ${antal(d.versioner.length + 1, 'version', 'versioner')}</span></div>
    ${fold('forhåndsvisning', ramme(slug, d, 'uv-forhaand'), `dok-${d.id}`)}
    <div class="actions"><a class="btn" href="${visUrl(slug, d.id)}" target="_blank" rel="noopener noreferrer">Åbn</a></div>
  </article>`;
}

// ---------- Overview ----------

function kandidatKort(k: MoedeKandidat, i: number, aktive: UniversInfo[], now: Date): Markup {
  const id = `placer-${i}`;
  return html`<form id="${id}" class="card uv-kandidat" onsubmit="return false" data-element="Nyt møde: ${k.titel}">
    <div class="card-head"><h3>${k.titel}</h3><span class="mono muted">${tidsrum(k, now)}</span></div>
    <p class="row-note">${k.deltagere.length ? navne(k.deltagere) : 'Ingen deltagere noteret'}${k.sted ? html` · ${k.sted}` : ''}</p>
    ${aktive.length ? html`
      <label class="field"><span class="row-note">Hvilket univers hører det til?</span><select name="slug">${aktive.map((u) => html`<option value="${u.id}">${u.navn}</option>`)}</select></label>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-aktion="placerMoede" data-arg="${arg({ eventId: k.eventId })}" data-form="${id}" data-status="lægger mødet i univers">Læg i univers</button>
        <button type="button" class="btn btn-ghost" data-aktion="skjulMoede" data-arg="${arg({ eventId: k.eventId })}" data-status="skjuler mødet">Ikke et møde for mig</button>
      </div>` : html`
      <p class="row-note">Opret først et univers, så kan mødet lægges i det.</p>
      <div class="actions"><button type="button" class="btn btn-ghost" data-aktion="skjulMoede" data-arg="${arg({ eventId: k.eventId })}" data-status="skjuler mødet">Ikke et møde for mig</button></div>`}
  </form>`;
}

/** The overview: active universes as tiles, "Nyt univers", and meetings waiting for a univers. */
/** KC-0148: `husstand` — the household universe is there for the person looking; its tile comes first. */
export function renderOversigt(indeks: UniversIndeks, stats: Record<string, UniversStat>, now: Date, igang: IgangRaekke[] = [], o: { husstand?: boolean } = {}): Markup {
  const aktive = indeks.univers.filter((u) => !u.arkiveret);
  const husstand = o.husstand ? html`<a class="tile" href="/rum/husstand" data-element="Husstanden">
        <span class="tile-name">Husstanden</span>
        <span class="row-note">Hvem der er med, og det, der gælder jer alle.</span>
      </a>` : '';
  const indhold = html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">Dine universer</h2><span class="muted mono">${aktive.length}</span></div>
    ${!aktive.length && o.husstand ? html`<div class="tiles">${husstand}</div>` : ''}
    ${aktive.length ? html`<div class="tiles">${husstand}${aktive.map((u) => {
      const s = stats[u.id];
      return medId(`univers:${u.id}`, html`<a class="tile" href="/rum/${universRum(u.id)}" data-element="Univers: ${u.navn}">
        <span class="tile-name">${u.navn}</span>
        ${u.om ? html`<span class="row-note">${u.om}</span>` : ''}
        ${s ? html`<span class="mono muted">${antal(s.moeder, 'møde', 'møder')} · ${antal(s.aabneOpgaver, 'åben opgave', 'åbne opgaver')}</span>` : ''}
      </a>`);
    })}</div>` : html`<section class="card"><h3>Ingen universer endnu</h3><p class="muted">Opret et under, eller bed Hermes i chatten: "lav et univers om min arena".</p></section>`}
  </section>

  <form id="nyt-univers" class="card nyt-form" onsubmit="return false">
    <h2>Nyt univers</h2>
    <label class="field"><span class="row-note">Navn</span><input name="navn" type="text" maxlength="80" placeholder="Fx Min arena" required></label>
    <label class="field"><span class="row-note">Hvad handler det om? En sætning.</span><input name="om" type="text" maxlength="400" placeholder="Fx Min nye lederrolle og det, jeg skal levere i den"></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nytUnivers" data-form="nyt-univers" data-status="opretter univers">Opret univers</button></div>
  </form>`;
  return html`
  <header class="room-head">
    <div><h1>Univers</h1><p class="muted">Et sted per emne, der vokser. Alt, du og Hermes laver om emnet, bliver her.</p></div>
  </header>

  ${baand({
    kraever: [{ titel: 'Nye møder', form: 'kort', elementer: indeks.nyeMoeder.map((k, i) => ({ id: `kandidat:${k.eventId}`, html: kandidatKort(k, i, aktive, now) })) }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [],
  })}`;
}

// ---------- One univers ----------

function naeste(state: UniversState, slug: string, now: Date): Markup {
  const naesteMoede = state.moeder.filter((m) => kommende(m, now)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const abne = aabne(state.opgaver).length;
  return html`<section class="card" data-element="Næste i universet">
    <div class="card-head"><h2 class="eyebrow">Næste</h2><span class="muted mono">${antal(abne, 'åben opgave', 'åbne opgaver')}</span></div>
    ${naesteMoede ? html`<div class="row"><span class="mono time">${tid(naesteMoede.start, now)}</span><span class="row-main"><span class="row-title">${naesteMoede.titel}</span><span class="row-note">${naesteMoede.forberedelse ? 'Forberedt' : 'Ikke forberedt endnu'}</span></span>${naesteMoede.forberedelse ? html`<a class="btn" href="/moede/${encodeURIComponent(slug)}/${encodeURIComponent(naesteMoede.id)}">Åbn</a>` : ''}</div>` : html`<p class="muted row">Ingen kommende møder.</p>`}
  </section>`;
}

function nytMoedeForm(): Markup {
  return html`<form id="nyt-moede" class="card nyt-form" onsubmit="return false">
    <h2>Nyt møde</h2>
    <label class="field"><span class="row-note">Titel</span><input name="titel" type="text" maxlength="200" placeholder="Fx Pitch til Tom om lederrollen" required></label>
    <label class="field"><span class="row-note">Starter</span><input name="start" type="datetime-local" required></label>
    <label class="field"><span class="row-note">Varighed i minutter</span><input name="varighed" type="number" min="5" max="1440" step="5" value="60"></label>
    <label class="field"><span class="row-note">Deltagere (navne eller mails, adskilt af komma)</span><input name="deltagere" type="text" maxlength="500" placeholder="Jonas Holm, Line Berg"></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nytMoede" data-form="nyt-moede" data-status="tilføjer mødet">Tilføj mødet</button></div>
  </form>`;
}

/** One univers: header, Næste, Møder, Opgaver (board), Dokumenter, Noter and the Nyt møde form. */
/** KC-0093: what waits on Henrik in one univers — its open opgaver and upcoming meetings without a forberedelse; the nav's number and the room's. */
export function venterUnivers(state: UniversState, now: Date): number {
  return state.opgaver.filter((o) => o.status !== 'faerdig').length + state.moeder.filter((m) => kommende(m, now) && !m.forberedelse).length;
}

export function renderUnivers(info: UniversInfo, state: UniversState, now: Date, o: { log?: LogEntry[]; igang?: IgangRaekke[] } = {}): Markup {
  const kommer = state.moeder.filter((m) => kommende(m, now)).sort((a, b) => a.start.localeCompare(b.start));
  const forbi = state.moeder.filter((m) => !kommende(m, now)).sort((a, b) => b.start.localeCompare(a.start));
  const dokumenter = [...state.dokumenter].sort((a, b) => b.aendret.localeCompare(a.aendret));
  const noter = [...state.noter].sort((a, b) => b.oprettet.localeCompare(a.oprettet));
  // Upcoming meetings without a forberedelse wait on Henrik; prepared ones and past ones are the room's content.
  const ikkeForberedt = kommer.filter((m) => !m.forberedelse);
  const klar = kommer.filter((m) => m.forberedelse);
  const moeder = state.moeder.length === 0
    ? html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">Møder</h2><span class="muted mono">0</span></div>
    <p class="muted">Ingen møder endnu. Læg et fra Univers-oversigten, eller tilføj et nedenfor.</p>
  </section>`
    : klar.length || forbi.length ? html`<section class="stack">
    <div class="card-head"><h2 class="eyebrow">Møder</h2><span class="muted mono">${klar.length + forbi.length}</span></div>
    ${klar.map((m) => medId(`moede:${m.id}`, moedeKort(info.id, m, now)))}
    ${forbi.length ? fold('tidligere møder', html`<div class="stack">${forbi.map((m) => medId(`moede:${m.id}`, moedeKort(info.id, m, now)))}</div>`, 'tidligere-moeder') : ''}
  </section>` : '';
  const indhold = html`${naeste(state, info.id, now)}

  ${moeder}

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">Opgaver</h2><span class="muted mono">${state.opgaver.length}</span></div>
    ${state.opgaver.length ? tavle(state) : html`<p class="muted">Ingen opgaver endnu. Bed Hermes i chatten om at lave dem, eller forbered et møde.</p>`}
  </section>

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">Dokumenter</h2><span class="muted mono">${dokumenter.length}</span></div>
    ${dokumenter.length ? dokumenter.map((d) => medId(`dok:${d.id}`, dokumentKort(info.id, d, now))) : html`<p class="muted">Ingen dokumenter endnu. Bed Hermes i chatten om fx en præsentation eller et notat.</p>`}
  </section>

  <section class="stack">
    <div class="card-head"><h2 class="eyebrow">Noter</h2><span class="muted mono">${noter.length}</span></div>
    ${noter.length ? noter.map((n) => medId(`note:${n.id}`, html`<article class="card" data-element="Note: ${n.titel}"${zoneData(n)}><div class="card-head"><h3>${n.titel}</h3>${zoneChip(n)}<span class="mono muted">${tid(n.oprettet, now)}</span></div><p>${n.tekst}</p></article>`)) : html`<p class="muted">Ingen noter endnu.</p>`}
  </section>

  ${nytMoedeForm()}`;
  return html`
  <header class="room-head" data-element="Univers: ${info.navn}">
    <div><a class="muted" href="/rum/univers">Alle universer</a><h1>${info.navn}</h1>${info.om ? html`<p class="muted">${info.om}</p>` : ''}</div>
  </header>

  ${baand({
    venter: venterUnivers(state, now),
    kraever: [{ titel: 'Ikke forberedt', form: 'kort', elementer: ikkeForberedt.map((m) => ({ id: `moede:${m.id}`, html: moedeKort(info.id, m, now) })) }],
    indhold,
    igang: [igangGruppe(o.igang ?? [])],
    ordnet: [{ titel: 'Hvad der er ændret', form: 'raekker', elementer: dagensLog(o.log ?? [], now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) }],
  })}`;
}

/** KC-0064: a log line with its Fortryd while there is something to undo (a young entry). */
function logRow(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

// ---------- The meeting view ----------

/** The meeting view (laptop: presentation left, goal/points/people/tasks right; phone: the core, presentation folded). */
export function renderMoedeVisning(info: UniversInfo, moede: Moede, state: UniversState, now: Date): Markup {
  const f = moede.forberedelse;
  const slide = f?.dokumentId ? state.dokumenter.find((d) => d.id === f.dokumentId) : undefined;
  const opgaver = aabne(state.opgaver.filter((o) => o.moedeId === moede.id));
  const rest = resterende(moede, now);
  return html`
  <header class="room-head uv-moedehoved" data-element="Mødet: ${moede.titel}">
    <div>
      <p class="muted">${info.navn}</p>
      <h1>${moede.titel}</h1>
      <p class="mono muted">${rest ? html`<strong>${rest}</strong> · ` : ''}${tidsrum(moede, now)}${moede.sted ? html` · ${moede.sted}` : ''}</p>
      ${f ? html`<div class="uv-maal">${visHoved({ ikon: 'target' }, f.maal, 'Mål')}</div>` : ''}
    </div>
    <div class="actions"><a class="btn" href="/rum/dagen" data-forlad-moede="${moede.id}">Til Dagen</a></div>
  </header>

  ${f ? html`
  <div class="uv-moedevisning">
    ${slide ? html`<section class="uv-slides" data-element="Præsentationen: ${slide.titel}">${fold('præsentationen', ramme(info.id, slide, 'uv-praesentation'), 'praesentation')}</section>` : ''}
    <div class="uv-side stack">
      <section class="card" data-element="Talepunkter">
        <div class="card-head"><h2 class="eyebrow">Talepunkter</h2></div>
        ${talepunkter(f)}
      </section>
      <section class="card" data-element="Deltagerne">
        <div class="card-head"><h2 class="eyebrow">Deltagere</h2></div>
        ${f.deltagere.length ? f.deltagere.map((d) => html`<div class="row uv-deltager">${avatar(d.navn)}<span class="row-main"><span class="row-title">${d.navn}</span>${d.hvem ? html`<span class="row-note">${d.hvem}</span>` : ''}${d.baggrund || d.vil ? mere(html`${d.baggrund ? html`<p class="row-note">${d.baggrund}</p>` : ''}${d.vil ? html`<p class="row-note">Vil sandsynligvis: ${d.vil}</p>` : ''}`, 'Baggrund') : ''}</span></div>`) : ansigter(moede)}
      </section>
      <section class="card" data-element="Mødets opgaver">
        <div class="card-head"><h2 class="eyebrow">Opgaver til mødet</h2><span class="muted mono">${opgaver.length}</span></div>
        ${opgaver.length ? html`<div class="card-list">${opgaver.map((o) => opgaveRow(o, state, true))}</div>` : html`<p class="muted row">Ingen åbne opgaver til mødet.</p>`}
      </section>
    </div>
  </div>` : html`
  <section class="card">
    <h2>Ikke forberedt endnu</h2>
    <p class="muted">Hermes kan lave mål, talepunkter og en præsentation ud fra, hvem der er med.${moede.deltagere.length ? ` Deltagere: ${navne(moede.deltagere)}.` : ''}</p>
    ${forberedForm(moede)}
  </section>`}`;
}
