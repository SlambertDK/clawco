// The booking intent (KC-0151): Hermes answers a sentence like "jeg skal bruge den store bil lørdag 10 til 15"
// with one fenced block {"booking": {ressource, start, slut, titel}}. Here that block is read down to its four
// fields and checked against the stored resources; it never books anything — the room turns it into a card, and
// only a person's tap on the card books. Pure: no I/O, the clock passed in.

import { koebenhavnTilIso } from '../shell/tid.ts';
import { husstandTekst } from './tekster.ts';
import type { PersonId, Ressource, Tidsrum } from './ressource.ts';

/** How far ahead a booking may be asked for, and how long one may last. */
export const MAX_FREM_DAGE = 14;
export const MAX_VARIGHED_DAGE = 7;
/** A draft stays on screen this long (and never past its own start). */
export const UDKAST_LEVETID_MS = 24 * 3600_000;

/** What Hermes wrote, as plain strings: nothing is trusted yet. */
export type BookingOensker = { ressource: string; start: string; slut: string; titel: string };

/** A booking waiting for its person's tap: stored beside the state, never in a calendar. */
export type BookingUdkast = { id: string; af: PersonId; ressourceId: string; start: string; slut: string; titel: string; oprettet: string };

export type Valideret = { ok: true; r: Ressource; tid: Tidsrum; titel: string };
export type Afvist = { ok: false; hvorfor: string };

const ren = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim() : '');

/** Hermes' answer → the four fields of its booking block (every other key dropped); null when there is no such block. */
export function parseBookingSvar(svar: string): BookingOensker | null {
  const blok = /```(?:json)?\s*([\s\S]*?)```/i.exec(svar)?.[1];
  if (!blok) return null;
  let raw: unknown;
  try { raw = JSON.parse(blok); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const b = (raw as Record<string, unknown>)['booking'];
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  return { ressource: ren(o['ressource']).slice(0, 80), start: ren(o['start']).slice(0, 40), slut: ren(o['slut']).slice(0, 40), titel: ren(o['titel']) };
}

const MED_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO time with an explicit offset, or Copenhagen wall time ("2026-11-07T10:00"), as an ISO instant; null otherwise. */
function tidAf(v: string): string | null {
  if (MED_ZONE.test(v)) { const ms = Date.parse(v); return Number.isNaN(ms) ? null : new Date(ms).toISOString(); }
  return koebenhavnTilIso(v);
}

const afvist = (hvorfor: string): Afvist => ({ ok: false, hvorfor });

/** The wish checked against the stored resources and the clock: a known resource, readable times, start before end, in the future, at most 14 days ahead. */
export function valider(o: BookingOensker, ressourcer: readonly Ressource[], nu: Date): Valideret | Afvist {
  const T = husstandTekst();
  const r = ressourcer.find((x) => x.id === o.ressource);
  if (!r) return afvist(T.fejl.tingFindesIkke);
  const start = tidAf(o.start), slut = tidAf(o.slut);
  if (!start || !slut) return afvist(T.fejl.kunneIkkeLaese);
  if (Date.parse(slut) <= Date.parse(start)) return afvist(T.fejl.slutEfterStart);
  if (Date.parse(start) <= nu.getTime()) return afvist(T.fejl.tidGaaet);
  if (Date.parse(start) > nu.getTime() + MAX_FREM_DAGE * 86_400_000) return afvist(T.fejl.maxFrem(MAX_FREM_DAGE));
  if (Date.parse(slut) - Date.parse(start) > MAX_VARIGHED_DAGE * 86_400_000) return afvist(T.fejl.forLang(MAX_VARIGHED_DAGE));
  return { ok: true, r, tid: { start, slut }, titel: ren(o.titel).slice(0, 200) || T.turTitel };
}

/** A draft shows until its start, and for 24 hours. */
export const udkastAabent = (u: Pick<BookingUdkast, 'start' | 'oprettet'>, nu: Date): boolean =>
  Date.parse(u.start) > nu.getTime() && nu.getTime() - Date.parse(u.oprettet) < UDKAST_LEVETID_MS;
