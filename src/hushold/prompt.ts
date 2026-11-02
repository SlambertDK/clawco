// What we ask Hermes in Husstanden (KC-0148): only the chat. The room itself is
// pure aggregation; the chat answers about who is in the household and the
// shared week, in the husstand zone only. Members' names are the household
// file's; calendar titles are untrusted (D6).

import { byggPrompt, elementSegment, pegerTekst } from '../agent/prompt.ts';
import { KORSEL, type Medlem } from './schema.ts';
import type { FaellesDag } from './uge.ts';
import type { ForespForslag, Forespoergsel } from './foresp.ts';
import { idagKbh } from '../shell/tid.ts';
import { klokke } from './render.ts';
import { sprogNu } from '../store/sprog.ts';
import { tekst } from '../shell/tekster.ts';
import { HUSSTAND_TEKSTER, husstandTekst } from './tekster.ts';
import { husstandPrompt } from './prompt-tekster.ts';
import { konfliktResume, type Konflikt } from './konflikt.ts';
import { valgNeutralt, type Ressource, type Sammenfald, type SammenfaldForslag } from './ressource.ts';

// KC-0241: the words are in prompt-tekster.ts, Danish and English, read at call time; the room's name is the nav's.
const rum = (): string => tekst().rum['husstand']!;

/** Today as the prompt says it: "mandag 2026-11-02 09.00" (Copenhagen). */
const uret = (nu: Date): string => `${new Intl.DateTimeFormat(husstandPrompt().locale, { timeZone: 'Europe/Copenhagen', weekday: 'long' }).format(nu)} ${idagKbh(nu)} ${klokke(nu.toISOString(), sprogNu())}`;

export function buildHusstandChatRun(besked: string, kontekst: string | undefined, medlemmer: readonly Medlem[], uge: readonly FaellesDag[], ressourcer: readonly Ressource[] = [], nu: Date = new Date()): ReturnType<typeof byggPrompt> {
  const T = husstandPrompt();
  const navn = (id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? id;
  const hvem = medlemmer.map((m) => T.medlemLinje(m.navn, husstandTekst().rolleOrd[m.rolle], m.relation)).join('\n') || T.ingen;
  const linjer = uge.flatMap((d) => d.poster.map((p) => T.ugeLinje(d.dato, p.heldag ? T.heleDagen : p.start, p.titel, p.hvem.length ? p.hvem.map(navn).join(', ') : T.alle))).join('\n') || T.intetFaelles;
  const ting = ressourcer.map((r) => T.tingLinje(r.id, r.navn, T.slags[r.slags], r.ejere.map(navn).join(', '))).join('\n');
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: `${T.rolle(rum())}\n${pegerTekst(T.hvem)}\n\n${T.chatRegler}${ressourcer.length ? `\n${T.bookingRegel}` : ''}`,
    data: [
      { kilde: 'husstand', zone: KORSEL, tillid: 'afledt', tekst: `${T.hvemOverskrift}\n${hvem}` },
      { kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `${T.ugeOverskrift}\n${linjer}` },
      ...(ressourcer.length ? [
        { kilde: 'ressource', zone: KORSEL, tillid: 'utroet' as const, tekst: `${T.tingeOverskrift}\n${ting}` },
        { kilde: 'ur', zone: KORSEL, tillid: 'afledt' as const, tekst: T.nu(uret(nu)) },
      ] : []),
      ...elementSegment(kontekst, KORSEL, T.hvem),
      { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked },
    ],
  });
}

// KC-0149: Hermes' suggestions for a request — answer options and alternatives for whoever decides, and one line of
// advice. Neutral: it takes no side and decides nothing. Its answer is validated here and stored beside the state
// (Forespoergsel.forslag); nothing in it can move a request (foresp.ts is only called by a person's tap or the clock).

export function buildForespForslagRun(f: Forespoergsel, medlemmer: readonly Medlem[], uge: readonly FaellesDag[]): ReturnType<typeof byggPrompt> {
  const T = husstandPrompt();
  const navn = (id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? id;
  const tid = f.tid ? ` (${f.tid.start}–${f.tid.slut})` : '';
  const linjer = uge.flatMap((d) => d.poster.map((p) => T.ugeLinje(d.dato, p.heldag ? T.heleDagen : p.start, p.titel, null))).join('\n') || T.intetFaelles;
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: T.forespOpgave(rum()),
    data: [
      { kilde: 'forespoergsel', zone: KORSEL, tillid: 'utroet', tekst: T.forespLinje(navn(f.fra), navn(f.til), f.titel, tid) },
      { kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `${T.ugeOverskrift}\n${linjer}` },
    ],
  });
}

const KL = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ren = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '');

/** Hermes' answer → suggestions only (every other key dropped); null when the answer carries no JSON object. */
export function parseForespForslag(svar: string): ForespForslag | null {
  const blok = /```(?:json)?\s*([\s\S]*?)```/i.exec(svar)?.[1];
  if (!blok) return null;
  let raw: unknown;
  try { raw = JSON.parse(blok); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const alternativer = (Array.isArray(o['alternativer']) ? o['alternativer'] : [])
    .map((a) => (typeof a === 'object' && a !== null ? { kl: ren((a as Record<string, unknown>)['kl']), tekst: ren((a as Record<string, unknown>)['tekst']) } : null))
    .filter((a): a is { kl: string; tekst: string } => a !== null && KL.test(a.kl) && a.tekst.length > 0 && a.tekst.length <= 40)
    .slice(0, 2);
  const ud: ForespForslag = { alternativer };
  const anbefaling = ren(o['anbefaling']).slice(0, 200);
  if (anbefaling) ud.anbefaling = anbefaling;
  return ud;
}

// KC-0150: Hermes' suggestion for a clash — which of the app's options to show first, and one neutral sentence. It
// reads the clashing resource's calendar and the two bookings only (no other resource, no week, no third person's
// name), and its answer is validated against the clash's own option ids; nothing it writes books or decides anything.

export function buildSammenfaldForslagRun(s: Sammenfald, r: Ressource, medlemmer: readonly Medlem[], ressourcer: readonly Ressource[]): ReturnType<typeof byggPrompt> {
  const T = husstandPrompt();
  const parter = [s.ny.af, s.mod.af];
  const navn = (id: string): string => (parter.includes(id) ? medlemmer.find((m) => m.id === id)?.navn ?? id : T.enAnden);
  const kalender = [...r.kalender].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map((b) => T.bookingLinje(b.start, b.slut, b.titel, navn(b.af))).join('\n') || T.tomKalender;
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: T.sammenfaldOpgave(rum()),
    data: [
      { kilde: 'ressource', zone: KORSEL, tillid: 'utroet', tekst: `${T.kalenderAf(r.navn)}\n${kalender}` },
      { kilde: 'sammenfald', zone: KORSEL, tillid: 'utroet', tekst: T.sammenfald(navn(s.mod.af), s.mod.start, s.mod.slut, s.mod.titel, navn(s.ny.af), s.ny.start, s.ny.slut, s.ny.titel) },
      { kilde: 'valg', zone: KORSEL, tillid: 'afledt', tekst: `${T.mulighederne}\n${s.valg.map((v) => `- ${v.id}: ${valgNeutralt(s, v, navn, ressourcer, HUSSTAND_TEKSTER[sprogNu()])}`).join('\n')}` },
    ],
  });
}

/** Hermes' answer → the first option (one of the clash's own ids) and a capped sentence; null otherwise, so nothing is written. */
export function parseSammenfaldForslag(svar: string, s: Pick<Sammenfald, 'valg'>): SammenfaldForslag | null {
  const blok = /```(?:json)?\s*([\s\S]*?)```/i.exec(svar)?.[1];
  if (!blok) return null;
  let raw: unknown;
  try { raw = JSON.parse(blok); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const foerste = ren(o['foerste']);
  if (!s.valg.some((v) => v.id === foerste)) return null;
  const ud: SammenfaldForslag = { foerste };
  const anbefaling = ren(o['anbefaling']).slice(0, 200);
  if (anbefaling) ud.anbefaling = anbefaling;
  return ud;
}

// KC-0152: Hermes phrases the weekend card (taenker tier) — two adults busy at the same time and something to cover.
// It is told exactly what the card already shows to both (the busy blocks, the titles that may be shown, the need),
// never the week, a third person or an event body, and answers with the summary and the question in neutral words.
// The options are not its to change: the app keeps them symmetrical. A bad answer writes nothing (parseKonfliktTekst).

export function buildKonfliktRun(k: Konflikt, medlemmer: readonly Medlem[]): ReturnType<typeof byggPrompt> {
  const T = husstandPrompt();
  const { tekst: _tidligere, ...uden } = k; // the fixed words, never Hermes' own earlier phrasing
  const fast = konfliktResume(uden, medlemmer);
  const hvem = k.parter.map((id) => medlemmer.find((m) => m.id === id)?.navn ?? T.enUkendt).join(` ${T.og} `);
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: T.konfliktOpgave(rum()),
    data: [
      { kilde: 'weekend', zone: KORSEL, tillid: 'utroet', tekst: `${fast.resume} ${fast.spoergsmaal}` },
      { kilde: 'voksne', zone: KORSEL, tillid: 'afledt', tekst: T.voksne(hvem) },
    ],
  });
}
