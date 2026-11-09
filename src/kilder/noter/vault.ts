// KC-0136: the notes folder's two setups and the vault detection (spec §3 step
// 4, D7). A new vault gets the inbox, the people register and Clawco's own
// folder (with the profile note); an existing vault gets only the folders it
// lacks — Clawco never edits, moves or deletes a note it did not create.
// Detection lists Obsidian vaults (a folder holding `.obsidian/`) under a fixed
// list of candidate roots to depth 3, reading directory names only: no file is
// ever opened, and nothing outside the list is scanned.

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { KildeFejl } from '../types.ts';
import { noterTekst } from './tekster.ts';
import { iRod } from './sti.ts';

/** The folders Clawco needs in a vault, relative to its root. */
export const STRUKTUR = { indbakke: '00-Indbakke', personer: '40-Mennesker/People', clawco: 'Clawco' } as const;
/** The profile note (KC-0129 writes it through profil.ts). */
export const PROFIL = 'Clawco/Om mig.md';
export const PROFIL_SKABELON = '# Om mig\n\nSkriv her, hvad Clawco skal vide om dig. Det er en almindelig tekstfil, som du selv kan rette.\n';
/** Where a new vault goes unless the user picks another folder. */
export const NY_VAULT = path.join('Clawco', 'Vault');

const MAPPER = [STRUKTUR.indbakke, STRUKTUR.personer, STRUKTUR.clawco];
/** Files a folder may hold and still count as empty for a new vault. */
const STOEJ = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const erMappe = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false;

/** The structure folders `rod` lacks, in STRUKTUR order. */
export async function manglerI(rod: string): Promise<string[]> {
  const ud: string[] = [];
  for (const m of MAPPER) if (!(await erMappe(path.join(rod, m)))) ud.push(m);
  return ud;
}

async function tilfoej(rod: string): Promise<string[]> {
  const mangler = await manglerI(rod);
  for (const m of mangler) await mkdir(await iRod(rod, m), { recursive: true });
  return mangler;
}

/**
 * Setup 1, a new vault at `rod`: creates the folder, the structure and the profile note, and returns what it added.
 * A folder that already holds other files is refused (409), unless it is a vault Clawco made (it has Clawco/).
 */
export async function lavNyVault(rod: string): Promise<string[]> {
  const findes = await stat(rod).catch(() => null);
  if (findes && !findes.isDirectory()) throw new KildeFejl(409, noterTekst().filHvorMappen);
  if (findes) {
    const indhold = (await readdir(rod)).filter((n) => !STOEJ.has(n));
    if (indhold.length && !(await erMappe(path.join(rod, STRUKTUR.clawco)))) throw new KildeFejl(409, noterTekst().mappenIkkeTom);
  } else {
    await mkdir(rod, { recursive: true });
  }
  const lagt = await tilfoej(rod);
  try {
    await writeFile(await iRod(rod, PROFIL), PROFIL_SKABELON, { encoding: 'utf8', flag: 'wx' });
    lagt.push(PROFIL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return lagt;
}

/** Setup 2, an existing vault at `rod`: adds only the missing structure folders and returns them. Missing folder → 409. */
export async function adopterVault(rod: string): Promise<string[]> {
  if (!(await erMappe(rod))) throw new KildeFejl(409, noterTekst().mappenFindesIkke);
  return tilfoej(rod);
}

/** KC-0284: where compose.noter.yaml mounts a vault folder from the host into the container (absent anywhere else, then skipped). */
const DOCKER_NOTER = '/noter';

/** The fixed roots detection may look under, per platform (Linux equivalents include a Danish Dokumenter). */
export function kandidatRoedder(hjem: string, platform: NodeJS.Platform | string): string[] {
  const i = (...d: string[]): string => path.join(hjem, ...d);
  return platform === 'darwin'
    ? [hjem, i('Documents'), i('Obsidian'), i('Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents')]
    : [hjem, i('Documents'), i('Dokumenter'), i('Obsidian'), DOCKER_NOTER];
}

type LaesMappe = (p: string, o: { withFileTypes: true }) => Promise<Dirent[]>;
/** Folders never descended into from a root (big, never a vault; the iCloud vaults have their own root). */
const SPRING_OVER = new Set(['Library', 'node_modules', 'AppData']);
const MAKS_MAPPER = 5000;

/** Vault folders under `roedder` at depth ≤ maksDybde (root = 0), sorted. Uses only readdir (`o.fs` for tests). */
export async function findVaults(roedder: readonly string[], o: { maksDybde?: number; fs?: { readdir: LaesMappe } } = {}): Promise<string[]> {
  const maks = o.maksDybde ?? 3;
  const laes: LaesMappe = o.fs?.readdir ?? ((p, x) => readdir(p, x));
  const fundet = new Set<string>();
  const set = new Set<string>();
  const koe: [string, number][] = roedder.map((r) => [path.resolve(r), 0]);
  while (koe.length && set.size < MAKS_MAPPER) {
    const [dir, dybde] = koe.shift() as [string, number];
    if (set.has(dir)) continue;
    set.add(dir);
    let poster: Dirent[];
    try { poster = await laes(dir, { withFileTypes: true }); } catch { continue; }
    if (poster.some((p) => p.name === '.obsidian' && p.isDirectory())) { fundet.add(dir); continue; }
    if (dybde >= maks) continue;
    for (const p of poster) {
      // isDirectory() is false for a symlink: links are never followed.
      if (p.isDirectory() && !p.name.startsWith('.') && !SPRING_OVER.has(p.name)) koe.push([path.join(dir, p.name), dybde + 1]);
    }
  }
  return [...fundet].sort();
}
