// KC-0170: the Dagen room's strings, Danish and English, in the shape of src/rooms/start/tekster.ts (which says how the
// language is chosen): plain text or small functions, escaped by render.ts. English must have exactly Danish's keys (the
// type and test/rooms/dagen-tekster.test.ts hold that). Render code calls dagenTekst() at render time, never at load.
// Not here (follow-up): ActionError messages, log texts, the prompts, the week's source and the spoken view.

import { sprogNu } from '../../shell/tekster.ts';
import { dagenGammel, type DagenState, type KalenderPost } from './schema.ts';
import type { LogEntry } from '../../store/types.ts';

const da = {
  /** The weekday names, Sunday first (the order of Date#getUTCDay). */
  dage: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
  maaneder: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  /** "Mandag 26. okt": weekday, day of the month, month. */
  datoLinje: (dag: string, dato: number, maaned: string): string => `${dag} ${dato}. ${maaned}`,

  // What the room reports to Nu
  nuIkkeBygget: 'Dagen er ikke bygget i dag',
  nuAnbefaling: (tekst: string): string => `Anbefaling: ${tekst}`,
  nuAftale: (handling: string, titel: string, tid: string): string => `${handling}: ${titel} kl. ${tid}`,

  // The header and the empty room
  rum: 'Dagen',
  opdater: 'Opdatér',
  opdaterTitel: 'Bed Hermes bygge dagen igen',
  ingenData: 'Ingen data endnu',
  ingenDataIDagEndnu: 'Ingen data for i dag endnu.',
  rummetErTomt: 'Rummet er tomt',
  tomForklaring: 'Kiras morgenavis bygger normalt dagens data kl. 7. Hermes kan hente dem nu med sine egne værktøjer; det tager et par minutter.',
  bedHermesHente: 'Bed Hermes hente dagen',

  // The overview
  anbefaling: 'Anbefaling',
  anbefalingen: (tekst: string): string => `Anbefalingen: ${tekst}`,
  dagenITreLinjer: 'Dagen i tre linjer',

  // The calendar
  kalender: 'Kalender',
  antalAftaler: (n: number): string => `${n} aftaler`,
  ingenAftaler: 'Ingen tidsatte aftaler i dag.',
  moedet: (tid: string, titel: string): string => `Mødet kl. ${tid}: ${titel}`,
  kalenderStatus: { klar: 'klar', flyttet: 'flyttet', aflyst: 'aflyst' } as Record<NonNullable<KalenderPost['status']>, string>,

  // The morning paper and the week
  morgenavisen: 'Morgenavisen',
  antalValgt: (n: number): string => `${n} valgt`,
  nyheden: (titel: string): string => `Nyheden: ${titel}`,
  ugenFrem: 'Ugen frem',
  antalDage: (n: number): string => `${n} dage`,

  // The bands
  dagenErIkkeBygget: 'Dagen er ikke bygget',
  hermesArbejdeIDag: "Hermes' arbejde i dag",
  fortryd: 'Fortryd',
  fortrudtKl: 'Fortrudt kl. ',

  // The "not built yet" card
  ikkeByggetTekst: 'Morgenbygningen har ikke lavet dagen for i dag. Hermes kan bygge den nu; det tager et par minutter.',
  bygNu: 'Byg Dagen nu',
};

export type DagenTekster = typeof da;

const en: DagenTekster = {
  dage: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  maaneder: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  datoLinje: (dag, dato, maaned) => `${dag} ${dato} ${maaned}`,

  nuIkkeBygget: 'Today has not been built',
  nuAnbefaling: (tekst) => `Recommendation: ${tekst}`,
  nuAftale: (handling, titel, tid) => `${handling}: ${titel} at ${tid}`,

  rum: 'Today',
  opdater: 'Refresh',
  opdaterTitel: 'Ask Hermes to build the day again',
  ingenData: 'No data yet',
  ingenDataIDagEndnu: 'No data for today yet.',
  rummetErTomt: 'The room is empty',
  tomForklaring: "Kira's morning paper normally builds today's data at 7. Hermes can fetch it now with its own tools; it takes a couple of minutes.",
  bedHermesHente: 'Ask Hermes to fetch the day',

  anbefaling: 'Recommendation',
  anbefalingen: (tekst) => `Recommendation: ${tekst}`,
  dagenITreLinjer: 'The day in three lines',

  kalender: 'Calendar',
  antalAftaler: (n) => (n === 1 ? '1 appointment' : `${n} appointments`),
  ingenAftaler: 'No timed appointments today.',
  moedet: (tid, titel) => `Meeting at ${tid}: ${titel}`,
  kalenderStatus: { klar: 'ready', flyttet: 'moved', aflyst: 'cancelled' },

  morgenavisen: 'The morning paper',
  antalValgt: (n) => `${n} picked`,
  nyheden: (titel) => `News item: ${titel}`,
  ugenFrem: 'The week ahead',
  antalDage: (n) => (n === 1 ? '1 day' : `${n} days`),

  dagenErIkkeBygget: 'Today is not built',
  hermesArbejdeIDag: "Hermes' work today",
  fortryd: 'Undo',
  fortrudtKl: 'Undone at ',

  ikkeByggetTekst: "The morning build has not produced today's overview. Hermes can build it now; it takes a couple of minutes.",
  bygNu: 'Build today now',
};

export const DAGEN_TEKSTER = { da, en };

/** The Dagen strings of the language being rendered (Danish when none is chosen). */
export const dagenTekst = (): DagenTekster => DAGEN_TEKSTER[sprogNu()];

/**
 * What in Dagen waits on the person, one line each, in the language being rendered: ventendeDagen's list (schema.ts)
 * word for word in Danish. The selection is the same; test/rooms/dagen-tekster.test.ts holds the two lists equal in
 * Danish and the same length in English, so the nav's count and Nu's lines cannot drift.
 */
export function ventendeLinjer(state: DagenState | null, log: LogEntry[], now: Date): string[] {
  if (!state) return [];
  const t = dagenTekst();
  const gammel = dagenGammel(state, now);
  if (gammel) return gammel === 'byg' ? [t.nuIkkeBygget] : [];
  const done = new Set(log.filter((e) => e.handlingId && !e.fortrudt).map((e) => e.handlingId));
  const ud: string[] = [];
  if (state.anbefaling.handling && !done.has(state.anbefaling.handling.id)) ud.push(t.nuAnbefaling(state.anbefaling.tekst));
  for (const k of state.kalender) if (k.handling && !done.has(k.handling.id)) ud.push(t.nuAftale(k.handling.label, k.titel, k.tid));
  return ud;
}
