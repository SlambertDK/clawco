// The state of the room Skrive and the validators for Hermes' answers
// (a new document, or proposals for an existing one).

import { randomUUID } from 'node:crypto';
import { SchemaError } from '../dagen/schema.ts';
import type { DataZone } from '../../identitet/zoner.ts';
import { skriveTekst } from './tekster.ts';
import { skrivePrompt } from './prompt-tekster.ts';

// KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones.
export const KORSEL: DataZone = 'privat';

export type Afsnit = { id: string; tekst: string };
export type Forslag = { id: string; dokId: string; afsnitId: string | null; efterId?: string; ny: string; hvorfor: string; tid: string };
export type Dokument = {
  id: string;
  titel: string;
  brief: string;
  afsnit: Afsnit[];
  kilder: string[];
  oprettet: string;
  aendret: string;
  gemtSom?: string;
};
export type SkriveState = { dokumenter: Dokument[]; aktivt: string | null; forslag: Forslag[]; hermesStatus: string };

const MAX_AFSNIT = 40;
const MAX_FORSLAG = 3;
const MAX_KILDER = 10;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function tomtState(): SkriveState {
  return { dokumenter: [], aktivt: null, forslag: [], hermesStatus: 'Klar til at skrive' };
}

export function parseNytDokument(raw: unknown, meta: { brief: string; titel?: string }, now: Date): Dokument {
  if (!isObj(raw)) throw new SchemaError(skrivePrompt().fejl.ikkeObjekt);
  const afsnitRaw = Array.isArray(raw['afsnit']) ? raw['afsnit'] : [];
  const tekster = afsnitRaw.map((a) => str(isObj(a) ? a['tekst'] : a)).filter(Boolean).slice(0, MAX_AFSNIT);
  if (tekster.length === 0) throw new SchemaError(skrivePrompt().fejl.ingenAfsnit);
  const kilder = (Array.isArray(raw['kilder']) ? raw['kilder'] : []).map((k) => str(k, 300)).filter(Boolean).slice(0, MAX_KILDER);
  const titel = str(raw['titel'], 200) || str(meta.titel, 200) || meta.brief.slice(0, 80);
  const tid = now.toISOString();
  return {
    id: `dok-${randomUUID().slice(0, 8)}`,
    titel,
    brief: meta.brief,
    afsnit: tekster.map((tekst, i) => ({ id: `a${i + 1}`, tekst })),
    kilder,
    oprettet: tid,
    aendret: tid,
  };
}

export function parseForslag(raw: unknown, dok: Dokument, now: Date): Forslag[] {
  if (!isObj(raw)) throw new SchemaError(skrivePrompt().fejl.ikkeObjekt);
  const list = Array.isArray(raw['forslag']) ? raw['forslag'] : [];
  const ids = new Set(dok.afsnit.map((a) => a.id));
  const out: Forslag[] = [];
  const touched = new Set<string>();
  for (const f of list) {
    if (!isObj(f)) continue;
    const ny = str(f['ny']);
    if (!ny) continue;
    const afsnitId = f['afsnitId'] === null || f['afsnitId'] === undefined || str(f['afsnitId'], 20) === '' ? null : str(f['afsnitId'], 20);
    if (afsnitId !== null && !ids.has(afsnitId)) continue;
    if (afsnitId !== null && touched.has(afsnitId)) continue;
    const efter = str(f['efterId'], 20);
    const post: Forslag = { id: `f-${randomUUID().slice(0, 8)}`, dokId: dok.id, afsnitId, ny, hvorfor: str(f['hvorfor'], 300), tid: now.toISOString() };
    if (afsnitId === null) post.efterId = ids.has(efter) ? efter : (dok.afsnit.at(-1)?.id ?? 'a1');
    else touched.add(afsnitId);
    out.push(post);
    if (out.length >= MAX_FORSLAG) break;
  }
  if (out.length === 0) throw new SchemaError(skrivePrompt().fejl.ingenForslag);
  return out;
}

/** Applies a proposal; returns the paragraph text it replaced (null for an insertion). */
export function brugForslag(dok: Dokument, f: Forslag, now: Date): { gammel: string | null } {
  if (f.afsnitId === null) {
    const idx = dok.afsnit.findIndex((a) => a.id === f.efterId);
    const nextNo = dok.afsnit.reduce((m, a) => Math.max(m, Number(a.id.slice(1)) || 0), 0) + 1;
    dok.afsnit.splice(idx < 0 ? dok.afsnit.length : idx + 1, 0, { id: `a${nextNo}`, tekst: f.ny });
    dok.aendret = now.toISOString();
    return { gammel: null };
  }
  const a = dok.afsnit.find((x) => x.id === f.afsnitId);
  if (!a) throw new SchemaError(skrivePrompt().fejl.afsnitVaek);
  const gammel = a.tekst;
  a.tekst = f.ny;
  dok.aendret = now.toISOString();
  return { gammel };
}

/** The text itself: paragraphs separated by a blank line — no title, no sources. */
export function dokumentTekst(dok: Dokument): string {
  return dok.afsnit.map((a) => a.tekst).join('\n\n');
}

export function dokumentTilMarkdown(dok: Dokument): string {
  const body = dokumentTekst(dok);
  const kilder = dok.kilder.length ? `\n\n## ${skriveTekst().kilderOverskrift}\n${dok.kilder.map((k) => `- ${k}`).join('\n')}\n` : '\n';
  return `# ${dok.titel}\n\n${body}\n${kilder}`;
}

export function venterSkrive(state: SkriveState | null): number {
  return state ? state.forslag.length : 0;
}
