// KC-0203: the two monthly prices the day-14 question quotes, read from the one price file (config/priser.json,
// KC-0190; the image carries config/). Amounts there are whole øre. Unreadable or odd = null: the question is left out,
// a price is never typed here (AGENTS §0 r6). The tenant reads only the two monthly DKK amounts; the rest of the file is Sky's.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BETA_PRISER_FIL = fileURLToPath(new URL('../../config/priser.json', import.meta.url));
/** Monthly kroner (not øre) of the two plans. */
export type BetaPriser = { solo: number; husstand: number };

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function maanedligKroner(planer: Record<string, unknown>, id: string): number | null {
  const p = planer[id];
  const m = erObj(p) && erObj(p['maanedlig']) ? p['maanedlig']['dkk'] : undefined;
  return typeof m === 'number' && Number.isInteger(m) && m > 0 ? m / 100 : null;
}

export async function laesBetaPriser(fil: string = BETA_PRISER_FIL): Promise<BetaPriser | null> {
  let raa: unknown;
  try { raa = JSON.parse(await readFile(fil, 'utf8')); } catch { return null; }
  if (!erObj(raa) || !erObj(raa['planer'])) return null;
  const solo = maanedligKroner(raa['planer'], 'sky-solo');
  const husstand = maanedligKroner(raa['planer'], 'sky-husstand');
  return solo !== null && husstand !== null ? { solo, husstand } : null;
}
