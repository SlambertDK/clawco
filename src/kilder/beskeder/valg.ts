// KC-0138: opt-in per conversation. The card has one choice per conversation found in the inbound log: "Læs ikke"
// (first, so every conversation — a group too — starts off) or the zone its messages go into. The choice is stored
// in kilder.json under the conversation's key, a hash of channel and platform id, so no phone number or handle is
// ever written to kilder.json, a card or a read. The list carries name, kind and count — never text.

import { createHash } from 'node:crypto';
import { DATAZONER, ZONE_NAVN, erDataZone, type DataZone } from '../../identitet/zoner.ts';
import type { Felt } from '../types.ts';
import type { Kanal, RaaBesked } from './jsonl.ts';

export const IKKE = 'nej';
export const KANAL_NAVN: Record<Kanal, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', signal: 'Signal' };
const NOEGLE = /^s-[0-9a-f]{12}$/;

export type Samtale = { noegle: string; kanal: Kanal; gruppe: boolean; navn: string; antal: number; sidst: string };

export const samtaleNoegle = (kanal: Kanal, samtale: string): string => `s-${createHash('sha256').update(`${kanal}\u0000${samtale}`).digest('hex').slice(0, 12)}`;

/** A name that is really an id: digits and phone punctuation, a handle, or a platform address. Never shown. */
export const erId = (navn: string): boolean => /^[+\d\s().-]{5,}$/.test(navn) || /^@/.test(navn) || /@[\w.-]+\.\w+$/.test(navn) || /^-?\d+$/.test(navn);

export const standardNavn = (kanal: Kanal, gruppe: boolean): string => `${gruppe ? 'Gruppe' : 'Samtale'} på ${KANAL_NAVN[kanal]}`;

/** The chosen conversations and their zone. Anything not a key with a zone is not chosen. */
export function valgte(valg: Readonly<Record<string, string>>): Map<string, DataZone> {
  const m = new Map<string, DataZone>();
  for (const [k, v] of Object.entries(valg)) if (NOEGLE.test(k) && erDataZone(v)) m.set(k, v);
  return m;
}

/** Each conversation once, newest first, with its latest non-id name and how many messages the log holds. */
export function samtaler(poster: readonly RaaBesked[]): Samtale[] {
  const m = new Map<string, Samtale>();
  for (const p of poster) {
    const noegle = samtaleNoegle(p.kanal, p.samtale);
    const egen = p.samtaleNavn && !erId(p.samtaleNavn) ? p.samtaleNavn : undefined;
    const afsender = !p.gruppe && p.afsenderNavn && !erId(p.afsenderNavn) ? p.afsenderNavn : undefined;
    const navn = egen ?? afsender;
    const s = m.get(noegle);
    if (!s) { m.set(noegle, { noegle, kanal: p.kanal, gruppe: p.gruppe, navn: navn ?? standardNavn(p.kanal, p.gruppe), antal: 1, sidst: p.tid }); continue; }
    s.antal += 1;
    if (p.tid >= s.sidst) { s.sidst = p.tid; if (navn) s.navn = navn; }
  }
  return [...m.values()].sort((a, b) => b.sidst.localeCompare(a.sidst));
}

/** One select per conversation, "Læs ikke" first. */
export function felter(liste: readonly Samtale[]): Felt[] {
  const muligheder = [{ vaerdi: IKKE, etiket: 'Læs ikke' }, ...DATAZONER.map((z) => ({ vaerdi: z, etiket: `Læs, ${ZONE_NAVN[z].toLowerCase()}` }))];
  return liste.map((s) => ({
    navn: s.noegle, etiket: `${s.navn} (${s.gruppe ? 'gruppe' : 'samtale'} på ${KANAL_NAVN[s.kanal]})`, type: 'tekst', paakraevet: false, muligheder,
  }));
}

/**
 * KC-0224: the chosen conversations after the user's change made once the source is connected. Every key must be a
 * conversation the log shows (null otherwise); one already chosen keeps its zone, a new one is read in `standard`;
 * a conversation not given is no longer chosen. The old choice is left as it was.
 */
export function nytValg(liste: readonly Samtale[], nu: ReadonlyMap<string, DataZone>, noegler: readonly string[], standard: DataZone): Map<string, DataZone> | null {
  const kendt = new Set(liste.map((s) => s.noegle));
  const ud = new Map<string, DataZone>();
  for (const n of noegler) {
    if (!kendt.has(n)) return null;
    ud.set(n, nu.get(n) ?? standard);
  }
  return ud;
}
