// The household's shared week (KC-0148): a pure merge of what concerns
// everyone — events from calendars read in the husstand zone, resource bookings
// (KC-0150) and accepted requests (KC-0149). A calendar read in privat or
// arbejde is never even parsed (D2/E7: no cross-zone copy). Calendar data is
// the JSON scripts/kalender_uge.py prints, as every calendar connector returns
// it (KalenderData in src/kilder/types.ts); it is untrusted, so every field is
// checked and capped here.

import type { DataZone } from '../identitet/zoner.ts';
import type { Medlem, Ressource } from './schema.ts';
import { aftaleTid, type Forespoergsel } from './foresp.ts';

/** One calendar as read: its zone, and who connected it (null = the host, i.e. nobody known). */
export type KalenderLaesning = { zone: DataZone; ejer: string | null; data: unknown };
export type FaellesPost = {
  id: string; titel: string; start: string; slut?: string; heldag: boolean; sted?: string;
  /** Member ids the entry belongs to; empty = the whole household. */
  hvem: string[];
  kilde: 'kalender' | 'booking' | 'aftale';
};
export type FaellesDag = { dato: string; poster: FaellesPost[] };
/** What the week reads of a request (KC-0149): an accepted one at its agreed time. */
export type FaellesForesp = Pick<Forespoergsel, 'id' | 'fra' | 'til' | 'titel' | 'tid' | 'tilstand' | 'alternativ'>;
export type FaellesKilder = { kalendere: readonly KalenderLaesning[]; ressourcer: readonly Ressource[]; forespoergsler: readonly FaellesForesp[] };

const TZ = 'Europe/Copenhagen';
const MAX_PER_DAG = 30;
const DATO = /^\d{4}-\d{2}-\d{2}$/;

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const dagKbh = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** `n` Copenhagen dates (YYYY-MM-DD) from today. */
export function ugeDage(nu: Date, n = 7): string[] {
  const [y, m, d] = dagKbh(nu).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + i)).toISOString().slice(0, 10));
}

/** The Copenhagen day of a start (a date for all-day entries, else an ISO time); '' when it is not a time. */
function dagAf(start: string, heldag: boolean): string {
  if (heldag) return DATO.test(start.slice(0, 10)) ? start.slice(0, 10) : '';
  const t = Date.parse(start);
  return Number.isNaN(t) ? '' : dagKbh(new Date(t));
}

/** Members (in household order) whose tailnet login is among the event's attendees or its creator. */
export function medlemmerI(e: Record<string, unknown>, medlemmer: readonly Medlem[]): string[] {
  const adresser = new Set<string>();
  const creator = s(e['creator'], 200).toLowerCase(); if (creator) adresser.add(creator);
  for (const a of Array.isArray(e['attendees']) ? e['attendees'] : []) { const m = erObj(a) ? s(a['email'], 200).toLowerCase() : ''; if (m) adresser.add(m); }
  return medlemmer.filter((m) => m.tailnetLogin && adresser.has(m.tailnetLogin.trim().toLowerCase())).map((m) => m.id);
}

function fraKalender(k: KalenderLaesning, medlemmer: readonly Medlem[]): FaellesPost[] {
  const ud: FaellesPost[] = [];
  const ejer = k.ejer && medlemmer.some((m) => m.id === k.ejer) ? k.ejer : null;
  const dage = erObj(k.data) && Array.isArray(k.data['days']) ? k.data['days'] : [];
  for (const d of dage) {
    for (const e of erObj(d) && Array.isArray(d['events']) ? d['events'] : []) {
      if (!erObj(e)) continue;
      const titel = s(e['title'], 120); const start = s(e['start'], 40);
      if (!titel || !start) continue;
      const heldag = e['all_day'] === true;
      const p: FaellesPost = { id: s(e['id'], 200) || `${titel}|${start}`, titel, start, heldag, hvem: [], kilde: 'kalender' };
      const slut = s(e['end'], 40); if (slut) p.slut = slut;
      const sted = s(e['location'], 120); if (sted) p.sted = sted;
      const hvem = medlemmerI(e, medlemmer);
      p.hvem = hvem.length ? hvem : ejer ? [ejer] : [];
      ud.push(p);
    }
  }
  return ud;
}

/** The week `uge` (YYYY-MM-DD dates), one entry per date in that order; within a day all-day first, then by start. */
export function faellesUge(medlemmer: readonly Medlem[], kilder: FaellesKilder, uge: readonly string[]): FaellesDag[] {
  const orden = (id: string): number => medlemmer.findIndex((m) => m.id === id);
  const efterId = new Map<string, FaellesPost>();
  for (const k of kilder.kalendere) {
    if (k.zone !== 'husstand') continue;
    for (const p of fraKalender(k, medlemmer)) {
      const tidligere = efterId.get(p.id);
      if (!tidligere) { efterId.set(p.id, p); continue; }
      tidligere.hvem = [...new Set([...tidligere.hvem, ...p.hvem])].sort((a, b) => orden(a) - orden(b));
    }
  }
  const poster: FaellesPost[] = [...efterId.values()];
  for (const r of kilder.ressourcer) {
    for (const b of r.kalender) poster.push({ id: `booking:${b.id}`, titel: `${r.navn}: ${b.titel}`.slice(0, 120), start: b.start, slut: b.slut, heldag: false, hvem: [b.af], kilde: 'booking' });
  }
  for (const f of kilder.forespoergsler) {
    const t = aftaleTid(f);
    if (!t) continue;
    poster.push({ id: `aftale:${f.id}`, titel: f.titel.slice(0, 120), start: t.start, slut: t.slut, heldag: false, hvem: [f.fra, f.til], kilde: 'aftale' });
  }
  const tid = (p: FaellesPost): number => (p.heldag ? -Infinity : Date.parse(p.start));
  return uge.map((dato) => ({
    dato,
    poster: poster.filter((p) => dagAf(p.start, p.heldag) === dato).sort((a, b) => tid(a) - tid(b)).slice(0, MAX_PER_DAG),
  }));
}
