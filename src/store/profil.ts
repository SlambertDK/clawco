// KC-0126: the user's profile — what they are called, which language Hermes
// answers in, alone or a household — in $KC_DATA_DIR/profil.json (spec §3 step
// 1, D7). Validated on every write and read; the write is atomic (AGENTS §4 r5).
// A file that cannot be read fails closed (ProfilFejl), never "no profile".
// Depends on nothing in src/ outside this folder.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from './atomisk.ts';

export const SPROG = ['da', 'en'] as const;
export const HUSSTAND = ['alene', 'husstand'] as const;
export type Sprog = (typeof SPROG)[number];
export type Husstandsform = (typeof HUSSTAND)[number];
export type Profil = { navn: string; sprog: Sprog; husstand: Husstandsform };

export const NAVN_MAKS = 60;

export class ProfilFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'ProfilFejl'; }
}

/** The profile in `raw`, trimmed; throws ProfilFejl with a Danish reason the form can show. */
export function validerProfil(raw: unknown): Profil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProfilFejl('Profilen mangler');
  const o = raw as Record<string, unknown>;
  const navn = typeof o['navn'] === 'string' ? o['navn'].trim() : '';
  if (!navn) throw new ProfilFejl('Skriv hvad du hedder');
  if (navn.length > NAVN_MAKS) throw new ProfilFejl(`Navnet må højst være ${NAVN_MAKS} tegn`);
  if (/[\u0000-\u001f\u007f]/.test(navn)) throw new ProfilFejl('Navnet har ugyldige tegn');
  const sprog = o['sprog'];
  if (!(SPROG as readonly unknown[]).includes(sprog)) throw new ProfilFejl('Vælg dansk eller engelsk');
  const husstand = o['husstand'];
  if (!(HUSSTAND as readonly unknown[]).includes(husstand)) throw new ProfilFejl('Vælg alene eller husstand');
  return { navn, sprog: sprog as Sprog, husstand: husstand as Husstandsform };
}

export type ProfilLager = {
  /** null when there is no profile yet. */
  laes(): Promise<Profil | null>;
  /** The profile read synchronously, for the run registry (a tiny file); null when missing or unreadable. */
  laesNu(): Profil | null;
  skriv(p: Profil): Promise<void>;
  /** Back to no profile (the undo of the first save). */
  fjern(): Promise<void>;
};

export function lavProfilLager(dataDir: string): ProfilLager {
  const fil = path.join(dataDir, 'profil.json');
  return {
    async laes() {
      let tekst: string;
      try { tekst = await readFile(fil, 'utf8'); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new ProfilFejl('profil.json kunne ikke læses');
      }
      let raw: unknown;
      try { raw = JSON.parse(tekst); } catch { throw new ProfilFejl('profil.json er ikke gyldig JSON'); }
      return validerProfil(raw);
    },
    laesNu() {
      try { return validerProfil(JSON.parse(readFileSync(fil, 'utf8'))); } catch { return null; }
    },
    async skriv(p) {
      const ren = validerProfil(p);
      await mkdir(dataDir, { recursive: true });
      await skrivAtomisk(fil, JSON.stringify(ren, null, 2));
    },
    async fjern() { await rm(fil, { force: true }); },
  };
}
