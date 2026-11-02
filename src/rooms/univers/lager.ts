// Storage and pure operations for the Univers room family. The index lives in
// store room `univers`, each univers in store room `univers-<slug>`. Every
// read-modify-write goes through a per-store, per-room promise chain (the
// `endreKurator` pattern), because chat runs and buttons can overlap. The
// element operations are pure functions over UniversState.

import type { RumLager } from '../../store/types.ts';
import { zoneAf, type DataZone } from '../../identitet/zoner.ts';
import {
  KORSEL, SchemaError, htmlTilTekst, isOpgaveStatus, deltagereFraTekst, normaliserIndeks, normaliserUnivers, tomtUnivers, standardId,
  type Dokument, type Forberedelse, type ForberedelseSvar, type Moede, type MoedeKandidat, type NyId, type NytElement,
  type Note, type Opgave, type OpgaveStatus, type UniversIndeks, type UniversInfo, type UniversState,
} from './schema.ts';

export const UNIVERS = 'univers';
export const universRum = (slug: string): string => `univers-${slug}`;
const UNIVERS_RUM = /^univers-[a-z0-9-]{1,32}$/;

const MAX_VERSIONER = 10;
const MAX_SLUG = 30;
const MAX_SKJULTE = 500;

// ---------- Slugs ----------

/** URL/room-safe name: æ→ae, ø→oe, å→aa, [a-z0-9-], at most 30 characters, unique against `taget` by -2, -3 … */
export function slug(navn: string, taget: Iterable<string> = []): string {
  const base = String(navn ?? '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '') || 'univers';
  const brugt = new Set(taget);
  if (!brugt.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const kandidat = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, '') + suffix;
    if (!brugt.has(kandidat)) return kandidat;
  }
}

// ---------- Store: reads and the lock ----------

export async function laesIndeks(store: RumLager): Promise<UniversIndeks> {
  return normaliserIndeks(await store.readState(UNIVERS));
}

/** The state of one univers; the empty state when nothing is stored yet. Existence is the index's business. */
export async function laesUnivers(store: RumLager, slugNavn: string): Promise<UniversState> {
  return normaliserUnivers(await store.readState(universRum(slugNavn)));
}

export const findUnivers = (indeks: UniversIndeks, slugNavn: string): UniversInfo | undefined => indeks.univers.find((u) => u.id === slugNavn);

const koer = new WeakMap<RumLager, Map<string, Promise<unknown>>>();

function laas<T>(store: RumLager, rum: string, trin: () => Promise<T>): Promise<T> {
  let kaeder = koer.get(store);
  if (!kaeder) { kaeder = new Map(); koer.set(store, kaeder); }
  const naeste = (kaeder.get(rum) ?? Promise.resolve()).then(trin, trin);
  kaeder.set(rum, naeste.catch(() => undefined));
  return naeste;
}

/**
 * The one way to change a univers' state (room `univers-<slug>`): `fn` gets the current state (read inside the
 * chain) and returns the next one, which is written; returning the very same object writes nothing. A throw
 * writes nothing and does not block later steps. Never call endreUnivers for the same room from inside `fn`.
 */
export function endreUnivers(store: RumLager, roomId: string, fn: (s: UniversState) => UniversState | Promise<UniversState>): Promise<UniversState> {
  if (!UNIVERS_RUM.test(roomId)) return Promise.reject(new Error(`endreUnivers: ${roomId} er ikke et univers-rum`));
  return laas(store, roomId, async () => {
    const nu = normaliserUnivers(await store.readState(roomId));
    const ny = await fn(nu);
    if (ny !== nu) await store.writeState(roomId, ny);
    return ny;
  });
}

/** Same discipline for the index (room `univers`). */
export function endreIndeks(store: RumLager, fn: (i: UniversIndeks) => UniversIndeks | Promise<UniversIndeks>): Promise<UniversIndeks> {
  return laas(store, UNIVERS, async () => {
    const nu = normaliserIndeks(await store.readState(UNIVERS));
    const ny = await fn(nu);
    if (ny !== nu) await store.writeState(UNIVERS, ny);
    return ny;
  });
}

// ---------- Store: universes ----------

export async function opretUnivers(store: RumLager, input: { navn: string; om: string }, now: Date): Promise<UniversInfo> {
  let info: UniversInfo | undefined;
  await endreIndeks(store, async (i) => {
    const navn = String(input.navn ?? '').trim().slice(0, 80);
    if (!navn) throw new SchemaError('Univers: navn mangler');
    const id = slug(navn, i.univers.map((u) => u.id));
    info = { id, navn, om: String(input.om ?? '').trim().slice(0, 400), oprettet: now.toISOString() };
    await store.writeState(universRum(id), tomtUnivers());
    return { ...i, univers: [...i.univers, info] };
  });
  return info as UniversInfo;
}

/** Hides a univers from the nav; its data stays (nothing is deleted from the UI). Null when the slug is unknown. */
export async function arkiverUnivers(store: RumLager, slugNavn: string, now: Date): Promise<UniversInfo | null> {
  let resultat: UniversInfo | null = null;
  await endreIndeks(store, (i) => {
    const eksisterende = findUnivers(i, slugNavn);
    if (!eksisterende) return i;
    resultat = { ...eksisterende, arkiveret: now.toISOString() };
    return { ...i, univers: i.univers.map((u) => (u.id === slugNavn ? (resultat as UniversInfo) : u)) };
  });
  return resultat;
}

// ---------- Elements: apply and undo ----------

export type ElementType = 'dokument' | 'note' | 'opgave';
export type FortrydTrin =
  | { op: 'fjern'; type: ElementType; id: string }
  | { op: 'gendan'; type: ElementType; element: Dokument | Note | Opgave }
  | { op: 'forberedelse'; moedeId: string; foer: Forberedelse | null };
/** What restores the state before one change; JSON-safe (the log stores it as `lokal:<json>`). */
export type Fortryd = FortrydTrin[];
export type Beroert = { type: ElementType; id: string; titel: string; ny: boolean };

const LISTE = { dokument: 'dokumenter', note: 'noter', opgave: 'opgaver' } as const;
const TYPER: readonly string[] = ['dokument', 'note', 'opgave'];

function version(d: Dokument): { html: string; tekst: string; tid: string } {
  return { html: d.html, tekst: d.tekst, tid: d.aendret };
}

/** Creates or updates a document in the (already cloned) state, recording the undo step. */
function saetDokument(s: UniversState, fortryd: Fortryd, input: { id?: string; titel: string; html: string; moedeId?: string; zone: DataZone }, now: Date, nyId: NyId): { dok: Dokument; ny: boolean } {
  const tekst = htmlTilTekst(input.html);
  // KC-0117: a run only updates an element of its own zone; an id naming another zone makes a new element (never relabels, never overwrites).
  const eksisterende = input.id ? s.dokumenter.find((d) => d.id === input.id && zoneAf(d) === input.zone) : undefined;
  if (eksisterende) {
    fortryd.push({ op: 'gendan', type: 'dokument', element: structuredClone(eksisterende) });
    eksisterende.versioner = [...eksisterende.versioner, version(eksisterende)].slice(-MAX_VERSIONER);
    eksisterende.titel = input.titel;
    eksisterende.html = input.html;
    eksisterende.tekst = tekst;
    eksisterende.aendret = now.toISOString();
    return { dok: eksisterende, ny: false };
  }
  const dok: Dokument = {
    id: nyId('dok'), titel: input.titel, html: input.html, tekst, versioner: [], zone: input.zone,
    ...(input.moedeId ? { moedeId: input.moedeId } : {}),
    oprettet: now.toISOString(), aendret: now.toISOString(),
  };
  s.dokumenter.push(dok);
  fortryd.push({ op: 'fjern', type: 'dokument', id: dok.id });
  return { dok, ny: true };
}

function nyOpgave(s: UniversState, fortryd: Fortryd, input: { titel: string; note?: string; status?: OpgaveStatus; moedeId?: string }, nyId: NyId): Opgave {
  const o: Opgave = {
    id: nyId('opg'), titel: input.titel,
    ...(input.note ? { note: input.note } : {}),
    status: input.status ?? 'aaben',
    ...(input.moedeId ? { moedeId: input.moedeId } : {}),
  };
  s.opgaver.push(o);
  fortryd.push({ op: 'fjern', type: 'opgave', id: o.id });
  return o;
}

/**
 * Applies Hermes' elements: add, or update when `id` names an existing element of that type (an unknown id
 * adds a new element with a minted id — the app mints ids, Hermes only points at existing ones). Updating a
 * document pushes the previous version (at most 10 are kept). Never mutates `state`.
 */
export function anvendElementer(state: UniversState, elementer: NytElement[], now: Date, nyId: NyId): { state: UniversState; fortryd: Fortryd; beroert: Beroert[] } {
  const s = structuredClone(state);
  const fortryd: Fortryd = [];
  const beroert: Beroert[] = [];
  for (const e of elementer) {
    if (e.type === 'dokument') {
      const { dok, ny } = saetDokument(s, fortryd, { ...(e.id ? { id: e.id } : {}), titel: e.titel, html: e.html, zone: e.zone }, now, nyId);
      beroert.push({ type: 'dokument', id: dok.id, titel: dok.titel, ny });
    } else if (e.type === 'note') {
      const fandt = e.id ? s.noter.find((n) => n.id === e.id && zoneAf(n) === e.zone) : undefined;
      if (fandt) {
        fortryd.push({ op: 'gendan', type: 'note', element: structuredClone(fandt) });
        fandt.titel = e.titel;
        fandt.tekst = e.tekst;
        beroert.push({ type: 'note', id: fandt.id, titel: fandt.titel, ny: false });
      } else {
        const n: Note = { id: nyId('note'), titel: e.titel, tekst: e.tekst, oprettet: now.toISOString(), zone: e.zone };
        s.noter.push(n);
        fortryd.push({ op: 'fjern', type: 'note', id: n.id });
        beroert.push({ type: 'note', id: n.id, titel: n.titel, ny: true });
      }
    } else {
      const fandt = e.id ? s.opgaver.find((o) => o.id === e.id) : undefined;
      if (fandt) {
        fortryd.push({ op: 'gendan', type: 'opgave', element: structuredClone(fandt) });
        fandt.titel = e.titel;
        if (e.note !== undefined) fandt.note = e.note;
        if (e.status !== undefined) fandt.status = e.status;
        beroert.push({ type: 'opgave', id: fandt.id, titel: fandt.titel, ny: false });
      } else {
        const o = nyOpgave(s, fortryd, { titel: e.titel, ...(e.note ? { note: e.note } : {}), ...(e.status ? { status: e.status } : {}) }, nyId);
        beroert.push({ type: 'opgave', id: o.id, titel: o.titel, ny: true });
      }
    }
  }
  return { state: s, fortryd, beroert };
}

/** Reverses a recorded change (newest step first). Never mutates `state`. */
export function fortrydElementer(state: UniversState, fortryd: Fortryd): UniversState {
  const s = structuredClone(state);
  for (const trin of [...fortryd].reverse()) {
    if (trin.op === 'forberedelse') {
      const m = s.moeder.find((x) => x.id === trin.moedeId);
      if (!m) continue;
      if (trin.foer) m.forberedelse = structuredClone(trin.foer);
      else delete m.forberedelse;
      continue;
    }
    const liste = s[LISTE[trin.type]] as { id: string }[];
    const idx = liste.findIndex((x) => x.id === (trin.op === 'fjern' ? trin.id : trin.element.id));
    if (trin.op === 'fjern') {
      if (idx >= 0) liste.splice(idx, 1);
    } else if (idx >= 0) {
      liste[idx] = structuredClone(trin.element);
    } else {
      liste.push(structuredClone(trin.element));
    }
  }
  return s;
}

/** Validates a stored fortryd (it comes back from the log as text). */
export function parseFortryd(raw: unknown): Fortryd {
  if (!Array.isArray(raw) || raw.length > 200) throw new SchemaError('Univers: fortryd er ikke en liste');
  const out: Fortryd = [];
  for (const t of raw as unknown[]) {
    const o = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    if (o['op'] === 'fjern' && TYPER.includes(String(o['type'])) && typeof o['id'] === 'string') {
      out.push({ op: 'fjern', type: o['type'] as ElementType, id: o['id'] });
    } else if (o['op'] === 'gendan' && TYPER.includes(String(o['type'])) && typeof o['element'] === 'object' && o['element'] !== null && typeof (o['element'] as { id?: unknown }).id === 'string') {
      out.push({ op: 'gendan', type: o['type'] as ElementType, element: o['element'] as Dokument | Note | Opgave });
    } else if (o['op'] === 'forberedelse' && typeof o['moedeId'] === 'string' && (o['foer'] === null || (typeof o['foer'] === 'object' && o['foer'] !== null))) {
      out.push({ op: 'forberedelse', moedeId: o['moedeId'], foer: o['foer'] as Forberedelse | null });
    } else {
      throw new SchemaError('Univers: ugyldigt fortryd-trin');
    }
  }
  return out;
}

export function saetOpgaveStatus(state: UniversState, opgaveId: string, status: OpgaveStatus): UniversState {
  if (!isOpgaveStatus(status)) throw new SchemaError('Univers: ukendt status');
  if (!state.opgaver.some((o) => o.id === opgaveId)) throw new SchemaError('Univers: opgaven findes ikke længere');
  return { ...state, opgaver: state.opgaver.map((o) => (o.id === opgaveId ? { ...o, status } : o)) };
}

// ---------- Meetings ----------

/** Adds a meeting; a calendar meeting that is already there (same eventId) gets its time/title/people refreshed, keeping id and preparation. */
export function tilfoejMoede(state: UniversState, moede: Moede): UniversState {
  const fandt = moede.eventId ? state.moeder.find((m) => m.eventId === moede.eventId) : undefined;
  if (!fandt) return { ...state, moeder: [...state.moeder, structuredClone(moede)] };
  return {
    ...state,
    moeder: state.moeder.map((m) => {
      if (m !== fandt) return m;
      const { sted: _sted, ...rest } = m;
      return { ...rest, titel: moede.titel, start: moede.start, slut: moede.slut, deltagere: structuredClone(moede.deltagere), ...(moede.sted ? { sted: moede.sted } : {}) };
    }),
  };
}

export function moedeFraKandidat(k: MoedeKandidat, nyId: NyId): Moede {
  return {
    id: nyId('moede'), kilde: 'kalender', eventId: k.eventId, titel: k.titel, start: k.start, slut: k.slut,
    ...(k.sted ? { sted: k.sted } : {}), deltagere: structuredClone(k.deltagere),
  };
}

/** A meeting Henrik adds by hand. `start` must already be an ISO instant (the form's local time is converted by the caller). */
export function nytMoedeFraInput(input: { titel: string; start: string; varighedMinutter: number; deltagere: string; sted?: string }, nyId: NyId): Moede {
  const titel = String(input.titel ?? '').trim().slice(0, 200);
  if (!titel) throw new SchemaError('Møde: titel mangler');
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new SchemaError('Møde: starttidspunktet kan ikke læses');
  const min = Number.isFinite(input.varighedMinutter) ? Math.min(Math.max(Math.round(input.varighedMinutter), 5), 24 * 60) : 60;
  const sted = String(input.sted ?? '').trim().slice(0, 200);
  return {
    id: nyId('moede'), kilde: 'manuel', titel, start: start.toISOString(), slut: new Date(start.getTime() + min * 60_000).toISOString(),
    ...(sted ? { sted } : {}), deltagere: deltagereFraTekst(input.deltagere),
  };
}

/**
 * Stores Hermes' preparation on the meeting, adds its tasks (linked to the meeting; a task with the same title
 * already linked is not added twice) and, when a presentation comes with it, creates the meeting's document or
 * writes a new version of it. Without a presentation the earlier document link is kept.
 */
export function anvendForberedelse(state: UniversState, moedeId: string, svar: ForberedelseSvar, now: Date, nyId: NyId): { state: UniversState; fortryd: Fortryd } {
  const s = structuredClone(state);
  const m = s.moeder.find((x) => x.id === moedeId);
  if (!m) throw new SchemaError('Univers: mødet findes ikke længere');
  const fortryd: Fortryd = [{ op: 'forberedelse', moedeId, foer: m.forberedelse ? structuredClone(m.forberedelse) : null }];

  let dokumentId = m.forberedelse?.dokumentId;
  if (svar.praesentation) {
    const eksisterende = (dokumentId && s.dokumenter.find((d) => d.id === dokumentId)) || s.dokumenter.find((d) => d.moedeId === moedeId);
    const { dok } = saetDokument(s, fortryd, { ...(eksisterende ? { id: eksisterende.id } : {}), titel: svar.praesentation.titel, html: svar.praesentation.html, moedeId, zone: KORSEL }, now, nyId);
    dokumentId = dok.id;
  }
  const kendte = new Set(s.opgaver.filter((o) => o.moedeId === moedeId).map((o) => o.titel.trim().toLowerCase()));
  for (const o of svar.opgaver) {
    const noegle = o.titel.trim().toLowerCase();
    if (kendte.has(noegle)) continue;
    kendte.add(noegle);
    nyOpgave(s, fortryd, { titel: o.titel, ...(o.note ? { note: o.note } : {}), moedeId }, nyId);
  }
  m.forberedelse = {
    maal: svar.maal, deltagere: structuredClone(svar.deltagere), talepunkter: [...svar.talepunkter],
    ...(svar.talepunktIkoner ? { talepunktIkoner: [...svar.talepunktIkoner] } : {}),
    ...(dokumentId ? { dokumentId } : {}), tid: now.toISOString(),
  };
  return { state: s, fortryd };
}

// ---------- Index: new meetings ----------

/** Takes a candidate out of "Nye møder" and returns it (null when it is not there). */
export function placerMoede(indeks: UniversIndeks, eventId: string): { indeks: UniversIndeks; kandidat: MoedeKandidat | null } {
  const kandidat = indeks.nyeMoeder.find((k) => k.eventId === eventId) ?? null;
  if (!kandidat) return { indeks, kandidat: null };
  return { indeks: { ...indeks, nyeMoeder: indeks.nyeMoeder.filter((k) => k.eventId !== eventId) }, kandidat };
}

/** "Ikke et møde for mig": out of the new ones, and never offered again. */
export function skjulMoede(indeks: UniversIndeks, eventId: string): UniversIndeks {
  const skjulte = indeks.skjulteMoeder.includes(eventId) ? indeks.skjulteMoeder : [...indeks.skjulteMoeder, eventId].slice(-MAX_SKJULTE);
  return { ...indeks, nyeMoeder: indeks.nyeMoeder.filter((k) => k.eventId !== eventId), skjulteMoeder: skjulte };
}

/**
 * Merges the calendar's current candidates: those not already placed or hidden become (or stay) "Nye møder"
 * with fresh data; ones that vanished from the calendar drop out. Sorted by start.
 */
export function flettKandidater(indeks: UniversIndeks, kandidater: MoedeKandidat[], placeredeEventIds: Iterable<string>): UniversIndeks {
  const placerede = new Set(placeredeEventIds);
  const skjulte = new Set(indeks.skjulteMoeder);
  const set = new Set<string>();
  const nye: MoedeKandidat[] = [];
  for (const k of kandidater) {
    if (placerede.has(k.eventId) || skjulte.has(k.eventId) || set.has(k.eventId)) continue;
    set.add(k.eventId);
    nye.push(k);
  }
  nye.sort((a, b) => a.start.localeCompare(b.start));
  return { ...indeks, nyeMoeder: nye };
}

/**
 * "Læg i univers": the candidate goes into the univers first, then out of the index — so a crash in between
 * leaves it in both (harmless: placing again merges by eventId), never in neither. Null when the candidate or
 * an active univers is unknown.
 */
export async function placerMoedeIUnivers(store: RumLager, eventId: string, slugNavn: string, nyId: NyId = standardId): Promise<Moede | null> {
  const indeks = await laesIndeks(store);
  const kandidat = indeks.nyeMoeder.find((k) => k.eventId === eventId);
  const info = findUnivers(indeks, slugNavn);
  if (!kandidat || !info || info.arkiveret) return null;
  const nyt = moedeFraKandidat(kandidat, nyId);
  const state = await endreUnivers(store, universRum(slugNavn), (s) => tilfoejMoede(s, nyt));
  await endreIndeks(store, (i) => placerMoede(i, eventId).indeks);
  return state.moeder.find((m) => m.eventId === eventId) ?? null;
}

// ---------- The situation ----------

export type UniversStat = { moeder: number; aabneOpgaver: number; dokumenter: number };

/** Counts for the overview tiles: meetings still to come (or running), tasks not done, documents. */
export function universStat(state: UniversState, now: Date): UniversStat {
  return {
    moeder: state.moeder.filter((m) => Date.parse(m.slut) > now.getTime()).length,
    aabneOpgaver: state.opgaver.filter((o) => o.status !== 'faerdig').length,
    dokumenter: state.dokumenter.length,
  };
}
