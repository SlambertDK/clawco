// KC-0136, derive don't mirror (§0 r6): where the inbox and the people register
// are. The source of truth is the vault chosen on the notes card (the notes
// connector's folder in kilder.json); KC_VAULT_INBOX and KC_PEOPLE_DIR still
// override (Henrik's NAS vault, read by the legacy adapter kira-noter). The
// rooms that save to the vault (Skrive, Nyheder) and the people rule on every
// run read the paths from here, through createApp.
// KC-0213: this is also the ONE answer to "where is the vault" (`rod`, §0 r8):
// the rules file, the ledgers, the inbox and the people register all follow it.

import { statSync } from 'node:fs';
import path from 'node:path';
import { KonfigFejl, laesKonfigSync, type KilderKonfig } from '../register.ts';
import { STRUKTUR } from './vault.ts';

/** The notes connector's id (the one kilder.json post the vault is read from). */
export const NOTER_ID = 'noter';

/** `rod`: the one vault root every writer shares; `valgt`: the folder chosen on the notes card ('' = none; the profile note and the import follow it). */
export type VaultStier = { rod: string; valgt: string; indbakke: string; personer: string };
type Miljoe = { KC_VAULT_DIR?: string | undefined; KC_VAULT_INBOX?: string | undefined; KC_PEOPLE_DIR?: string | undefined };

const under = (rod: string, rel: string): string => (rod ? path.join(rod, ...rel.split('/')) : '');

/**
 * The vault root: KC_VAULT_DIR; else the parent of KC_VAULT_INBOX (the inbox is the vault's 00-Indbakke); else the
 * vault chosen on the notes card (`valgt`); else <dataDir>/vault; '' when nothing is known.
 */
export function vaultRodAf(env: Miljoe, valgt: string, dataDir = ''): string {
  const dir = (env.KC_VAULT_DIR ?? '').trim();
  if (dir) return path.resolve(dir);
  const indbakke = (env.KC_VAULT_INBOX ?? '').trim();
  if (indbakke) return path.dirname(path.resolve(indbakke));
  if (valgt) return valgt;
  return dataDir.trim() ? path.resolve(dataDir.trim(), 'vault') : '';
}

/**
 * The paths for a chosen vault root `valgt` ('' = none); a set env var wins over the derived path. `rod` is the
 * vault root every writer shares (vaultRodAf: the env, else the chosen vault, else the data-dir default). The inbox and
 * the people register derive from the chosen vault only, as before: with none chosen they stay '' (no folder).
 */
export function noterStier(env: Miljoe, valgt: string, dataDir = ''): VaultStier {
  return {
    rod: vaultRodAf(env, valgt, dataDir),
    valgt,
    indbakke: (env.KC_VAULT_INBOX ?? '').trim() || under(valgt, STRUKTUR.indbakke),
    personer: (env.KC_PEOPLE_DIR ?? '').trim() || under(valgt, STRUKTUR.personer),
  };
}

/** The folder of the connected notes connector, '' when it is not connected. */
export function valgtVault(k: KilderKonfig): string {
  const p = k.kilder.find((x) => x.id === NOTER_ID && x.status === 'forbundet');
  return (p?.valg['mappe'] ?? '').trim();
}

/**
 * The paths now, for callers that cannot wait (a getter on RoomDeps). Reads kilder.json again only when it changed
 * (mtime); an unreadable kilder.json means no chosen vault (fail closed: the env paths still work). Without a data
 * dir there is no chosen vault. `standardIndbakke`: the inbox when nothing else is known (npm run dev).
 */
export function lavVaultStier(o: { dataDir?: string; env: Miljoe; standardIndbakke?: string }): () => VaultStier {
  let maerke = '';
  let valgt = '';
  let meldt = false;
  const laes = (): string => {
    if (!o.dataDir) return '';
    let nyt: string;
    try { const s = statSync(path.join(o.dataDir, 'kilder.json')); nyt = `${s.ino}:${s.mtimeMs}:${s.size}`; } catch { nyt = 'ingen'; }
    if (nyt === maerke) return valgt;
    maerke = nyt;
    try { valgt = valgtVault(laesKonfigSync(o.dataDir)); meldt = false; } catch (err) {
      if (!(err instanceof KonfigFejl)) throw err;
      if (!meldt) console.error('noter:', err.message, '— ingen valgt mappe');
      meldt = true;
      valgt = '';
    }
    return valgt;
  };
  return () => {
    const s = noterStier(o.env, laes(), o.dataDir ?? '');
    return s.indbakke || !o.standardIndbakke ? s : { ...s, indbakke: o.standardIndbakke };
  };
}
