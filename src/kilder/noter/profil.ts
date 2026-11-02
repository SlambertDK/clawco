// KC-0136: the profile note, Clawco/Om mig.md — what Clawco should know about
// the user, as a plain file they can open and edit. KC-0129 writes it from an
// import. Same rules as the people register: the untouched template a new
// vault starts with may be replaced; anything the user wrote is never
// overwritten (a collision answers with the diff); Fortryd restores exactly
// what was there, and only while the file still holds what was written.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KildeFejl } from '../types.ts';
import { sha256, type Kvittering, type Skrevet } from './personer.ts';
import { iRod } from './sti.ts';
import { noterTekst } from './tekster.ts';
import { PROFIL, PROFIL_SKABELON } from './vault.ts';

const MAKS = 50_000;

async function skrivAtomisk(fil: string, tekst: string): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  await writeFile(tmp, tekst, 'utf8');
  await rename(tmp, fil);
}

/** The profile's text, or null when the vault has none. */
export async function laesProfil(rod: string): Promise<string | null> {
  return readFile(await iRod(rod, PROFIL), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
}

export async function skrivProfil(rod: string, tekst: string): Promise<Skrevet> {
  if (typeof tekst !== 'string' || !tekst.trim() || tekst.length > MAKS || tekst.includes('\u0000')) throw new KildeFejl(400, noterTekst().ugyldigProfiltekst);
  const fil = await iRod(rod, PROFIL);
  const nu = await laesProfil(rod);
  if (nu === tekst) return { udfald: 'uaendret', sti: PROFIL };
  if (nu !== null && nu !== PROFIL_SKABELON) return { udfald: 'kollision', sti: PROFIL, diff: [{ felt: 'tekst', nu, ny: tekst }] };
  if (nu === null) {
    await mkdir(path.dirname(fil), { recursive: true });
    try { await writeFile(fil, tekst, { encoding: 'utf8', flag: 'wx' }); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return skrivProfil(rod, tekst);
      throw err;
    }
    return { udfald: 'oprettet', sti: PROFIL, kvittering: { sti: PROFIL, sha256: sha256(tekst) } };
  }
  await skrivAtomisk(fil, tekst);
  return { udfald: 'oprettet', sti: PROFIL, kvittering: { sti: PROFIL, sha256: sha256(tekst), forrige: nu } };
}

/** Fortryd: puts back what was there (the template) or removes the file — only while it holds what was written. */
export async function fjernProfil(rod: string, k: Kvittering): Promise<boolean> {
  if (k.sti !== PROFIL) throw new KildeFejl(400, noterTekst().kunProfilen);
  const fil = await iRod(rod, PROFIL);
  const nu = await laesProfil(rod);
  if (nu === null || sha256(nu) !== k.sha256) return false;
  if (k.forrige !== undefined) await skrivAtomisk(fil, k.forrige);
  else await unlink(fil);
  return true;
}
