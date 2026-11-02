// KC-0088: the next appointment today, read from Dagen's own state. Dagen's
// `kalender` is the source: it holds today's timed appointments with real
// times and titles as Hermes wrote them. Pure: `now` is injected.

import type { Naeste } from '../../shell/naeste.ts';
import { idagKbh, koebenhavnTilIso } from '../../shell/tid.ts';
import type { DagenState } from './schema.ts';

/** "14.00", "14:00" or "9.30" → "HH:MM"; null for anything else ("hele dagen"). */
function hhmm(tid: string): string | null {
  const m = /^(\d{1,2})[.:](\d{2})$/.exec(tid.trim());
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/** The first of today's appointments that has not ended, or null when nothing is left (or Dagen is from another day). */
export function naesteAftale(state: DagenState, now: Date): Naeste | null {
  const dag = idagKbh(now);
  if (state.dato !== dag) return null;
  const kandidater: Naeste[] = [];
  for (const k of state.kalender) {
    if (k.status === 'aflyst') continue;
    const s = hhmm(k.tid);
    const start = s ? koebenhavnTilIso(`${dag}T${s}`) : null;
    if (!start) continue;
    const e = k.slut ? hhmm(k.slut) : null;
    const slut = e ? koebenhavnTilIso(`${dag}T${e}`) : null;
    // An end that is not after the start (a night shift "21.00–07.00") would run past midnight: treat it as a point in time.
    kandidater.push({ titel: k.titel, start, ...(slut && slut > start ? { slut } : {}) });
  }
  return kandidater
    .filter((n) => Date.parse(n.slut ?? n.start) > now.getTime())
    .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
}
