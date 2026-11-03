// KC-0235: a small iCalendar reader (RFC 5545), no dependency, for the one thing Clawco reads from a calendar link:
// when, what and where. It keeps ONLY the title (SUMMARY), the time (DTSTART/DTEND/DURATION), the place (LOCATION),
// the calendar's own name (X-WR-CALNAME, the institution) and the UID (the caller hashes it into a stable id, it is never
// shown). Organizer, attendees, descriptions, URLs, attachments and alarms are never read into anything: the parser does
// not even look at those lines. Free text is cleaned (escapes, control characters, e-mail addresses) and capped.
//
// Everything is judged inside the asked window [fra, til) of Copenhagen days. Recurrence (RRULE) is expanded only inside
// it, and only for DAILY and WEEKLY (INTERVAL, COUNT, UNTIL, and BYDAY for weekly); any other rule gives the first
// occurrence only and is counted in `ustoettet`. EXDATE and changed occurrences (RECURRENCE-ID) are honoured; cancelled
// events are dropped. A line or event that cannot be read is skipped and counted, never thrown; only a file that is not a
// calendar or is over the size cap is refused. Pure: no I/O, no clock.

export const MAKS_BYTES = 1024 * 1024;
export const MAKS_HAENDELSER = 500;
const MAKS_TITEL = 200;
const MAKS_STED = 200;
const MAKS_TRIN = 20_000;
/** KC-0274: ONE step budget for the whole file, shared by every series (500 events × MAKS_TRIN steps was minutes of work). */
export const MAKS_TRIN_PER_FIL = 20_000;
/** Free text is examined only in its first MAKS_HOVED_FAKTOR × max characters: the scrub below is quadratic in what it sees. */
const MAKS_HOVED_FAKTOR = 20;
const MAKS_HOVED_TEGN = 64 * 1024;

export class IcsFejl extends Error {
  readonly kode: 'stor' | 'ikke-kalender';
  constructor(kode: IcsFejl['kode'], besked: string) { super(besked); this.name = 'IcsFejl'; this.kode = kode; }
}

/** One occurrence inside the window. `start`/`slut`: Copenhagen time with its offset, or a date for an all-day entry (`slut` exclusive). */
export type IcsHaendelse = { uid: string; titel: string; start: string; slut: string | null; heldag: boolean; sted: string | null };
export type IcsSvar = {
  kalenderNavn: string | null;
  haendelser: IcsHaendelse[];
  /** Events with a repeat rule that was not expanded (only their first occurrence is given). */
  ustoettet: number;
  /** Events and lines that could not be read. */
  sprunget: number;
  /** More than MAKS_HAENDELSER events, or the file's repeat-step budget ran out: the rest was not read or not expanded. */
  afkortet: boolean;
};

const TZ = 'Europe/Copenhagen';
const DAG_MS = 86_400_000;

// ---------- time zones (Intl only) ----------

const formater = new Map<string, Intl.DateTimeFormat | null>();
function formatFor(tz: string): Intl.DateTimeFormat | null {
  if (!formater.has(tz)) {
    try { formater.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })); } catch { formater.set(tz, null); }
  }
  return formater.get(tz) ?? null;
}
/** The zone name as given when the runtime knows it, else Copenhagen (a Windows name or a typo reads as local time). */
const kendtZone = (tz: string | undefined): string => (tz && formatFor(tz) ? tz : TZ);

/** The UTC offset in minutes of `tz` at the instant `ms`. */
function offsetMin(tz: string, ms: number): number {
  const navn = formatFor(tz)?.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(navn);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

type Mur = { dag: number; t: number; mi: number; s: number };
const dagFraYmd = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / DAG_MS);
const ymd = (dag: number): string => new Date(dag * DAG_MS).toISOString().slice(0, 10);

/** The instant of a wall time in `tz` (the offset is looked up twice so a time next to a change lands right). */
function murTilMs(w: Mur, tz: string): number {
  const gaet = w.dag * DAG_MS + (w.t * 3600 + w.mi * 60 + w.s) * 1000;
  const ms = gaet - offsetMin(tz, gaet) * 60_000;
  const o2 = offsetMin(tz, ms);
  return gaet - o2 * 60_000;
}

const DATO = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const TID = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** An instant as Copenhagen wall time with its offset: 2026-11-03T08:00:00+01:00. */
function kbhIso(ms: number): string {
  const o = offsetMin(TZ, ms);
  const a = Math.abs(o);
  return `${DATO.format(new Date(ms))}T${TID.format(new Date(ms))}${o < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ---------- lines ----------

type Linje = { navn: string; param: Record<string, string>; vaerdi: string };

/** First `sep` outside double quotes, or -1. */
function udenforCitat(s: string, sep: string, fra = 0): number {
  let i = fra;
  for (let citat = false; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') citat = !citat;
    else if (c === sep && !citat) return i;
  }
  return -1;
}

function laesLinje(raa: string): Linje | null {
  const l = raa.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  const kolon = udenforCitat(l, ':');
  if (kolon <= 0) return null;
  const hoved = l.slice(0, kolon);
  const dele: string[] = [];
  for (let fra = 0; ;) {
    const semi = udenforCitat(hoved, ';', fra);
    dele.push(hoved.slice(fra, semi < 0 ? undefined : semi));
    if (semi < 0) break;
    fra = semi + 1;
  }
  const navn = (dele[0] ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(navn)) return null;
  const param: Record<string, string> = {};
  for (const p of dele.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) param[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { navn, param, vaerdi: l.slice(kolon + 1) };
}

const EPOST = /[^\s@<>()]{1,254}@[^\s@<>()]{1,254}\.[^\s@<>()]{1,254}/g;
/**
 * Free text as plain text: escapes undone, newlines as spaces, e-mail addresses removed, capped. The raw text is cut to a
 * small multiple of `maks` FIRST (KC-0274, C1), at a space so no half e-mail address survives the cut.
 */
function renTekst(raa: string | undefined, maks: number): string {
  if (!raa) return '';
  const graense = Math.min(maks * MAKS_HOVED_FAKTOR, MAKS_HOVED_TEGN);
  let v = raa;
  if (v.length > graense) {
    v = v.slice(0, graense);
    const sidsteMellemrum = Math.max(v.lastIndexOf(' '), v.lastIndexOf('\t'));
    v = sidsteMellemrum > 0 ? v.slice(0, sidsteMellemrum) : '';
  }
  return v.replace(/\\(.)/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).replace(EPOST, '').replace(/\s+/g, ' ').trim().slice(0, maks);
}

// ---------- values ----------

type Tid = { heldag: true; dag: number } | { heldag: false; mur: Mur; tz: string };

function laesTid(vaerdi: string, param: Record<string, string>): Tid | null {
  const v = vaerdi.trim();
  const dato = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (param['VALUE'] === 'DATE' && !dato) return null;
  const m = dato ?? dt;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dag = dagFraYmd(y, mo, d);
  if (mo < 1 || mo > 12 || d < 1 || ymd(dag) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  if (dato) return { heldag: true, dag };
  const [t, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (t > 23 || mi > 59 || s > 60) return null;
  return { heldag: false, mur: { dag, t, mi, s: Math.min(s, 59) }, tz: m[7] === 'Z' ? 'UTC' : kendtZone(param['TZID']) };
}

function laesVarighed(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim().replace(/[+-]?P/, '') === '') return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---------- recurrence ----------

type Regel = { frekvens: 'DAILY' | 'WEEKLY'; interval: number; count: number | null; until: string | null; ugedage: number[] | null };
const UGEDAG = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The rule when it is one this reader expands, else null. */
function laesRegel(raa: string): Regel | null {
  const nogler = new Map<string, string>();
  for (const del of raa.split(';')) {
    const eq = del.indexOf('=');
    if (eq <= 0) return null;
    nogler.set(del.slice(0, eq).trim().toUpperCase(), del.slice(eq + 1).trim().toUpperCase());
  }
  const frekvens = nogler.get('FREQ');
  if (frekvens !== 'DAILY' && frekvens !== 'WEEKLY') return null;
  for (const n of nogler.keys()) if (!['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'].includes(n)) return null;
  if (nogler.has('WKST') && nogler.get('WKST') !== 'MO') return null;
  const heltal = (n: string, standard: number | null): number | null | undefined => {
    const v = nogler.get(n);
    if (v === undefined) return standard;
    return /^\d{1,5}$/.test(v) && Number(v) > 0 ? Number(v) : undefined;
  };
  const interval = heltal('INTERVAL', 1);
  const count = heltal('COUNT', null);
  if (interval === undefined || interval === null || count === undefined) return null;
  let ugedage: number[] | null = null;
  if (nogler.has('BYDAY')) {
    if (frekvens !== 'WEEKLY') return null;
    const dele = (nogler.get('BYDAY') ?? '').split(',');
    if (!dele.every((x) => UGEDAG.includes(x))) return null; // a numbered day (1MO) is a monthly idea
    ugedage = dele.map((x) => UGEDAG.indexOf(x));
  }
  return { frekvens, interval, count, until: nogler.get('UNTIL') ?? null, ugedage };
}

const ugedagAf = (dag: number): number => new Date(dag * DAG_MS).getUTCDay();

/** The dates of the occurrences of a rule from `start` up to (not including) `slut`; COUNT counts from the first. */
function forekomster(start: number, r: Regel, slut: number, ikkeEfterUntil: (dag: number) => boolean, trin: { rest: number; opbrugt: boolean }): number[] {
  const ud: number[] = [];
  let antal = 0;
  const tag = (dag: number): boolean => {
    if (trin.rest <= 0) { trin.opbrugt = true; return false; }
    trin.rest -= 1;
    if (dag < start) return true;
    if (r.count !== null && antal >= r.count) return false;
    if (!ikkeEfterUntil(dag)) return false;
    antal += 1;
    if (dag < slut) ud.push(dag);
    return dag < slut;
  };
  if (r.frekvens === 'DAILY') {
    for (let i = 0; i < MAKS_TRIN; i += 1) if (!tag(start + i * r.interval)) break;
    return ud;
  }
  const mandag = start - ((ugedagAf(start) + 6) % 7);
  const dage = (r.ugedage ?? [ugedagAf(start)]).map((u) => (u + 6) % 7).sort((a, b) => a - b);
  for (let w = 0; w < MAKS_TRIN; w += 1) {
    const ugeStart = mandag + w * 7 * r.interval;
    if (ugeStart >= slut) break;
    let videre = true;
    for (const off of dage) { if (!tag(ugeStart + off)) { videre = false; break; } }
    if (!videre) break;
  }
  return ud;
}

// ---------- events ----------

type Raa = {
  uid: string; titel: string; sted: string; status: string;
  start: Tid | null; slut: Tid | null; varighed: number | null;
  regel: string | null; undtagelser: Tid[]; erstatter: Tid | null;
};

function nyRaa(): Raa {
  return { uid: '', titel: '', sted: '', status: '', start: null, slut: null, varighed: null, regel: null, undtagelser: [], erstatter: null };
}

const noegle = (t: Tid): string => (t.heldag ? `d:${t.dag}` : `t:${murTilMs(t.mur, t.tz)}`);

/** Parses `tekst`; the window is [fra, til) as Copenhagen dates (YYYY-MM-DD). Throws IcsFejl only for a file that is too large or not a calendar. */
export function parseIcs(tekst: string, vindue: { fra: string; til: string }): IcsSvar {
  if (tekst.length > MAKS_BYTES) throw new IcsFejl('stor', 'Kalenderen er for stor.');
  const linjer = tekst.replace(/^﻿/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  if (!linjer.some((l) => /^BEGIN:VCALENDAR\s*$/i.test(l))) throw new IcsFejl('ikke-kalender', 'Det er ikke en kalender.');

  let sprunget = 0;
  let afkortet = false;
  let kalenderNavn: string | null = null;
  const raa: Raa[] = [];
  let nu: Raa | null = null;
  let boern = 0; // nested components (VALARM …) inside an event: their lines are not the event's
  let set = 0;

  for (const l of linjer) {
    const ln = laesLinje(l);
    if (!ln) { if (l.trim()) sprunget += 1; continue; }
    if (ln.navn === 'BEGIN') {
      const hvad = ln.vaerdi.trim().toUpperCase();
      if (hvad === 'VEVENT') {
        if (nu) sprunget += 1; // the one before was never closed
        set += 1;
        if (set > MAKS_HAENDELSER) { afkortet = true; nu = null; continue; }
        nu = nyRaa(); boern = 0;
      } else if (nu) boern += 1;
      continue;
    }
    if (ln.navn === 'END') {
      const hvad = ln.vaerdi.trim().toUpperCase();
      if (hvad === 'VEVENT') {
        if (nu) { if (nu.start) raa.push(nu); else sprunget += 1; }
        nu = null;
      } else if (hvad === 'VCALENDAR') {
        if (nu) { sprunget += 1; nu = null; }
      } else if (nu && boern > 0) boern -= 1;
      continue;
    }
    if (!nu) {
      if (ln.navn === 'X-WR-CALNAME' && kalenderNavn === null) kalenderNavn = renTekst(ln.vaerdi, 80) || null;
      continue;
    }
    if (boern > 0) continue;
    switch (ln.navn) {
      case 'UID': nu.uid ||= ln.vaerdi.trim().slice(0, 300); break;
      case 'SUMMARY': nu.titel ||= renTekst(ln.vaerdi, MAKS_TITEL); break;
      case 'LOCATION': nu.sted ||= renTekst(ln.vaerdi, MAKS_STED); break;
      case 'STATUS': nu.status ||= ln.vaerdi.trim().toUpperCase(); break;
      case 'DTSTART': { const t = laesTid(ln.vaerdi, ln.param); if (t) nu.start ??= t; else { nu.start = null; nu.status = nu.status || 'UGYLDIG'; } break; }
      case 'DTEND': nu.slut ??= laesTid(ln.vaerdi, ln.param); break;
      case 'DURATION': nu.varighed ??= laesVarighed(ln.vaerdi); break;
      case 'RRULE': nu.regel ??= ln.vaerdi.trim(); break;
      case 'RECURRENCE-ID': nu.erstatter ??= laesTid(ln.vaerdi, ln.param); break;
      case 'EXDATE': for (const v of ln.vaerdi.split(',')) { const t = laesTid(v, ln.param); if (t) nu.undtagelser.push(t); } break;
      default: break; // ORGANIZER, ATTENDEE, DESCRIPTION, URL, ATTACH, … are never read
    }
  }
  if (nu) sprunget += 1;

  const fraDag = dagFraYmd(...(vindue.fra.split('-').map(Number) as [number, number, number]));
  const tilDag = dagFraYmd(...(vindue.til.split('-').map(Number) as [number, number, number]));
  const fraMs = murTilMs({ dag: fraDag, t: 0, mi: 0, s: 0 }, TZ);
  const tilMs = murTilMs({ dag: tilDag, t: 0, mi: 0, s: 0 }, TZ);

  // Changed occurrences replace the one they name (even when the change itself is cancelled).
  const erstattet = new Set<string>();
  for (const r of raa) if (r.erstatter) erstattet.add(`${r.uid}|${noegle(r.erstatter)}`);

  const ud: IcsHaendelse[] = [];
  const trin = { rest: MAKS_TRIN_PER_FIL, opbrugt: false };
  let ustoettet = 0;
  const hold = (r: Raa, start: string, slut: string | null, heldag: boolean): void => {
    ud.push({ uid: r.uid, titel: r.titel || '(uden titel)', start, slut, heldag, sted: r.sted || null });
  };

  for (const r of raa) {
    const s = r.start;
    if (!s || r.status === 'CANCELLED' || r.status === 'UGYLDIG') { if (r.status === 'UGYLDIG') sprunget += 1; continue; }
    let regel: Regel | null = null;
    if (r.regel !== null && !r.erstatter) {
      regel = laesRegel(r.regel);
      if (!regel) ustoettet += 1;
    }
    const undtagelser = new Set(r.undtagelser.map(noegle));

    if (s.heldag) {
      const dage = r.slut?.heldag && r.slut.dag > s.dag ? r.slut.dag - s.dag : 1;
      const until = regel?.until ? laesTid(regel.until, {}) : null;
      const efterUntil = (d: number): boolean => !until || (until.heldag ? d <= until.dag : d <= until.mur.dag);
      const dagene = regel ? forekomster(s.dag, regel, tilDag + 1, efterUntil, trin) : [s.dag];
      for (const d of dagene) {
        if (!(d < tilDag && d + dage > fraDag)) continue;
        if (undtagelser.has(`d:${d}`) || erstattet.has(`${r.uid}|d:${d}`)) continue;
        hold(r, ymd(d), ymd(d + dage), true);
      }
      continue;
    }

    const startMs = murTilMs(s.mur, s.tz);
    const varighed = r.slut && !r.slut.heldag ? murTilMs(r.slut.mur, r.slut.tz) - startMs : r.varighed;
    const until = regel?.until ? laesTid(regel.until, {}) : null;
    // UNTIL is an instant (UTC) or a wall time in the start's zone; an occurrence is kept while it starts no later.
    const efterUntil = (d: number): boolean => {
      if (!until) return true;
      if (until.heldag) return d <= until.dag;
      return murTilMs({ ...s.mur, dag: d }, s.tz) <= murTilMs(until.mur, until.tz === 'UTC' && regel?.until?.endsWith('Z') ? 'UTC' : s.tz);
    };
    const dagene = regel ? forekomster(s.mur.dag, regel, Math.ceil(tilMs / DAG_MS) + 2, efterUntil, trin) : [s.mur.dag];
    for (const d of dagene) {
      const ms = murTilMs({ ...s.mur, dag: d }, s.tz);
      const slutMs = varighed !== null && varighed >= 0 ? ms + varighed : null;
      if (!(ms < tilMs && ((slutMs ?? ms) > fraMs || ms >= fraMs))) continue;
      if (undtagelser.has(`t:${ms}`) || undtagelser.has(`d:${d}`) || erstattet.has(`${r.uid}|t:${ms}`)) continue;
      hold(r, kbhIso(ms), slutMs === null ? null : kbhIso(slutMs), false);
    }
  }
  return { kalenderNavn, haendelser: ud, ustoettet, sprunget, afkortet: afkortet || trin.opbrugt };
}
