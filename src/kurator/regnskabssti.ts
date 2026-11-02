// KC-0213: where the ledgers live is data, not code. `regnskab.json` in the data dir maps each ledger (`hvor`) to a
// path relative to the vault root; without an entry the ledger is `Clawco/Regnskab/<hvor>.md` under the vault, so a
// product install never writes into folders it did not create. An install whose ledgers already sit at the paths
// the app used before KC-0213 adopts them once (it finds them, writes the map, logs one line) and keeps them.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Regnskabslinje } from '../rooms/hjem/kort.ts';

export type Hvor = Regnskabslinje['hvor'];
export type Regnskabsstier = Record<Hvor, string>;

export const REGNSKAB_FIL = 'regnskab.json';
const HVOR: readonly Hvor[] = ['shelfatlas', 'privat'];

/** The default for every install: inside `<vault>/Clawco/`, the one folder the app owns. */
export const STANDARD_STIER: Regnskabsstier = { shelfatlas: 'Clawco/Regnskab/shelfatlas.md', privat: 'Clawco/Regnskab/privat.md' };

/** The paths before KC-0213 (the reference install's folders), only used to recognise ledgers that already exist there. */
export const AELDRE_STIER: Regnskabsstier = { shelfatlas: '30-Projekter/ShelfAtlas/Regnskab.md', privat: '10-Privat/Økonomi/abonnementer.md' };

/** A relative path that stays inside the vault; anything else (absolute, `..`, empty, NUL) is refused. */
function gyldig(v: unknown): v is string {
  if (typeof v !== 'string' || !v.trim() || v.includes('\0') || path.isAbsolute(v) || path.win32.isAbsolute(v)) return false;
  return !v.split(/[\\/]+/).some((d) => d === '..');
}

/** The map now: the file's entries where valid, the default for the rest (a missing or broken file = all defaults). */
export function laesRegnskabsstier(dataDir: string | undefined): Regnskabsstier {
  let raa: Record<string, unknown> = {};
  if (dataDir) {
    try {
      const j = JSON.parse(readFileSync(path.join(dataDir, REGNSKAB_FIL), 'utf8')) as unknown;
      if (typeof j === 'object' && j !== null) raa = j as Record<string, unknown>;
    } catch { /* absent or unreadable: the defaults */ }
  }
  const ud = { ...STANDARD_STIER };
  for (const h of HVOR) if (gyldig(raa[h])) ud[h] = raa[h].trim().replace(/\\/g, '/');
  return ud;
}

export type Finder = (fil: string) => boolean;
const erFil: Finder = (fil) => { try { return statSync(fil).isFile(); } catch { return false; } };

/**
 * Adopts the old paths when the map is not written yet and a ledger sits at an old path under `rod` while the default
 * file does not exist: then both old paths are written to regnskab.json (the vault is organised that way) and one
 * line is logged. Returns whether it adopted. Nothing is written without a data dir or a vault root.
 */
export function adopterAeldreStier(o: { dataDir: string | undefined; rod: string; finder?: Finder; log?: (linje: string) => void }): boolean {
  if (!o.dataDir || !o.rod) return false;
  const fil = path.join(o.dataDir, REGNSKAB_FIL);
  if (existsSync(fil)) return false;
  const finder = o.finder ?? erFil;
  const abs = (rel: string): string => path.join(o.rod, ...rel.split('/'));
  if (HVOR.some((h) => finder(abs(STANDARD_STIER[h])))) return false;
  if (!HVOR.some((h) => finder(abs(AELDRE_STIER[h])))) return false;
  mkdirSync(o.dataDir, { recursive: true });
  const tmp = `${fil}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(AELDRE_STIER, null, 2) + '\n', 'utf8');
  renameSync(tmp, fil);
  (o.log ?? console.log)(`regnskab: fandt regnskabsfilerne på de hidtidige steder i ${o.rod} og beholder dem (${REGNSKAB_FIL})`);
  return true;
}

/**
 * The absolute ledger file for `hvor`, now: the vault root and the map are read at every call (the user may choose
 * another vault, or edit regnskab.json). Until the map is written each call looks once more for ledgers at the old
 * paths (a vault on a network share may not have been mounted at start). '' when no vault root is known.
 */
export function lavRegnskabsfil(o: { dataDir: string | undefined; rod: () => string; finder?: Finder; log?: (linje: string) => void }): (hvor: Hvor) => string {
  const adopt = (): void => { adopterAeldreStier({ dataDir: o.dataDir, rod: o.rod(), ...(o.finder ? { finder: o.finder } : {}), ...(o.log ? { log: o.log } : {}) }); };
  adopt();
  return (hvor) => {
    const rod = o.rod();
    if (!rod) return '';
    adopt();
    return path.join(rod, ...laesRegnskabsstier(o.dataDir)[hvor].split('/'));
  };
}
