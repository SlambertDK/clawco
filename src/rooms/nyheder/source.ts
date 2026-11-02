// Raw data in for Nyheder: all news items from Kiras morning-paper JSON
// (not the capped Dagen trim), source stats, and the mails archived today.

import { readFile } from 'node:fs/promises';
import { copenhagenDate, sourcePathFor } from '../dagen/source.ts';
import { parseEnvelopes, type Runner } from '../mail/source.ts';

export type RaaNyhed = { titel: string; kilde: string; url?: string; resume?: string; udgivet?: string };
export type KildeStatus = { antal: number; medNyheder: number; nyheder: number; fejlede: string[] };
export type TrimmedNyheder = { dato: string; nyheder: RaaNyhed[]; kilder: KildeStatus };
export type Nyhedsbrev = { mailId: string; emne: string; fra: string };
/** KC-0137: what the user's own feeds (the nyheder-rss connector) read, in the paper's shape; wired by the composition root. */
export type RssNyheder = { nyheder: RaaNyhed[]; kilder: KildeStatus };

export const MAX_NYHEDER = 80;
const MAX_BREVE = 20;
const SKIP = new Set(['tasks', 'experiment']);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function trimNyheder(raw: unknown): TrimmedNyheder {
  const root = isObj(raw) ? raw : {};
  const kt = isObj(root['kontroltaarn']) ? root['kontroltaarn'] : {};
  const nyheder: RaaNyhed[] = [];
  let antal = 0; let medNyheder = 0; const fejlede: string[] = [];
  for (const src of Array.isArray(root['sources']) ? root['sources'] : []) {
    if (!isObj(src)) continue;
    const kilde = s(src['source'], 80);
    const type = s(src['type'], 20);
    if (!kilde || SKIP.has(type)) continue;
    antal++;
    if (s(src['error'], 200)) fejlede.push(kilde);
    const items = Array.isArray(src['items']) ? src['items'] : [];
    if (items.length) medNyheder++;
    for (const it of items) {
      if (!isObj(it)) continue;
      const titel = s(it['title'], 200);
      if (!titel) continue;
      const n: RaaNyhed = { titel, kilde };
      const url = s(it['url'], 2000); if (/^https?:\/\//i.test(url)) n.url = url;
      const resume = s(it['summary'], 300); if (resume) n.resume = resume;
      const udgivet = s(it['published'], 40); if (udgivet) n.udgivet = udgivet;
      nyheder.push(n);
    }
  }
  nyheder.sort((a, b) => (b.udgivet ?? '').localeCompare(a.udgivet ?? ''));
  return {
    dato: s(kt['generated_date'], 10) || s(root['fetched_at'], 10),
    nyheder: nyheder.slice(0, MAX_NYHEDER),
    kilder: { antal, medNyheder, nyheder: nyheder.length, fejlede },
  };
}

/**
 * KC-0137: the morning paper and the user's own feeds as one list — newest first, one line per link (the paper's
 * line wins), capped like the paper, the source counts added up and every name that did not answer kept. Neither
 * side present = null (the room then asks Hermes to fetch the paper, as before); only one = that one unchanged.
 */
export function flettNyheder(papir: TrimmedNyheder | null, rss: RssNyheder | null, now: Date): TrimmedNyheder | null {
  if (!rss) return papir;
  if (!papir) return { dato: copenhagenDate(now), nyheder: rss.nyheder.slice(0, MAX_NYHEDER), kilder: rss.kilder };
  const set = new Set(papir.nyheder.flatMap((n) => (n.url ? [n.url] : [])));
  const alle = [...papir.nyheder, ...rss.nyheder.filter((n) => !n.url || !set.has(n.url))];
  alle.sort((a, b) => (b.udgivet ?? '').localeCompare(a.udgivet ?? ''));
  const k = (f: (x: KildeStatus) => number): number => f(papir.kilder) + f(rss.kilder);
  return {
    dato: papir.dato,
    nyheder: alle.slice(0, MAX_NYHEDER),
    kilder: { antal: k((x) => x.antal), medNyheder: k((x) => x.medNyheder), nyheder: alle.length, fejlede: [...papir.kilder.fejlede, ...rss.kilder.fejlede] },
  };
}

export async function readNyhederSource(pattern: string, now: Date): Promise<TrimmedNyheder | null> {
  const file = sourcePathFor(pattern, now);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const t = trimNyheder(JSON.parse(text));
  if (!t.dato) t.dato = copenhagenDate(now);
  return t;
}

/** Mails in Archive dated today (Kira archives newsletters there). Never throws. */
export async function readNyhedsbreve(run: Runner, himalaya: string, now: Date): Promise<Nyhedsbrev[]> {
  const today = copenhagenDate(now);
  try {
    const r = await run(himalaya, ['envelope', 'list', '-m', 'Archive', '-s', '60', '-p', '1', '--json']);
    if (r.code !== 0) return [];
    const all = parseEnvelopes(JSON.parse(r.stdout));
    return all.filter((e) => copenhagenDate(new Date(e.modtaget)) === today).slice(0, MAX_BREVE).map((e) => ({ mailId: e.id, emne: e.emne, fra: e.fra }));
  } catch { return []; }
}
