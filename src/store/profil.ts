// KC-0126: the user's profile — what they are called, which language Hermes
// answers in, alone or a household — in $KC_DATA_DIR/profil.json (spec §3 step
// 1, D7). Validated on every write and read; the write is atomic (AGENTS §4 r5).
// A file that cannot be read fails closed (ProfilFejl), never "no profile".
// Depends on nothing in src/ outside this folder.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from './atomisk.ts';
import { sprogNu } from './sprog.ts';

export const SPROG = ['da', 'en'] as const;
export const HUSSTAND = ['alene', 'husstand'] as const;
export type Sprog = (typeof SPROG)[number];
export type Husstandsform = (typeof HUSSTAND)[number];
export type Profil = { navn: string; sprog: Sprog; husstand: Husstandsform };

export const NAVN_MAKS = 60;

/** KC-0170: what a person is told when the profile they typed is refused, in the request's language (file errors are the operator's and stay Danish). */
export const PROFIL_TEKSTER = {
  da: { mangler: 'Profilen mangler', skrivNavn: 'Skriv hvad du hedder', navnForLangt: (maks: number): string => `Navnet må højst være ${maks} tegn`, ugyldigeTegn: 'Navnet har ugyldige tegn', vaelgSprog: 'Vælg dansk eller engelsk', vaelgHusstand: 'Vælg alene eller husstand' },
  en: { mangler: 'The profile is missing', skrivNavn: 'Write what you are called', navnForLangt: (maks: number): string => `The name can be at most ${maks} characters`, ugyldigeTegn: 'The name has invalid characters', vaelgSprog: 'Choose Danish or English', vaelgHusstand: 'Choose alone or household' },
};
const profilTekst = () => PROFIL_TEKSTER[sprogNu()];

export class ProfilFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'ProfilFejl'; }
}

/** The profile in `raw`, trimmed; throws ProfilFejl with a Danish reason the form can show. */
export function validerProfil(raw: unknown): Profil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProfilFejl(profilTekst().mangler);
  const o = raw as Record<string, unknown>;
  const navn = typeof o['navn'] === 'string' ? o['navn'].trim() : '';
  if (!navn) throw new ProfilFejl(profilTekst().skrivNavn);
  if (navn.length > NAVN_MAKS) throw new ProfilFejl(profilTekst().navnForLangt(NAVN_MAKS));
  if (/[\u0000-\u001f\u007f]/.test(navn)) throw new ProfilFejl(profilTekst().ugyldigeTegn);
  const sprog = o['sprog'];
  if (!(SPROG as readonly unknown[]).includes(sprog)) throw new ProfilFejl(profilTekst().vaelgSprog);
  const husstand = o['husstand'];
  if (!(HUSSTAND as readonly unknown[]).includes(husstand)) throw new ProfilFejl(profilTekst().vaelgHusstand);
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
