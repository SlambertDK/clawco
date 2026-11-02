// KC-0233, the Danmark-pakke's small memory: the sender address(es) the person confirmed in Start, the notices marked
// "Set den", which viewer the card's link goes to, and (optionally) when Start's step was put away (and, KC-0236, the Aula card). One file,
// $KC_DATA_DIR/danmark/digital-post.json, written atomically; changes one at a time. Pure parse + a lager that only
// reads and writes. Nothing here is mail content: ids and addresses only.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from '../store/atomisk.ts';

/** The viewers a person may choose — each a FIXED front page; a link is never built from anything in a mail. */
export const VISERE = {
  'mit.dk': { navn: 'mit.dk', url: 'https://mit.dk/' },
  'e-boks': { navn: 'e-Boks', url: 'https://www.e-boks.dk/' },
  'borger.dk': { navn: 'borger.dk', url: 'https://www.borger.dk/' },
} as const;
export type Viser = keyof typeof VISERE;
export const erViser = (v: unknown): v is Viser => typeof v === 'string' && Object.hasOwn(VISERE, v);

export type DanmarkTilstand = {
  /** The confirmed notification senders, lower-case addresses. */
  afsendere: string[];
  /** Message ids marked "Set den" (cut to the newest SET_MAKS by tilfoejSet). */
  set: string[];
  viser: Viser;
  /** When Start's step was put away ("Ikke nu"); absent = it shows. */
  afvist?: string;
  /** KC-0236: the same for the Aula card in Start's Danmark-pakke group; absent = it shows (while Aula is not connected). */
  aulaAfvist?: string;
};

export const STANDARD: DanmarkTilstand = { afsendere: [], set: [], viser: 'mit.dk' };

export class DanmarkFejl extends Error {}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v));
const erAdresse = (v: unknown): v is string => typeof v === 'string' && v === v.toLowerCase() && /^[^\s@]+@[^\s@]+$/.test(v);

/** The file as it is read: anything that does not match is null (the caller fails loudly; nothing is repaired by guessing). */
export function parseDanmarkTilstand(raw: unknown): DanmarkTilstand | null {
  if (!erObj(raw) || !Array.isArray(raw['afsendere']) || !Array.isArray(raw['set']) || !erViser(raw['viser'])) return null;
  if (!raw['afsendere'].every(erAdresse) || !raw['set'].every((s) => typeof s === 'string' && s.length > 0 && s.length <= 300)) return null;
  const afvist = raw['afvist'];
  if (afvist !== undefined && !erIso(afvist)) return null;
  const aulaAfvist = raw['aulaAfvist'];
  if (aulaAfvist !== undefined && !erIso(aulaAfvist)) return null;
  return { afsendere: [...raw['afsendere']] as string[], set: [...raw['set']] as string[], viser: raw['viser'], ...(afvist !== undefined ? { afvist } : {}), ...(aulaAfvist !== undefined ? { aulaAfvist } : {}) };
}

export type DanmarkLager = {
  /** The state; the default when there is no file yet (reading writes nothing). Throws DanmarkFejl on a damaged file. */
  laes(): Promise<DanmarkTilstand>;
  /** Read, change, write atomically — one change at a time. */
  aendre(fn: (s: DanmarkTilstand) => DanmarkTilstand): Promise<DanmarkTilstand>;
};

export function lavDanmarkLager(o: { dir: string }): DanmarkLager {
  const mappe = path.join(o.dir, 'danmark');
  const fil = path.join(mappe, 'digital-post.json');
  let kaede: Promise<unknown> = Promise.resolve();
  const enkeltvis = <T>(fn: () => Promise<T>): Promise<T> => { const r = kaede.then(fn); kaede = r.catch(() => undefined); return r; };
  const laes = async (): Promise<DanmarkTilstand> => {
    let tekst: string;
    try { tekst = await readFile(fil, 'utf8'); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...STANDARD, afsendere: [], set: [] };
      throw new DanmarkFejl(`digital-post.json kunne ikke læses: ${(err as Error).message}`);
    }
    let raw: unknown;
    try { raw = JSON.parse(tekst); } catch { throw new DanmarkFejl('digital-post.json er ikke gyldig JSON'); }
    const s = parseDanmarkTilstand(raw);
    if (!s) throw new DanmarkFejl('digital-post.json har forkert form');
    return s;
  };
  return {
    laes: () => enkeltvis(laes),
    aendre: (fn) => enkeltvis(async () => {
      const ny = fn(await laes());
      await mkdir(mappe, { recursive: true });
      await skrivAtomisk(fil, JSON.stringify(ny, null, 2));
      return ny;
    }),
  };
}
