// The week ahead from Google Calendar via scripts/kalender_uge.py (which uses
// Kiras token script). Trimmed to what Hermes needs.

import { copenhagenTime } from './source.ts';
import type { Runner } from '../mail/source.ts';

/** oprettetAf (KC-0027): the creator's address, for Hermes to tell whose the event is; never rendered. */
export type UgeAftale = { tid: string; slut?: string; titel: string; kalender?: string; sted?: string; oprettetAf?: string };
export type UgeDag = { dato: string; aftaler: UgeAftale[] };
export type TrimmedUge = { hentet: string; dage: UgeDag[]; fejl: string[] };

const MAX_DAGE = 7; const MAX_PER_DAG = 12;
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const s = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function kalenderNavn(cal: string): string {
  if (/@/.test(cal)) return 'Henrik';
  return cal.slice(0, 30);
}

export function trimUge(raw: unknown): TrimmedUge {
  const root = isObj(raw) ? raw : {};
  const dage: UgeDag[] = [];
  for (const d of Array.isArray(root['days']) ? root['days'] : []) {
    if (!isObj(d) || dage.length >= MAX_DAGE) continue;
    const dato = s(d['date'], 10);
    if (!dato) continue;
    const aftaler: UgeAftale[] = [];
    for (const e of Array.isArray(d['events']) ? d['events'] : []) {
      if (!isObj(e) || aftaler.length >= MAX_PER_DAG) continue;
      const titel = s(e['title'], 120);
      if (!titel) continue;
      const allDay = e['all_day'] === true;
      const a: UgeAftale = { tid: allDay ? 'hele dagen' : copenhagenTime(s(e['start'], 40)), titel };
      if (!allDay) { const slut = copenhagenTime(s(e['end'], 40)); if (slut) a.slut = slut; }
      const kal = s(e['calendar'], 80); if (kal) a.kalender = kalenderNavn(kal);
      const af = s(e['creator'], 120); if (af) a.oprettetAf = af;
      const sted = s(e['location'], 120); if (sted) a.sted = sted;
      aftaler.push(a);
    }
    dage.push({ dato, aftaler });
  }
  return { hentet: s(root['generated'], 40), dage, fejl: (Array.isArray(root['errors']) ? root['errors'] : []).map((x) => s(x, 160)).filter(Boolean) };
}

/** null when the script cannot run (no token, no python); the room then has no week. */
export async function readUge(run: Runner, script: string): Promise<TrimmedUge | null> {
  try {
    const r = await run('python3', [script]);
    if (r.code !== 0 || !r.stdout.trim()) return null;
    return trimUge(JSON.parse(r.stdout));
  } catch { return null; }
}
