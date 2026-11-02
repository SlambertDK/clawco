// KC-0145: what the app kept off the screen, as the app itself recorded it — the honest base of the Sunday sample's
// number. A record is written where the app hides something (Kuratoren's "intet at gøre" lines in src/kurator/kurator.ts,
// Mail's Ordnet in src/rooms/mail/room.ts), never from a sentence in Hermes' answer. Only the title, where it came from
// and the rule id that was the reason are kept. Append-only store ($KC_DATA_DIR/tillid/skjulte.jsonl, never rewritten,
// §4 r5); one line per id, so a list seen again (Mail rebuilds many times a day) counts once.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { idagKbh } from '../shell/tid.ts';

/** Where a hidden item came from, in Henrik's words (the Sunday card and Hermes' context). */
export const SKJULT_KILDE: Record<string, string> = { kuratoren: 'Nu: intet at gøre', mail: 'Mail: lagt i Ordnet' };

export type Skjult = { id: string; tid: string; titel: string; kilde: string; regelId?: string };

export type SkjultLager = {
  /** Appends the records whose id is new; resolves to how many were written. */
  noter(poster: readonly Skjult[]): Promise<number>;
  /** Every record, oldest first. Never throws on a missing or damaged file. */
  alle(): Promise<Skjult[]>;
};

const REGEL = /^R-\d{4,}$/;
const MAX_TITEL = 200;

/** A stored line → a record, or null when it is not one. */
function somSkjult(v: unknown): Skjult | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const { id, tid, titel, kilde, regelId } = o;
  if (typeof id !== 'string' || !id || id.length > 200 || typeof tid !== 'string' || Number.isNaN(Date.parse(tid))) return null;
  if (typeof titel !== 'string' || typeof kilde !== 'string' || !kilde) return null;
  return { id, tid, titel: titel.slice(0, MAX_TITEL), kilde: kilde.slice(0, 40), ...(typeof regelId === 'string' && REGEL.test(regelId) ? { regelId } : {}) };
}

export function lavSkjulte(o: { dir: string }): SkjultLager {
  const fil = path.join(o.dir, 'tillid', 'skjulte.jsonl');
  let cache: Skjult[] | undefined;
  let kaede: Promise<unknown> = Promise.resolve();
  const enkeltvis = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = kaede.then(fn);
    kaede = r.catch(() => undefined);
    return r;
  };
  async function indlaes(): Promise<Skjult[]> {
    if (cache) return cache;
    let tekst = '';
    try { tekst = await readFile(fil, 'utf8'); } catch { tekst = ''; }
    const set = new Set<string>();
    const ud: Skjult[] = [];
    for (const linje of tekst.split('\n')) {
      if (!linje.trim()) continue;
      let s: Skjult | null = null;
      try { s = somSkjult(JSON.parse(linje)); } catch { s = null; }
      if (s && !set.has(s.id)) { set.add(s.id); ud.push(s); }
    }
    cache = ud;
    return ud;
  }
  return {
    noter: (poster) => enkeltvis(async () => {
      const alle = await indlaes();
      const kendt = new Set(alle.map((s) => s.id));
      const nye: Skjult[] = [];
      for (const p of poster) {
        const s = somSkjult(p);
        if (!s || kendt.has(s.id)) continue;
        kendt.add(s.id);
        nye.push(s);
      }
      if (!nye.length) return 0;
      await mkdir(path.dirname(fil), { recursive: true });
      await appendFile(fil, nye.map((s) => `${JSON.stringify(s)}\n`).join(''), 'utf8');
      alle.push(...nye);
      return nye.length;
    }),
    alle: () => enkeltvis(async () => [...(await indlaes())]),
  };
}

const DAG_MS = 86_400_000;

/** The records whose Copenhagen day falls in the week starting `mandag` (YYYY-MM-DD): Monday 00:00 to Sunday 24:00. */
export function iUge(skjulte: readonly Skjult[], mandag: string): Skjult[] {
  const slut = new Date(Date.parse(`${mandag}T00:00:00Z`) + 7 * DAG_MS).toISOString().slice(0, 10);
  return skjulte.filter((s) => {
    const dag = idagKbh(new Date(s.tid));
    return dag >= mandag && dag < slut;
  });
}
