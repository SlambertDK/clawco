// HTML for the room Skrive. Buttons use data-aktion + data-arg (see app.js).

import { html, type Markup } from '../../shell/html.ts';
import { dagensLog } from '../../shell/log.ts';
import type { LogEntry } from '../../store/types.ts';
import { dokumentTekst, type SkriveState, type Dokument, type Forslag } from './schema.ts';
import { baand, igangGruppe, knap, medId, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';

const FORTRYD_TIMER = 24;

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}
const arg = (o: Record<string, unknown>): string => JSON.stringify(o);

function forslagKnapper(dokId: string, afsnitId: string | null): Markup {
  const typer: [string, string][] = [['stram', 'Stram op'], ['konkret', 'Gør mere konkret'], ['kortere', 'Kortere']];
  return html`<div class="actions actions-small">${typer.map(([type, label]) => html`<button type="button" class="btn btn-ghost" data-aktion="forslag" data-arg="${arg({ dokId, afsnitId, type })}" data-status="${label}">${label}</button>`)}</div>`;
}

function afsnitRow(dok: Dokument, a: { id: string; tekst: string }, i: number, forslag: Forslag[]): Markup {
  const has = forslag.some((f) => f.afsnitId === a.id);
  const label = `Afsnit ${i + 1}`;
  return medId(`afsnit:${dok.id}:${a.id}`, html`<div class="afsnit${has ? ' has-forslag' : ''}" data-element="${label}" data-afsnit="${a.id}">
    <p>${a.tekst}</p>
    <div class="afsnit-tools"><span class="mono muted">${label}</span>${forslagKnapper(dok.id, a.id)}</div>
  </div>`);
}

function forslagKort(f: Forslag, dok: Dokument): Markup {
  const idx = dok.afsnit.findIndex((a) => a.id === f.afsnitId);
  const hvor = f.afsnitId === null ? `Nyt afsnit efter afsnit ${dok.afsnit.findIndex((a) => a.id === f.efterId) + 1}` : `Afsnit ${idx + 1}`;
  return html`<article class="card forslag" data-element="Forslag til ${hvor.toLowerCase()}">
    <div class="card-head"><h3 class="eyebrow">Hermes foreslår · ${hvor}</h3><span class="mono muted">${klokke(f.tid)}</span></div>
    <p class="forslag-ny">${f.ny}</p>
    ${f.hvorfor ? html`<p class="row-note">${f.hvorfor}</p>` : ''}
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="brug" data-arg="${arg({ forslagId: f.id })}">Brug</button><button type="button" class="btn btn-ghost" data-aktion="afvis" data-arg="${arg({ forslagId: f.id })}">Afvis</button></div>
  </article>`;
}

function logRow(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}">
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

function nytForm(): Markup {
  return html`<form id="nyt-form" class="card nyt-form" onsubmit="return false">
    <h2>Nyt udkast</h2>
    <label class="field"><span class="row-note">Titel (valgfri)</span><input name="titel" type="text" maxlength="120" placeholder="Fx Mail til driften om vinterberedskab"></label>
    <label class="field"><span class="row-note">Hvad skal Hermes skrive? Til hvem, hvilken tone, hvor langt.</span><textarea name="brief" rows="3" maxlength="2000" placeholder="Kort mail til Tom om, at vi strammer reserverne fra december. Venlig, konkret, højst fem linjer." required></textarea></label>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="nyt" data-form="nyt-form" data-status="skriver udkast">Skriv udkastet</button></div>
  </form>`;
}

export function renderSkrive(state: SkriveState, log: LogEntry[], now: Date, igang: IgangRaekke[] = []): Markup {
  const dok = state.dokumenter.find((d) => d.id === state.aktivt) ?? state.dokumenter[0] ?? null;
  const forslag = dok ? state.forslag.filter((f) => f.dokId === dok.id) : [];
  const indhold = html`${state.dokumenter.length ? html`<div class="doks">${state.dokumenter.map((d) => d.id === dok?.id
    ? tilstandChip('handling', d.titel)
    : html`<button type="button" class="chip chip-muted chip-btn" data-aktion="vaelg" data-arg="${arg({ dokId: d.id })}" data-status="skifter">${d.titel}</button>`)}<button type="button" class="chip chip-muted chip-btn" data-aktion="nyt" data-prompt="brief=Hvad skal Hermes skrive? Til hvem, hvilken tone, hvor langt." data-status="skriver udkast">+ Nyt udkast</button></div>` : ''}

  ${dok ? html`
  <section class="card dok" data-element="Udkastet: ${dok.titel}">
    <div class="card-head"><h2>${dok.titel}</h2><span class="mono muted">ændret ${klokke(dok.aendret)}</span></div>
    <p class="row-note">Brief: ${dok.brief}</p>
    <div class="afsnit-liste">${dok.afsnit.map((a, i) => afsnitRow(dok, a, i, forslag))}</div>
    <div class="afsnit-tools"><span class="mono muted">Hele teksten</span>${forslagKnapper(dok.id, null)}</div>
    ${dok.kilder.length ? html`<div class="kilder"><span class="eyebrow">Kilder i udkastet</span><ul>${dok.kilder.map((k) => html`<li>${k}</li>`)}</ul></div>` : ''}
    ${dok.gemtSom ? html`<p class="row-note">Gemt i Obsidian: ${dok.gemtSom}</p>` : ''}
  </section>` : html`
  <section class="card"><h2>Ingen udkast endnu</h2><p class="muted">Beskriv, hvad Hermes skal skrive, så kommer det første udkast her som afsnit, du kan pege på.</p></section>`}

  ${nytForm()}`;
  return html`
  <header class="room-head">
    <div><h1>Skrive</h1><p class="muted">Du siger hvad. Hermes skriver. Du bruger eller afviser.</p></div>
    ${dok ? html`<div class="actions">${knap({ label: 'Kopiér', attrs: { 'data-kopier': dokumentTekst(dok) } })}<a class="btn" href="/rum/skrive/dok/${dok.id}.md" download>Hent som fil</a><button type="button" class="btn" data-aktion="gem" data-arg="${arg({ dokId: dok.id })}" data-status="gemmer i Obsidian">${dok.gemtSom ? 'Gem igen i Obsidian' : 'Gem i Obsidian'}</button></div>` : ''}
  </header>

  ${baand({
    kraever: [{ titel: 'Hermes\' forslag', form: 'kort', elementer: dok ? forslag.map((f) => ({ id: `forslag:${f.id}`, html: forslagKort(f, dok) })) : [] }],
    indhold,
    igang: [igangGruppe(igang)],
    ordnet: [{ titel: 'Ændringer', form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) }],
  })}`;
}
