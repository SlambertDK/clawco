// The card model of Hjem's Kuratoren and the pure merge of Hermes' answer into
// the stored cards. No I/O: parse in, state in, state out. The invariant: a
// card stays on screen only while a later run stood by it (keep or update),
// it has not expired, and Henrik has not dismissed it.

import { SvarFejl } from '../../svarfejl.ts';
import { findProjekt } from '../../udvikling/projekter.ts';
import { parseVisuel, type Visuel } from '../../shell/visuel.ts';
import { idagKbh, koebenhavnTilIso } from '../../shell/tid.ts';
import { ZoneFejl, erDataZone, synligFor, zoneAf, zoneFra, type DataZone, type Zoneret } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import type { Regelforslag } from '../../tillid/forslag.ts';
import { hjemTekst } from './tekster.ts';
import { hjemPromptTekst } from './prompt-tekster.ts';

/** KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones. */
export const KORSEL: DataZone = 'privat';

export type KortType = 'tjeneste' | 'familie' | 'regning' | 'nyhed';
export type Handling = { id: string; label: string; instruktion: string; fortryd?: string };
export type Regnskabslinje = { hvor: 'shelfatlas' | 'privat'; dato: string; leverandoer: string; beloeb: string; valuta: string; periode?: string; art: 'abonnement' | 'koeb'; emne: string };
export type Kort = { id: string; type: KortType; titel: string; betyder: string; grundlag: string[]; kilder: string[]; anbefaling: string; prioritet: number; gyldigTil?: string; handling?: Handling; prompt?: string; mailId?: string; regnskab?: Regnskabslinje; regnskabUklart?: boolean; /** Hermes' proposed line for an unclear bill (no ledger yet): written to the ledger Henrik picks. */ regnskabForslag?: Omit<Regnskabslinje, 'hvor'>; skrevet?: { hvor: 'shelfatlas' | 'privat'; fil: string };
  /** KC-0046: the card is about one of Henrik's own projects — Kuratoren suggests sending it to Claude Code. */
  udvikling?: { projekt: string };
  /** KC-0059: the pictogram, headline and picture the card is read from. */
  visuel?: Visuel;
  /** KC-0096: the app's, never Hermes': Henrik put the card away (Senere) until this instant (ISO); it is off screen and uncounted until then. */
  udsatTil?: string;
  /** KC-0138: the card is about one message (its id from the Beskeder read); such a card never carries a handling. */
  beskedId?: string;
  /** KC-0138: the app's, never Hermes': the channel and the sender as the connector named them. */
  besked?: { kanal: string; afsender: string };
  /** KC-0143: the app's, never Hermes': the bill's row was not written on its own because no rule covers it; the card asks which should. */
  kraeverRegel?: true } & Zoneret;
/** KC-0145: `regel` = the rule Kuratoren cites as the reason (kept only when it is an active rule in the file read for the run). */
export type Intet = { titel: string; hvorfor: string; regel?: string } & Zoneret;
/** KC-0039: a card Henrik closed and his reason in his own words (empty = none given); newest first. */
export type Lukning = { id: string; titel: string; grund: string; dato: string } & Zoneret;
export type KuratorState = { kort: Kort[]; intet: Intet[]; afvist: string[]; sete: string[]; cursor?: string; sidst?: string; sidstDyb?: string;
  lukket?: Lukning[];
  /** The Nyheder state's `genereret` the last successful run saw; the same stamp is not sent again. */
  nyhederSet?: string;
  /** Which bill cards the app has written to a ledger, by card id. An id with an entry is never written again (an undo or a move keeps its entry). */
  regnskab?: Record<string, RegnskabsStatus>;
  /** KC-0138: the message ids a successful run has sent to Hermes (newest last); the same message is not sent again. */
  beskederSete?: string[];
  /** KC-0144: Hermes' proposals for a rule after a Ret or an Ikke relevant — pending ones are shown as a card, decided ones are remembered for 30 days. Only the app writes this (src/tillid/forslag.ts). */
  regelforslag?: Regelforslag[] };
/** Where a card's ledger row is ('skrevet') or was ('fortrudt'), with the written line's supplier and amount, so the row can be shown and undone after its card retired. */
export type RegnskabsStatus = { hvor: 'shelfatlas' | 'privat'; status: 'skrevet' | 'fortrudt'; leverandoer?: string; beloeb?: string; valuta?: string } & Zoneret;
export type KuratorSvar = { nye: Kort[]; behold: string[]; opdater: Kort[]; fjern: { id: string; hvorfor: string }[]; intet: Intet[] };

export const MAX_KORT = 7;
const MAX_INTET = 20;
export const MAX_LUKKET = 30;
const MAX_LISTE = 5;
export const TYPER: readonly string[] = ['tjeneste', 'familie', 'regning', 'nyhed'];
/** KC-0119: 'forespoergsel' was renamed 'familie' (the name is reserved for the household block, KC-0149). Stored cards and Hermes answers in transit still carry it: read it as 'familie', never reject it. */
export const kortTypeFra = (type: string): string => (type === 'forespoergsel' ? 'familie' : type);
export const HVOR: readonly string[] = ['shelfatlas', 'privat'];
export const ART: readonly string[] = ['abonnement', 'koeb'];
const ID = /^[a-z0-9:_-]{1,80}$/;
const ISO_DATO = /^\d{4}-\d{2}-\d{2}/;
/** KC-0138: the shape of a message id (src/kilder/beskeder/besked.ts). */
export const BESKED_ID = /^b-[0-9a-f]{16}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const optStr = (v: unknown, max = 400): string | undefined => { const s = str(v, max); return s ? s : undefined; };

/** KC-0023: a card never shows an e-mail address, whatever Hermes wrote. */
export const skjulAdresser = (t: string): string => t.replace(/\S+@\S+\.\S+/g, '[adresse]');

function liste(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((x) => skjulAdresser(x.trim().slice(0, 300))).filter(Boolean).slice(0, MAX_LISTE);
}

function handling(v: unknown, kortId: string): Handling | undefined {
  if (!isObj(v)) return undefined;
  const label = str(v['label'], 80);
  const instruktion = str(v['instruktion'], 2000);
  if (!label || !instruktion) return undefined;
  // Always derived from the card: an id from Hermes could collide with another card's or a ledger row's.
  const id = `${kortId}:h`;
  const fortryd = optStr(v['fortryd'], 2000);
  return fortryd ? { id, label, instruktion, fortryd } : { id, label, instruktion };
}

/** The fields of a ledger line except the ledger itself, or undefined when one is missing or invalid. */
function linjeFelter(v: Record<string, unknown>): Omit<Regnskabslinje, 'hvor'> | undefined {
  const art = str(v['art'], 20);
  const dato = str(v['dato'], 40);
  const leverandoer = str(v['leverandoer'], 120);
  const beloeb = str(v['beloeb'], 40);
  const valuta = str(v['valuta'], 10);
  if (!ART.includes(art) || !dato || !leverandoer || !beloeb || !valuta) return undefined;
  const periode = optStr(v['periode'], 40);
  const felter: Omit<Regnskabslinje, 'hvor'> = { dato, leverandoer, beloeb, valuta, art: art as Regnskabslinje['art'], emne: str(v['emne'], 200) };
  if (periode) felter.periode = periode;
  return felter;
}

/** Returns the ledger line, or 'uklart' when Hermes could not tell which ledger, or undefined. */
function regnskab(v: unknown): Regnskabslinje | 'uklart' | undefined {
  if (!isObj(v)) return undefined;
  const hvor = str(v['hvor'], 20);
  if (hvor === 'uklart') return 'uklart';
  if (!HVOR.includes(hvor)) return undefined;
  const felter = linjeFelter(v);
  return felter ? { hvor: hvor as Regnskabslinje['hvor'], ...felter } : undefined;
}

/** KC-0117: the zone Hermes named (absent = the run's zone); an unknown zone, or one this run did not read, is a schema error. */
function zoneAfSvar(raw: unknown, korsel: DataZone): DataZone {
  try { return zoneFra(raw, korsel); } catch (e) {
    if (e instanceof ZoneFejl) { const t = hjemPromptTekst().fejl; throw new SvarFejl(erDataZone(raw) ? t.zoneAnden(raw, korsel) : t.zoneUkendt(String(raw).slice(0, 40))); }
    throw e;
  }
}

/** The zone and owner of a stored element, for a derived one (a retired card's "intet" line, its closing, its ledger row) to carry on. */
export const zoneFelter = (el: Zoneret): Zoneret => ({ zone: el.zone ?? 'privat', ...(el.ejer ? { ejer: el.ejer } : {}) });

/** KC-0117: only what `person` may see (synligFor). Absent person = the caller has already filtered. */
export function kunSynlige<T extends Zoneret>(liste: readonly T[], person: Person | undefined): T[] {
  return person ? liste.filter((el) => synligFor(person, el)) : [...liste];
}

function enKort(v: unknown, korsel: DataZone): Kort | null {
  if (!isObj(v)) return null;
  const zone = zoneAfSvar(v['zone'], korsel); // before the other checks: a bad zone rejects the answer, it never just drops the card
  const id = str(v['id'], 200);
  const type = kortTypeFra(str(v['type'], 20));
  const titel = skjulAdresser(str(v['titel'], 200));
  const betyder = skjulAdresser(str(v['betyder'], 800));
  if (!ID.test(id) || !TYPER.includes(type) || !titel || !betyder) return null;
  const p = typeof v['prioritet'] === 'number' && Number.isFinite(v['prioritet']) ? Math.round(v['prioritet']) : 5;
  const k: Kort = {
    id,
    type: type as KortType,
    titel,
    betyder,
    grundlag: liste(v['grundlag']),
    kilder: liste(v['kilder']),
    anbefaling: skjulAdresser(str(v['anbefaling'], 600)),
    prioritet: Math.min(9, Math.max(1, p)),
    zone,
  };
  const gyldigTil = str(v['gyldigTil'], 40);
  if (ISO_DATO.test(gyldigTil)) k.gyldigTil = gyldigTil.slice(0, 10);
  // KC-0138: a card on a message never carries a handling — third parties' words are the strongest injection channel.
  const beskedId = str(v['beskedId'], 40);
  if (BESKED_ID.test(beskedId)) k.beskedId = beskedId;
  const h = k.beskedId ? undefined : handling(v['handling'], id);
  if (h) k.handling = h;
  const prompt = optStr(v['prompt'], 4000);
  if (prompt && type === 'nyhed') k.prompt = prompt;
  const mailId = optStr(v['mailId'], 200);
  if (mailId) k.mailId = mailId;
  const udv = v['udvikling'];
  if (isObj(udv) && findProjekt(str(udv['projekt'], 40))) k.udvikling = { projekt: str(udv['projekt'], 40) };
  const visuel = parseVisuel(v['visuel']);
  if (visuel) k.visuel = visuel;
  if (type === 'regning') {
    const r = regnskab(v['regnskab']);
    if (r === 'uklart') {
      k.regnskabUklart = true;
      const forslag = isObj(v['regnskab']) ? linjeFelter(v['regnskab']) : undefined;
      if (forslag) k.regnskabForslag = forslag;
    } else if (r) k.regnskab = r;
  }
  // `skrevet` is set by the app after it writes a ledger line, never by Hermes.
  return k;
}

type Status = 'behold' | 'opdater' | 'fjern';

/**
 * Validates Hermes' JSON ("kort", "vurderinger", "intet"). Throws when "kort" is missing or not an array.
 * KC-0226: `korsel` is the one zone the run read (privat unless it is a zone run): an element naming another zone is a schema error.
 */
export function parseKuratorSvar(raw: unknown, korsel: DataZone = KORSEL): KuratorSvar {
  if (!isObj(raw)) throw new SvarFejl(hjemPromptTekst().fejl.ikkeObjekt);
  if (!Array.isArray(raw['kort'])) throw new SvarFejl(hjemPromptTekst().fejl.kortMangler);
  const rawV = raw['vurderinger'];
  if (rawV !== undefined && !Array.isArray(rawV)) throw new SvarFejl(hjemPromptTekst().fejl.vurderingerIkkeListe);

  const status = new Map<string, Status>();
  const svar: KuratorSvar = { nye: [], behold: [], opdater: [], fjern: [], intet: [] };
  for (const e of (rawV ?? []) as unknown[]) {
    if (!isObj(e)) continue;
    const id = str(e['id'], 200);
    const s = str(e['status'], 20);
    if (!id || status.has(id) || (s !== 'behold' && s !== 'opdater' && s !== 'fjern')) continue;
    status.set(id, s);
    if (s === 'behold') svar.behold.push(id);
    else if (s === 'fjern') svar.fjern.push({ id, hvorfor: str(e['hvorfor'], 300) });
  }

  const set = new Set<string>();
  for (const v of raw['kort']) {
    const k = enKort(v, korsel);
    if (!k || set.has(k.id)) continue;
    set.add(k.id);
    (status.get(k.id) === 'opdater' ? svar.opdater : svar.nye).push(k);
  }

  if (Array.isArray(raw['intet'])) {
    for (const v of raw['intet']) {
      if (!isObj(v)) continue;
      const titel = str(v['titel'], 200);
      const zone = zoneAfSvar(v['zone'], korsel);
      const regel = str(v['regel'], 20);
      if (titel) svar.intet.push({ titel, hvorfor: str(v['hvorfor'], 300), zone, ...(/^R-\d{4,}$/.test(regel) ? { regel } : {}) });
    }
  }
  return svar;
}

/** Today's date in Copenhagen as YYYY-MM-DD. */
function idag(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(now);
}

/** A card whose deadline (gyldigTil) is before today (Copenhagen) has expired: not shown, not kept. */
export function udloebet(k: Kort, now: Date): boolean {
  return Boolean(k.gyldigTil && k.gyldigTil.slice(0, 10) < idag(now));
}

/** KC-0096 Senere: where a card can be put away to. */
export type Senere = 'aften' | 'morgen';
export const SENERE: readonly string[] = ['aften', 'morgen'];
/** "I aften" (18.00) is only offered before 17.00 local time: later it would be minutes away, not a decision. */
const AFTEN_SENEST = '17:00';

const kbhIso = (dato: string, hhmm: string): string => koebenhavnTilIso(`${dato}T${hhmm}`) as string;

/** True while "I aften" can be chosen: it is before 17.00 in Copenhagen. */
export function aftenMulig(now: Date): boolean {
  return now.getTime() < Date.parse(kbhIso(idagKbh(now), AFTEN_SENEST));
}

/** The ISO instant a card put away comes back (tonight 18.00 or tomorrow 07.00, Copenhagen), or null for "aften" from 17.00 on. */
export function senereTid(til: Senere, now: Date): string | null {
  const dato = idagKbh(now);
  if (til === 'aften') return aftenMulig(now) ? kbhIso(dato, '18:00') : null;
  return kbhIso(new Date(Date.parse(`${dato}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), '07:00');
}

/** The card is put away right now (its time has not come). */
export function udsatNu(k: Kort, now: Date): boolean {
  return Boolean(k.udsatTil) && Date.parse(k.udsatTil as string) > now.getTime();
}

const APP_FELTER =['regnskab', 'regnskabUklart', 'regnskabForslag', 'skrevet'] as const;

/** A written bill's ledger fields are the app's (Henrik may have moved or chosen the row): Hermes' version of them is dropped. */
function medAppensRegnskab(ny: Kort, gammel: Kort): Kort {
  const k: Kort = { ...ny };
  for (const f of APP_FELTER) delete k[f];
  for (const f of APP_FELTER) if (gammel[f] !== undefined) (k as Record<string, unknown>)[f] = gammel[f];
  return k;
}

/** KC-0096: Hermes' version of a card keeps Henrik's snooze while it lasts (a passed one is dropped: the card is simply open again). */
function medUdsat(ny: Kort, gammel: Kort, now: Date): Kort {
  const k: Kort = { ...ny };
  delete k.udsatTil;
  if (udsatNu(gammel, now) && gammel.udsatTil) k.udsatTil = gammel.udsatTil;
  return k;
}

/**
 * Merges Hermes' answer into the stored cards. Every open card must be stood by
 * (behold, opdater, or returned in "kort") or it is retired. Dismissed ids
 * (afvist) never come back, expired cards (gyldigTil before today) are dropped,
 * `fjern` wins, and only MAX_KORT cards stay — lowest prioritet number first;
 * the overflow goes to "intet" with the reason "plads". Does not touch cursor,
 * sete, sidst or sidstDyb: the run owns those.
 */
/**
 * KC-0117: `korsel` is the one zone the run read. A stored card of another zone is outside what the run saw: it is
 * kept as it is (never rewritten, relabelled or retired by this run).
 */
export function mergeKort(state: KuratorState, svar: KuratorSvar, now: Date, korsel: DataZone): KuratorState {
  const fjernet = new Set(svar.fjern.map((f) => f.id));
  const afvist = new Set(state.afvist);
  const behold = new Set(svar.behold);
  const opdateret = new Map(svar.opdater.map((k) => [k.id, k]));
  const nye = new Map(svar.nye.map((k) => [k.id, k]));

  const ud = new Map<string, Kort>();
  const andenZone = new Set<string>();
  for (const gammel of state.kort) {
    if (zoneAf(gammel) !== korsel) { ud.set(gammel.id, gammel); andenZone.add(gammel.id); continue; }
    const ny = opdateret.get(gammel.id) ?? nye.get(gammel.id);
    if (ny) ud.set(gammel.id, medUdsat(gammel.skrevet ? medAppensRegnskab(ny, gammel) : ny, gammel, now));
    else if (behold.has(gammel.id)) ud.set(gammel.id, gammel);
    // else: not stood by, so retired
  }
  for (const k of [...svar.opdater, ...svar.nye]) if (!ud.has(k.id)) ud.set(k.id, k);

  const levende = [...ud.values()].filter((k) =>
    (andenZone.has(k.id) || (!fjernet.has(k.id) && !afvist.has(k.id))) && !udloebet(k, now));
  // Array.prototype.sort is stable, so kept cards stay ahead of new ones on equal prioritet.
  levende.sort((a, b) => a.prioritet - b.prioritet);
  const kort = levende.slice(0, MAX_KORT);
  const overskud: Intet[] = levende.slice(MAX_KORT).map((k) => ({ titel: k.titel, hvorfor: hjemTekst().pladsHvorfor, ...zoneFelter(k) }));

  return {
    ...state,
    kort,
    intet: [...overskud, ...svar.intet, ...state.intet].slice(0, MAX_INTET),
    afvist: [...state.afvist],
  };
}
