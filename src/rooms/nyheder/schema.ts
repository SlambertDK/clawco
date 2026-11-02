// The state of the room Nyheder and the validator for Hermes' answer.

import { SchemaError, type Handling } from '../dagen/schema.ts';
import type { KildeStatus, Nyhedsbrev } from './source.ts';
import { zoneFra, ZoneFejl, type DataZone, type Zoneret } from '../../identitet/zoner.ts';
import { agentGulv, verbFra } from '../../graenser/verber.ts';
import { nyhederTekst } from './tekster.ts';

/** KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones. */
export const KORSEL: DataZone = 'privat';

export const RELEVANS_FOR = ['mig', 'familie', 'arbejde', 'danmark', 'holdning', 'projekter'] as const;
export type RelevansFor = (typeof RELEVANS_FOR)[number];
export type Relevans = { for: RelevansFor; note: string };
export type Nyhed = { id: string; titel: string; hvorfor: string; kilde?: string; url?: string; relevans?: Relevans[] } & Zoneret;
export type Bane = { navn: string; nyheder: Nyhed[] };
export type NyhederForslag = { id: string; tekst: string; handling?: Handling };
export type NyhederState = {
  dato: string;
  genereret: string;
  femLinjer: string[];
  baner: Bane[];
  forslag: NyhederForslag[];
  nyhedsbreve: Nyhedsbrev[];
  kilder: KildeStatus;
  gemt: string[];
  hermesStatus: string;
};
export type NyhederFacts = { nyhedsbreve: Nyhedsbrev[]; kilder: KildeStatus };

const MAX_LINJER = 5; const MAX_BANER = 4; const MAX_PER_BANE = 5; const MAX_FORSLAG = 3; const MAX_RELEVANS = 3;

/** The zone of one news item Hermes returned; a zone the run did not read is a schema error, never relabelled. */
function zoneAf(raw: unknown): DataZone {
  try { return zoneFra(raw, KORSEL); } catch (e) { if (e instanceof ZoneFejl) throw new SchemaError(`Nyheder: ${e.message}`); throw e; }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optStr = (v: unknown, max = 400): string | undefined => { const s = str(v, max); return s ? s : undefined; };
function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'h';
}

export function parseNyhederState(raw: unknown, facts: NyhederFacts, now: Date, previous?: NyhederState | null): NyhederState {
  if (!isObj(raw)) throw new SchemaError('Nyheder: svaret er ikke et objekt');
  const femLinjer = (Array.isArray(raw['femLinjer']) ? raw['femLinjer'] : []).map((l) => str(l, 300)).filter(Boolean).slice(0, MAX_LINJER);
  if (!femLinjer.length) throw new SchemaError('Nyheder: femLinjer mangler');

  let n = 0;
  const baner: Bane[] = [];
  for (const b of Array.isArray(raw['baner']) ? raw['baner'] : []) {
    if (!isObj(b)) continue;
    const navn = str(b['navn'], 60);
    const nyheder: Nyhed[] = [];
    for (const it of Array.isArray(b['nyheder']) ? b['nyheder'] : []) {
      if (!isObj(it)) continue;
      const titel = str(it['titel'], 200);
      if (!titel) continue;
      const post: Nyhed = { id: `n${++n}`, titel, hvorfor: str(it['hvorfor'], 300), zone: zoneAf(it['zone']) };
      const kilde = optStr(it['kilde'], 80); if (kilde) post.kilde = kilde;
      const url = str(it['url'], 2000); if (/^https?:\/\//i.test(url)) post.url = url;
      const rel: Relevans[] = [];
      for (const r of Array.isArray(it['relevans']) ? it['relevans'] : []) {
        if (!isObj(r) || rel.length >= MAX_RELEVANS) continue;
        const f = str(r['for'], 20).toLowerCase(); const note = str(r['note'], 200);
        if ((RELEVANS_FOR as readonly string[]).includes(f) && note) rel.push({ for: f as RelevansFor, note });
      }
      if (rel.length) post.relevans = rel;
      nyheder.push(post);
      if (nyheder.length >= MAX_PER_BANE) break;
    }
    if (!navn || !nyheder.length) continue;
    baner.push({ navn, nyheder });
    if (baner.length >= MAX_BANER) break;
  }
  if (!baner.length) throw new SchemaError('Nyheder: ingen baner med nyheder');

  const forslag: NyhederForslag[] = [];
  (Array.isArray(raw['forslag']) ? raw['forslag'] : []).forEach((f, i) => {
    if (!isObj(f) || forslag.length >= MAX_FORSLAG) return;
    const tekst = str(f['tekst'], 300);
    if (!tekst) return;
    const post: NyhederForslag = { id: `f${i + 1}`, tekst };
    const h = f['handling'];
    if (isObj(h)) {
      const label = str(h['label'], 80); const instruktion = str(h['instruktion'], 2000);
      if (label && instruktion) {
        const fortryd = optStr(h['fortryd'], 2000);
        const id = `forslag-${i + 1}-${slug(label)}`;
        post.handling = fortryd ? { id, label, instruktion, fortryd } : { id, label, instruktion };
        post.handling.verb = verbFra(h['verb'], agentGulv(post.handling));
      }
    }
    forslag.push(post);
  });

  const urls = new Map<string, string>();
  for (const b of baner) for (const it of b.nyheder) if (it.url) urls.set(it.url, it.id);
  const prevById = new Map<string, string>();
  for (const b of previous?.baner ?? []) for (const it of b.nyheder) if (it.url) prevById.set(it.id, it.url);
  const gemt = (previous?.gemt ?? []).map((id) => { const u = prevById.get(id); return u ? urls.get(u) : undefined; }).filter((x): x is string => Boolean(x));

  return {
    dato: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
    genereret: now.toISOString(),
    femLinjer,
    baner,
    forslag,
    nyhedsbreve: facts.nyhedsbreve,
    kilder: facts.kilder,
    gemt: [...new Set(gemt)],
    hermesStatus: str(raw['hermesStatus'], 80) || nyhederTekst().foelger,
  };
}

export function alleNyheder(state: NyhederState): Map<string, Nyhed> {
  const m = new Map<string, Nyhed>();
  for (const b of state.baner) for (const it of b.nyheder) m.set(it.id, it);
  return m;
}

export function handlingerINyheder(state: NyhederState): Map<string, Handling> {
  const m = new Map<string, Handling>();
  for (const f of state.forslag) if (f.handling) m.set(f.handling.id, f.handling);
  return m;
}
