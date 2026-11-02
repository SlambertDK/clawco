// HTML for the room Skrive. Buttons use data-aktion + data-arg (see app.js).

import { html, type Markup } from '../../shell/html.ts';
import { dagensLog } from '../../shell/log.ts';
import type { LogEntry } from '../../store/types.ts';
import { dokumentTekst, type SkriveState, type Dokument, type Forslag } from './schema.ts';
import { baand, igangGruppe, knap, medId, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';
import { tekst } from '../../shell/tekster.ts';
import { klokkeIso as klokke } from '../../shell/friskhed.ts';
import { skriveTekst } from './tekster.ts';

const FORTRYD_TIMER = 24;

const arg = (o: Record<string, unknown>): string => JSON.stringify(o);

function forslagKnapper(dokId: string, afsnitId: string | null): Markup {
  const T = skriveTekst();
  const typer: [string, string][] = [['stram', T.stramOp], ['konkret', T.goerKonkret], ['kortere', T.kortere]];
  return html`<div class="actions actions-small">${typer.map(([type, label]) => html`<button type="button" class="btn btn-ghost" data-aktion="forslag" data-arg="${arg({ dokId, afsnitId, type })}" data-status="${label}">${label}</button>`)}</div>`;
}

function afsnitRow(dok: Dokument, a: { id: string; tekst: string }, i: number, forslag: Forslag[]): Markup {
  const has = forslag.some((f) => f.afsnitId === a.id);
  const label = skriveTekst().afsnit(i + 1);
  return medId(`afsnit:${dok.id}:${a.id}`, html`<div class="afsnit${has ? ' has-forslag' : ''}" data-element="${label}" data-afsnit="${a.id}">
    <p>${a.tekst}</p>
    <div class="afsnit-tools"><span class="mono muted">${label}</span>${forslagKnapper(dok.id, a.id)}</div>
  </div>`);
}

function forslagKort(f: Forslag, dok: Dokument): Markup {
  const T = skriveTekst();
  const idx = dok.afsnit.findIndex((a) => a.id === f.afsnitId);
  const hvor = f.afsnitId === null ? T.nytAfsnitEfter(dok.afsnit.findIndex((a) => a.id === f.efterId) + 1) : T.afsnit(idx + 1);
  return html`<article class="card forslag" data-element="${T.forslagTil(hvor)}">
    <div class="card-head"><h3 class="eyebrow">${T.hermesForeslaar(hvor)}</h3><span class="mono muted">${klokke(f.tid)}</span></div>
    <p class="forslag-ny">${f.ny}</p>
    ${f.hvorfor ? html`<p class="row-note">${f.hvorfor}</p>` : ''}
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="brug" data-arg="${arg({ forslagId: f.id })}">${T.brug}</button><button type="button" class="btn btn-ghost" data-aktion="afvis" data-arg="${arg({ forslagId: f.id })}">${T.afvis}</button></div>
  </article>`;
}

function logRow(e: LogEntry, now: Date): Markup {
  const T = skriveTekst();
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}">
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">${T.fortrudtKl(klokke(e.fortrudt ?? ''))}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">${T.fortryd}</button>` : ''}
  </div>`;
}

function nytForm(): Markup {
  const T = skriveTekst();
  return html`<form id="nyt-form" class="card nyt-form" onsubmit="return false">
    <h2>${T.nytUdkast}</h2>
    <label class="field"><span class="row-note">${T.titelValgfri}</span><input name="titel" type="text" maxlength="120" placeholder="${T.titelPlaceholder}"></label>
    <label class="field"><span class="row-note">${T.briefSpoergsmaal}</span><textarea name="brief" rows="3" maxlength="2000" placeholder="${T.briefPlaceholder}" required></textarea></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nyt" data-form="nyt-form" data-status="${T.statusSkriver}">${T.skrivUdkastet}</button></div>
  </form>`;
}

export function renderSkrive(state: SkriveState, log: LogEntry[], now: Date, igang: IgangRaekke[] = []): Markup {
  const T = skriveTekst();
  const dok = state.dokumenter.find((d) => d.id === state.aktivt) ?? state.dokumenter[0] ?? null;
  const forslag = dok ? state.forslag.filter((f) => f.dokId === dok.id) : [];
  const indhold = html`${state.dokumenter.length ? html`<div class="doks">${state.dokumenter.map((d) => d.id === dok?.id
    ? tilstandChip('handling', d.titel)
    : html`<button type="button" class="chip chip-muted chip-btn" data-aktion="vaelg" data-arg="${arg({ dokId: d.id })}" data-status="${T.statusSkifter}">${d.titel}</button>`)}<button type="button" class="chip chip-muted chip-btn" data-aktion="nyt" data-prompt="brief=${T.briefSpoergsmaal}" data-status="${T.statusSkriver}">${T.nytUdkastChip}</button></div>` : ''}

  ${dok ? html`
  <section class="card dok" data-element="${T.udkastet(dok.titel)}">
    <div class="card-head"><h2>${dok.titel}</h2><span class="mono muted">${T.aendretKl(klokke(dok.aendret))}</span></div>
    <p class="row-note">${T.brief(dok.brief)}</p>
    <div class="afsnit-liste">${dok.afsnit.map((a, i) => afsnitRow(dok, a, i, forslag))}</div>
    <div class="afsnit-tools"><span class="mono muted">${T.heleTeksten}</span>${forslagKnapper(dok.id, null)}</div>
    ${dok.kilder.length ? html`<div class="kilder"><span class="eyebrow">${T.kilderIUdkastet}</span><ul>${dok.kilder.map((k) => html`<li>${k}</li>`)}</ul></div>` : ''}
    ${dok.gemtSom ? html`<p class="row-note">${T.gemtIObsidian(dok.gemtSom)}</p>` : ''}
  </section>` : html`
  <section class="card"><h2>${T.ingenUdkast}</h2><p class="muted">${T.ingenUdkastTekst}</p></section>`}

  ${nytForm()}`;
  return html`
  <header class="room-head">
    <div><h1>${tekst().rum['skrive']}</h1><p class="muted">${T.undertitel}</p></div>
    ${dok ? html`<div class="actions">${knap({ label: T.kopier, attrs: { 'data-kopier': dokumentTekst(dok) } })}<a class="btn" href="/rum/skrive/dok/${dok.id}.md" download>${T.hentSomFil}</a><button type="button" class="btn" data-aktion="gem" data-arg="${arg({ dokId: dok.id })}" data-status="${T.statusGemmer}">${dok.gemtSom ? T.gemIgenIObsidian : T.gemIObsidian}</button></div>` : ''}
  </header>

  ${baand({
    kraever: [{ titel: T.hermesForslagGruppe, form: 'kort', elementer: dok ? forslag.map((f) => ({ id: `forslag:${f.id}`, html: forslagKort(f, dok) })) : [] }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [{ titel: T.aendringer, form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) }],
  })}`;
}
