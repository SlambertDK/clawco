// The Univers room family: the state shapes (index + one state per univers) and
// the validators for Hermes' answers. Hermes is an untrusted producer: every
// field is checked, defaults filled, lengths and counts capped. Pure — no I/O.

import { randomUUID } from 'node:crypto';
import { SchemaError } from '../dagen/schema.ts';
import { parseIkon, type IkonNavn } from '../../shell/visuel.ts';
import { zoneFra, ZoneFejl, type DataZone, type Zoneret } from '../../identitet/zoner.ts';

/** KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones. */
export const KORSEL: DataZone = 'privat';

export { SchemaError };

// ---------- State shapes ----------

export type UniversInfo = { id: string; navn: string; om: string; oprettet: string; arkiveret?: string };
export type Deltager = { navn: string; email?: string };
export type MoedeKandidat = { eventId: string; titel: string; start: string; slut: string; sted?: string; deltagere: Deltager[] };
export type UniversIndeks = { univers: UniversInfo[]; nyeMoeder: MoedeKandidat[]; skjulteMoeder: string[] };

export type DokumentVersion = { html: string; tekst: string; tid: string };
export type Dokument = {
  id: string;
  titel: string;
  html: string;
  /** Plain-text extract of `html`, used in prompts. */
  tekst: string;
  versioner: DokumentVersion[];
  moedeId?: string;
  oprettet: string;
  aendret: string;
} & Zoneret;
export type Note = { id: string; titel: string; tekst: string; oprettet: string } & Zoneret;
export type OpgaveStatus = 'aaben' | 'igang' | 'faerdig';
export type Opgave = { id: string; titel: string; note?: string; status: OpgaveStatus; moedeId?: string };
export type ForberedelseDeltager = { navn: string; hvem: string; baggrund: string; vil: string };
/** `talepunktIkoner[i]` is the pictogram of `talepunkter[i]` (KC-0059); an empty slot means "use the default". After a JSON round trip an empty slot is `null`, so readers use `?? fallback`. */
export type Forberedelse = { maal: string; deltagere: ForberedelseDeltager[]; talepunkter: string[]; talepunktIkoner?: (IkonNavn | undefined)[]; dokumentId?: string; tid: string };
export type Moede = {
  id: string;
  kilde: 'kalender' | 'manuel';
  eventId?: string;
  titel: string;
  /** ISO timestamps. */
  start: string;
  slut: string;
  sted?: string;
  deltagere: Deltager[];
  forberedelse?: Forberedelse;
};
export type UniversState = { dokumenter: Dokument[]; noter: Note[]; opgaver: Opgave[]; moeder: Moede[]; hermesStatus?: string };

export const OPGAVE_STATUS: readonly OpgaveStatus[] = ['aaben', 'igang', 'faerdig'];
export const isOpgaveStatus = (v: unknown): v is OpgaveStatus => typeof v === 'string' && (OPGAVE_STATUS as readonly string[]).includes(v);

// ---------- Ids ----------

export type IdPrefix = 'dok' | 'note' | 'opg' | 'moede';
/** Injectable id generator: `dok-` / `note-` / `opg-` / `moede-` + 8 hex. */
export type NyId = (prefix: IdPrefix) => string;
export const standardId: NyId = (prefix) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

// ---------- Limits ----------

export const MAX_HTML = 200_000;
const MAX_ELEMENTER = 30;
const MAX_DELTAGERE = 20;
const MAX_TALEPUNKTER = 20;
const MAX_OPGAVER = 15;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** An id Hermes may send to update an existing element; anything odd is dropped (the app mints ids). */
const idOr = (v: unknown): string | undefined => {
  const s = str(v, 40);
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(s) ? s : undefined;
};

export const tomtUnivers = (): UniversState => ({ dokumenter: [], noter: [], opgaver: [], moeder: [] });
export const tomtIndeks = (): UniversIndeks => ({ univers: [], nyeMoeder: [], skjulteMoeder: [] });

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Stored state may be missing, partial or from an older shape: fill every list. */
export function normaliserUnivers(raw: unknown): UniversState {
  const s = isObj(raw) ? raw : {};
  return {
    ...(s as Partial<UniversState>),
    dokumenter: arr<Dokument>(s['dokumenter']).map((d) => ({ ...d, versioner: arr<DokumentVersion>(d.versioner) })),
    noter: arr<Note>(s['noter']),
    opgaver: arr<Opgave>(s['opgaver']),
    moeder: arr<Moede>(s['moeder']).map((m) => ({ ...m, deltagere: arr<Deltager>(m.deltagere) })),
  };
}

export function normaliserIndeks(raw: unknown): UniversIndeks {
  const s = isObj(raw) ? raw : {};
  return {
    ...(s as Partial<UniversIndeks>),
    univers: arr<UniversInfo>(s['univers']),
    nyeMoeder: arr<MoedeKandidat>(s['nyeMoeder']),
    skjulteMoeder: arr<string>(s['skjulteMoeder']).filter((x) => typeof x === 'string'),
  };
}

// ---------- Plain text from HTML ----------

const ENTITETER: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** Strips tags, scripts, styles and comments from (untrusted) HTML into bounded plain text for prompts. */
export function htmlTilTekst(htmlTekst: string, max = 20_000): string {
  const kilde = String(htmlTekst ?? '').slice(0, MAX_HTML * 2);
  const ren = kilde
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const kode = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(kode) && kode > 0 && kode < 0x110000 ? String.fromCodePoint(kode) : ' ';
      }
      return ENTITETER[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return ren.slice(0, max);
}

// ---------- Hermes answers ----------

export type NytElement =
  | { type: 'dokument'; id?: string; titel: string; html: string; zone: DataZone }
  | { type: 'note'; id?: string; titel: string; tekst: string; zone: DataZone }
  | { type: 'opgave'; id?: string; titel: string; note?: string; status?: OpgaveStatus };

/** The zone of one element Hermes returned; a zone the run did not read is a schema error, never relabelled. */
function zoneAf(raw: unknown): DataZone {
  try { return zoneFra(raw, KORSEL); } catch (e) { if (e instanceof ZoneFejl) throw new SchemaError(`Univers: ${e.message}`); throw e; }
}

/** `{"elementer": [...]}` from a univers chat run. Unusable items are skipped; none usable = SchemaError. */
export function parseUniversSvar(raw: unknown): NytElement[] {
  if (!isObj(raw)) throw new SchemaError('Univers: svaret er ikke et objekt');
  const out: NytElement[] = [];
  for (const e of arr<unknown>(raw['elementer'])) {
    if (!isObj(e)) continue;
    const titel = str(e['titel'], 200);
    if (!titel) continue;
    const id = idOr(e['id']);
    const medId = id ? { id } : {};
    if (e['type'] === 'dokument') {
      const h = typeof e['html'] === 'string' ? e['html'].slice(0, MAX_HTML) : '';
      if (!h.trim()) continue;
      out.push({ type: 'dokument', ...medId, titel, html: h, zone: zoneAf(e['zone']) });
    } else if (e['type'] === 'note') {
      const tekst = str(e['tekst'], 20_000);
      if (!tekst) continue;
      out.push({ type: 'note', ...medId, titel, tekst, zone: zoneAf(e['zone']) });
    } else if (e['type'] === 'opgave') {
      const note = str(e['note'], 1000);
      out.push({
        type: 'opgave', ...medId, titel,
        ...(note ? { note } : {}),
        ...(isOpgaveStatus(e['status']) ? { status: e['status'] } : {}),
      });
    }
    if (out.length >= MAX_ELEMENTER) break;
  }
  if (out.length === 0) throw new SchemaError('Univers: ingen brugbare elementer i svaret');
  return out;
}

export type ForberedelseSvar = {
  maal: string;
  deltagere: ForberedelseDeltager[];
  talepunkter: string[];
  talepunktIkoner?: (IkonNavn | undefined)[];
  opgaver: { titel: string; note?: string }[];
  praesentation?: { titel: string; html: string };
};

/** `{"forberedelse": {...}}` from a `forbered` run. */
export function parseForberedelse(raw: unknown): ForberedelseSvar {
  const f = isObj(raw) ? raw['forberedelse'] : undefined;
  if (!isObj(f)) throw new SchemaError('Forberedelse: svaret mangler "forberedelse"');
  const maal = str(f['maal'], 400);
  if (!maal) throw new SchemaError('Forberedelse: maal mangler');
  // Icons ride along with their talepunkt: a blank talepunkt is dropped together with its icon, so they never drift apart.
  const ikonRaa = arr<unknown>(f['talepunktIkoner']);
  const par = arr<unknown>(f['talepunkter']).map((t, i) => ({ tekst: str(t, 400), ikon: parseIkon(ikonRaa[i]) })).filter((p) => p.tekst).slice(0, MAX_TALEPUNKTER);
  const talepunkter = par.map((p) => p.tekst);
  if (talepunkter.length === 0) throw new SchemaError('Forberedelse: talepunkter mangler');
  const deltagere: ForberedelseDeltager[] = [];
  for (const d of arr<unknown>(f['deltagere'])) {
    if (!isObj(d)) continue;
    const navn = str(d['navn'], 100);
    if (!navn) continue;
    deltagere.push({ navn, hvem: str(d['hvem'], 300), baggrund: str(d['baggrund'], 800), vil: str(d['vil'], 400) });
    if (deltagere.length >= MAX_DELTAGERE) break;
  }
  const opgaver: ForberedelseSvar['opgaver'] = [];
  for (const o of arr<unknown>(f['opgaver'])) {
    if (!isObj(o)) continue;
    const titel = str(o['titel'], 200);
    if (!titel) continue;
    const note = str(o['note'], 1000);
    opgaver.push(note ? { titel, note } : { titel });
    if (opgaver.length >= MAX_OPGAVER) break;
  }
  const svar: ForberedelseSvar = { maal, deltagere, talepunkter, opgaver };
  // A talepunktIkoner that is not an array, or has no valid icon, is dropped; otherwise bad slots are simply empty.
  if (par.some((p) => p.ikon)) svar.talepunktIkoner = par.map((p) => p.ikon);
  const p = f['praesentation'];
  if (isObj(p) && typeof p['html'] === 'string' && p['html'].trim()) {
    svar.praesentation = { titel: str(p['titel'], 200) || 'Præsentation', html: p['html'].slice(0, MAX_HTML) };
  }
  return svar;
}

/** `{"nytUnivers": {navn, om}}` from the overview chat. */
export function parseNytUnivers(raw: unknown): { navn: string; om: string } {
  const n = isObj(raw) ? raw['nytUnivers'] : undefined;
  if (!isObj(n)) throw new SchemaError('Univers: svaret mangler "nytUnivers"');
  const navn = str(n['navn'], 80);
  if (!navn) throw new SchemaError('Univers: navn mangler');
  return { navn, om: str(n['om'], 400) };
}

// ---------- Participants from free text ----------

/** "Jonas Holm, Anne <anne@x.example>, mette@y.example" (comma, semicolon or newline separated) → participants. */
export function deltagereFraTekst(tekst: string): Deltager[] {
  const out: Deltager[] = [];
  for (const del of String(tekst ?? '').split(/[\n,;]+/)) {
    const d = del.trim();
    if (!d) continue;
    const vinkel = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(d);
    if (vinkel) {
      const navn = (vinkel[1] ?? '').trim() || (vinkel[2] ?? '').split('@')[0] || '';
      out.push({ navn: navn.slice(0, 80), email: (vinkel[2] ?? '').slice(0, 200) });
    } else if (/^[^\s@]+@[^\s@]+$/.test(d)) {
      out.push({ navn: (d.split('@')[0] ?? d).slice(0, 80), email: d.slice(0, 200) });
    } else {
      out.push({ navn: d.slice(0, 80) });
    }
    if (out.length >= MAX_DELTAGERE) break;
  }
  return out;
}
