// The household file, $KC_DATA_DIR/husstand.json (KC-0116): who lives here, by
// tailnet login, with a role. No file = single-user. A file that exists but
// cannot be read fails closed (HusstandFejl), never back to single-user — that
// would make every visitor the owner.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { erRolle, type Rolle } from './roller.ts';

export type Person = { id: string; login: string | null; navn: string; rolle: Rolle };
export type Husstand = { personer: Person[] };

export class HusstandFejl extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function valider(raw: unknown): Husstand {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HusstandFejl('husstand.json er ikke et objekt');
  const liste = (raw as Record<string, unknown>)['personer'];
  if (!Array.isArray(liste)) throw new HusstandFejl('husstand.json mangler personer');
  const personer = liste.map((p, i): Person => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const { id, login, navn, rolle } = o;
    if (typeof id !== 'string' || !ID.test(id)) throw new HusstandFejl(`person ${i}: ugyldigt id`);
    if (login !== null && (typeof login !== 'string' || !login.trim() || login.length > 200)) throw new HusstandFejl(`person ${id}: ugyldigt login`);
    if (typeof navn !== 'string' || !navn.trim() || navn.length > 80) throw new HusstandFejl(`person ${id}: ugyldigt navn`);
    if (!erRolle(rolle)) throw new HusstandFejl(`person ${id}: ukendt rolle`);
    return { id, login, navn, rolle };
  });
  const ider = personer.map((p) => p.id);
  const logins = personer.map((p) => p.login?.trim().toLowerCase()).filter((l) => l);
  if (new Set(ider).size !== ider.length || new Set(logins).size !== logins.length) throw new HusstandFejl('husstand.json har en person to gange');
  return { personer };
}

const fil = (dataDir: string): string => path.join(dataDir, 'husstand.json');

/** The household, or null when there is no file (single-user). Throws HusstandFejl on a broken file. */
export async function laesHusstand(dataDir: string): Promise<Husstand | null> {
  let tekst: string;
  try { tekst = await readFile(fil(dataDir), 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new HusstandFejl(`husstand.json kunne ikke læses: ${(err as Error).message}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(tekst); } catch { throw new HusstandFejl('husstand.json er ikke gyldig JSON'); }
  return valider(raw);
}

/** Validates and writes the household atomically (tmp file + rename). */
export async function skrivHusstand(dataDir: string, h: Husstand): Promise<void> {
  const ren = valider(h);
  await mkdir(dataDir, { recursive: true });
  const tmp = `${fil(dataDir)}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(ren, null, 2), 'utf8');
  await rename(tmp, fil(dataDir));
}
