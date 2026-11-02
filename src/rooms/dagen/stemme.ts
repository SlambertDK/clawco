// The spoken view of Dagen (KC-0015): the three lines as the résumé, and the
// anbefaling plus calendar posts that still carry an open handling.

import type { LogEntry } from '../../store/types.ts';
import type { StemmePunkt, StemmeRum } from '../../stemme/types.ts';
import { saetning, taleKlokken } from '../../stemme/tale.ts';
import { senesteResultater } from '../../shell/log.ts';
import type { DagenState, KalenderPost } from './schema.ts';

export function sigAnbefaling(a: DagenState['anbefaling']): string {
  return `Min anbefaling: ${saetning(a.tekst)}`;
}

export function sigKalender(k: KalenderPost): string {
  const hvad = k.handling ? ` Jeg kan: ${saetning(k.handling.label)}` : '';
  return `${saetning(`${taleKlokken(k.tid)} har du ${k.titel}`)}${hvad}`.replace(/^k/, 'K');
}

export function stemmeDagen(state: DagenState | null, log: LogEntry[]): StemmeRum {
  if (!state) return { rum: 'dagen', resume: 'Dagen er ikke bygget endnu.', punkter: [] };
  const resultater = senesteResultater(log);
  const punkter: StemmePunkt[] = [];
  const a = state.anbefaling;
  if (a.handling && !resultater.has(a.handling.id)) {
    punkter.push({ id: a.handling.id, sig: sigAnbefaling(a), valg: [{ id: a.handling.id, label: a.handling.label }] });
  }
  for (const k of state.kalender) {
    if (!k.handling || resultater.has(k.handling.id)) continue;
    punkter.push({ id: k.handling.id, sig: sigKalender(k), valg: [{ id: k.handling.id, label: k.handling.label }] });
  }
  return { rum: 'dagen', resume: state.treLinjer.map(saetning).filter(Boolean).join(' '), punkter };
}
