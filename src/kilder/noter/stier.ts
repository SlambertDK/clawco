// KC-0136, derive don't mirror (§0 r6): where the inbox and the people register
// are. The source of truth is the vault chosen on the notes card (the notes
// connector's folder in kilder.json); KC_VAULT_INBOX and KC_PEOPLE_DIR still
// override (Henrik's NAS vault, read by the legacy adapter kira-noter). The
// rooms that save to the vault (Skrive, Nyheder) and the people rule on every
// run read the paths from here, through createApp.

import { statSync } from 'node:fs';
import path from 'node:path';
import { KonfigFejl, laesKonfigSync, type KilderKonfig } from '../register.ts';
import { STRUKTUR } from './vault.ts';

/** The notes connector's id (the one kilder.json post the vault is read from). */
export const NOTER_ID = 'noter';

export type VaultStier = { rod: string; indbakke: string; personer: string };
type Miljoe = { KC_VAULT_INBOX?: string | undefined; KC_PEOPLE_DIR?: string | undefined };

const under = (rod: string, rel: string): string => (rod ? path.join(rod, ...rel.split('/')) : '');

/** The paths for a chosen vault root `valgt` ('' = none); a set env var wins over the derived path. */
export function noterStier(env: Miljoe, valgt: string): VaultStier {
  return {
    rod: valgt,
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
    const s = noterStier(o.env, laes());
    return s.indbakke || !o.standardIndbakke ? s : { ...s, indbakke: o.standardIndbakke };
  };
}
