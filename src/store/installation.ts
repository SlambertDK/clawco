// KC-0170: the language an installation speaks before anyone chose one in Start (step 1). English is the product's
// first language (Henrik 2026-10-31: "det er et globalt produkt … engelsk er startsproget"); Henrik's own installation
// predates the language and must stay Danish without a profile. The record is $KC_DATA_DIR/installation.json, written
// once by the composition root at the first start that finds none: a data folder already in use (room state, a
// profile, a household, settings) is an installation from before the language, so Danish; an empty one is new, so
// English. Read, never guessed again: the file is the source of truth from then on. A file that cannot be read is
// left as it is and reads as Danish (fail closed, never destructive). Depends on nothing in src/ outside this folder.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Sprog } from './profil.ts';

export const INSTALLATION_FIL = 'installation.json';

export type Installation = { standardSprog: Sprog; oprettet: string; /** Why the language was chosen: `ny` (an empty folder) or `foer-sproget` (a folder in use before the language existed). */ grund: 'ny' | 'foer-sproget' };

/** Signs that a data folder was in use before the language existed. */
export const FOER_SPROGET = ['rum', 'profil.json', 'husstand.json', 'indstillinger.json', 'kilder.json', 'pause.json', 'tillid'] as const;

const erSprog = (v: unknown): v is Sprog => v === 'da' || v === 'en';

/** The record as stored, `null` when there is none, `'ulaeselig'` when there is one that cannot be read. */
export function laesInstallationsfil(dataDir: string): Installation | null | 'ulaeselig' {
  const fil = path.join(dataDir, INSTALLATION_FIL);
  if (!existsSync(fil)) return null;
  try {
    const o: unknown = JSON.parse(readFileSync(fil, 'utf8'));
    if (typeof o !== 'object' || o === null || !erSprog((o as Record<string, unknown>)['standardSprog'])) return 'ulaeselig';
    const r = o as Record<string, unknown>;
    return { standardSprog: r['standardSprog'] as Sprog, oprettet: typeof r['oprettet'] === 'string' ? r['oprettet'] : '', grund: r['grund'] === 'ny' ? 'ny' : 'foer-sproget' };
  } catch { return 'ulaeselig'; }
}

/** The folder shows an installation from before the language existed. */
export const iBrugFoerSproget = (dataDir: string): boolean => FOER_SPROGET.some((navn) => existsSync(path.join(dataDir, navn)));

/** KC-0246: the language Clawco Sky tells a new tenant's container (KC_SPROG = the owner's choice at sign-up): da or en, else no wish. */
export function sprogFraMiljoe(e: Record<string, string | undefined>): Sprog | null {
  const v = (e['KC_SPROG'] ?? '').trim();
  return v === 'da' || v === 'en' ? v : null;
}

/** KC-0246: Sky seeds husstand.json before the first start (sky/src/fleet/lokal.ts), so that one file alone is not use. */
const iBrugUdoverHusstand = (dataDir: string): boolean => FOER_SPROGET.some((navn) => navn !== 'husstand.json' && existsSync(path.join(dataDir, navn)));

/**
 * The installation's record, written at the first start that finds none (atomically: tmp file + rename). An unreadable
 * record is not touched and reads as Danish. `onsket` (KC-0246, KC_SPROG under Sky) is the language a NEW installation
 * starts in instead of English: only while no record exists and the folder shows no use (but a seeded household); a folder
 * in use keeps Danish whatever is wished, and a record once written is never changed by it.
 */
export function laesInstallation(dataDir: string, nu: () => Date = () => new Date(), onsket: Sprog | null = null): Installation {
  const gemt = laesInstallationsfil(dataDir);
  if (gemt === 'ulaeselig') return { standardSprog: 'da', oprettet: '', grund: 'foer-sproget' };
  if (gemt) return gemt;
  const ny: Installation = (onsket ? iBrugUdoverHusstand(dataDir) : iBrugFoerSproget(dataDir))
    ? { standardSprog: 'da', oprettet: nu().toISOString(), grund: 'foer-sproget' }
    : { standardSprog: onsket ?? 'en', oprettet: nu().toISOString(), grund: 'ny' };
  mkdirSync(dataDir, { recursive: true });
  const fil = path.join(dataDir, INSTALLATION_FIL);
  const tmp = `${fil}.tmp-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(ny, null, 2)}\n`, 'utf8');
  renameSync(tmp, fil);
  return ny;
}
