// KC-0146 (D7): the user's folder — the one place that knows what Clawco keeps
// about the user: the contents of $KC_DATA_DIR plus Clawco's own vault folder
// <vault>/Clawco/. The export ("Hent alt"), the page's tally and the delete
// ("Slet alt") read it from here; KC-0159 (backup) imports the same list so
// export and backup never disagree. Plain functions, no HTTP: Sky (KC-0206) can
// run them inside a tenant.
//
// Invariants: a symlink is never followed (a link is not the user's data, and
// following one could leave the roots); the vault root, the people register
// and the inbox are never part of the data dir's walk even when they sit inside
// it (dev and the test world keep the vault in the data dir) — the user's own
// notes are not Clawco's; secrets never enter the list (erHemmelig).

import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { SKJULTE_DATAFILER } from '../hemmeligheder/lager-fil.ts';
import { KILDE_HEMMELIGHEDER } from '../kilder/hemmeligheder.ts';
import { STRUKTUR } from '../kilder/noter/vault.ts';
import { lavZip } from './zip.ts';

export type Brugermappe = {
  dataDir: string;
  /** The vault root (kilder/noter/stier.ts); its Clawco/ folder is the user's, the rest is not touched. */
  vaultDir?: string;
  /** More folders that are the user's own notes (people register, inbox): never listed or deleted from the data dir. */
  beskyt?: readonly string[];
};

/** One file of the user's folder: its path in the zip (`data/…`, `vault/Clawco/…`, `personer/…`), where it is, its size. */
export type Fil = { sti: string; abs: string; bytes: number };

export type RumOpgoer = { id: string; log: number; chat: number; bytes: number; filer: string[] };
export type Opgoer = {
  rum: RumOpgoer[];
  /** The files in <vault>/Clawco/, as zip paths. */
  clawco: string[];
  /** Other files in the data dir (connections, settings, the audit log …). */
  andre: number;
  /** Files with keys or logins in the data dir: never exported, but deleted by Slet alt. */
  noegler: number;
  bytes: number;
};

/** Words in a file or folder name that mark a secret (English and Danish). */
const HEMMELIGE_ORD = /key|token|secret|noegle|nøgle|hemmelig|password|adgangskode/i;
/** `.env`, `.env.local`, `clawco.env`. */
const ENV = /^\.env(\..*)?$|\.env$/i;

/** Whether a file or folder name holds a secret: kept out of the export (and of any user-visible file list). */
export function erHemmelig(navn: string): boolean {
  const n = navn.normalize('NFC');
  return ENV.test(n) || HEMMELIGE_ORD.test(n) || SKJULTE_DATAFILER.includes(n) || n === KILDE_HEMMELIGHEDER;
}

const aegte = async (p: string): Promise<string> => { try { return await realpath(p); } catch { return path.resolve(p); } };
const indenfor = (rod: string, p: string): boolean => p === rod || p.startsWith(rod + path.sep);

type Fund = { filer: Fil[]; hemmelige: number };

/** What `gaa` hides: by default every secret (erHemmelig); `kunEnv` only `.env` files (a vault holds notes); `alle` nothing (KC-0159 --med-noegler). */
type Skjul = { kunEnv?: boolean; alle?: boolean };

/** Every regular file under `dir` (zip prefix `praefiks`), skipping symlinks, `beskyt` and secrets (counted). */
async function gaa(dir: string, praefiks: string, beskyt: readonly string[], fund: Fund, hemmelig = false, skjul: Skjul = {}): Promise<void> {
  let poster;
  try { poster = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const p of poster) {
    const abs = path.join(dir, p.name);
    if (p.isSymbolicLink() || beskyt.includes(abs)) continue;
    const skjult = !skjul.alle && (hemmelig || (skjul.kunEnv ? ENV.test(p.name.normalize('NFC')) : erHemmelig(p.name)));
    if (p.isDirectory()) await gaa(abs, `${praefiks}/${p.name}`, beskyt, fund, skjult, skjul);
    else if (p.isFile()) {
      if (skjult) { fund.hemmelige += 1; continue; }
      fund.filer.push({ sti: `${praefiks}/${p.name}`.normalize('NFC'), abs, bytes: (await lstat(abs)).size });
    }
  }
}

/** The folders that are never part of the data dir's walk, resolved: the vault root and `beskyt`. */
async function beskyttede(m: Brugermappe): Promise<string[]> {
  return Promise.all([m.vaultDir, ...(m.beskyt ?? [])].filter((p): p is string => !!p && !!p.trim()).map(aegte));
}

/** <vault>/Clawco as a real folder, or null (no vault, missing, a file, or a symlink — never followed). */
export async function clawcoMappe(vaultDir: string | undefined): Promise<string | null> {
  if (!vaultDir?.trim()) return null;
  const rod = await aegte(vaultDir);
  const mappe = path.join(rod, STRUKTUR.clawco);
  const s = await lstat(mappe).catch(() => null);
  return s?.isDirectory() ? mappe : null;
}

async function find(m: Brugermappe): Promise<Fund> {
  const fund: Fund = { filer: [], hemmelige: 0 };
  const data = await aegte(m.dataDir);
  const beskyt = await beskyttede(m);
  // A data dir that is itself the vault holds the user's notes: only Clawco/ below is Clawco's.
  if ((await lstat(data).catch(() => null))?.isDirectory() && !beskyt.includes(data)) await gaa(data, 'data', beskyt, fund);
  const clawco = await clawcoMappe(m.vaultDir);
  if (clawco) await gaa(clawco, `vault/${STRUKTUR.clawco}`, [], fund);
  return fund;
}

const sorter = (a: Fil, b: Fil): number => (a.sti < b.sti ? -1 : a.sti > b.sti ? 1 : 0);

/**
 * The files of the user's folder, sorted by zip path. `personer`: the people register files the page shows
 * (relative to `dir`), added under `personer/` — read-only copies; only regular files inside `dir` that exist.
 */
export async function listBrugerfiler(m: Brugermappe, o: { personer?: { dir: string; filer: readonly string[] } } = {}): Promise<Fil[]> {
  const { filer } = await find(m);
  if (o.personer?.dir) {
    const rod = await aegte(o.personer.dir);
    for (const rel of o.personer.filer) {
      const dele = rel.split(/[\\/]+/).filter((d) => d && d !== '.');
      if (!dele.length || dele.includes('..') || path.isAbsolute(rel) || dele.some(erHemmelig)) continue;
      const abs = path.join(rod, ...dele);
      const s = await lstat(abs).catch(() => null);
      if (!s?.isFile() || !indenfor(rod, await aegte(abs))) continue;
      filer.push({ sti: `personer/${dele.join('/')}`.normalize('NFC'), abs, bytes: s.size });
    }
  }
  return filer.sort(sorter);
}

async function linjer(fil: string): Promise<number> {
  try { return (await readFile(fil, 'utf8')).split('\n').filter((l) => l.trim() !== '').length; } catch { return 0; }
}

/** The page's tally of what Clawco keeps: per room (log and chat lines, bytes), Clawco's vault files, the rest. */
export async function opgoer(m: Brugermappe): Promise<Opgoer> {
  const { filer, hemmelige } = await find(m);
  const rum = new Map<string, RumOpgoer>();
  let andre = 0;
  const clawco: string[] = [];
  for (const f of filer.sort(sorter)) {
    const r = /^data\/rum\/([^/]+)\/(.+)$/.exec(f.sti);
    if (r) {
      const id = r[1] as string;
      const post = rum.get(id) ?? { id, log: 0, chat: 0, bytes: 0, filer: [] };
      post.bytes += f.bytes;
      post.filer.push(f.sti);
      if (r[2] === 'log.jsonl') post.log = await linjer(f.abs);
      if (r[2] === 'chat.jsonl') post.chat = await linjer(f.abs);
      rum.set(id, post);
    } else if (f.sti.startsWith('vault/')) clawco.push(f.sti);
    else andre += 1;
  }
  return { rum: [...rum.values()], clawco, andre, noegler: hemmelige, bytes: filer.reduce((s, f) => s + f.bytes, 0) };
}

/** "Hent alt": the zip of listBrugerfiler (same arguments). A file that is gone by the time it is read is left out. */
export async function eksporter(m: Brugermappe, o: Parameters<typeof listBrugerfiler>[1] = {}, tid?: Date): Promise<Buffer> {
  const ud: { navn: string; data: Buffer }[] = [];
  for (const f of await listBrugerfiler(m, o)) {
    try { ud.push({ navn: f.sti, data: await readFile(f.abs) }); } catch { /* removed meanwhile */ }
  }
  return lavZip(ud, tid ? { tid } : {});
}

/** Where the vault stands in a backup: `med` (in it), `ikke-lokal` (on a network mount, left out), `ingen` (no vault folder). */
export type VaultStatus = { status: 'med' | 'ikke-lokal' | 'ingen'; rod?: string; sti?: string };

/**
 * KC-0159: the files a backup copies — the same folder as the export, one list. Differences, on purpose: the whole
 * data dir (also the vault when it sits inside it) and the whole local vault, not only <vault>/Clawco/; secrets
 * are left out and counted (`udeladt`) unless `medNoegler`. A vault on a network mount (`vaultFjern`) stays out
 * unless `medVault`. `envFil`: the install's settings file, and `noeglefil` (KC-0245): the key file that opens
 * hemmeligheder.enc (KC_HEMMELIGHEDER_FIL, outside the data dir), both only with `medNoegler`, under `miljoe/`.
 * Zip-path style prefixes: `data/…`, `vault/…`, `miljoe/…`; symlinks are never followed.
 */
export async function listSikkerhedskopi(
  m: { dataDir: string; vaultDir?: string },
  o: { medNoegler?: boolean; medVault?: boolean; vaultFjern?: boolean; envFil?: string; noeglefil?: string } = {},
): Promise<{ filer: Fil[]; udeladt: number; vault: VaultStatus }> {
  const fund: Fund = { filer: [], hemmelige: 0 };
  const alle = o.medNoegler === true;
  const data = await aegte(m.dataDir);
  const vaultRodReel = m.vaultDir?.trim() && (await lstat(m.vaultDir).catch(() => null))?.isDirectory() ? await aegte(m.vaultDir) : '';
  const vault: VaultStatus = vaultRodReel ? { status: 'med', rod: vaultRodReel } : { status: 'ingen' };
  const ude = !!vaultRodReel && o.vaultFjern === true && o.medVault !== true;
  if (ude) vault.status = 'ikke-lokal';
  const inde = !!vaultRodReel && indenfor(data, vaultRodReel) && vaultRodReel !== data;
  if (inde) vault.sti = `data/${path.relative(data, vaultRodReel).split(path.sep).join('/')}`.normalize('NFC');
  // The data dir is walked without the vault (a vault inside it is walked below under its own rule: it holds notes,
  // so only .env files are hidden there; a word like "key" in a note's name is no reason to leave the note out).
  if ((await lstat(data).catch(() => null))?.isDirectory()) {
    await gaa(data, 'data', inde ? [vaultRodReel] : [], fund, false, alle ? { alle } : {});
  }
  if (vaultRodReel && !ude && vaultRodReel !== data) {
    vault.sti ??= 'vault';
    await gaa(vaultRodReel, vault.sti, [], fund, false, alle ? { alle } : { kunEnv: true });
  }
  for (const fil of alle ? [o.envFil, o.noeglefil] : []) {
    if (!fil?.trim()) continue;
    const env = await aegte(fil);
    const s = await lstat(env).catch(() => null);
    if (s?.isFile() && !indenfor(data, env) && !(vaultRodReel && indenfor(vaultRodReel, env))) {
      fund.filer.push({ sti: `miljoe/${path.basename(env)}`.normalize('NFC'), abs: env, bytes: s.size });
    }
  }
  return { filer: fund.filer.sort(sorter), udeladt: fund.hemmelige, vault };
}
