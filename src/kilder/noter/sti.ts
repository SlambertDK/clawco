// KC-0136: path safety for the notes connector. Every path Clawco reads or
// writes in a vault goes through `iRod`: resolved under the root, refused if it
// escapes by `..`, by being absolute, or through a symlink that leads outside
// (also a dangling one, which could be made to). A person's file name goes
// through `filnavn`: one safe segment, NFC, portable to an SMB/NAS share.

import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { KildeFejl } from '../types.ts';
import { noterTekst } from './tekster.ts';

const KONTROL = /[\u0000-\u001f\u007f]/;
/** Characters a file name on a NAS share or a Windows/Mac sync folder cannot carry. */
const UPORTABEL = /[/\\:*?"<>|]/;
const NAVN_MAKS = 120;

const indenfor = (rod: string, p: string): boolean => p === rod || p.startsWith(rod + path.sep);

async function findes(p: string): Promise<boolean> {
  try { await lstat(p); return true; } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** The vault root itself, resolved (symlinks followed). A missing root is a 409: the folder cannot be found. */
export async function rigtigRod(rod: string): Promise<string> {
  try { return await realpath(path.resolve(rod)); } catch { throw new KildeFejl(409, noterTekst().mappenFindesIkke); }
}

/** `rel` (relative, `/`-separated) as an absolute path under `rod`; a KildeFejl 400 when it would leave the root. */
export async function iRod(rod: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || !rel.trim() || KONTROL.test(rel)) throw new KildeFejl(400, noterTekst().ugyldigSti);
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new KildeFejl(400, noterTekst().stiIMappen);
  const dele = rel.split(/[\\/]+/).filter((d) => d && d !== '.');
  if (!dele.length || dele.includes('..')) throw new KildeFejl(400, noterTekst().stiIMappen);
  const r = await rigtigRod(rod);
  // The deepest part that exists decides: its real path must stay under the root; the rest is appended.
  for (let i = dele.length; i > 0; i -= 1) {
    const p = path.join(r, ...dele.slice(0, i));
    if (!(await findes(p))) continue;
    let aegte: string;
    try { aegte = await realpath(p); } catch { throw new KildeFejl(400, noterTekst().stiUd); }
    if (!indenfor(r, aegte)) throw new KildeFejl(400, noterTekst().stiUd);
    return path.join(aegte, ...dele.slice(i));
  }
  return path.join(r, ...dele);
}

/** A person's name as a file name: trimmed, NFC, ≤ 120 characters, one portable segment; else a KildeFejl 400. */
export function filnavn(navn: string): string {
  const n = typeof navn === 'string' ? navn.normalize('NFC').trim() : '';
  if (!n || n.length > NAVN_MAKS || KONTROL.test(n) || UPORTABEL.test(n) || n.startsWith('.')) throw new KildeFejl(400, noterTekst().ugyldigtFilnavn);
  return n;
}
