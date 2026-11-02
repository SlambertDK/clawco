// The room Hjem: greeting, what waits (links into rooms), the room tiles and
// what Hermes did lately. Also the placeholder for rooms that are drawn but
// not built.

import { html, raw, type Markup } from '../../shell/html.ts';
import { fold } from '../../shell/fold.ts';
import { ROOMS, findRoom, type Room } from '../registry.ts';
import { aftenMulig, kunSynlige, type Intet, type Kort, type KortType } from './kort.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import type { Zoneret } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import { findProjekt } from '../../udvikling/projekter.ts';
import type { ProjektTal } from '../../udvikling/opgaver.ts';
import { billede, ikon, mere, visHoved, type IkonNavn } from '../../shell/visuel.ts';
import { baand, handlinger, igangGruppe, knap, medId, unikIder, spoerg, tilstandChip, type Element, type Gruppe, type IgangRaekke, type Knap, type OrdnetGruppe, type Tilstand } from '../../shell/sprog.ts';
import { dagensLog } from '../../shell/log.ts';
import { naesteLinje, type Naeste } from '../../shell/naeste.ts';
import { SITUATIONER, type Situation } from '../../situation/regler.ts';
import { kildeFriskhed, klokkeIso as klokke, type KildeFriskhed } from '../../shell/friskhed.ts';
import { kildeHelbredElementer, type KildeHelbredKort } from '../../shell/kilde-helbred.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import type { Stikuge } from '../../tillid/stikproeve.ts';
import { stikproeveKort, stopKort } from './stikproeve.ts';
import { regelforslagKort } from '../../shell/regelforslagkort.ts';
import { betaKort, feedbackKort, type BetaVisning } from './beta.ts';
import { hjemTekst } from './tekster.ts';
import { tekst } from '../../shell/tekster.ts';

export const CANVAS_URL = 'https://claude.ai/artifact/UETuFBpsk39GAAXUFprqyD';

export type HjemData = {
  hilsen: string;
  venter: { roomId: string; tekst: string }[];
  /** KC-0149: what the person started that waits on someone else (a request not answered yet), in I gang. Absent = none. */
  venterPaaAndre?: { roomId: string; tekst: string }[];
  /** Hjem's own log entries carry `id` (+ `handlingId`, `fortryd`, `fortrudt`) so they can be undone; other rooms' entries do not. */
  hermes: ({ tid: string; tekst: string; id?: string; handlingId?: string; fortryd?: string; fortrudt?: string; graense?: 'afvist' | 'kraever-ja' } & Zoneret)[];
  /** Handling ids (card handlings) that already ran and were not undone: the card shows "Gjort". */
  gjort?: string[];
  now?: Date;
  /** KC-0088: the next appointment today (from Dagen); absent = nothing left, nothing shown. */
  naeste?: Naeste;
  /** Kuratoren's cards ("Lige nu") and what it found nothing to do about. Both default to none. */
  kort?: Kort[];
  intet?: Intet[];
  /** Ledger rows the app wrote whose card is no longer on screen: each keeps its Fortryd here. */
  regnskab?: SkrevetRaekke[];
  /** KC-0043: what Henrik sent to Claude Code, newest first (the server picks which are shown). */
  claudeCode?: CcRaekke[];
  /** KC-0048: the trust numbers per project (projekt = its display name), over every opgave ever sent. */
  ccTal?: ProjektTal[];
  /** KC-0052: the rooms that are relevant now; only those get a tile. Absent = every room. */
  synlige?: ReadonlySet<string>;
  /** KC-0064: Hermes' runs in flight (any room), for the I gang band. */
  igang?: IgangRaekke[];
  /** KC-0093: what waits in all (Hjem's own + every room's nav count) — the tab title's number; absent = the elements shown. */
  venterIalt?: number;
  /** KC-0117: the person looking. Given, Hjem shows (and counts) only the cards, lines and ledger rows `synligFor` allows. */
  person?: Person;
  /** KC-0115: the situation now (KC-0114); it selects Nu's optional kinds. Absent = dagen. */
  situation?: Situation;
  /** KC-0115: the meeting on now, shown in I gang when the situation selects it. */
  moede?: { titel: string; url: string; slut: string };
  /** KC-0142: the rules file could not be read (why, and which file); absent = readable or none, and no card. */
  reglerFejl?: { hvorfor: string; fil: string };
  /** KC-0128: a new source's first value (Start's preview cards, built by the server), until the curated view replaces it. */
  forhaandsvisninger?: Element[];
  /** KC-0144: Hermes' proposals for a rule; the pending ones of the person looking are one card each under Regler. */
  regelforslag?: Regelforslag[];
  /** KC-0139: a connected source that does not work gets one card ("Forbindelser" under Kræver dig); absent = every source works. */
  kildeHelbred?: KildeHelbredKort[];
  /** KC-0139: by slags, the sources whose elements are not current (not working, or last read past the window): the elements built from them are marked "ikke opdateret siden …". Absent = all current. */
  gamle?: Partial<Record<string, KildeFriskhed>>;
  /** KC-0147: the week's number (src/tillid/dagstal.ts ugeLinje), built by the server and passed only on Mondays (KC-0052); absent = not shown. */
  ugetal?: Markup;
  /** KC-0145: the Sunday sample while a drawn line waits for an answer (the owner's, the check on); absent = no card. */
  stikproeve?: Stikuge;
  /** KC-0145: the stop question after three clean weeks is pending (the owner's); absent = not asked. */
  stopTilbud?: true;
  /** KC-0203: the closed beta's cards (the owner's; only under KC_BETA=ja, only while one is due); absent = none. */
  beta?: BetaVisning;
};

export type CcRaekke = { id: string; status: 'sendt' | 'modtaget' | 'i-gang' | 'parkeret' | 'faerdig'; projekt: string; saetning: string; oprettet: string; ticket?: string; bevis?: string; pr?: string; grund?: string;
  /** KC-0045: Claude Code's question while parked, and Henrik's answer. */
  spoergsmaal?: { tekst: string; valg: string[] }; svar?: string };

export type SkrevetRaekke = { id: string; hvor: 'shelfatlas' | 'privat'; leverandoer?: string; beloeb?: string; valuta?: string } & Zoneret;

/** KC-0059: the pictogram of a card that brings none of its own. */
const TYPE_IKON: Record<KortType, IkonNavn> = { tjeneste: 'sparkles', familie: 'heart', regning: 'receipt', nyhed: 'newspaper' };
const RUM_IKON: Record<string, IkonNavn> = { dagen: 'sunrise', mail: 'mail', skrive: 'pen-line', nyheder: 'newspaper' };
const rumIkon = (roomId: string): Markup => html`<span class="rum-ikon">${ikon(RUM_IKON[roomId] ?? (roomId.startsWith('univers') ? 'target' : 'house'))}</span>`;
/** KC-0024: the phone shows this many cards; the rest are one tap away. */
const SYNLIGE_KORT = 3;
const FORTRYD_TIMER = 24;


/** KC-0024: the phone shows the first three; the rest fold. */
function venterRow(v: { roomId: string; tekst: string }, gammel?: { f: KildeFriskhed; nu: Date }): Markup {
  const note = gammel ? kildeFriskhed(gammel.f, gammel.nu) : '';
  return html`<a class="row row-link" href="/rum/${v.roomId}">${rumIkon(v.roomId)}<span class="row-main"><span class="row-title">${v.tekst}</span><span class="row-note">${rumNavn(v.roomId)}${note ? html` · ${note}` : ''}</span></span><span class="muted">→</span></a>`;
}

/** A room's name in the language being rendered; a room the table does not know (a universe) keeps the registry's. */
const rumNavn = (roomId: string): string => tekst().rum[roomId] ?? findRoom(roomId)?.navn ?? roomId;

/** The registry's description of a room, in the language being rendered; a description that is not the registry's own is shown as given. */
const rumBeskrivelse = (r: Room): string => (findRoom(r.id)?.beskrivelse === r.beskrivelse ? hjemTekst().flise[r.id] ?? r.beskrivelse : r.beskrivelse);

/** KC-0139: which slags a room's waiting lines are read from (the rooms that read a connector). */
const RUM_SLAGS: Record<string, string> = { dagen: 'kalender', mail: 'mail' };

/** A source is a link only when it is an http(s) address; anything else is plain text. */
function kilde(k: string): Markup {
  return /^https?:\/\//i.test(k) ? html`<a href="${k}" target="_blank" rel="noopener noreferrer">${k}</a>` : html`${k}`;
}

/** The ledger buttons of a bill card. Two equal choices (no recommendation) are both plain: neither is the primary. */
function regnskabsKnapper(k: Kort): Knap[] {
  const t = hjemTekst();
  if (k.skrevet) {
    const anden = k.skrevet.hvor === 'shelfatlas' ? 'privat' : 'shelfatlas';
    return [html`<p class="row-note">${t.skrevetI(t.hvorBeskrivelse[k.skrevet.hvor])}</p>`, knap({ label: t.fortrydRegnskab, attrs: { 'data-regnskab': 'fortryd' } }), knap({ label: t.flytTil(t.hvorKnap[anden]), attrs: { 'data-regnskab': 'flyt' } })];
  }
  if (k.regnskabUklart) return [knap({ label: t.skrivI(t.hvorKnap.shelfatlas), attrs: { 'data-regnskab': 'shelfatlas' } }), knap({ label: t.skrivI(t.hvorKnap.privat), attrs: { 'data-regnskab': 'privat' } })];
  return [];
}

/** KC-0096: the two places a card can be put away to, hidden until Senere is pressed (public/app.js opens them in place). */
function senereValg(id: string, aften: boolean): Markup {
  const t = hjemTekst();
  return html`<div class="senere-valg" data-senere-valg hidden role="group" aria-label="${t.senereVisIgen}"><span class="row-note">${t.senereVisDet}</span>${aften ? html`<button type="button" class="btn" data-senere="aften" data-senere-kort="${id}">${t.iAften}</button>` : ''}<button type="button" class="btn" data-senere="morgen" data-senere-kort="${id}">${t.iMorgen}</button></div>`;
}

/** KC-0138: the channels' names (src/kilder/beskeder/valg.ts KANAL_NAVN restated: rooms import nothing from src/kilder). */
const KANAL_NAVN: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', signal: 'Signal' };

/** KC-0138: who wrote, where, and that Clawco only reads — the app's line, never Hermes' text. */
function beskedLinje(b: NonNullable<Kort['besked']>): Markup {
  const kanal = KANAL_NAVN[b.kanal] ?? b.kanal;
  return html`<p class="row-note besked-linje" data-besked-kanal="${b.kanal}">${hjemTekst().beskedLinje(b.afsender, kanal)}</p>`;
}

/** KC-0064 rule 6: `stor` is the one large card of the room view — its recommendation sits on the face. */
function kortKasse(k: Kort, gjort: Set<string>, stor = false, senere?: { aften: boolean }): Markup {
  const t = hjemTekst();
  // KC-0046: only a card about one of Henrik's projects offers Send til Claude Code (any card can still go from the chat head).
  const udvikling = k.udvikling ? findProjekt(k.udvikling.projekt) : undefined;
  // KC-0059: pictogram, one headline, the picture and the one move; everything else is behind Hvorfor?.
  const v = { ...(k.visuel ?? { ikon: TYPE_IKON[k.type] }), ...(stor ? { tone: 'adv' as const } : {}) };
  const overskrift = k.visuel?.overskrift ?? k.titel;
  const anbefaling = k.anbefaling ? html`<div class="pending"><span class="pending-label">${t.anbefaling}</span><span>${k.anbefaling}</span></div>` : '';
  const hvorfor = html`${overskrift !== k.titel ? html`<p class="row-title">${k.titel}</p>` : ''}<p class="betydning">${k.betyder}</p>
    ${stor ? '' : anbefaling}
    ${k.grundlag.length ? html`<ul class="lines">${k.grundlag.map((g) => html`<li>${g}</li>`)}</ul>` : ''}${k.kilder.length ? html`<p class="row-note">${t.kilder}${k.kilder.map((x, i) => html`${i ? ' · ' : ''}${kilde(x)}`)}</p>` : ''}`;
  // KC-0064: at most one primary — the handling, else writing the bill, else Send til Claude Code.
  const handlingKnap = k.handling && !gjort.has(k.handling.id) ? knap({ label: k.handling.label, slags: 'primaer', attrs: { 'data-kort-handling': k.id } }) : undefined;
  // KC-0066: a bill whose line is not in a ledger (Henrik undid it) can be written again, to the ledger the line names.
  const skrivKnap = k.regnskab && !k.skrevet && !k.regnskabUklart ? knap({ label: t.skrivI(t.hvorKnap[k.regnskab.hvor]), slags: handlingKnap ? 'normal' : 'primaer', attrs: { 'data-regnskab': k.regnskab.hvor } }) : undefined;
  const ccKnap = udvikling ? knap({ label: t.sendTilClaude(udvikling.navn), slags: handlingKnap || skrivKnap ? 'normal' : 'primaer', attrs: { 'data-cc-kort': k.id, 'data-cc-titel': k.titel, 'data-cc-projekt': udvikling.id, 'data-cc-projekt-navn': udvikling.navn } }) : undefined;
  const primaer = handlingKnap ?? skrivKnap ?? ccKnap;
  const andre: Knap[] = [
    ...(k.handling && !handlingKnap ? [tilstandChip('ordnet', t.gjort)] : []),
    ...(k.mailId ? [knap({ label: t.svarIMail, attrs: {}, href: '/rum/mail' })] : []),
    ...(k.prompt ? [knap({ label: t.kopierPrompt, attrs: { 'data-kopier': k.prompt } })] : []),
    ...regnskabsKnapper(k),
    ...(handlingKnap && skrivKnap ? [skrivKnap] : []),
    ...((handlingKnap || skrivKnap) && ccKnap ? [ccKnap] : []),
    html`<span class="vis-smaa">${spoerg(t.kortet(k.titel), t.ret)}${senere ? html`<button type="button" class="btn btn-ghost" data-senere-aabn="${k.id}" aria-expanded="false">${t.senere}</button>` : ''}<button type="button" class="btn btn-ghost" data-luk="${k.id}">${t.luk}</button></span>`,
  ];
  // KC-0068: the card's kind and its ledger line's art are markers for the test world's coverage.
  const art = (k.regnskab ?? k.regnskabForslag)?.art;
  return html`<article class="card kort${stor ? ' kort-stor' : ''}" data-kort-id="${k.id}" data-kort-type="${k.type}"${art ? html` data-regnskab-art="${art}"` : ''}${zoneData(k)} data-element="${t.kortet(k.titel)}" data-blok="kort">
    ${visHoved(v, overskrift, t.typeLabel[k.type])}${zoneChip(k)}
    ${k.besked ? beskedLinje(k.besked) : ''}
    ${k.visuel?.billede ? billede(k.visuel.billede) : ''}
    ${stor ? anbefaling : ''}
    ${k.kraeverRegel && !k.skrevet ? html`<p class="row-note tilstand-kraever" data-kraever-regel>${t.kraeverRegel}</p>` : ''}
    ${handlinger(primaer, andre)}
    ${senere ? senereValg(k.id, senere.aften) : ''}
    ${mere(hvorfor, t.hvorfor)}
  </article>`;
}

const CC_TILSTAND: Record<CcRaekke['status'], Tilstand> = { sendt: 'rolig', modtaget: 'rolig', 'i-gang': 'rolig', parkeret: 'kraever', faerdig: 'ordnet' };

/** KC-0043: one line per opgave — where it is, and the evidence or the reason when it ended. */
function ccRaekke(o: CcRaekke): Markup {
  const t = hjemTekst();
  const note = [o.projekt, o.ticket].filter(Boolean).join(' · ');
  // Links are dropped from the text (the PR has its own link): a long URL would also widen the phone layout.
  const efter = (o.status === 'faerdig' ? o.bevis : o.status === 'parkeret' ? (o.svar ? t.ditSvar(o.svar) : o.grund) : undefined)?.replace(/\s*(?:PR:?\s*)?https?:\/\/\S+/g, '').trim();
  return html`<div class="row cc-row" data-cc-opgave="${o.id}" data-cc-status="${o.status}">${tilstandChip(o.status === 'parkeret' && o.svar ? 'rolig' : CC_TILSTAND[o.status], t.ccStatus[o.status])}<span class="row-main"><span class="row-title">${o.saetning}</span><span class="row-note">${note}${efter ? html` — ${efter}` : ''}</span>${o.pr ? html`<a class="row-note cc-pr" href="${o.pr}" target="_blank" rel="noopener noreferrer">${t.seAendringen}</a>` : ''}</span></div>`;
}

const ccElement = (o: CcRaekke): Element => ({ id: `cc:${o.id}`, html: ccRaekke(o) });

/** KC-0045: a parked ticket waits on Henrik — the question, one button per option (the first is the recommendation) and his own words. */
function spoergsmaalKort(o: CcRaekke & { spoergsmaal: { tekst: string; valg: string[] } }): Markup {
  const t = hjemTekst();
  // The first option is Hermes' recommendation and the one primary; the others are plain.
  const valgKnapper = o.spoergsmaal.valg.map((v, i) => knap({ label: v, slags: i === 0 ? 'primaer' : 'normal', attrs: { 'data-cc-svar': o.id, 'data-svar': v } }));
  if (valgKnapper.length) valgKnapper.splice(1, 0, html`<span class="row-note cc-anbefalet">${t.anbefalet}</span>`);
  return html`<article class="card kort cc-spoergsmaal" data-element="${t.ccSpoergerElement(o.spoergsmaal.tekst)}">
    <div class="kort-head">${tilstandChip('rolig', `${o.projekt}${o.ticket ? ` · ${o.ticket}` : ''}`)}<span class="row-title">${o.spoergsmaal.tekst}</span></div>
    <p class="row-note">${t.om}${o.saetning}</p>
    ${handlinger(valgKnapper[0], valgKnapper.slice(1))}
    <form class="cc-svar-form" data-cc-svar-form="${o.id}" autocomplete="off"><input name="svar" type="text" maxlength="500" required placeholder="${o.spoergsmaal.valg.length ? t.egneOrd : t.ditSvarFelt}"><button type="submit" class="btn">${t.svar}</button></form>
  </article>`;
}

/** KC-0048: one line per project — what landed, what was rolled back, how long it typically took, what is parked. */
function ccTalLinje(t: ProjektTal): Markup {
  return html`<p class="row-note cc-tal" data-cc-tal="${t.projekt.toLowerCase()}">${hjemTekst().ccTal(t.projekt, t.landet, t.rullet, t.parkeret, t.minutter)}</p>`;
}

const erSpoergsmaal = (o: CcRaekke): o is CcRaekke & { spoergsmaal: { tekst: string; valg: string[] } } => o.status === 'parkeret' && Boolean(o.spoergsmaal) && !o.svar;

/** KC-0064: a parked opgave waits on Henrik until he has answered; after that it is Claude Code's again (I gang). */
const venterPaaHenrik = (o: CcRaekke): boolean => o.status === 'parkeret' && !o.svar;

function skrevetRaekke(r: SkrevetRaekke): Markup {
  const t = hjemTekst();
  return html`<div class="row" data-regnskab-id="${r.id}"${zoneData(r)}><span class="row-main"><span class="row-title">${[r.leverandoer, r.beloeb, r.valuta].filter(Boolean).join(' ') || r.id}</span><span class="row-note">${t.iHvor(t.hvorBeskrivelse[r.hvor])}</span></span><button type="button" class="btn btn-ghost" data-regnskab="fortryd">${t.fortryd}</button></div>`;
}

/** A ledger row (handlingId regnskab:<id>) can always be undone; anything else needs a stored fortryd and a young entry (as in Dagen). */
function logRaekke(h: HjemData['hermes'][number], now: Date): Markup {
  const t = hjemTekst();
  const fortrudt = Boolean(h.fortrudt);
  const regnskabsraekke = Boolean(h.handlingId?.startsWith('regnskab:'));
  const gammel = now.getTime() - new Date(h.tid).getTime() > FORTRYD_TIMER * 3600_000;
  const kan = Boolean(h.id) && !fortrudt && (regnskabsraekke || (Boolean(h.fortryd) && !gammel));
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}"${h.id ? html` data-log="${h.id}"` : ''}${zoneData(h)}${h.graense ? html` data-graense="${h.graense}"` : ''}><span class="mono time">${klokke(h.tid)}</span><span class="row-main"><span class="row-title">${h.tekst}</span>${fortrudt ? html`<span class="row-note">${t.fortrudtKl(klokke(h.fortrudt ?? ''))}</span>` : ''}</span>${kan ? html`<button type="button" class="btn btn-ghost" data-hjem-fortryd="${h.id}">${t.fortryd}</button>` : ''}</div>`;
}

/** What waits on Henrik in Hjem itself: Claude Code's questions and parked opgaver, and Kuratoren's open cards. */
type EgneFelter = 'kort' | 'gjort' | 'claudeCode' | 'person' | 'reglerFejl' | 'kildeHelbred' | 'regelforslag' | 'stikproeve' | 'stopTilbud' | 'beta';
function egneDele(d: Pick<HjemData, EgneFelter>) {
  const gjort = new Set(d.gjort ?? []);
  const cc = d.claudeCode ?? [];
  // A card is done when its handling ran (and was not undone) or, without a handling, when it was written to the ledger.
  const erGjort = (k: Kort): boolean => (k.handling ? gjort.has(k.handling.id) : Boolean(k.skrevet));
  const rangeret = kunSynlige(d.kort ?? [], d.person).sort((a, b) => a.prioritet - b.prioritet);
  return { gjort, erGjort, rangeret, aabne: rangeret.filter((k) => !erGjort(k)), spoerger: cc.filter(erSpoergsmaal), parkerede: cc.filter((o) => venterPaaHenrik(o) && !o.spoergsmaal), forbindelser: kunSynlige(d.kildeHelbred ?? [], d.person), forslag: kunSynlige(d.regelforslag ?? [], d.person).filter((f) => f.status === 'afventer'), beta: betaElementer(d) };
}

/** KC-0093: Hjem's own share of "venter på dig" — the nav and the tab title add it to every room's count. */
export function hjemEgne(d: Pick<HjemData, EgneFelter>): number {
  const e = egneDele(d);
  return e.aabne.length + e.spoerger.length + e.parkerede.length + e.forbindelser.length + e.forslag.length + (d.reglerFejl ? 1 : 0) + (d.stikproeve ? 1 : 0) + (d.stopTilbud ? 1 : 0) + e.beta.length;
}

/** KC-0203: the beta's cards — the owner's only (a member never sees them even if handed the data). Their ids start with BETA_ID. */
const BETA_ID = 'beta:';
function betaElementer(d: Pick<HjemData, 'beta' | 'person'>): Element[] {
  if (!d.beta || (d.person && d.person.rolle !== 'ejer')) return [];
  return [...(d.beta.kort ? [{ id: `${BETA_ID}kort`, html: betaKort() }] : []), ...(d.beta.feedback ? [{ id: `${BETA_ID}feedback:${d.beta.feedback.dag}`, html: feedbackKort(d.beta.feedback.dag, d.beta.feedback.priser) }] : [])];
}

/** KC-0099: nothing waits anywhere — say so calmly, with what comes next today, instead of an empty page. */
function altOrdnet(naeste: Naeste | undefined): Markup {
  const t = hjemTekst();
  const linje = naeste && !Number.isNaN(Date.parse(naeste.start)) ? t.detNaeste(naeste.titel, klokke(naeste.start)) : t.hermesHolderOje;
  return html`<section class="card alt-ordnet" data-element="${t.altOrdnet}">${visHoved({ ikon: 'circle-check', tone: 'god' }, t.altOrdnet)}<p class="muted">${linje}</p></section>`;
}

/** KC-0142: the rules file does not parse — Hermes falls back to trin 0 until Henrik fixes it. */
function reglerFejlKort(f: NonNullable<HjemData['reglerFejl']>): Markup {
  const t = hjemTekst();
  return html`<article class="card kort" data-element="${t.reglerFejlTitel}" data-blok="kort" data-regler="ulaeselig">
    ${visHoved({ ikon: 'triangle-alert', tone: 'adv' }, t.reglerFejlTitel, t.regler)}
    <p class="betydning">${t.reglerFejlTekst}</p>
    <p class="row-note">${t.fejlen(f.hvorfor)}</p>
    <p class="row-note">${t.filen(f.fil)}</p>
  </article>`;
}

/** KC-0115: the meeting on now, one row in I gang with the way into the meeting view. */
function moedeNu(m: NonNullable<HjemData['moede']>): Markup {
  return html`<div class="row" data-nu-moede><span class="row-main"><span class="row-title">${m.titel}</span><span class="row-note">${hjemTekst().slutterKl(klokke(m.slut))}</span></span><a class="btn" href="${m.url}">${hjemTekst().aabnMoedet}</a></div>`;
}

/**
 * KC-0147: the Kræver dig band, the one place it is computed — renderHjem draws it, and kraeverIder (the day's count of
 * what required Henrik) reads the very same groups, so the count can never disagree with the screen (§0 r6).
 */
function kraeverGrupper(d: HjemData, nu: Date, unik: (id: string) => string): Gruppe[] {
  const { gjort, aabne, spoerger, parkerede, forbindelser, forslag, beta } = egneDele(d);
  const t = hjemTekst();
  const stor = aabne.find((k) => k.handling)?.id; // rule 6: the one large card
  const unikNoegle = unikIder(); // a waiting row's identity for counting: its room and its words, not its place in the list
  return [
    // KC-0203: the closed beta's questions (only under KC_BETA=ja); first, because they are asked once and leave.
    { titel: t.betaGruppe, form: 'kort', elementer: beta },
    { titel: t.regler, form: 'kort', elementer: [...(d.reglerFejl ? [{ id: 'regler:ulaeselig', html: reglerFejlKort(d.reglerFejl) }] : []), ...forslag.map((f) => ({ id: `regelforslag:${f.id}`, html: regelforslagKort(f) }))] },
    // KC-0145: the Sunday sample (one bunke, gone when all lines are answered) and the stop question.
    { titel: t.soendagstjek, form: 'kort', elementer: [...(d.stikproeve ? [{ id: `stikproeve:${d.stikproeve.uge}`, html: stikproeveKort(d.stikproeve) }] : []), ...(d.stopTilbud ? [{ id: 'soendagstjek:stop', html: stopKort() }] : [])] },
    // KC-0139: a connection that does not work — one card per source, gone when it works again.
    { titel: t.forbindelser, form: 'kort', elementer: kildeHelbredElementer(forbindelser, nu) },
    { titel: t.ccSpoerger, form: 'kort', elementer: spoerger.map((o) => ({ id: `cc:${o.id}`, html: spoergsmaalKort(o) })) },
    { titel: t.ccParkerede, form: 'raekker', elementer: parkerede.map(ccElement) },
    { titel: t.ligeNu, form: 'kort', elementer: aabne.map((k) => ({ id: `kort:${k.id}`, html: kortKasse(k, gjort, k.id === stor, { aften: aftenMulig(nu) }) })), fold: { efter: SYNLIGE_KORT, navn: t.flereKort } },
    { titel: t.venterPaaDig, form: 'raekker', elementer: d.venter.map((v) => { const f = d.gamle?.[RUM_SLAGS[v.roomId] ?? '']; return { id: unik(`venter:${v.roomId}`), noegle: unikNoegle(`venter:${v.roomId}:${v.tekst}`), html: venterRow(v, f ? { f, nu } : undefined) }; }), fold: { efter: 3, navn: t.alle(d.venter.length) } },
  ];
}

/** KC-0147: the ids (stable per element) of everything in Nu's Kræver dig band right now. */
export function kraeverIder(d: HjemData): string[] {
  // KC-0203: the beta's questions are a survey, not something that required the person: the day count the beta measures (and the week's number) leave them out.
  return kraeverGrupper(d, d.now ?? new Date(), unikIder()).flatMap((g) => g.elementer.map((e) => e.noegle ?? e.id)).filter((id) => !id.startsWith(BETA_ID));
}

export function renderHjem(d: HjemData): Markup {
  const intet = kunSynlige(d.intet ?? [], d.person);
  const cc = d.claudeCode ?? [];
  const nu = d.now ?? new Date();
  const t = hjemTekst();
  const unik = unikIder(); // venter rows (one per waiting thing) and id-less log entries can repeat
  const vis = new Set<string>(SITUATIONER[d.situation ?? 'dagen'].elementer);
  const fliser = vis.has('fliser') ? ROOMS.filter((r) => r.id !== 'hjem' && (!d.synlige || d.synlige.has(r.id))) : [];
  const { gjort, erGjort, rangeret } = egneDele(d);
  const hosCc = cc.filter((o) => o.status === 'sendt' || o.status === 'modtaget' || o.status === 'i-gang' || (o.status === 'parkeret' && Boolean(o.svar)));
  const kraever = kraeverGrupper(d, nu, unik);
  const igang: Gruppe[] = !vis.has('igang') ? [] : [
    ...(vis.has('moede') && d.moede ? [{ titel: t.moedeNu, form: 'raekker' as const, elementer: [{ id: 'nu:moede', html: moedeNu(d.moede) }] }] : []),
    { titel: t.venterPaaAndre, form: 'raekker', elementer: (d.venterPaaAndre ?? []).map((v) => ({ id: unik(`andre:${v.roomId}`), html: venterRow(v) })) },
    { titel: t.hosCc, form: 'raekker', elementer: hosCc.map(ccElement), fold: { efter: 3, navn: t.alleOpgaver(hosCc.length) } },
    igangGruppe(d.igang ?? []),
  ];
  const ordnet: OrdnetGruppe[] = !vis.has('ordnet') ? [] : [
    { titel: t.gjort, form: 'kort', elementer: rangeret.filter(erGjort).map((k) => ({ id: `kort:${k.id}`, html: kortKasse(k, gjort) })) },
    { titel: t.skrevetIRegnskab, form: 'raekker', elementer: kunSynlige(d.regnskab ?? [], d.person).map((r) => ({ id: `regnskab:${r.id}`, html: skrevetRaekke(r) })) },
    { titel: t.intetAtGoere, form: 'raekker', elementer: intet.map((i) => ({ id: `intet:${i.titel}`, html: html`<div class="row"><span class="row-main"><span class="row-title">${i.titel}</span>${i.hvorfor ? html`<span class="row-note">${i.hvorfor}</span>` : ''}</span></div>` })) },
    { titel: t.ccFaerdig, form: 'raekker', elementer: cc.filter((o) => o.status === 'faerdig').map(ccElement), note: html`${(d.ccTal ?? []).map(ccTalLinje)}` },
    { titel: t.hermesHarGjort, form: 'raekker', elementer: dagensLog(kunSynlige(d.hermes, d.person), nu).map((h) => ({ id: unik(`log:${h.id ?? `${h.tid}|${h.tekst}`}`), html: logRaekke(h, nu) })) },
  ];
  // KC-0128: the first look at a new source is content, not something that waits on Henrik.
  const foerste = d.forhaandsvisninger?.length ? html`<div class="stack gruppe" data-gruppe="${t.foersteKig}">${d.forhaandsvisninger.map((e) => medId(e.id, e.html))}</div>` : undefined;
  const indhold = d.venterIalt === 0 ? html`${foerste ?? ''}${altOrdnet(d.naeste)}` : foerste;
  return html`
  <header class="room-head"><div><h1>${d.hilsen}</h1>${d.naeste && vis.has('naeste') ? naesteLinje(d.naeste, nu) : ''}${d.naeste && vis.has('naeste') && d.gamle?.['kalender'] ? html`<p class="row-note" data-gammel="kalender">${t.kalenderen}${kildeFriskhed(d.gamle['kalender'], nu)}</p>` : ''}<p class="muted">${t.overskrift}</p></div></header>
  ${d.ugetal ?? ''}

  ${baand({ kraever, igang, ordnet, ...(d.venterIalt !== undefined ? { venter: d.venterIalt } : {}), ...(indhold ? { indhold } : {}) })}

  ${fliser.length ? html`<section class="tiles kun-stor">
    ${fliser.map((r) => medId(`rum:${r.id}`, html`<a class="tile${r.built ? '' : ' tile-unbuilt'}" href="/rum/${r.id}" data-room-tile="${r.id}">${rumIkon(r.id)}<span class="tile-name">${rumNavn(r.id)}</span><span class="row-note">${rumBeskrivelse(r)}</span></a>`))}
  </section>` : ''}
  ${tekst().chatSaetninger ? html`<p class="row-note rum-hint">${raw(t.chatHint)}</p>` : ''}`;
}

export function renderPlaceholder(r: Room): Markup {
  const t = hjemTekst();
  return html`
  <header class="room-head"><div><h1>${findRoom(r.id)?.navn === r.navn ? rumNavn(r.id) : r.navn}</h1><p class="muted">${t.tegnetIkkeBygget}</p></div></header>
  <section class="card">
    <p>${rumBeskrivelse(r)}</p>
    <p class="muted">${t.tegnetTekst}</p>
    <p><a href="${CANVAS_URL}" target="_blank" rel="noopener">${t.seTegningen}</a></p>
  </section>`;
}
