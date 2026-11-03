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
import { UDBYDERE, udbyderAf, type Udbyder } from './udbydere.ts';
import { erModelFejlArt, type ModelFejlArt } from './modelfejl.ts';
import type { AgentStatus } from '../../agent/types.ts';
import type { GithubTilstand } from '../../agent/github-enhed.ts';
import { kildeIndhold, type KildeVisning } from './kilderender.ts';
import { renderTillidskort } from './tillidskort.ts';
import { renderRegelforslag } from './regelforslag.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import { importIndhold, type ImportVisning } from './import/render.ts';
import { renderTailscaleKort, type TailscaleVisning } from './tailscalekort.ts';
import type { PostStartVisning } from './digitalpost.ts';
import { renderDanmarkPakke, type AulaStartVisning } from './danmarkpakke.ts';
import { startTekst } from './tekster.ts';
import { sprogNu, tekst } from '../../shell/tekster.ts';
import { klokkeIso } from '../../shell/friskhed.ts';

const FORTRYD_TIMER = 24;

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
  model?: {
    syn: ModelSyn; agent: AgentStatus; gemt?: StartModel; kanGemme: boolean;
    /** KC-0245: the built-in agent (no Hermes): only providers it can call, and no Hermes wording. */ direkte?: boolean;
    /** KC-0263: the GitHub sign-in for Copilot (only beside the built-in agent). */ github?: GithubTilstand;
  };
  /** KC-0128: steps 3–4 — the registry's cards, the previews and step 4's pile; absent = nothing to connect. */
  kilder?: KildeVisning;
  /** KC-0129: step 5 — the import card's data; absent = no import (no notes writer wired). */
  import?: ImportVisning;
  /** KC-0130: step 6 — what is in Nu to point at (`punkt` null = Nu is empty), the recorded first Ret, the rule proposals waiting (Nu's card). Absent = nothing. */
  /** KC-0160: laptop mode — one person on this machine: no household question or wording (the profile is saved as alone). */
  laptop?: boolean;
  /** KC-0161: the Tailscale card under the steps (absent = none: no CLI wired, or nothing to ask for after the journey is Done). */
  tailscale?: TailscaleVisning;
  /** KC-0233: the Danmark-pakke step under the steps (absent = none: no mail connected, a sender confirmed, or put away). */
  digitalPost?: PostStartVisning;
  /** KC-0236: Aula's card in the Danmark-pakke group (absent = none: Aula connected, put away, not the owner, or not offered). */
  aula?: AulaStartVisning;
  foersteRet?: { punkt: { titel: string | null } | null; ret?: StartRet; forslag?: Regelforslag[]; kanSpringeOver: boolean };
};

export const sek = (ms: number): string => (ms / 1000).toLocaleString(tekst().lokale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** One test's result in one line: "Virker · 0,8 s" or the fixed reason, in the language being rendered. */
export function testTekst(t: { ok: boolean; ms: number; fejl?: string }): string {
  if (t.ok) return startTekst().virkerMs(sek(t.ms));
  const art: ModelFejlArt = erModelFejlArt(t.fejl) ? t.fejl : 'ukendt';
  return startTekst().modelFejl[art];
}

/** A tier's row: its model, the last test (only when it belongs to the model the tier has now), and Test. */
function testRaekke(n: Niveau, m: NonNullable<StartVisning['model']>): Markup {
  const model = m.syn.modeller[n];
  const t = m.syn.test[n];
  const gyldig = t && t.rev === m.syn.rev[n] ? t : undefined;
  const tilstand = gyldig ? (gyldig.ok ? 'ok' : 'fejl') : 'ikke-testet';
  const T = startTekst();
  return html`<div class="row" data-model-tier="${n}" data-model-test="${tilstand}" data-element="${T.modelElement(T.niveau[n])}">
    <span class="row-main"><span class="row-title">${T.niveau[n]}: <span class="mono">${model ?? T.ingenModel}</span></span><span class="row-note">${gyldig ? testTekst(gyldig) : T.ikkeProevet}</span></span>
    <span class="vis-smaa">${gyldig ? (gyldig.ok ? tilstandChip('ordnet', T.virker) : tilstandChip('kraever', T.virkerIkke)) : ''}${model && m.kanGemme ? html`<button type="button" class="btn btn-ghost" data-aktion="model-test" data-arg="${JSON.stringify({ tier: n })}" data-status="${T.proeverModellen}">${T.test}</button>` : ''}</span>
  </div>`;
}

/** KC-0263: a provider that signs in with GitHub instead of a key (Copilot, only beside the built-in agent). */
const medGithub = (m: NonNullable<StartVisning['model']>, u: Udbyder): boolean => Boolean(m.direkte && u.direkte?.api === 'copilot-sdk');

/** KC-0263: a sign-in under way (or just ended) keeps Copilot chosen in the form, though the choice is saved only once signed in. */
const githubIGang = (g: GithubTilstand | undefined): boolean => g !== undefined && ['venter', 'udloebet', 'afvist', 'fejl'].includes(g.tilstand);

/** KC-0263: the sign-in in the card: the button, the code with its link while waiting, then who is signed in and Log ud. */
function githubIndhold(m: NonNullable<StartVisning['model']>): Markup {
  const T = startTekst();
  const G = T.github;
  const g: GithubTilstand = m.github ?? { tilstand: 'ikke-sat-op' };
  const logInd = (tekst: string): Markup => html`<div class="actions"><button type="button" class="btn btn-primary" data-aktion="github-start" data-status="${G.beder}">${tekst}</button></div>`;
  switch (g.tilstand) {
    case 'ikke-sat-op': return html`<p class="row-note" data-github="ikke-sat-op">${G.ikkeSatOp}</p>`;
    case 'venter': return html`<div class="github-venter" data-github="venter">
      <p class="row-note">${G.skrivKoden}</p>
      <p class="github-kode mono" data-github-kode>${g.userCode}</p>
      <div class="actions"><button type="button" class="btn btn-ghost" data-kopier="${g.userCode}">${G.kopierKode}</button><a class="btn btn-primary" href="${g.verificationUri}" target="_blank" rel="noopener noreferrer">${G.aabn}</a></div>
      <p class="row-note" data-github-venter>${G.venter}</p>
    </div>`;
    case 'inde': {
      const login = g.login ?? (m.gemt?.udbyder === 'copilot' ? m.gemt.github?.login : undefined);
      return html`<p class="row-note" data-github="inde">${G.inde(login)} ${G.gemt(g.laengde)}</p><p class="row-note">${G.udenVaerktoej}</p>
      <div class="actions"><button type="button" class="btn btn-ghost" data-aktion="github-ud" data-status="${G.loggerUd}">${G.logUd}</button></div>`;
    }
    case 'udloebet': case 'afvist': case 'fejl': return html`<p class="row-note" data-github="${g.tilstand}">${G[g.tilstand]}</p>${logInd(G.proevIgen)}`;
    default: return html`<p class="row-note" data-github="ude">${G.intro}</p>${logInd(G.logInd)}`;
  }
}

/** Step 2's form: provider, key (write-only) or local address, the two tiers' models with the discovered names offered. */
function modelForm(m: NonNullable<StartVisning['model']>): Markup {
  // KC-0263: Copilot needs Clawco's GitHub app; without it (no client id) the choice is not shown at all (KC-0052).
  const udbydere = (m.direkte ? UDBYDERE.filter((u) => u.direkte) : UDBYDERE)
    .filter((u) => !(medGithub(m, u) && (m.github?.tilstand ?? 'ikke-sat-op') === 'ikke-sat-op'));
  const igang = githubIGang(m.github) ? udbydere.find((u) => medGithub(m, u)) : undefined;
  const valgt = igang ?? udbydere.find((u) => u.id === m.syn.udbyder) ?? udbydere[0]!;
  const github = medGithub(m, valgt);
  const harGithub = udbydere.some((u) => medGithub(m, u));
  const gemt = m.gemt?.udbyder === valgt.id ? m.gemt : undefined;
  const navne = gemt?.navne ?? [];
  const forslag = [...new Set([...navne, valgt.standardModeller.lille, valgt.standardModeller.taenker])];
  const lokal = !valgt.kraeverNoegle;
  const vaerdi = (n: Niveau): string => (m.syn.udbyder === valgt.id ? m.syn.modeller[n] : undefined) ?? valgt.standardModeller[n];
  const T = startTekst();
  return html`<form id="model-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">${T.udbyder}</span><select name="udbyder" data-model-udbyder>${udbydere.map((u) => html`<option value="${u.id}"${medGithub(m, u) ? html` data-login="github"` : html` data-placeholder="${T.noeglePlaceholder(u)}"`}${u.kraeverNoegle ? '' : html` data-lokal`}${u.id === valgt.id ? html` selected` : ''}>${T.udbyderNavn(u)}</option>`)}</select></label>
    ${harGithub ? html`<div class="field" data-model-felt="github"${github ? '' : html` hidden`}>${githubIndhold(m)}</div>` : ''}<label class="field" data-model-felt="noegle"${lokal || github ? html` hidden` : ''}><span class="row-note">${T.noegleFra}${gemt?.noegle ? T.beholdGemte : ''}</span><input name="noegle" type="password" autocomplete="off" spellcheck="false" placeholder="${valgt.kraeverNoegle && !github ? T.noeglePlaceholder(valgt) : ''}"></label>
    <label class="field" data-model-felt="url"${lokal ? '' : html` hidden`}><span class="row-note">${T.adressen}</span><input name="url" type="url" inputmode="url" spellcheck="false" value="${lokal ? (gemt?.url ?? '') : ''}" placeholder="${valgt.standardUrl ?? 'http://127.0.0.1:1234'}"></label>
    ${NIVEAUER.map((n) => html`<label class="field"><span class="row-note">${T.nyModel(T.niveau[n])}</span><input name="${n}" type="text" list="model-navne" spellcheck="false" maxlength="80" value="${vaerdi(n)}"></label>`)}
    <datalist id="model-navne">${forslag.map((x) => html`<option value="${x}"></option>`)}</datalist>
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="model-gem" data-form="model-form" data-status="${T.gemmerOgProever}">${T.gemOgTest}</button></div>
  </form>`;
}

/** What Start knows of the key for the chosen provider: its length, or the command to run on Hermes' machine. */
function noegleLinje(m: NonNullable<StartVisning['model']>, klaret = false): Markup {
  const g = m.gemt;
  if (!g || g.udbyder !== (m.syn.udbyder ?? '')) return html``;
  const T = startTekst();
  // KC-0263: Copilot's sign-in sits in the form; once the step is Klaret the form is folded, so the line shows here.
  const u = udbyderAf(g.udbyder);
  if (u && medGithub(m, u)) {
    return klaret && g.noegle ? html`<p class="row-note" data-github="inde">${T.github.inde(m.github?.tilstand === 'inde' ? m.github.login ?? g.github?.login : g.github?.login)} ${T.github.gemt(m.github?.tilstand === 'inde' ? m.github.laengde : g.noegle.laengde)}</p>` : html``;
  }
  if (g.kommando) {
    return html`<div class="model-kommando" data-model-kommando>
      <p class="row-note">${T.kanIkkeSkrive}</p>
      <pre class="mono">${g.kommando}</pre>
      <div class="actions"><button type="button" class="btn btn-ghost" data-kopier="${g.kommando}">${T.kopierKommando}</button></div>
    </div>`;
  }
  if (g.noegle) return html`<p class="row-note" data-model-noegle>${(m.direkte ? T.noegleGemt : T.noegleGivet)(g.noegle.laengde)}</p>`;
  return g.url ? html`<p class="row-note">${T.adresse}<span class="mono">${g.url}</span></p>` : html``;
}

function modelIndhold(status: TrinStatus, v: StartVisning): Markup {
  const m = v.model;
  const T = startTekst();
  if (!m) return html`<p class="row-note">${T.ingenDatamappe}</p>`;
  if (m.agent === 'mangler-noegle') {
    if (!m.kanGemme) return html`<p class="row-note">${T.ingenAgentNoegleEjer}</p>`;
    return html`<p class="row-note" data-model-agent="mangler-noegle">${T.ingenAgentNoegle}</p>
    <form id="model-agent-form" class="nyt-form" onsubmit="return false" autocomplete="off">
      <label class="field"><span class="row-note">${T.noegleTilHermes}</span><input name="noegle" type="password" autocomplete="off" spellcheck="false" required></label>
      <div class="actions"><button type="button" class="btn btn-primary" data-aktion="model-agent-noegle" data-form="model-agent-form" data-status="${T.gemmerNoeglen}">${T.gem}</button></div>
    </form>`;
  }
  if (m.agent === 'utilgaengelig') {
    return html`<p class="row-note" data-model-agent="utilgaengelig">${T.utilgaengeligFoer}<span class="mono">hermes gateway start</span>${T.utilgaengeligEfter}</p>`;
  }
  const raekker = NIVEAUER.some((n) => m.syn.modeller[n]) ? html`<div class="card-list">${NIVEAUER.map((n) => testRaekke(n, m))}</div>` : html``;
  if (!m.kanGemme) return html`${raekker}<p class="row-note">${T.ejerenVaelger}</p>`;
  if (status === 'klaret') return html`${raekker}${noegleLinje(m, true)}${mere(modelForm(m), T.skiftModel)}`;
  return html`${noegleLinje(m)}${raekker}${modelForm(m)}`;
}

const klokke = klokkeIso;

function valg<T extends string>(navn: string, etiket: string, tekster: Record<T, string>, valgt: T): Markup {
  return html`<label class="field"><span class="row-note">${etiket}</span><select name="${navn}">${(Object.keys(tekster) as T[]).map((v) => html`<option value="${v}"${v === valgt ? html` selected` : ''}>${tekster[v]}</option>`)}</select></label>`;
}

/** Step 1's form: name, language, alone or household. */
function velkommenForm(p: Profil | null, standardNavn: string, knaptekst: string, laptop = false): Markup {
  const T = startTekst();
  return html`<form id="velkommen-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">${T.hvadHedderDu}</span><input name="navn" type="text" maxlength="${NAVN_MAKS}" required value="${p?.navn ?? standardNavn}" placeholder="${T.navnEksempel}"></label>
    ${valg('sprog', T.hvilketSprog, T.sprogValg, p?.sprog ?? sprogNu())}
    ${laptop ? html`<input type="hidden" name="husstand" value="alene">` : valg('husstand', T.aleneEllerHusstand, T.husstandValg, p?.husstand ?? 'alene')}
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="velkommen-gem" data-form="velkommen-form" data-status="${T.gemmer}">${knaptekst}</button></div>
  </form>`;
}

/** Step 6: points at the first element in Nu (the card has no Ret button of its own), says there is nothing yet, or thanks. */
function foersteRetIndhold(status: TrinStatus, v: StartVisning): Markup {
  const f = v.foersteRet;
  if (!f) return html``;
  const T = startTekst();
  if (status === 'klaret') return html`<p class="row-note" data-foerste-ret="tak">${T.takRet}</p>`;
  if (!f.punkt) return html`<p class="row-note" data-foerste-ret="tom">${T.intetAtRette}</p>`;
  const hvor = f.punkt.titel ? T.iNu(f.punkt.titel) : T.foersteKortINu;
  return html`<div data-foerste-ret="aaben">
    <p class="row-note">${T.proevDetPaa}${hvor}${T.ikkeRelevantErLuk}</p>
    ${f.kanSpringeOver && status !== 'sprunget-over' ? html`<div class="actions"><button type="button" class="btn btn-ghost" data-aktion="ret-spring-over" data-status="${T.springerOver}">${T.springOver}</button></div>` : ''}
  </div>`;
}

/** Under step 6's card once the Ret is made: the one explanation card, then the rule proposals waiting for an answer (the same card as in Nu). */
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
  const T = startTekst();
  if (status !== 'klaret' || !v.profil) {
    return v.kanGemme ? velkommenForm(v.profil, v.standardNavn, T.gem, v.laptop) : html`<p class="row-note">${T.ejerenFortaeller}</p>`;
  }
  const p = v.profil;
  return html`<p class="row-note">${T.duHedder(p.navn, p.sprog)}${v.laptop ? '' : T.duEr(p.husstand)}.</p>${v.kanGemme ? mere(velkommenForm(p, v.standardNavn, T.gemAendringen, v.laptop), T.retProfilen) : ''}`;
}

function trinKort(t: Trin, status: TrinStatus, v: StartVisning): Markup {
  const T = startTekst();
  const chip = status === 'klaret' ? tilstandChip('ordnet', T.status.klaret) : tilstandChip(t.krav === 'obligatorisk' ? 'kraever' : 'rolig', t.krav === 'valgfri' && status === 'ikke-startet' ? T.valgfrit : T.status[status]);
  return html`<article class="card kort trin-kort" data-blok="kort" data-trin="${t.id}" data-trin-status="${status}" data-element="${T.trinElement(t.titel)}">
    <div class="kort-head">${chip}<span class="row-title">${t.titel}</span></div>
    ${status === 'klaret' ? '' : html`<p>${v.laptop && t.id === 'velkommen' ? T.laptopVelkommen : t.tekst}</p>`}
    ${indholdAf(t, status, v)}
  </article>`;
}

function forslagRaekke(f: Forslag): Markup {
  const T = startTekst();
  return html`<div class="row" data-forslag-kilde="${f.kildeId}" data-element="${T.forslag(f.navn)}">
    <span class="row-main"><span class="row-title">${f.navn}</span><span class="row-note">${f.grund}</span></span>
    <span class="vis-smaa">${spoerg(T.forslag(f.navn))}<button type="button" class="btn btn-ghost" data-aktion="forslag-afvis" data-arg="${JSON.stringify({ kildeId: f.kildeId })}" data-status="${T.laeggerVaek}">${T.ikkeNu}</button></span>
  </div>`;
}

function logRaekke(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}">
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">${startTekst().fortrudtKl}${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">${startTekst().fortryd}</button>` : ''}
  </div>`;
}

export function renderStart(v: StartVisning): Markup {
  const now = v.now ?? new Date();
  // The open steps on top, in journey order; what is done or skipped below them.
  const aabne = v.trin.filter((x) => x.status !== 'klaret' && x.status !== 'sprunget-over');
  const rest = v.trin.filter((x) => x.status === 'klaret' || x.status === 'sprunget-over');
  const venter = v.venter ?? aabne.filter((x) => x.trin.krav === 'obligatorisk').length;
  const bunke = html`<div class="stack" data-trin-bunke>${[...aabne, ...rest].map((x) => html`${trinKort(x.trin, x.status, v)}${x.trin.id === 'foerste-ret' ? efterRet(v) : ''}`)}${v.tailscale ? renderTailscaleKort(v.tailscale) : ''}${renderDanmarkPakke({ aula: v.aula, post: v.digitalPost })}</div>`;
  // Optional, so not under Kræver dig: a source worth adding sits under the steps, one line each (a bunke).
  const T = startTekst();
  const forslag = v.forslag.length ? html`<div class="card card-list gruppe" data-blok="bunke" data-gruppe="${T.vaerdAtTilfoeje}"><div class="card-head"><h3 class="eyebrow">${T.vaerdAtTilfoeje}</h3><span class="muted mono">${v.forslag.length}</span></div>${v.forslag.map(forslagRaekke)}</div>` : '';
  return html`
  <header class="room-head">
    <div><h1>${tekst().rum['start']}</h1><p class="muted">${T.rumIntro}</p></div>
  </header>

  ${baand({
    kraever: [],
    indhold: html`${bunke}${forslag}`,
    igang: [igangGruppe(v.igang ?? [])],
    ordnet: [{ titel: T.detErGjort, form: 'raekker', elementer: dagensLog(v.log ?? [], now).map((e) => ({ id: `log:${e.id}`, html: logRaekke(e, now) })) }],
    venter,
  })}`;
}
