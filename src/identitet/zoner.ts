// Data zones (KC-0117, spec §5): everything Clawco knows belongs to one of
// privat · arbejde · husstand. Not the weather bands of the day picture —
// those are `ZONER`/`Zone` in src/shell/visuel.ts.
//
// Invariants: an element's zone equals the zone of every source it was built
// from (a run reads one zone; an element naming another zone is rejected, never
// relabelled), and no element is shown to a person `synligFor` denies. The
// policy layer (KC-0122) turns `blandetZoner` into the "no cross-zone copy" rule.

import type { Person } from './husstand.ts';
import { kan } from './roller.ts';
import type { LogEntry } from '../store/types.ts';

export const DATAZONER = ['privat', 'arbejde', 'husstand'] as const;
export type DataZone = (typeof DATAZONER)[number];

// The store spells the union out (it imports nothing from src/); these two lines fail typecheck if they drift.
const _logHarAlle: readonly NonNullable<LogEntry['zone']>[] = DATAZONER;
const _logHarIngenAndre = (z: NonNullable<LogEntry['zone']>): DataZone => z;
void _logHarAlle; void _logHarIngenAndre;

/** Danish chip text (UI copy). */
export const ZONE_NAVN: Record<DataZone, string> = { privat: 'Privat', arbejde: 'Arbejde', husstand: 'Husstand' };

/** What every element carries: its zone and, for privat/arbejde, whose it is. Absent = old data (see zoneAf / synligFor). */
export type Zoneret = { zone?: DataZone; ejer?: string };

export class ZoneFejl extends Error {}

export const erDataZone = (v: unknown): v is DataZone => typeof v === 'string' && (DATAZONER as readonly string[]).includes(v);

/** The element's zone; a missing or unknown stored zone reads as the most private one. */
export const zoneAf = (el: Zoneret): DataZone => (erDataZone(el.zone) ? el.zone : 'privat');

/**
 * The zone of an element an agent returned, read in a run over `korsel` (the one zone that run read).
 * Absent → `korsel`. Unknown, or a zone the run did not read → ZoneFejl (the room turns it into its schema error).
 */
export function zoneFra(raw: unknown, korsel: DataZone): DataZone {
  if (raw === undefined || raw === null) return korsel;
  if (!erDataZone(raw)) throw new ZoneFejl(`ukendt zone: ${String(raw).slice(0, 40)}`);
  if (raw !== korsel) throw new ZoneFejl(`elementet siger zone ${raw}, men kørslen læste ${korsel}`);
  return raw;
}

/** True when the sources span more than one zone. */
export const blandetZoner = (kilder: readonly DataZone[]): boolean => new Set(kilder).size > 1;

/**
 * Whether `person` may see `el`. husstand: every role with `se-husstand` (roller.ts: not a guest). privat/arbejde: only its ejer; an element with no ejer
 * recorded (written before households existed) belongs to the household's owner.
 */
export function synligFor(person: Person, el: Zoneret): boolean {
  const zone = zoneAf(el);
  if (zone === 'husstand') return kan(person.rolle, 'se-husstand');
  return el.ejer ? el.ejer === person.id : person.rolle === 'ejer';
}
