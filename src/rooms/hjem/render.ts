// The room Hjem: greeting, what waits (links into rooms), the room tiles and
// what Hermes did lately. Also the placeholder for rooms that are drawn but
// not built.

import { ikkeEndnu } from '../../graenser/afgoer.ts';
import { html, type Markup } from '../../shell/html.ts';
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
import { kildeFriskhed, type KildeFriskhed } from '../../shell/friskhed.ts';
import { kildeHelbredElementer, type KildeHelbredKort } from '../../shell/kilde-helbred.ts';
import { TRIN } from '../../tillid/trin.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import type { Stikuge } from '../../tillid/stikproeve.ts';
import { stikproeveKort, stopKort } from './stikproeve.ts';

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
};

export type CcRaekke = { id: string; status: 'sendt' | 'modtaget' | 'i-gang' | 'parkeret' | 'faerdig'; projekt: string; saetning: string; oprettet: string; ticket?: string; bevis?: string; pr?: string; grund?: string;
  /** KC-0045: Claude Code's question while parked, and Henrik's answer. */
  spoergsmaal?: { tekst: string; valg: string[] }; svar?: string };

export type SkrevetRaekke = { id: string; hvor: 'shelfatlas' | 'privat'; leverandoer?: string; beloeb?: string; valuta?: string } & Zoneret;

const TYPE_LABEL: Record<KortType, string> = { tjeneste: 'Tjeneste', familie: 'Fra familien', regning: 'Regning', nyhed: 'Nyhed' };
/** KC-0059: the pictogram of a card that brings none of its own. */
const TYPE_IKON: Record<KortType, IkonNavn> = { tjeneste: 'sparkles', familie: 'heart', regning: 'receipt', nyhed: 'newspaper' };
const RUM_IKON: Record<string, IkonNavn> = { dagen: 'sunrise', mail: 'mail', skrive: 'pen-line', nyheder: 'newspaper' };
const rumIkon = (roomId: string): Markup => html`<span class="rum-ikon">${ikon(RUM_IKON[roomId] ?? (roomId.startsWith('univers') ? 'target' : 'house'))}</span>`;
const HVOR_LABEL = { shelfatlas: 'ShelfAtlas-regnskabet', privat: 'det private regnskab' } as const;
const HVOR_KNAP = { shelfatlas: 'ShelfAtlas', privat: 'privat' } as const;
/** KC-0024: the phone shows this many cards; the rest are one tap away. */
const SYNLIGE_KORT = 3;
const FORTRYD_TIMER = 24;

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

/** KC-0024: the phone shows the first three; the rest fold. */
function venterRow(v: { roomId: string; tekst: string }, gammel?: { f: KildeFriskhed; nu: Date }): Markup {
  const note = gammel ? kildeFriskhed(gammel.f, gammel.nu) : '';
  return html`<a class="row row-link" href="/rum/${v.roomId}">${rumIkon(v.roomId)}<span class="row-main"><span class="row-title">${v.tekst}</span><span class="row-note">${findRoom(v.roomId)?.navn ?? v.roomId}${note ? html` · ${note}` : ''}</span></span><span class="muted">→</span></a>`;
}

/** KC-0139: which slags a room's waiting lines are read from (the rooms that read a connector). */
const RUM_SLAGS: Record<string, string> = { dagen: 'kalender', mail: 'mail' };

/** A source is a link only when it is an http(s) address; anything else is plain text. */
function kilde(k: string): Markup {
  return /^https?:\/\//i.test(k) ? html`<a href="${k}" target="_blank" rel="noopener noreferrer">${k}</a>` : html`${k}`;
}

/** The ledger buttons of a bill card. Two equal choices (no recommendation) are both plain: neither is the primary. */
function regnskabsKnapper(k: Kort): Knap[] {
  if (k.skrevet) {
    const anden = k.skrevet.hvor === 'shelfatlas' ? 'privat' : 'shelfatlas';
    return [html`<p class="row-note">Skrevet i ${HVOR_LABEL[k.skrevet.hvor]}</p>`, knap({ label: 'Fortryd regnskab', attrs: { 'data-regnskab': 'fortryd' } }), knap({ label: `Flyt til ${HVOR_KNAP[anden]}`, attrs: { 'data-regnskab': 'flyt' } })];
  }
  if (k.regnskabUklart) return [knap({ label: 'Skriv i ShelfAtlas', attrs: { 'data-regnskab': 'shelfatlas' } }), knap({ label: 'Skriv i privat', attrs: { 'data-regnskab': 'privat' } })];
  return [];
}

/** KC-0096: the two places a card can be put away to, hidden until Senere is pressed (public/app.js opens them in place). */
function senereValg(id: string, aften: boolean): Markup {
  return html`<div class="senere-valg" data-senere-valg hidden role="group" aria-label="Vis kortet igen"><span class="row-note">Vis det igen</span>${aften ? html`<button type="button" class="btn" data-senere="aften" data-senere-kort="${id}">I aften</button>` : ''}<button type="button" class="btn" data-senere="morgen" data-senere-kort="${id}">I morgen</button></div>`;
}

/** KC-0138: the channels' names (src/kilder/beskeder/valg.ts KANAL_NAVN restated: rooms import nothing from src/kilder). */
const KANAL_NAVN: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', signal: 'Signal' };

/** KC-0138: who wrote, where, and that Clawco only reads — the app's line, never Hermes' text. */
function beskedLinje(b: NonNullable<Kort['besked']>): Markup {
  const kanal = KANAL_NAVN[b.kanal] ?? b.kanal;
  return html`<p class="row-note besked-linje" data-besked-kanal="${b.kanal}">Besked fra ${b.afsender} på ${kanal} · Clawco læser kun og svarer aldrig selv. Svar selv i ${kanal}.</p>`;
}

/** KC-0064 rule 6: `stor` is the one large card of the room view — its recommendation sits on the face. */
function kortKasse(k: Kort, gjort: Set<string>, stor = false, senere?: { aften: boolean }): Markup {
  // KC-0046: only a card about one of Henrik's projects offers Send til Claude Code (any card can still go from the chat head).
  const udvikling = k.udvikling ? findProjekt(k.udvikling.projekt) : undefined;
  // KC-0059: pictogram, one headline, the picture and the one move; everything else is behind Hvorfor?.
  const v = { ...(k.visuel ?? { ikon: TYPE_IKON[k.type] }), ...(stor ? { tone: 'adv' as const } : {}) };
  const overskrift = k.visuel?.overskrift ?? k.titel;
  const anbefaling = k.anbefaling ? html`<div class="pending"><span class="pending-label">Anbefaling</span><span>${k.anbefaling}</span></div>` : '';
  const hvorfor = html`${overskrift !== k.titel ? html`<p class="row-title">${k.titel}</p>` : ''}<p class="betydning">${k.betyder}</p>
    ${stor ? '' : anbefaling}
    ${k.grundlag.length ? html`<ul class="lines">${k.grundlag.map((g) => html`<li>${g}</li>`)}</ul>` : ''}${k.kilder.length ? html`<p class="row-note">Kilder: ${k.kilder.map((x, i) => html`${i ? ' · ' : ''}${kilde(x)}`)}</p>` : ''}`;
  // KC-0064: at most one primary — the handling, else writing the bill, else Send til Claude Code.
  const handlingKnap = k.handling && !gjort.has(k.handling.id) ? knap({ label: k.handling.label, slags: 'primaer', attrs: { 'data-kort-handling': k.id } }) : undefined;
  // KC-0066: a bill whose line is not in a ledger (Henrik undid it) can be written again, to the ledger the line names.
  const skrivKnap = k.regnskab && !k.skrevet && !k.regnskabUklart ? knap({ label: `Skriv i ${HVOR_KNAP[k.regnskab.hvor]}`, slags: handlingKnap ? 'normal' : 'primaer', attrs: { 'data-regnskab': k.regnskab.hvor } }) : undefined;
  const ccKnap = udvikling ? knap({ label: `Send til Claude Code · ${udvikling.navn}`, slags: handlingKnap || skrivKnap ? 'normal' : 'primaer', attrs: { 'data-cc-kort': k.id, 'data-cc-titel': k.titel, 'data-cc-projekt': udvikling.id, 'data-cc-projekt-navn': udvikling.navn } }) : undefined;
  const primaer = handlingKnap ?? skrivKnap ?? ccKnap;
  const andre: Knap[] = [
    ...(k.handling && !handlingKnap ? [tilstandChip('ordnet', 'Gjort')] : []),
    ...(k.mailId ? [knap({ label: 'Svar i Mail', attrs: {}, href: '/rum/mail' })] : []),
    ...(k.prompt ? [knap({ label: 'Kopiér prompt', attrs: { 'data-kopier': k.prompt } })] : []),
    ...regnskabsKnapper(k),
    ...(handlingKnap && skrivKnap ? [skrivKnap] : []),
    ...((handlingKnap || skrivKnap) && ccKnap ? [ccKnap] : []),
    html`<span class="vis-smaa">${spoerg(`Kortet: ${k.titel}`, 'Ret')}${senere ? html`<button type="button" class="btn btn-ghost" data-senere-aabn="${k.id}" aria-expanded="false">Senere</button>` : ''}<button type="button" class="btn btn-ghost" data-luk="${k.id}">Luk</button></span>`,
  ];
  // KC-0068: the card's kind and its ledger line's art are markers for the test world's coverage.
  const art = (k.regnskab ?? k.regnskabForslag)?.art;
  return html`<article class="card kort${stor ? ' kort-stor' : ''}" data-kort-id="${k.id}" data-kort-type="${k.type}"${art ? html` data-regnskab-art="${art}"` : ''}${zoneData(k)} data-element="Kortet: ${k.titel}" data-blok="kort">
    ${visHoved(v, overskrift, TYPE_LABEL[k.type])}${zoneChip(k)}
    ${k.besked ? beskedLinje(k.besked) : ''}
    ${k.visuel?.billede ? billede(k.visuel.billede) : ''}
    ${stor ? anbefaling : ''}
    ${k.kraeverRegel && !k.skrevet ? html`<p class="row-note tilstand-kraever" data-kraever-regel>${ikkeEndnu('bogfoer')}</p>` : ''}
    ${handlinger(primaer, andre)}
    ${senere ? senereValg(k.id, senere.aften) : ''}
    ${mere(hvorfor)}
  </article>`;
}

const CC_STATUS: Record<CcRaekke['status'], { tekst: string; tilstand: Tilstand }> = {
  sendt: { tekst: 'Sendt', tilstand: 'rolig' }, modtaget: { tekst: 'Modtaget', tilstand: 'rolig' }, 'i-gang': { tekst: 'I gang', tilstand: 'rolig' },
  parkeret: { tekst: 'Parkeret', tilstand: 'kraever' }, faerdig: { tekst: 'Færdig', tilstand: 'ordnet' },
};

/** KC-0043: one line per opgave — where it is, and the evidence or the reason when it ended. */
function ccRaekke(o: CcRaekke): Markup {
  const s = CC_STATUS[o.status];
  const note = [o.projekt, o.ticket].filter(Boolean).join(' · ');
  // Links are dropped from the text (the PR has its own link): a long URL would also widen the phone layout.
  const efter = (o.status === 'faerdig' ? o.bevis : o.status === 'parkeret' ? (o.svar ? `Dit svar: ${o.svar} — Claude Code tager den op, næste gang den arbejder i projektet.` : o.grund) : undefined)?.replace(/\s*(?:PR:?\s*)?https?:\/\/\S+/g, '').trim();
  return html`<div class="row cc-row" data-cc-opgave="${o.id}" data-cc-status="${o.status}">${tilstandChip(o.status === 'parkeret' && o.svar ? 'rolig' : s.tilstand, s.tekst)}<span class="row-main"><span class="row-title">${o.saetning}</span><span class="row-note">${note}${efter ? html` — ${efter}` : ''}</span>${o.pr ? html`<a class="row-note cc-pr" href="${o.pr}" target="_blank" rel="noopener noreferrer">Se ændringen (PR)</a>` : ''}</span></div>`;
}

const ccElement = (o: CcRaekke): Element => ({ id: `cc:${o.id}`, html: ccRaekke(o) });

/** KC-0045: a parked ticket waits on Henrik — the question, one button per option (the first is the recommendation) and his own words. */
function spoergsmaalKort(o: CcRaekke & { spoergsmaal: { tekst: string; valg: string[] } }): Markup {
  // The first option is Hermes' recommendation and the one primary; the others are plain.
  const valgKnapper = o.spoergsmaal.valg.map((v, i) => knap({ label: v, slags: i === 0 ? 'primaer' : 'normal', attrs: { 'data-cc-svar': o.id, 'data-svar': v } }));
  if (valgKnapper.length) valgKnapper.splice(1, 0, html`<span class="row-note cc-anbefalet">← anbefalet</span>`);
  return html`<article class="card kort cc-spoergsmaal" data-element="Claude Code spørger: ${o.spoergsmaal.tekst}">
    <div class="kort-head">${tilstandChip('rolig', `${o.projekt}${o.ticket ? ` · ${o.ticket}` : ''}`)}<span class="row-title">${o.spoergsmaal.tekst}</span></div>
    <p class="row-note">Om: ${o.saetning}</p>
    ${handlinger(valgKnapper[0], valgKnapper.slice(1))}
    <form class="cc-svar-form" data-cc-svar-form="${o.id}" autocomplete="off"><input name="svar" type="text" maxlength="500" required placeholder="${o.spoergsmaal.valg.length ? 'Eller svar med dine egne ord' : 'Dit svar'}"><button type="submit" class="btn">Svar</button></form>
  </article>`;
}

/** KC-0048: one line per project — what landed, what was rolled back, how long it typically took, what is parked. */
function ccTalLinje(t: ProjektTal): Markup {
  const tid = t.minutter === undefined ? '' : ` · typisk ${t.minutter < 120 ? `${t.minutter} min` : `${Math.round(t.minutter / 60)} timer`}`;
  return html`<p class="row-note cc-tal" data-cc-tal="${t.projekt.toLowerCase()}">${t.projekt}: ${t.landet} ${t.landet === 1 ? 'færdig' : 'færdige'} · ${t.rullet} rullet tilbage${tid} · ${t.parkeret} parkeret</p>`;
}

const erSpoergsmaal = (o: CcRaekke): o is CcRaekke & { spoergsmaal: { tekst: string; valg: string[] } } => o.status === 'parkeret' && Boolean(o.spoergsmaal) && !o.svar;

/** KC-0064: a parked opgave waits on Henrik until he has answered; after that it is Claude Code's again (I gang). */
const venterPaaHenrik = (o: CcRaekke): boolean => o.status === 'parkeret' && !o.svar;

function skrevetRaekke(r: SkrevetRaekke): Markup {
  return html`<div class="row" data-regnskab-id="${r.id}"${zoneData(r)}><span class="row-main"><span class="row-title">${[r.leverandoer, r.beloeb, r.valuta].filter(Boolean).join(' ') || r.id}</span><span class="row-note">i ${HVOR_LABEL[r.hvor]}</span></span><button type="button" class="btn btn-ghost" data-regnskab="fortryd">Fortryd</button></div>`;
}

/** A ledger row (handlingId regnskab:<id>) can always be undone; anything else needs a stored fortryd and a young entry (as in Dagen). */
function logRaekke(h: HjemData['hermes'][number], now: Date): Markup {
  const fortrudt = Boolean(h.fortrudt);
  const regnskabsraekke = Boolean(h.handlingId?.startsWith('regnskab:'));
  const gammel = now.getTime() - new Date(h.tid).getTime() > FORTRYD_TIMER * 3600_000;
  const kan = Boolean(h.id) && !fortrudt && (regnskabsraekke || (Boolean(h.fortryd) && !gammel));
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}"${h.id ? html` data-log="${h.id}"` : ''}${zoneData(h)}${h.graense ? html` data-graense="${h.graense}"` : ''}><span class="mono time">${klokke(h.tid)}</span><span class="row-main"><span class="row-title">${h.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(h.fortrudt ?? '')}</span>` : ''}</span>${kan ? html`<button type="button" class="btn btn-ghost" data-hjem-fortryd="${h.id}">Fortryd</button>` : ''}</div>`;
}

/** What waits on Henrik in Hjem itself: Claude Code's questions and parked opgaver, and Kuratoren's open cards. */
type EgneFelter = 'kort' | 'gjort' | 'claudeCode' | 'person' | 'reglerFejl' | 'kildeHelbred' | 'regelforslag' | 'stikproeve' | 'stopTilbud';
function egneDele(d: Pick<HjemData, EgneFelter>) {
  const gjort = new Set(d.gjort ?? []);
  const cc = d.claudeCode ?? [];
  // A card is done when its handling ran (and was not undone) or, without a handling, when it was written to the ledger.
  const erGjort = (k: Kort): boolean => (k.handling ? gjort.has(k.handling.id) : Boolean(k.skrevet));
  const rangeret = kunSynlige(d.kort ?? [], d.person).sort((a, b) => a.prioritet - b.prioritet);
  return { gjort, erGjort, rangeret, aabne: rangeret.filter((k) => !erGjort(k)), spoerger: cc.filter(erSpoergsmaal), parkerede: cc.filter((o) => venterPaaHenrik(o) && !o.spoergsmaal), forbindelser: kunSynlige(d.kildeHelbred ?? [], d.person), forslag: kunSynlige(d.regelforslag ?? [], d.person).filter((f) => f.status === 'afventer') };
}

/** KC-0093: Hjem's own share of "venter på dig" — the nav and the tab title add it to every room's count. */
export function hjemEgne(d: Pick<HjemData, EgneFelter>): number {
  const e = egneDele(d);
  return e.aabne.length + e.spoerger.length + e.parkerede.length + e.forbindelser.length + e.forslag.length + (d.reglerFejl ? 1 : 0) + (d.stikproeve ? 1 : 0) + (d.stopTilbud ? 1 : 0);
}

/** KC-0099: nothing waits anywhere — say so calmly, with what comes next today, instead of an empty page. */
function altOrdnet(naeste: Naeste | undefined): Markup {
  const linje = naeste && !Number.isNaN(Date.parse(naeste.start)) ? `Det næste i dag er ${naeste.titel} kl. ${klokke(naeste.start)}.` : 'Hermes holder øje og siger til, når noget kræver dig.';
  return html`<section class="card alt-ordnet" data-element="Alt er ordnet">${visHoved({ ikon: 'circle-check', tone: 'god' }, 'Alt er ordnet')}<p class="muted">${linje}</p></section>`;
}

/** KC-0142: the rules file does not parse — Hermes falls back to trin 0 until Henrik fixes it. */
function reglerFejlKort(f: NonNullable<HjemData['reglerFejl']>): Markup {
  return html`<article class="card kort" data-element="Reglerne kan ikke læses" data-blok="kort" data-regler="ulaeselig">
    ${visHoved({ ikon: 'triangle-alert', tone: 'adv' }, 'Reglerne kan ikke læses', 'Regler')}
    <p class="betydning">Indtil filen er rettet, gør Hermes intet af sig selv: den ser kun og foreslår.</p>
    <p class="row-note">Fejlen: ${f.hvorfor}.</p>
    <p class="row-note">Filen: ${f.fil}</p>
  </article>`;
}

/** KC-0144: Hermes saw a pattern in a Ret or an Ikke relevant. Ja is the one primary and only Henrik's own tap; Ret reglen opens the chat with the proposal. */
function regelforslagKort(f: Regelforslag): Markup {
  if (f.kunPause) return pauseforslagKort(f);
  const t = TRIN[f.trin];
  return html`<article class="card kort" data-regelforslag="${f.id}" data-blok="beslutning" data-element="Regelforslag: ${f.titel}"${zoneData(f)}>
    ${visHoved({ ikon: 'list-checks' }, 'Skal jeg gøre det til en regel?', 'Forslag til en regel')}${zoneChip(f)}
    <p class="row-title">${f.titel}</p>
    <p class="betydning">${f.tekst}</p>
    <p class="row-note">Gælder ${f.gaelder.kilde}${f.gaelder.slags ? html` · ${f.gaelder.slags}` : ''} · Trin ${f.trin}, ${t.navn}: ${t.saetning}</p>
    ${f.pauser ? html`<p class="row-note">Et ja sætter samtidig ${f.pauser} på pause.</p>` : ''}
    <p class="row-note">Kom fra: ${kom(f)}</p>
    ${handlinger(
      knap({ label: 'Ja, gør det til en regel', slags: 'primaer', attrs: { 'data-regelforslag-ja': f.id } }),
      [spoerg(`Forslag: ${f.titel}`, 'Ret reglen'), knap({ label: 'Nej tak', attrs: { 'data-regelforslag-nej': f.id } })],
    )}
  </article>`;
}

/** Where a proposal came from: a Ret or Ikke relevant on a card, or (KC-0145) the Sunday sample. */
const kom = (f: Regelforslag): string => (f.kortId.startsWith('skjult:') ? `søndagstjekket: «${f.kortTitel}» skulle have været vist` : `dit ${f.art === 'ret' ? 'Ret' : 'Ikke relevant'} på «${f.kortTitel}»`);

/** KC-0145: the app's proposal to pause the rule that hid an item Henrik says he should have seen. Only his Ja pauses it. */
function pauseforslagKort(f: Regelforslag): Markup {
  return html`<article class="card kort" data-regelforslag="${f.id}" data-regelforslag-pause="${f.pauser ?? ''}" data-blok="beslutning" data-element="Regelforslag: ${f.titel}"${zoneData(f)}>
    ${visHoved({ ikon: 'list-checks' }, 'Skal jeg sætte reglen på pause?', 'Forslag til en regel')}${zoneChip(f)}
    <p class="row-title">${f.titel}</p>
    <p class="betydning">${f.tekst}</p>
    <p class="row-note">Kom fra: ${kom(f)}</p>
    ${handlinger(
      knap({ label: 'Ja, sæt den på pause', slags: 'primaer', attrs: { 'data-regelforslag-ja': f.id } }),
      [spoerg(`Forslag: ${f.titel}`, 'Ret reglen'), knap({ label: 'Nej tak', attrs: { 'data-regelforslag-nej': f.id } })],
    )}
  </article>`;
}

/** KC-0115: the meeting on now, one row in I gang with the way into the meeting view. */
function moedeNu(m: NonNullable<HjemData['moede']>): Markup {
  return html`<div class="row" data-nu-moede><span class="row-main"><span class="row-title">${m.titel}</span><span class="row-note">Slutter kl. ${klokke(m.slut)}</span></span><a class="btn" href="${m.url}">Åbn mødet</a></div>`;
}

/**
 * KC-0147: the Kræver dig band, the one place it is computed — renderHjem draws it, and kraeverIder (the day's count of
 * what required Henrik) reads the very same groups, so the count can never disagree with the screen (§0 r6).
 */
function kraeverGrupper(d: HjemData, nu: Date, unik: (id: string) => string): Gruppe[] {
  const { gjort, aabne, spoerger, parkerede, forbindelser, forslag } = egneDele(d);
  const stor = aabne.find((k) => k.handling)?.id; // rule 6: the one large card
  const unikNoegle = unikIder(); // a waiting row's identity for counting: its room and its words, not its place in the list
  return [
    { titel: 'Regler', form: 'kort', elementer: [...(d.reglerFejl ? [{ id: 'regler:ulaeselig', html: reglerFejlKort(d.reglerFejl) }] : []), ...forslag.map((f) => ({ id: `regelforslag:${f.id}`, html: regelforslagKort(f) }))] },
    // KC-0145: the Sunday sample (one bunke, gone when all lines are answered) and the stop question.
    { titel: 'Søndagstjek', form: 'kort', elementer: [...(d.stikproeve ? [{ id: `stikproeve:${d.stikproeve.uge}`, html: stikproeveKort(d.stikproeve) }] : []), ...(d.stopTilbud ? [{ id: 'soendagstjek:stop', html: stopKort() }] : [])] },
    // KC-0139: a connection that does not work — one card per source, gone when it works again.
    { titel: 'Forbindelser', form: 'kort', elementer: kildeHelbredElementer(forbindelser, nu) },
    { titel: 'Claude Code spørger', form: 'kort', elementer: spoerger.map((o) => ({ id: `cc:${o.id}`, html: spoergsmaalKort(o) })) },
    { titel: 'Claude Code parkerede', form: 'raekker', elementer: parkerede.map(ccElement) },
    { titel: 'Lige nu', form: 'kort', elementer: aabne.map((k) => ({ id: `kort:${k.id}`, html: kortKasse(k, gjort, k.id === stor, { aften: aftenMulig(nu) }) })), fold: { efter: SYNLIGE_KORT, navn: 'flere kort' } },
    { titel: 'Venter på dig', form: 'raekker', elementer: d.venter.map((v) => { const f = d.gamle?.[RUM_SLAGS[v.roomId] ?? '']; return { id: unik(`venter:${v.roomId}`), noegle: unikNoegle(`venter:${v.roomId}:${v.tekst}`), html: venterRow(v, f ? { f, nu } : undefined) }; }), fold: { efter: 3, navn: `alle ${d.venter.length}` } },
  ];
}

/** KC-0147: the ids (stable per element) of everything in Nu's Kræver dig band right now. */
export function kraeverIder(d: HjemData): string[] {
  return kraeverGrupper(d, d.now ?? new Date(), unikIder()).flatMap((g) => g.elementer.map((e) => e.noegle ?? e.id));
}

export function renderHjem(d: HjemData): Markup {
  const intet = kunSynlige(d.intet ?? [], d.person);
  const cc = d.claudeCode ?? [];
  const nu = d.now ?? new Date();
  const unik = unikIder(); // venter rows (one per waiting thing) and id-less log entries can repeat
  const vis = new Set<string>(SITUATIONER[d.situation ?? 'dagen'].elementer);
  const fliser = vis.has('fliser') ? ROOMS.filter((r) => r.id !== 'hjem' && (!d.synlige || d.synlige.has(r.id))) : [];
  const { gjort, erGjort, rangeret } = egneDele(d);
  const hosCc = cc.filter((o) => o.status === 'sendt' || o.status === 'modtaget' || o.status === 'i-gang' || (o.status === 'parkeret' && Boolean(o.svar)));
  const kraever = kraeverGrupper(d, nu, unik);
  const igang: Gruppe[] = !vis.has('igang') ? [] : [
    ...(vis.has('moede') && d.moede ? [{ titel: 'Mødet nu', form: 'raekker' as const, elementer: [{ id: 'nu:moede', html: moedeNu(d.moede) }] }] : []),
    { titel: 'Venter på andre', form: 'raekker', elementer: (d.venterPaaAndre ?? []).map((v) => ({ id: unik(`andre:${v.roomId}`), html: venterRow(v) })) },
    { titel: 'Hos Claude Code', form: 'raekker', elementer: hosCc.map(ccElement), fold: { efter: 3, navn: `alle ${hosCc.length} opgaver` } },
    igangGruppe(d.igang ?? []),
  ];
  const ordnet: OrdnetGruppe[] = !vis.has('ordnet') ? [] : [
    { titel: 'Gjort', form: 'kort', elementer: rangeret.filter(erGjort).map((k) => ({ id: `kort:${k.id}`, html: kortKasse(k, gjort) })) },
    { titel: 'Skrevet i regnskab', form: 'raekker', elementer: kunSynlige(d.regnskab ?? [], d.person).map((r) => ({ id: `regnskab:${r.id}`, html: skrevetRaekke(r) })) },
    { titel: 'Intet at gøre', form: 'raekker', elementer: intet.map((i) => ({ id: `intet:${i.titel}`, html: html`<div class="row"><span class="row-main"><span class="row-title">${i.titel}</span>${i.hvorfor ? html`<span class="row-note">${i.hvorfor}</span>` : ''}</span></div>` })) },
    { titel: 'Claude Code færdig', form: 'raekker', elementer: cc.filter((o) => o.status === 'faerdig').map(ccElement), note: html`${(d.ccTal ?? []).map(ccTalLinje)}` },
    { titel: 'Hermes har gjort', form: 'raekker', elementer: dagensLog(kunSynlige(d.hermes, d.person), nu).map((h) => ({ id: unik(`log:${h.id ?? `${h.tid}|${h.tekst}`}`), html: logRaekke(h, nu) })) },
  ];
  // KC-0128: the first look at a new source is content, not something that waits on Henrik.
  const foerste = d.forhaandsvisninger?.length ? html`<div class="stack gruppe" data-gruppe="Første kig">${d.forhaandsvisninger.map((e) => medId(e.id, e.html))}</div>` : undefined;
  const indhold = d.venterIalt === 0 ? html`${foerste ?? ''}${altOrdnet(d.naeste)}` : foerste;
  return html`
  <header class="room-head"><div><h1>${d.hilsen}</h1>${d.naeste && vis.has('naeste') ? naesteLinje(d.naeste, nu) : ''}${d.naeste && vis.has('naeste') && d.gamle?.['kalender'] ? html`<p class="row-note" data-gammel="kalender">Kalenderen: ${kildeFriskhed(d.gamle['kalender'], nu)}</p>` : ''}<p class="muted">Det, der kalder på dig lige nu.</p></div></header>
  ${d.ugetal ?? ''}

  ${baand({ kraever, igang, ordnet, ...(d.venterIalt !== undefined ? { venter: d.venterIalt } : {}), ...(indhold ? { indhold } : {}) })}

  ${fliser.length ? html`<section class="tiles kun-stor">
    ${fliser.map((r) => medId(`rum:${r.id}`, html`<a class="tile${r.built ? '' : ' tile-unbuilt'}" href="/rum/${r.id}" data-room-tile="${r.id}">${rumIkon(r.id)}<span class="tile-name">${r.navn}</span><span class="row-note">${r.beskrivelse}</span></a>`))}
  </section>` : ''}
  <p class="row-note rum-hint">Sig i chatten, hvad du vil — fx "jeg vil skrive" — så åbner rummet.</p>`;
}

export function renderPlaceholder(r: Room): Markup {
  return html`
  <header class="room-head"><div><h1>${r.navn}</h1><p class="muted">Tegnet, ikke bygget endnu</p></div></header>
  <section class="card">
    <p>${r.beskrivelse}</p>
    <p class="muted">Rummet er tegnet i prototypen, men ikke bygget endnu. Dagen er det første rum, der er bygget rigtigt mod Hermes.</p>
    <p><a href="${CANVAS_URL}" target="_blank" rel="noopener">Se tegningen af rummet</a></p>
  </section>`;
}
