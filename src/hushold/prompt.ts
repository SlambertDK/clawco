// What we ask Hermes in Husstanden (KC-0148): only the chat. The room itself is
// pure aggregation; the chat answers about who is in the household and the
// shared week, in the husstand zone only. Members' names are the household
// file's; calendar titles are untrusted (D6).

import { byggPrompt, elementSegment, PEGER } from '../agent/prompt.ts';
import { ROLLE_NAVN } from '../identitet/roller.ts';
import { KORSEL, type Medlem } from './schema.ts';
import type { FaellesDag } from './uge.ts';
import type { ForespForslag, Forespoergsel } from './foresp.ts';
import { idagKbh } from '../shell/tid.ts';
import { klokke } from './render.ts';
import { konfliktResume, type Konflikt } from './konflikt.ts';
import { valgNeutralt, type Ressource, type Sammenfald, type SammenfaldForslag } from './ressource.ts';

const ROLLE = 'Du er Hermes og arbejder i rummet "Husstanden": hvem der er med i husstanden, og en fælles uge med det, der gælder dem alle. Du ser kun husstandens fælles ting, aldrig nogens private eller arbejdsting, og du gætter ikke på dem.';

// KC-0151: when the household has things to book, the chat may answer a wish to use one with one fenced block. It only
// proposes: the app validates it (bil.ts) and shows a card, and only a person's tap on that card books.
const BOOKING_REGEL = `- Beder personen om at bruge eller booke en af tingene i listen (en bil, et rum, et værktøj), så skriv én kort sætning og ellers præcis én JSON-blok. Du booker aldrig selv: appen lægger et kort frem, og personen trykker selv. Brug id'et fra listen og lokal dansk tid:
\`\`\`json
{"booking": {"ressource": "stor-bil", "start": "2026-11-07T10:00", "slut": "2026-11-07T15:00", "titel": "kort tekst"}}
\`\`\`
  "start" og "slut" er ÅÅÅÅ-MM-DDTTT:MM. Regn dage som "lørdag" ud fra dagens dato i beskeden. Kender du ikke tingen eller tidspunktet, så spørg i stedet.`;

/** Today as the prompt says it: "mandag 2026-11-02 09.00" (Copenhagen). */
const uret = (nu: Date): string => `${new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', weekday: 'long' }).format(nu)} ${idagKbh(nu)} ${klokke(nu.toISOString())}`;

export function buildHusstandChatRun(besked: string, kontekst: string | undefined, medlemmer: readonly Medlem[], uge: readonly FaellesDag[], ressourcer: readonly Ressource[] = [], nu: Date = new Date()): ReturnType<typeof byggPrompt> {
  const navn = (id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? id;
  const hvem = medlemmer.map((m) => `- ${m.navn}: ${ROLLE_NAVN[m.rolle]}${m.relation ? ` (${m.relation})` : ''}`).join('\n') || '- (ingen)';
  const linjer = uge.flatMap((d) => d.poster.map((p) => `- ${d.dato} ${p.heldag ? 'hele dagen' : p.start}: ${p.titel} (${p.hvem.length ? p.hvem.map(navn).join(', ') : 'alle'})`)).join('\n') || '- (intet fælles)';
  const ting = ressourcer.map((r) => `- ${r.id}: ${r.navn} (${r.slags}; ejere: ${r.ejere.map(navn).join(', ') || 'ingen'})`).join('\n');
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: `${ROLLE}\n${PEGER}\n\nRegler for chatten:\n- Svar kort, som i en samtale.\n- Du må aldrig sende beskeder til andre i husstanden, købe noget eller slette noget.${ressourcer.length ? `\n${BOOKING_REGEL}` : ''}`,
    data: [
      { kilde: 'husstand', zone: KORSEL, tillid: 'afledt', tekst: `Hvem er med:\n${hvem}` },
      { kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `Den fælles uge:\n${linjer}` },
      ...(ressourcer.length ? [
        { kilde: 'ressource', zone: KORSEL, tillid: 'utroet' as const, tekst: `Tingene i husstanden:\n${ting}` },
        { kilde: 'ur', zone: KORSEL, tillid: 'afledt' as const, tekst: `Nu: ${uret(nu)}.` },
      ] : []),
      ...elementSegment(kontekst, KORSEL),
      { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked },
    ],
  });
}

// KC-0149: Hermes' suggestions for a request — answer options and alternatives for whoever decides, and one line of
// advice. Neutral: it takes no side and decides nothing. Its answer is validated here and stored beside the state
// (Forespoergsel.forslag); nothing in it can move a request (foresp.ts is only called by a person's tap or the clock).

const FORSLAG_OPGAVE = 'Du er Hermes og hjælper i rummet "Husstanden" med en forespørgsel: ét medlem af husstanden har bedt et andet om noget. Du er neutral: du tager ikke parti, du afgør intet, og du svarer ikke på nogens vegne. Kun et menneske ændrer forespørgslen, med et tryk i appen.\n\nGiv den, der skal svare, højst to andre tidspunkter samme dag, hvis tidspunktet ser ud til at støde ind i den fælles uge, og én kort sætning, der hjælper med at svare. Svar med præcis én JSON-blok:\n```json\n{"anbefaling": "én kort sætning", "alternativer": [{"kl": "16:30", "tekst": "Kan 16.30"}]}\n```\n"kl" er TT:MM, "tekst" højst 40 tegn. Ingen alternativer er en tom liste.';

export function buildForespForslagRun(f: Forespoergsel, medlemmer: readonly Medlem[], uge: readonly FaellesDag[]): ReturnType<typeof byggPrompt> {
  const navn = (id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? id;
  const tid = f.tid ? ` (${f.tid.start}–${f.tid.slut})` : '';
  const linjer = uge.flatMap((d) => d.poster.map((p) => `- ${d.dato} ${p.heldag ? 'hele dagen' : p.start}: ${p.titel}`)).join('\n') || '- (intet fælles)';
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: FORSLAG_OPGAVE,
    data: [
      { kilde: 'forespoergsel', zone: KORSEL, tillid: 'utroet', tekst: `${navn(f.fra)} spørger ${navn(f.til)}: ${f.titel}${tid}` },
      { kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `Den fælles uge:\n${linjer}` },
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

const SAMMENFALD_OPGAVE = 'Du er Hermes og hjælper i rummet "Husstanden": to i husstanden har booket den samme ting på samme tid. Du er neutral: du tager ikke parti, du afgør intet, og du booker ikke. Begge ser præcis det samme kort, så skriv om dem ved navn, aldrig "du".\n\nVælg den mulighed, der ser ud til at løse det bedst for dem begge, og skriv én kort sætning om hvorfor. Svar med præcis én JSON-blok:\n```json\n{"foerste": "v1", "anbefaling": "én kort sætning"}\n```\n"foerste" er id\'et på én af mulighederne.';

export function buildSammenfaldForslagRun(s: Sammenfald, r: Ressource, medlemmer: readonly Medlem[], ressourcer: readonly Ressource[]): ReturnType<typeof byggPrompt> {
  const parter = [s.ny.af, s.mod.af];
  const navn = (id: string): string => (parter.includes(id) ? medlemmer.find((m) => m.id === id)?.navn ?? id : 'en anden');
  const kalender = [...r.kalender].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map((b) => `- ${b.start}–${b.slut}: ${b.titel} (${navn(b.af)})`).join('\n') || '- (tom)';
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: SAMMENFALD_OPGAVE,
    data: [
      { kilde: 'ressource', zone: KORSEL, tillid: 'utroet', tekst: `${r.navn}s kalender:\n${kalender}` },
      { kilde: 'sammenfald', zone: KORSEL, tillid: 'utroet', tekst: `${navn(s.mod.af)} har den ${s.mod.start}–${s.mod.slut} (${s.mod.titel}). ${navn(s.ny.af)} vil gerne have den ${s.ny.start}–${s.ny.slut} (${s.ny.titel}).` },
      { kilde: 'valg', zone: KORSEL, tillid: 'afledt', tekst: `Mulighederne:\n${s.valg.map((v) => `- ${v.id}: ${valgNeutralt(s, v, navn, ressourcer)}`).join('\n')}` },
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

const KONFLIKT_OPGAVE = 'Du er Hermes og hjælper i rummet "Husstanden" med et weekendkort: to voksne i husstanden er optaget på samme tid i weekenden, og der er noget, der skal dækkes. Begge voksne får præcis det samme kort. Du er neutral: du tager ikke parti, du afgør intet, og du skriver aldrig "du", "dig" eller "jeg" — kun de to ved navn. Skriv ét kort resumé af, hvad hver af dem har, og ét kort spørgsmål om, hvem der tager sig af det. Brug kun det, du har fået, og gæt ikke på mere. Svar med præcis én JSON-blok:\n```json\n{"resume": "Lørdag er Henrik … og Rikke …", "spoergsmaal": "Hvem har Nora?"}\n```\nBegge navne skal stå i "resume", højst 300 tegn; "spoergsmaal" højst 100 tegn.';

export function buildKonfliktRun(k: Konflikt, medlemmer: readonly Medlem[]): ReturnType<typeof byggPrompt> {
  const { tekst: _tidligere, ...uden } = k; // the fixed words, never Hermes' own earlier phrasing
  const fast = konfliktResume(uden, medlemmer);
  const hvem = k.parter.map((id) => medlemmer.find((m) => m.id === id)?.navn ?? 'en').join(' og ');
  return byggPrompt({
    rum: 'husstand',
    zone: KORSEL,
    opgave: KONFLIKT_OPGAVE,
    data: [
      { kilde: 'weekend', zone: KORSEL, tillid: 'utroet', tekst: `${fast.resume} ${fast.spoergsmaal}` },
      { kilde: 'voksne', zone: KORSEL, tillid: 'afledt', tekst: `De to voksne: ${hvem}.` },
    ],
  });
}
