// A rule proposal as the app keeps it (KC-0144): Hermes' answer to a Ret or an Ikke relevant may carry ONE fenced
// block {"regelforslag": {titel, tekst, trin, gaelder} | null}. Hermes is an untrusted producer: the block is cut to
// the declared fields, checked by the one rule check (graenser/regelforslag.ts → validerRegel), its trin clamped to
// the cap (maksTrinForForslag, KC-0143) and its text flattened and capped; a bad block is dropped with a reason and
// nothing is written. What is stored here is only a pending proposal; the rules file changes solely through the
// approve route in server.ts (a redeemed human tap). Pure: no I/O.
// Invariants: one proposal per corrected card (its id comes from the card); a decided one is never replaced; a
// declined one is remembered 30 days by content and not proposed again.

import { createHash } from 'node:crypto';
import { forslagFra } from '../graenser/regelforslag.ts';
import { skjulAdresser, zoneFelter } from '../rooms/hjem/kort.ts';
import type { Zoneret } from '../identitet/zoner.ts';
import type { ReglerLaest } from './lager.ts';
import type { Regelsaet } from './regler.ts';
import { erTrin, maksTrinForForslag, type Trin } from './trin.ts';

export type Art = 'ret' | 'ikke-relevant';

/** One stored proposal: what Henrik is asked, where it came from, and how it ended. */
export type Regelforslag = {
  id: string;
  kortId: string;
  /** The corrected card's title, for "Kom fra: dit Ret på «…»". */
  kortTitel: string;
  titel: string;
  tekst: string;
  trin: Trin;
  gaelder: { kilde: string; slags?: string };
  art: Art;
  /** Content hash: a declined proposal is not made again for 30 days. */
  hash: string;
  oprettet: string;
  status: 'afventer' | 'godkendt' | 'afvist';
  afgjort?: string;
  /** The rule a Ja made. */
  regelId?: string;
} & Zoneret;

export type ForslagFelter = Pick<Regelforslag, 'titel' | 'tekst' | 'trin' | 'gaelder'>;

export const MAX_TITEL = 80;
export const MAX_TEKST = 400;
const MAX_FORSLAG = 50;
const HUSK_MS = 30 * 86_400_000;

// ---------- the block in Hermes' answer ----------

const BLOK = /```(?:json)?\s*(\{[^`]*"regelforslag"[^`]*)```/gi;

/**
 * The answer without any regelforslag block, and the value of the FIRST one: the object, null (explicitly none),
 * 'ugyldig' (not JSON, or no such key) or undefined (no block). Other fenced blocks stay in the text.
 */
export function extractForslagBlok(output: string): { tekst: string; blok: unknown } {
  let blok: unknown;
  let set = false;
  const tekst = output.replace(BLOK, (_m, indhold: string) => {
    if (!set) {
      set = true;
      try {
        const o: unknown = JSON.parse(indhold.trim());
        blok = typeof o === 'object' && o !== null && !Array.isArray(o) && Object.hasOwn(o, 'regelforslag') ? (o as Record<string, unknown>)['regelforslag'] : 'ugyldig';
      } catch { blok = 'ugyldig'; }
    }
    return '';
  }).trim();
  return { tekst, blok };
}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** One line of text: addresses hidden, whitespace collapsed, cut to `max`. */
const linje = (v: unknown, max: number): string => (typeof v === 'string' ? skjulAdresser(v).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

/**
 * Hermes' block → the fields of a proposal, or why not. `regler` is the rules file as read now (the cap); a missing or
 * unreadable file caps at 1. A proposal an active rule already covers (same kilde and slags, trin at or above) is dropped.
 */
export function parseRegelforslag(blok: unknown, o: { regler: ReglerLaest | undefined; art: Art; kortId: string }): { forslag: ForslagFelter } | { droppet: string } {
  if (!erObj(blok)) return { droppet: 'blokken er ikke et objekt' };
  const g = erObj(blok['gaelder']) ? blok['gaelder'] : {};
  const kilde = linje(g['kilde'], 40).toLowerCase();
  const slags = g['slags'] === undefined ? undefined : linje(g['slags'], 40).toLowerCase();
  if (kilde === '*') return { droppet: 'et forslag må ikke gælde alle kilder' };
  const titel = linje(blok['titel'], MAX_TITEL);
  const tekst = linje(blok['tekst'], MAX_TEKST) || titel;
  const trinRaa = blok['trin'] === undefined ? 1 : blok['trin'];
  if (!erTrin(trinRaa)) return { droppet: 'ukendt trin' };
  if (trinRaa === 0) return { droppet: 'trin 0 er ingen regel' };
  const gaelder = { kilde, ...(slags !== undefined ? { slags } : {}) };
  const f = forslagFra({ titel, tekst, trin: trinRaa, gaelder }, { art: o.art, kortId: o.kortId });
  if (!f) return { droppet: 'er ikke en gyldig regel' };
  const trin = Math.min(f.trin, maksTrinForForslag(o.regler, f.gaelder)) as Trin;
  if (o.regler?.tilstand === 'ok' && o.regler.saet.regler.some((r) => r.status === 'aktiv' && r.gaelder.kilde.toLowerCase() === f.gaelder.kilde && r.gaelder.slags?.toLowerCase() === f.gaelder.slags && r.trin >= trin)) {
    return { droppet: 'findes allerede som regel' };
  }
  return { forslag: { titel: f.titel, tekst: f.tekst, trin, gaelder: f.gaelder } };
}

// ---------- the stored proposal ----------

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const indhold = (f: ForslagFelter): string => sha(JSON.stringify([f.titel, f.tekst, f.trin, f.gaelder.kilde, f.gaelder.slags ?? '']));

/** A pending proposal for card `kort`: the id is the card's (one per mistake), zone and owner are the card's. */
export function lavForslag(f: ForslagFelter, o: { kort: { id: string; titel: string } & Zoneret; art: Art; nu: Date }): Regelforslag {
  return {
    id: `rf-${sha(o.kort.id).slice(0, 10)}`, kortId: o.kort.id, kortTitel: o.kort.titel.slice(0, 200),
    titel: f.titel, tekst: f.tekst, trin: f.trin, gaelder: { ...f.gaelder }, art: o.art, hash: indhold(f),
    oprettet: o.nu.toISOString(), status: 'afventer', ...zoneFelter(o.kort),
  };
}

export type LagtUdfald = 'lagt' | 'erstattet' | 'afgjort-for' | 'afvist-for-nylig';

/** A decided proposal older than 30 days is forgotten. */
const glemt = (f: Regelforslag, nu: Date): boolean => f.status !== 'afventer' && Date.parse(f.afgjort ?? f.oprettet) < nu.getTime() - HUSK_MS;

/**
 * Adds `nyt`: one per card (a pending one is replaced, a decided one stays and nothing is added), and not content
 * Henrik declined in the last 30 days. At most 50 are kept, the newest.
 */
export function laegTil(liste: readonly Regelforslag[] | undefined, nyt: Regelforslag, nu: Date): { liste: Regelforslag[]; udfald: LagtUdfald } {
  const base = (liste ?? []).filter((f) => !glemt(f, nu));
  const samme = base.find((f) => f.kortId === nyt.kortId);
  if (samme && samme.status !== 'afventer') return { liste: base, udfald: 'afgjort-for' };
  if (base.some((f) => f.status === 'afvist' && f.hash === nyt.hash)) return { liste: base, udfald: 'afvist-for-nylig' };
  if (samme) return { liste: base.map((f) => (f === samme ? nyt : f)), udfald: 'erstattet' };
  return { liste: [...base, nyt].slice(-MAX_FORSLAG), udfald: 'lagt' };
}

/** Marks proposal `id` decided (and, for a Ja, with the rule it made). */
export function afgoerForslag(liste: readonly Regelforslag[], id: string, status: 'godkendt' | 'afvist', nu: Date, regelId?: string): Regelforslag[] {
  return liste.map((f) => (f.id === id ? { ...f, status, afgjort: nu.toISOString(), ...(regelId ? { regelId } : {}) } : f));
}

/** The rules without rule `id`; `naesteId` stays, so the id is never used again. Null when there is no such rule. */
export function fjernRegel(saet: Regelsaet, id: string): Regelsaet | null {
  return saet.regler.some((r) => r.id === id) ? { ...saet, regler: saet.regler.filter((r) => r.id !== id) } : null;
}
