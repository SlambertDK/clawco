// KC-0129: Start's window onto the vault. Start never writes a file itself: the composition root wires this seam to
// the notes connector's writers (src/kilder/noter/personer.ts, profil.ts), so every path, collision rule and Fortryd
// check of KC-0136 applies unchanged (rooms import nothing from src/kilder; these shapes restate theirs).

import type { ImportMappe } from '../schema.ts';
import type { EksisterendePerson } from './foreslaa.ts';

/** What a write keeps to undo it: the file, the hash of what was written, and what was there before (the profile template). */
export type Kvittering = { sti: string; sha256: string; forrige?: string };
export type Skrevet =
  | { udfald: 'oprettet'; sti: string; kvittering: Kvittering }
  | { udfald: 'uaendret'; sti: string }
  | { udfald: 'kollision'; sti: string; diff: { felt: string; nu: string; ny: string }[] };

/** KC-0219: what an update of an existing person answers. `kvittering.forrige` = the file as it was, for Fortryd. */
export type Opdateret =
  | { udfald: 'opdateret'; sti: string; kvittering: Kvittering & { forrige: string }; felter: string[]; sprunget: string[] }
  | { udfald: 'uaendret'; sti: string }
  | { udfald: 'forandret'; sti: string; sprunget: string[] };

/** A person as the register stores one; `kilde` = `import-<slags>`, `importeret` = the date. */
export type SkrivPerson = { navn: string; relation: string; zone: 'privat' | 'arbejde'; org?: string; foedselsdag?: string; kilde: string; importeret: string; tekst?: string };

export type ImportSkriver = {
  /** Whether there is a vault with a people register to write into (the notes connector is set up, or the env paths are). */
  klar(): Promise<boolean>;
  /** Sets up a new notes folder for the user ("Lav en mappe til mig"); absent = Start can only point at the notes card. */
  lavMappe?(): Promise<void>;
  /** Everyone in the register now, for collision checks. */
  personer(): Promise<EksisterendePerson[]>;
  /** The user's own profile text; null when there is none or it is still the untouched template. */
  profil(): Promise<string | null>;
  skrivPerson(p: SkrivPerson, mappe: ImportMappe): Promise<Skrevet>;
  skrivProfil(tekst: string): Promise<Skrevet>;
  /** KC-0219: changes an existing person by the diff the user saw (only those fields, only while the file still says what the diff said). */
  opdaterPerson(p: { navn: string; diff: { felt: string; nu: string; ny: string }[] }): Promise<Opdateret>;
  /** Fortryd: true when the file was removed (it still held exactly what was written). */
  fjernPerson(k: Kvittering): Promise<boolean>;
  fjernProfil(k: Kvittering): Promise<boolean>;
  /** KC-0219 Fortryd of an update: true when the previous content was put back (the file still held exactly what the update wrote). */
  gendanPerson(k: Kvittering): Promise<boolean>;
};
