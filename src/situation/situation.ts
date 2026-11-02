// KC-0114: the situation engine. At any instant exactly one situation is
// active: a meeting that is on right now beats the clock; otherwise Copenhagen
// wall time decides (morgen until 10.00, dagen until 17.00 — Senere's "I aften"
// cut-off, KC-0096 — then aften). Pure: the server assembles the input, and
// calendar data it cannot read degrades to the clock, never throws.

import type { Situation } from './regler.ts';

/** A meeting is the situation from this many minutes before its start (KC-0030). */
export const FORBERED_MINUTTER = 10;

/** One calendar event of today, with the univers (slug) it belongs to. */
export type KalenderMoede = { id: string; start: string; slut: string; univers: string };

/** `moeder` is whatever the calendar gave; entries that are not a readable KalenderMoede are skipped. */
export type SituationInput = { now: Date; moeder: readonly unknown[] };

const timeKbh = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hourCycle: 'h23', hour: '2-digit' });

function laesbar(m: unknown): m is KalenderMoede {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['univers'] === 'string' && typeof o['start'] === 'string' && typeof o['slut'] === 'string'
    && !Number.isNaN(Date.parse(o['start'])) && !Number.isNaN(Date.parse(o['slut']));
}

/** The meeting active at `now` (earliest start wins), or null. */
export function aktivtMoede(moeder: readonly unknown[], now: Date): KalenderMoede | null {
  const t = now.getTime();
  if (Number.isNaN(t) || !Array.isArray(moeder)) return null;
  let bedst: KalenderMoede | null = null;
  for (const m of moeder) {
    if (!laesbar(m)) continue;
    const start = Date.parse(m.start);
    if (t < start - FORBERED_MINUTTER * 60_000 || t >= Date.parse(m.slut)) continue;
    if (!bedst || start < Date.parse(bedst.start)) bedst = m;
  }
  return bedst;
}

function urets(now: Date): Situation {
  if (Number.isNaN(now.getTime())) return 'dagen';
  const time = Number(timeKbh.format(now));
  return time < 10 ? 'morgen' : time < 17 ? 'dagen' : 'aften';
}

export function vaelgSituation(i: SituationInput): { situation: Situation; moede: KalenderMoede | null } {
  const moede = aktivtMoede(i.moeder, i.now);
  return moede ? { situation: 'moede', moede } : { situation: urets(i.now), moede: null };
}
