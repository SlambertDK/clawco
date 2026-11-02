// The state shape of the room Dagen, and the validator that turns Hermes'
// JSON answer into it. Hermes is an untrusted producer: every field is
// checked, defaults filled, lists capped.

import { SvarFejl } from '../../svarfejl.ts';
import { parseIkon, parseVisuel, type IkonNavn, type Visuel } from '../../shell/visuel.ts';
import type { LogEntry } from '../../store/types.ts';
import { dagStr, klokke } from '../../shell/friskhed.ts';
import { ZoneFejl, zoneFra, synligFor, type DataZone, type Zoneret } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import { agentGulv, verbFra } from '../../graenser/verber.ts';

/** KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones. */
export const KORSEL: DataZone = 'privat';

/** KC-0066: tilAndre marks a handling whose result is meant for other people (a dagsorden, a reply); it renders as the red graense button. */
/** KC-0122: `verb` is set by the app at parse (floor from tilAndre; a declared verb only when stricter); absent in old state = the floor. */
export type Handling = { id: string; label: string; instruktion: string; fortryd?: string; tilAndre?: true; verb?: string };

export type KalenderPost = {
  tid: string;
  slut?: string;
  titel: string;
  note?: string;
  status?: 'klar' | 'flyttet' | 'aflyst';
  handling?: Handling;
  ikon?: IkonNavn;
} & Zoneret;

export type AvisPost = { titel: string; hvorfor: string; kilde?: string; url?: string } & Zoneret;

export type UgeDagNote = { dato: string; note: string; aftaler: { tid: string; slut?: string; titel: string; kalender?: string }[] };

export type DagenState = {
  dato: string;
  genereret: string;
  vejr?: string;
  /** KC-0059: the picture of the day (billede is normally a 'dagslinje'). */
  visuel?: Visuel;
  treLinjer: string[];
  anbefaling: { tekst: string; handling?: Handling; ikon?: IkonNavn; /** KC-0059: a short headline; the full tekst sits behind Hvorfor. */ overskrift?: string };
  kalender: KalenderPost[];
  morgenavis: AvisPost[];
  ugen?: UgeDagNote[];
  hermesStatus: string;
};

export class SchemaError extends SvarFejl {
  constructor(message: string) { super(message); this.name = 'SchemaError'; }
}

const MAX_LINJER = 3;
const MAX_KALENDER = 20;
const MAX_AVIS = 8;
const STATUS = new Set(['klar', 'flyttet', 'aflyst']);

/** First fenced ```json block, else the first balanced top-level object. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1]); } catch { /* fall through to brace scan */ }
  }
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inStr = false; let escNext = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** extractJson for answers that must carry JSON: none readable is an unusable answer (KC-0050). */
export function kraevJson(text: string): unknown {
  const raw = extractJson(text);
  if (raw === null) throw new SchemaError('Hermes svarede uden JSON, eller med en blok, der ikke kan læses');
  return raw;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function optStr(v: unknown, max = 400): string | undefined {
  const s = str(v, max);
  return s ? s : undefined;
}

function safeUrl(v: unknown): string | undefined {
  const s = str(v, 2000);
  return /^https?:\/\//i.test(s) ? s : undefined;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'h';
}

function handling(v: unknown, fallbackId: string, where: string): Handling | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw new SchemaError(`${where}: handling skal være et objekt`);
  const label = str(v['label'], 80);
  const instruktion = str(v['instruktion'], 2000);
  if (!label || !instruktion) throw new SchemaError(`${where}: handling kræver label og instruktion`);
  const id = optStr(v['id'], 60) ?? `${fallbackId}-${slug(label)}`;
  const fortryd = optStr(v['fortryd'], 2000);
  const h: Handling = fortryd ? { id, label, instruktion, fortryd } : { id, label, instruktion };
  if (v['tilAndre'] === true) h.tilAndre = true;
  h.verb = verbFra(v['verb'], agentGulv(h));
  return h;
}

/** An element's zone from Hermes' answer, a ZoneFejl surfacing as this room's schema error. */
function zoneAfSvar(raw: unknown, where: string): DataZone {
  try { return zoneFra(raw, KORSEL); } catch (e) { if (e instanceof ZoneFejl) throw new SchemaError(`${where}: ${e.message}`); throw e; }
}

export function parseDagenState(raw: unknown, now: Date): DagenState {
  if (!isObj(raw)) throw new SchemaError('Dagen: svaret er ikke et objekt');

  const dato = str(raw['dato'], 10) || now.toISOString().slice(0, 10);

  const linjerRaw = Array.isArray(raw['treLinjer']) ? raw['treLinjer'] : [];
  const treLinjer = linjerRaw.map((l) => str(l, 300)).filter(Boolean).slice(0, MAX_LINJER);
  if (treLinjer.length === 0) throw new SchemaError('Dagen: treLinjer mangler');

  const a = raw['anbefaling'];
  if (!isObj(a) || !str(a['tekst'], 400)) throw new SchemaError('Dagen: anbefaling mangler');
  const aHandling = handling(a['handling'], 'anb', 'anbefaling');
  const anbefaling: DagenState['anbefaling'] = aHandling ? { tekst: str(a['tekst'], 400), handling: aHandling } : { tekst: str(a['tekst'], 400) };
  const aIkon = parseIkon(a['ikon']); if (aIkon) anbefaling.ikon = aIkon;
  const aOverskrift = str(a['overskrift'], 60); if (aOverskrift) anbefaling.overskrift = aOverskrift;

  const kalRaw = Array.isArray(raw['kalender']) ? raw['kalender'] : [];
  const kalender: KalenderPost[] = [];
  kalRaw.slice(0, MAX_KALENDER).forEach((k, i) => {
    if (!isObj(k)) return;
    const titel = str(k['titel'], 200);
    const tid = str(k['tid'], 20);
    if (!titel || !tid) return;
    const post: KalenderPost = { tid, titel, zone: zoneAfSvar(k['zone'], `kalender[${i}]`) };
    const slut = optStr(k['slut'], 20); if (slut) post.slut = slut;
    const note = optStr(k['note'], 300); if (note) post.note = note;
    const status = str(k['status'], 20); if (STATUS.has(status)) post.status = status as 'klar' | 'flyttet' | 'aflyst';
    const h = handling(k['handling'], `kal-${i + 1}`, `kalender[${i}]`); if (h) post.handling = h;
    const kIkon = parseIkon(k['ikon']); if (kIkon) post.ikon = kIkon;
    kalender.push(post);
  });

  const avisRaw = Array.isArray(raw['morgenavis']) ? raw['morgenavis'] : [];
  const morgenavis: AvisPost[] = [];
  for (const p of avisRaw) {
    if (!isObj(p)) continue;
    const titel = str(p['titel'], 200);
    if (!titel) continue;
    const post: AvisPost = { titel, hvorfor: str(p['hvorfor'], 300), zone: zoneAfSvar(p['zone'], `morgenavis[${morgenavis.length}]`) };
    const kilde = optStr(p['kilde'], 80); if (kilde) post.kilde = kilde;
    const url = safeUrl(p['url']); if (url) post.url = url;
    morgenavis.push(post);
    if (morgenavis.length >= MAX_AVIS) break;
  }

  const state: DagenState = {
    dato,
    genereret: now.toISOString(),
    treLinjer,
    anbefaling,
    kalender,
    morgenavis,
    hermesStatus: str(raw['hermesStatus'], 80) || 'Klar',
  };
  const vejr = optStr(raw['vejr'], 80); if (vejr) state.vejr = vejr;
  const visuel = parseVisuel(raw['visuel']); if (visuel) state.visuel = visuel;
  const ugeRaw = Array.isArray(raw['ugen']) ? raw['ugen'] : [];
  const ugen: UgeDagNote[] = [];
  for (const d of ugeRaw) {
    if (!isObj(d) || ugen.length >= 7) continue;
    const dDato = str(d['dato'], 10); if (!dDato) continue;
    const aftaler: UgeDagNote['aftaler'] = [];
    for (const a of Array.isArray(d['aftaler']) ? d['aftaler'] : []) {
      if (!isObj(a) || aftaler.length >= 12) continue;
      const titel = str(a['titel'], 120); const tid = str(a['tid'], 20);
      if (!titel || !tid) continue;
      const post: UgeDagNote['aftaler'][number] = { tid, titel };
      const slut = optStr(a['slut'], 20); if (slut) post.slut = slut;
      const kal = optStr(a['kalender'], 40); if (kal) post.kalender = kal;
      aftaler.push(post);
    }
    ugen.push({ dato: dDato, note: str(d['note'], 400), aftaler });
  }
  if (ugen.length) state.ugen = ugen;
  return state;
}

/**
 * KC-0117: the room as `person` may see it — calendar posts and paper items `synligFor` denies are gone. The three
 * lines, the recommendation and the picture of the day are the room's own summary and stay (see ticket follow-up).
 */
export function synligDagen(state: DagenState, person: Person): DagenState {
  return { ...state, kalender: state.kalender.filter((k) => synligFor(person, k)), morgenavis: state.morgenavis.filter((n) => synligFor(person, n)) };
}

/** Every handling in the state, keyed by id — the only source a click may name. */
export function handlingerI(state: DagenState): Map<string, Handling> {
  const m = new Map<string, Handling>();
  if (state.anbefaling.handling) m.set(state.anbefaling.handling.id, state.anbefaling.handling);
  for (const k of state.kalender) if (k.handling) m.set(k.handling.id, k.handling);
  return m;
}

/** KC-0095: from 07.30 (the morning build runs 07.05) a Dagen from an earlier day should have been rebuilt. */
const BYG_FRA = '07.30';

/** KC-0095: Dagen built on an earlier Copenhagen day — 'byg' once the morning is under way, 'vent' before; null when it is today's. */
export function dagenGammel(state: DagenState, now: Date): 'byg' | 'vent' | null {
  const bygget = new Date(state.genereret);
  if (Number.isNaN(bygget.getTime()) || dagStr(bygget) >= dagStr(now)) return null;
  return klokke(now) >= BYG_FRA ? 'byg' : 'vent';
}

/** What in Dagen waits on Henrik, one line each — Hjem's rows and (counted) the nav's number: the handlinger no
 *  (non-undone) log entry has carried out yet; for an old Dagen only "build it", never yesterday's handlinger. */
export function ventendeDagen(state: DagenState | null, log: LogEntry[], now: Date): string[] {
  if (!state) return [];
  const gammel = dagenGammel(state, now);
  if (gammel) return gammel === 'byg' ? ['Dagen er ikke bygget i dag'] : [];
  const done = new Set(log.filter((e) => e.handlingId && !e.fortrudt).map((e) => e.handlingId));
  const ud: string[] = [];
  if (state.anbefaling.handling && !done.has(state.anbefaling.handling.id)) ud.push(`Anbefaling: ${state.anbefaling.tekst}`);
  for (const k of state.kalender) if (k.handling && !done.has(k.handling.id)) ud.push(`${k.handling.label}: ${k.titel} kl. ${k.tid}`);
  return ud;
}

export const venterDagen = (state: DagenState | null, log: LogEntry[], now: Date): number => ventendeDagen(state, log, now).length;

/** KC-0122: the verb a stored handling runs under (old state has none: the app's floor). */
export const handlingensVerb = (h: Handling): string => h.verb ?? agentGulv(h);
