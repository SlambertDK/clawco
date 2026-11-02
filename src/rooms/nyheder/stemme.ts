// The spoken view of Nyheder (KC-0015): the five lines as the résumé and the
// forslag that still have an open handling as decisions.

import type { LogEntry } from '../../store/types.ts';
import type { StemmePunkt, StemmeRum } from '../../stemme/types.ts';
import { saetning } from '../../stemme/tale.ts';
import { senesteResultater } from '../../shell/log.ts';
import type { NyhederState } from './schema.ts';
import { nyhederTekst } from './tekster.ts';

export function stemmeNyheder(state: NyhederState | null, log: LogEntry[]): StemmeRum {
  if (!state) return { rum: 'nyheder', resume: nyhederTekst().stemme.ikkeBygget, punkter: [] };
  const resultater = senesteResultater(log);
  const punkter: StemmePunkt[] = [];
  for (const f of state.forslag) {
    if (!f.handling || resultater.has(f.handling.id)) continue;
    punkter.push({ id: f.id, sig: saetning(f.tekst), valg: [{ id: f.handling.id, label: f.handling.label }] });
  }
  return { rum: 'nyheder', resume: state.femLinjer.map(saetning).filter(Boolean).join(' '), punkter };
}
