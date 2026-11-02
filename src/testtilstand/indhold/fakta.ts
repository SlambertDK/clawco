// The test world's day (KC-0068): the six moments and the calendar facts every
// part of the story derives from the test date. Pure: no clock, no I/O. Lifted
// from the demo's fakta.ts (KC-0058); every date is relative to `dag`.

import { koebenhavnTilIso } from '../../rooms/univers/tid.ts';
import type { Moment } from '../typer.ts';

/** KC-0152: the moment with the weekend card. */
export const TIRSDAG_WEEKEND = 'tirsdag-weekend';

/** The day, in order. `replik` is a line Henrik might say to the voice at that moment. */
export const MOMENT_TABEL: readonly Moment[] = [
  { id: 'morgen', tid: '07:10', navn: 'Morgen', url: '/rum/hjem', replik: 'Godmorgen, hvad skal jeg i dag?' },
  { id: 'formiddag', tid: '09:30', navn: 'Formiddag', url: '/rum/mail', replik: 'Hvad skal jeg svare elektrikeren?' },
  { id: 'foer-moede', tid: '10:50', navn: 'Lige før et møde', url: '/rum/hjem', replik: 'Hvad sagde vi sidst?' },
  { id: 'moede', tid: '11:10', navn: 'Under mødet', url: '/rum/hjem', replik: 'Hvad er Claras største bekymring?' },
  { id: 'eftermiddag', tid: '14:30', navn: 'Eftermiddag', url: '/rum/skrive', replik: 'Gør den kortere' },
  { id: 'aften', tid: '20:30', navn: 'Aften', url: '/rum/hjem', replik: 'Er jeg fri lørdag?' },
  // KC-0103: after the evening — everything handled (Alt er ordnet), then the next morning without its 07.05 build (Byg Dagen nu).
  { id: 'sent-aften', tid: '22:30', navn: 'Sent aften', url: '/rum/hjem', replik: 'Er der mere i dag?' },
  { id: 'naeste-morgen', tid: '07:40', dagPlus: 1, navn: 'Næste morgen', url: '/rum/dagen', replik: 'Hvorfor er Dagen fra i går?' },
  // KC-0124: Maja pressed Stop alt at 07.52; Clawco stays on pause until Henrik starts it again.
  { id: 'pause', tid: '08:10', dagPlus: 1, navn: 'Sat på pause', url: '/rum/hjem', replik: 'Hvorfor gør Clawco ingenting?' },
  // KC-0151: the first household flow. Maja has the big car on a Saturday next week (a course 09–13); Henrik says his sentence.
  { id: 'bil-loerdag', tid: '19:30', dagPlus: 1, navn: 'Lørdag i næste uge', url: '/rum/husstand', replik: 'Jeg skal bruge den store bil lørdag 10 til 15' },
  // KC-0139: a connection that stopped working, one moment per visible state (the fake connectors' modes, KILDE_TILSTAND):
  // the calendar logged out (Log ind igen restarts the round trip), the mail not answering (type the password again),
  // an access that runs out soon. Each has its one card in Nu and its elements marked "ikke opdateret siden …".
  { id: 'kilde-log-ind-igen', tid: '08:20', dagPlus: 1, navn: 'Kalenderen er logget ud', url: '/rum/hjem', replik: 'Hvorfor ser jeg ikke min kalender?' },
  { id: 'kilde-nede', tid: '08:30', dagPlus: 1, navn: 'Mailen svarer ikke', url: '/rum/hjem', replik: 'Hvorfor er der ingen nye mails?' },
  { id: 'kilde-snart-udloebet', tid: '08:40', dagPlus: 1, navn: 'Adgangen udløber snart', url: '/rum/hjem', replik: 'Hvad sker der med min kalender?' },
  // KC-0135: Gmail through "Log ind med Google" over the world's fake Google — connected and reading, and logged out (Google refused the grant).
  { id: 'gmail-koblet', tid: '08:50', dagPlus: 1, navn: 'Gmail er koblet', url: '/rum/hjem', replik: 'Hvad er kommet i min Gmail?' },
  { id: 'gmail-log-ind-igen', tid: '09:00', dagPlus: 1, navn: 'Gmail er logget ud', url: '/rum/hjem', replik: 'Hvorfor ser jeg ikke min Gmail?' },
  // KC-0147: the first view on a Monday — Nu shows the week's number (the week that just ended against the one before).
  { id: 'mandag', tid: '07:30', ugedag: 1, navn: 'Mandag morgen', url: '/rum/hjem', replik: 'Hvordan gik sidste uge?' },
  // KC-0152: the first Tuesday after the story's day, 07.40 — the Tuesday check has just looked at the coming weekend.
  { id: TIRSDAG_WEEKEND, tid: '07:40', ugedag: 2, navn: 'Tirsdag før weekenden', url: '/rum/husstand', replik: 'Hvem har Ella i weekenden?' },
  // KC-0145: the first Sunday after the story day, after 18.00 — the Sunday sample (one line already answered wrong),
  // and the variant where the third clean week in a row has just been answered (the stop question).
  { id: 'soendag', tid: '18:30', ugedag: 0, navn: 'Søndag aften', url: '/rum/hjem', replik: 'Hvad skjulte du i denne uge?' },
  { id: 'soendag-stop', tid: '18:40', ugedag: 0, navn: 'Søndag: stop tjekket?', url: '/rum/hjem', replik: 'Skal vi blive ved med søndagstjekket?' },
];

/** Days after the story's day `dag` that the moment's clock is on: `dagPlus`, or (KC-0147, KC-0152) the days to the next `ugedag`. */
export function momentPlus(m: Pick<Moment, 'dagPlus' | 'ugedag'>, dag: string): number {
  return m.ugedag !== undefined ? naeste(dag, m.ugedag) : m.dagPlus ?? 0;
}

/** The rooms' story ends with the evening: the moments after it (KC-0103) show the evening's rooms; only Hjem moves on. */
export const rumNr = (n: number): number => Math.min(n, MOMENT_TABEL.findIndex((m) => m.id === 'aften'));


/** The moment's position in the day (throws on an unknown id). */
export function momentNr(id: string): number {
  const i = MOMENT_TABEL.findIndex((m) => m.id === id);
  if (i < 0) throw new Error(`ukendt moment: ${id}`);
  return i;
}

const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const UGEDAGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

function ms(dag: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dag);
  if (!m) throw new Error(`ugyldig dato: ${dag}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** YYYY-MM-DD, `n` days after `dag` (negative = before). */
export function plusDag(dag: string, n: number): string {
  return new Date(ms(dag) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const ugedagNr = (dag: string): number => new Date(ms(dag)).getUTCDay();

/** "30. oktober" */
export function kortDato(dag: string): string {
  const d = new Date(ms(dag));
  return `${d.getUTCDate()}. ${MDR[d.getUTCMonth()] ?? ''}`;
}

/** "fredag den 30. oktober" */
export const langDato = (dag: string): string => `${UGEDAGE[ugedagNr(dag)] ?? ''} den ${kortDato(dag)}`;

/** Days from `dag` to the next given weekday (strictly after: 1..7). */
function naeste(dag: string, ugedag: number): number {
  return ((ugedag - ugedagNr(dag) + 6) % 7) + 1;
}

/** The ISO instant of Copenhagen wall time "HH:MM" on any date. */
export function isoDato(dato: string, hhmm: string): string {
  const r = koebenhavnTilIso(`${dato}T${hhmm}`);
  if (!r) throw new Error(`ugyldigt tidspunkt: ${dato} ${hhmm}`);
  return r;
}

export type Fakta = {
  dag: string;
  /** The ISO instant of Copenhagen wall time "HH:MM" on `dag` (+ `plus` days). */
  iso(hhmm: string, plus?: number): string;
  plus(n: number): string;
  kort(n: number): string;
  lang(n: number): string;
  /** Days to the coming Friday / Saturday (1..7). */
  fredagPlus: number;
  loerdagPlus: number;
  /** The two-week deadline for the cable supplier's production slot. */
  slotFrist: string;
  /** The plumber's invoice falls due a week from today. */
  forfald: string;
  /** The day of the earlier meeting about the cable route: three weeks before `dag`. */
  forrige: string;
  /** "8. oktober"-style name of that day. */
  forrigeKort: string;
};

export function fakta(dag: string): Fakta {
  const iso = (hhmm: string, plus = 0): string => isoDato(plusDag(dag, plus), hhmm);
  const forrige = plusDag(dag, -21);
  return {
    dag,
    iso,
    plus: (n) => plusDag(dag, n),
    kort: (n) => kortDato(plusDag(dag, n)),
    lang: (n) => langDato(plusDag(dag, n)),
    fredagPlus: naeste(dag, 5),
    loerdagPlus: naeste(dag, 6),
    slotFrist: kortDato(plusDag(dag, 14)),
    forfald: kortDato(plusDag(dag, 7)),
    forrige,
    forrigeKort: kortDato(forrige),
  };
}
