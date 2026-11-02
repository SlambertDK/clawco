// HTML for the Start room (KC-0126): the journey as a pile of step cards, the
// open steps on top, built from the blocks that exist (kort per step, bunke for
// the suggestions; KC-0012). Pure: state in, Markup out; every text through
// html`` (the escaper). Buttons follow the client contract in public/app.js:
// data-aktion + data-arg (JSON), and data-form="<form id>" for a form.

import { html, type Markup } from '../../shell/html.ts';
import { mere } from '../../shell/visuel.ts';
import { baand, igangGruppe, spoerg, tilstandChip, type IgangRaekke } from '../../shell/sprog.ts';
import { dagensLog } from '../../shell/log.ts';
import type { LogEntry } from '../../store/types.ts';
import { NIVEAUER, type ModelSyn, type Niveau, type Trin } from './trin.ts';
import { NAVN_MAKS, type Forslag, type Profil, type StartModel, type StartRet, type TrinStatus } from './schema.ts';
import { UDBYDERE, udbyderAf } from './udbydere.ts';
import { erModelFejlArt, MODEL_FEJL, type ModelFejlArt } from './modelfejl.ts';
import type { AgentStatus } from '../../agent/types.ts';
import { kildeIndhold, type KildeVisning } from './kilderender.ts';
import { renderTillidskort } from './tillidskort.ts';
import { renderRegelforslag, type Tilbud } from './regelforslag.ts';
import { importIndhold, type ImportVisning } from './import/render.ts';

const TZ = 'Europe/Copenhagen';
const FORTRYD_TIMER = 24;
const SPROG_TEKST: Record<Profil['sprog'], string> = { da: 'dansk', en: 'engelsk' };
const HUSSTAND_TEKST: Record<Profil['husstand'], string> = { alene: 'alene', husstand: 'en husstand' };
const STATUS_TEKST: Record<TrinStatus, string> = { 'ikke-startet': 'Næste', 'i-gang': 'I gang', klaret: 'Klaret', 'sprunget-over': 'Sprunget over' };

export type StartVisning = {
  trin: { trin: Trin; status: TrinStatus }[];
  profil: Profil | null;
  /** The name the form starts with when there is no profile (the tailnet display name; empty in single-user mode). */
  standardNavn: string;
  forslag: Forslag[];
  /** Only the owner saves the profile; others see it read-only. */
  kanGemme: boolean;
  log?: LogEntry[];
  now?: Date;
  igang?: IgangRaekke[];
  /** The room's count (the nav's number): open mandatory steps, 0 once the journey is Done. Absent = the open mandatory steps. */
  venter?: number;
  /** KC-0127: step 2 — the model choice, the agent's state, what Start recorded of the key; absent = no data dir. */
  model?: { syn: ModelSyn; agent: AgentStatus; gemt?: StartModel; kanGemme: boolean };
  /** KC-0128: steps 3–4 — the registry's cards, the previews and step 4's pile; absent = nothing to connect. */
  kilder?: KildeVisning;
  /** KC-0129: step 5 — the import card's data; absent = no import (no notes writer wired). */
  import?: ImportVisning;
  /** KC-0130: step 6 — what is in Nu to point at (`punkt` null = Nu is empty), the recorded first Ret, E4's proposal on offer. Absent = nothing. */
  foersteRet?: { punkt: { titel: string | null } | null; ret?: StartRet; forslag?: Tilbud; kanSpringeOver: boolean };
};

const NIVEAU_TEKST: Record<Niveau, string> = { lille: 'Den hurtige', taenker: 'Den grundige' };
const sek = (ms: number): string => (ms / 1000).toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** One test's result in one line: "Virker · 0,8 s" or the fixed Danish reason. */
export function testTekst(t: { ok: boolean; ms: number; fejl?: string }): string {
  if (t.ok) return `Virker · ${sek(t.ms)} s`;
  const art: ModelFejlArt = erModelFejlArt(t.fejl) ? t.fejl : 'ukendt';
  return MODEL_FEJL[art];
}

/** A tier's row: its model, the last test (only when it belongs to the model the tier has now), and Test. */
function testRaekke(n: Niveau, m: NonNullable<StartVisning['model']>): Markup {
  const model = m.syn.modeller[n];
  const t = m.syn.test[n];
  const gyldig = t && t.rev === m.syn.rev[n] ? t : undefined;
  const tilstand = gyldig ? (gyldig.ok ? 'ok' : 'fejl') : 'ikke-testet';
  return html`<div class="row" data-model-tier="${n}" data-model-test="${tilstand}" data-element="Model: ${NIVEAU_TEKST[n]}">
    <span class="row-main"><span class="row-title">${NIVEAU_TEKST[n]}: <span class="mono">${model ?? 'ingen model valgt'}</span></span><span class="row-note">${gyldig ? testTekst(gyldig) : 'Ikke prøvet endnu.'}</span></span>
    <span class="vis-smaa">${gyldig ? (gyldig.ok ? tilstandChip('ordnet', 'Virker') : tilstandChip('kraever', 'Virker ikke')) : ''}${model && m.kanGemme ? html`<button type="button" class="btn btn-ghost" data-aktion="model-test" data-arg="${JSON.stringify({ tier: n })}" data-status="prøver modellen">Test</button>` : ''}</span>
  </div>`;
}

/** Step 2's form: provider, key (write-only) or local address, the two tiers' models with the discovered names offered. */
function modelForm(m: NonNullable<StartVisning['model']>): Markup {
  const valgt = udbyderAf(m.syn.udbyder ?? '') ?? UDBYDERE[0]!;
  const gemt = m.gemt?.udbyder === valgt.id ? m.gemt : undefined;
  const navne = gemt?.navne ?? [];
  const forslag = [...new Set([...navne, valgt.standardModeller.lille, valgt.standardModeller.taenker])];
  const lokal = !valgt.kraeverNoegle;
  const vaerdi = (n: Niveau): string => (m.syn.udbyder === valgt.id ? m.syn.modeller[n] : undefined) ?? valgt.standardModeller[n];
  return html`<form id="model-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">Udbyder</span><select name="udbyder" data-model-udbyder>${UDBYDERE.map((u) => html`<option value="${u.id}" data-placeholder="${u.noeglePlaceholder}"${u.kraeverNoegle ? '' : html` data-lokal`}${u.id === valgt.id ? html` selected` : ''}>${u.navn}</option>`)}</select></label>
    <label class="field" data-model-felt="noegle"${lokal ? html` hidden` : ''}><span class="row-note">Nøgle fra udbyderen${gemt?.noegle ? ' (tom = behold den gemte)' : ''}</span><input name="noegle" type="password" autocomplete="off" spellcheck="false" placeholder="${valgt.kraeverNoegle ? valgt.noeglePlaceholder : ''}"></label>
    <label class="field" data-model-felt="url"${lokal ? '' : html` hidden`}><span class="row-note">Adressen på din maskine (tom = standard)</span><input name="url" type="url" inputmode="url" spellcheck="false" value="${lokal ? (gemt?.url ?? '') : ''}" placeholder="${valgt.standardUrl ?? 'http://127.0.0.1:1234'}"></label>
    ${NIVEAUER.map((n) => html`<label class="field"><span class="row-note">${NIVEAU_TEKST[n]} model</span><input name="${n}" type="text" list="model-navne" spellcheck="false" maxlength="80" value="${vaerdi(n)}"></label>`)}
    <datalist id="model-navne">${forslag.map((x) => html`<option value="${x}"></option>`)}</datalist>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="model-gem" data-form="model-form" data-status="gemmer og prøver modellen">Gem og test</button></div>
  </form>`;
}

/** What Start knows of the key for the chosen provider: its length, or the command to run on Hermes' machine. */
function noegleLinje(m: NonNullable<StartVisning['model']>): Markup {
  const g = m.gemt;
  if (!g || g.udbyder !== (m.syn.udbyder ?? '')) return html``;
  if (g.kommando) {
    return html`<div class="model-kommando" data-model-kommando>
      <p class="row-note">Clawco kan ikke skrive til Hermes' indstillinger herfra. Kør kommandoen på Hermes' maskine, indsæt værdien, når den spørger, og tryk så Test.</p>
      <pre class="mono">${g.kommando}</pre>
      <div class="actions"><button type="button" class="btn btn-ghost" data-kopier="${g.kommando}">Kopiér kommandoen</button></div>
    </div>`;
  }
  if (g.noegle) return html`<p class="row-note" data-model-noegle>Nøglen er givet til Hermes. Gemt (${g.noegle.laengde} tegn).</p>`;
  return g.url ? html`<p class="row-note">Adresse: <span class="mono">${g.url}</span></p>` : html``;
}

function modelIndhold(status: TrinStatus, v: StartVisning): Markup {
  const m = v.model;
  if (!m) return html`<p class="row-note">Clawco har ingen datamappe, så modellen kan ikke vælges her.</p>`;
  if (m.agent === 'mangler-noegle') {
    if (!m.kanGemme) return html`<p class="row-note">Clawco har ingen nøgle til Hermes endnu. Ejeren indsætter den.</p>`;
    return html`<p class="row-note" data-model-agent="mangler-noegle">Clawco har ingen nøgle til Hermes endnu. Indsæt den nøgle, Hermes' api-server bruger (API_SERVER_KEY i Hermes' .env).</p>
    <form id="model-agent-form" class="nyt-form" onsubmit="return false" autocomplete="off">
      <label class="field"><span class="row-note">Nøgle til Hermes</span><input name="noegle" type="password" autocomplete="off" spellcheck="false" required></label>
      <div class="actions"><button type="button" class="btn btn-primary" data-aktion="model-agent-noegle" data-form="model-agent-form" data-status="gemmer nøglen">Gem</button></div>
    </form>`;
  }
  if (m.agent === 'utilgaengelig') {
    return html`<p class="row-note" data-model-agent="utilgaengelig">Hermes svarer ikke, så Clawco kan ikke prøve en model endnu. Clawco installerer ikke Hermes selv: installer og start Hermes på maskinen (fx <span class="mono">hermes gateway start</span>), og åbn så Start igen.</p>`;
  }
  const raekker = NIVEAUER.some((n) => m.syn.modeller[n]) ? html`<div class="card-list">${NIVEAUER.map((n) => testRaekke(n, m))}</div>` : html``;
  if (!m.kanGemme) return html`${raekker}<p class="row-note">Ejeren vælger modellen.</p>`;
  if (status === 'klaret') return html`${raekker}${noegleLinje(m)}${mere(modelForm(m), 'Skift model')}`;
  return html`${noegleLinje(m)}${raekker}${modelForm(m)}`;
}

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

function valg<T extends string>(navn: string, etiket: string, tekster: Record<T, string>, valgt: T): Markup {
  return html`<label class="field"><span class="row-note">${etiket}</span><select name="${navn}">${(Object.keys(tekster) as T[]).map((v) => html`<option value="${v}"${v === valgt ? html` selected` : ''}>${tekster[v]}</option>`)}</select></label>`;
}

/** Step 1's form: name, language, alone or household. */
function velkommenForm(p: Profil | null, standardNavn: string, knaptekst: string): Markup {
  return html`<form id="velkommen-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">Hvad hedder du?</span><input name="navn" type="text" maxlength="${NAVN_MAKS}" required value="${p?.navn ?? standardNavn}" placeholder="Fx Alma"></label>
    ${valg('sprog', 'Hvilket sprog skal Hermes svare på?', { da: 'Dansk', en: 'Engelsk' }, p?.sprog ?? 'da')}
    ${valg('husstand', 'Er du alene, eller er I en husstand?', { alene: 'Alene', husstand: 'En husstand' }, p?.husstand ?? 'alene')}
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="velkommen-gem" data-form="velkommen-form" data-status="gemmer">${knaptekst}</button></div>
  </form>`;
}

/** Step 6: points at the first element in Nu (the card has no Ret button of its own), says there is nothing yet, or thanks. */
function foersteRetIndhold(status: TrinStatus, v: StartVisning): Markup {
  const f = v.foersteRet;
  if (!f) return html``;
  if (status === 'klaret') return html`<p class="row-note" data-foerste-ret="tak">Tak. Det hjælper Hermes at kende dig. Her er, hvordan den får mere frihed.</p>`;
  if (!f.punkt) return html`<p class="row-note" data-foerste-ret="tom">Der er ikke noget at rette endnu; Hermes lægger det første op, når der er noget.</p>`;
  const hvor = f.punkt.titel ? html`»${f.punkt.titel}« i Nu` : html`det første kort i Nu`;
  return html`<div data-foerste-ret="aaben">
    <p class="row-note">Prøv det på ${hvor}. Ikke relevant er knappen Luk; skriv gerne hvorfor, så husker Hermes det.</p>
    ${f.kanSpringeOver && status !== 'sprunget-over' ? html`<div class="actions"><button type="button" class="btn btn-ghost" data-aktion="ret-spring-over" data-status="springer over">Spring over</button></div>` : ''}
  </div>`;
}

/** Under step 6's card once the Ret is made: the one explanation card, then E4's proposal when there is one. */
function efterRet(v: StartVisning): Markup {
  const f = v.foersteRet;
  if (!f?.ret) return html``;
  return html`${renderTillidskort()}${f.forslag ? renderRegelforslag(f.forslag) : ''}`;
}

function indholdAf(t: Trin, status: TrinStatus, v: StartVisning): Markup {
  if (t.id === 'foerste-ret') return foersteRetIndhold(status, v);
  if (t.id === 'import') return v.import ? importIndhold(status, v.import) : html``;
  if (t.id === 'model') return modelIndhold(status, v);
  if (v.kilder && (t.id === 'foerste-kilde' || t.id === 'flere-kilder')) return kildeIndhold(t.id, status, v.kilder, v.now ?? new Date());
  if (t.id !== 'velkommen') return html``;
  if (status !== 'klaret' || !v.profil) {
    return v.kanGemme ? velkommenForm(v.profil, v.standardNavn, 'Gem') : html`<p class="row-note">Ejeren fortæller Clawco, hvem I er.</p>`;
  }
  const p = v.profil;
  return html`<p class="row-note">Du hedder ${p.navn} · Hermes svarer på ${SPROG_TEKST[p.sprog]} · du er ${HUSSTAND_TEKST[p.husstand]}.</p>${v.kanGemme ? mere(velkommenForm(p, v.standardNavn, 'Gem ændringen'), 'Ret profilen') : ''}`;
}

function trinKort(t: Trin, status: TrinStatus, v: StartVisning): Markup {
  const chip = status === 'klaret' ? tilstandChip('ordnet', 'Klaret') : tilstandChip(t.krav === 'obligatorisk' ? 'kraever' : 'rolig', t.krav === 'valgfri' && status === 'ikke-startet' ? 'Valgfrit' : STATUS_TEKST[status]);
  return html`<article class="card kort trin-kort" data-blok="kort" data-trin="${t.id}" data-trin-status="${status}" data-element="Trin: ${t.titel}">
    <div class="kort-head">${chip}<span class="row-title">${t.titel}</span></div>
    ${status === 'klaret' ? '' : html`<p>${t.tekst}</p>`}
    ${indholdAf(t, status, v)}
  </article>`;
}

function forslagRaekke(f: Forslag): Markup {
  return html`<div class="row" data-forslag-kilde="${f.kildeId}" data-element="Forslag: ${f.navn}">
    <span class="row-main"><span class="row-title">${f.navn}</span><span class="row-note">${f.grund}</span></span>
    <span class="vis-smaa">${spoerg(`Forslag: ${f.navn}`)}<button type="button" class="btn btn-ghost" data-aktion="forslag-afvis" data-arg="${JSON.stringify({ kildeId: f.kildeId })}" data-status="lægger forslaget væk">Ikke nu</button></span>
  </div>`;
}

function logRaekke(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}">
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

export function renderStart(v: StartVisning): Markup {
  const now = v.now ?? new Date();
  // The open steps on top, in journey order; what is done or skipped below them.
  const aabne = v.trin.filter((x) => x.status !== 'klaret' && x.status !== 'sprunget-over');
  const rest = v.trin.filter((x) => x.status === 'klaret' || x.status === 'sprunget-over');
  const venter = v.venter ?? aabne.filter((x) => x.trin.krav === 'obligatorisk').length;
  const bunke = html`<div class="stack" data-trin-bunke>${[...aabne, ...rest].map((x) => html`${trinKort(x.trin, x.status, v)}${x.trin.id === 'foerste-ret' ? efterRet(v) : ''}`)}</div>`;
  // Optional, so not under Kræver dig: a source worth adding sits under the steps, one line each (a bunke).
  const forslag = v.forslag.length ? html`<div class="card card-list gruppe" data-blok="bunke" data-gruppe="Værd at tilføje"><div class="card-head"><h3 class="eyebrow">Værd at tilføje</h3><span class="muted mono">${v.forslag.length}</span></div>${v.forslag.map(forslagRaekke)}</div>` : '';
  return html`
  <header class="room-head">
    <div><h1>Start</h1><p class="muted">Rejsen fra kold start: ét kort per trin. Svar på det øverste, så står det næste klar.</p></div>
  </header>

  ${baand({
    kraever: [],
    indhold: html`${bunke}${forslag}`,
    igang: [igangGruppe(v.igang ?? [])],
    ordnet: [{ titel: 'Det er gjort', form: 'raekker', elementer: dagensLog(v.log ?? [], now).map((e) => ({ id: `log:${e.id}`, html: logRaekke(e, now) })) }],
    venter,
  })}`;
}
