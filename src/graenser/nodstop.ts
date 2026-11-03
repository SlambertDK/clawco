// The kill switch (KC-0124). "Stop alt" cancels every queued run, aborts every
// run in flight (the KC-0118 signal) and holds Clawco on pause until the owner
// starts it again. The pause lives in $KC_DATA_DIR/pause.json (atomic write),
// so a restart while paused stays paused; a file that cannot be read counts as
// paused (fail-safe, §0 r7). Who may: any non-guest stops, only the owner
// resumes (roller.ts: nodstop / genoptag).

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kan } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import type { Kanal, Revisionslog } from './revisionslog.ts';
import { GRAENSER_TEKSTER, graenserTekst } from './tekster.ts';

/** The pause sentence in Danish (the constant a caller compares with); `pauseTekst()` is the one in the language of the request (KC-0170). */
export const PAUSE_TEKST = GRAENSER_TEKSTER.da.pause;
export const pauseTekst = (): string => graenserTekst().pause;

/** A run asked for while Clawco is paused. The server answers 503 with the message. */
export class PauseFejl extends Error {
  constructor() { super(pauseTekst()); this.name = 'PauseFejl'; }
}

/** KC-0275 (B7): a run asked for while the person already has the maximum waiting. The server answers 429 with the message. */
export class KoeFuld extends Error {
  constructor() { super(graenserTekst().koeFuld); this.name = 'KoeFuld'; }
}

/** A person whose role may not stop or resume. The server answers 403 with the message. */
export class NodstopNaegtet extends Error {
  constructor(hvorfor: string) { super(hvorfor); this.name = 'NodstopNaegtet'; }
}

export type PauseTilstand = { pause: boolean; tid: string; person: string };

const IKKE_PAA_PAUSE: PauseTilstand = { pause: false, tid: '', person: '' };

/** pause.json's content; anything that is not exactly the shape reads as paused. */
function fortolk(tekst: string): PauseTilstand {
  let raw: unknown;
  try { raw = JSON.parse(tekst); } catch { return { pause: true, tid: '', person: '' }; }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof o['pause'] !== 'boolean') return { pause: true, tid: '', person: '' };
  return { pause: o['pause'], tid: typeof o['tid'] === 'string' ? o['tid'] : '', person: typeof o['person'] === 'string' ? o['person'] : '' };
}

const fejlkode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

/**
 * The pause, held in memory and persisted to `<dataDir>/pause.json`. Read once at creation (synchronously, so a
 * registry made at start-up is paused before its first run); `genlaes` re-reads it (the test world reseeds the file).
 * Without a data dir it lives in memory only.
 */
export function lavPause(dataDir?: string) {
  const fil = dataDir ? path.join(dataDir, 'pause.json') : '';
  let tilstand: PauseTilstand = IKKE_PAA_PAUSE;
  if (fil) {
    try { tilstand = fortolk(readFileSync(fil, 'utf8')); } catch (err) {
      if (fejlkode(err) !== 'ENOENT') tilstand = { pause: true, tid: '', person: '' };
    }
  }
  async function skriv(t: PauseTilstand): Promise<void> {
    if (!dataDir) return;
    await mkdir(dataDir, { recursive: true });
    const tmp = `${fil}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(t, null, 2), 'utf8');
    await rename(tmp, fil);
  }
  return {
    erPaaPause: (): boolean => tilstand.pause,
    tilstand: (): PauseTilstand => ({ ...tilstand }),
    /** Pausing takes effect in memory at once (nothing may start while the file is written); resuming only after the file says so. */
    async saet(t: PauseTilstand): Promise<void> {
      if (t.pause) { tilstand = { ...t }; await skriv(t); return; }
      await skriv(t);
      tilstand = { ...t };
    },
    async genlaes(): Promise<void> {
      if (!fil) return;
      try { tilstand = fortolk(await readFile(fil, 'utf8')); } catch (err) {
        tilstand = fejlkode(err) === 'ENOENT' ? IKKE_PAA_PAUSE : { pause: true, tid: '', person: '' };
      }
    },
  };
}
export type Pause = ReturnType<typeof lavPause>;

/** What the switch needs from the run registry (runs.ts). */
type Stopbar = { stopAlle(person: string): Promise<number>; genoptag(person: string): Promise<void>; paaPause(): boolean };
type Hvem = { runs: Stopbar; revision?: Revisionslog | undefined; person: Person; kanal: Kanal };

/** "Stop alt": any non-guest. Stops everything, then writes one audit line. Returns how many runs were stopped. */
export async function stopAlt(o: Hvem): Promise<number> {
  if (!kan(o.person.rolle, 'nodstop')) throw new NodstopNaegtet(graenserTekst().rolleKanIkkeStoppe);
  const stoppede = await o.runs.stopAlle(o.person.id);
  await o.revision?.skriv({ person: o.person.id, kanal: o.kanal, rum: 'alle', verb: 'stop', udfald: 'stop', hvorfor: stoppede === 0 ? graenserTekst().stopIntet : stoppede === 1 ? graenserTekst().stopEn : graenserTekst().stopFlere(stoppede), zoner: [], kilde: 'nodstop' });
  return stoppede;
}

/** "Start igen": the owner only. A resume when nothing is paused does nothing and writes nothing. Returns whether it resumed. */
export async function startIgen(o: Hvem): Promise<boolean> {
  if (!kan(o.person.rolle, 'genoptag')) throw new NodstopNaegtet(graenserTekst().kunEjerenStarter);
  if (!o.runs.paaPause()) return false;
  await o.runs.genoptag(o.person.id);
  await o.revision?.skriv({ person: o.person.id, kanal: o.kanal, rum: 'alle', verb: 'genoptag', udfald: 'genoptag', hvorfor: graenserTekst().startIgen, zoner: [], kilde: 'nodstop' });
  return true;
}
