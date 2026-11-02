// KC-0170: the Nyheder room's strings (render.ts and the Nu line in room.ts), Danish and English, in the shape of
// src/shell/tekster.ts (which also says which language is being rendered). Plain text or small functions: render.ts
// escapes all of it. English must have exactly Danish's keys (the type and test/rooms/nyheder-tekster.test.ts hold
// that). Not here (follow-up): the ActionError messages and the log lines in room.ts, the prompt, the schema, the
// merge and the voice (stemme.ts); the freshness phrase and the zone names come from src/shell/.

import { sprogNu } from '../../shell/tekster.ts';
import type { RelevansFor } from './schema.ts';

const da = {
  /** The separator between hours and minutes: Copenhagen's "10.04". */

  // Header
  undertitel: (medNyheder: number, antal: number, nyheder: number): string => `Morgenavisen, udvalgt af Hermes · ${medNyheder} af ${antal} kilder svarede, ${nyheder} nyheder`,
  opdater: 'Opdatér',
  opdaterTitel: 'Bed Hermes udvælge igen',

  // Content
  femLinjer: 'I dag i fem linjer',
  banerne: 'Banerne',
  baneElement: (navn: string): string => `Banen: ${navn}`,
  nyhedElement: (titel: string): string => `Nyheden: ${titel}`,
  relevans: { mig: 'Mig', familie: 'Familien', arbejde: 'Arbejde', danmark: 'Danmark', holdning: 'Holdning', projekter: 'Projekter' } as Record<RelevansFor, string>,
  gemt: 'Gemt',
  gemTilSenere: 'Gem til senere',
  statusGemmer: 'gemmer til senere',
  kilderFejlede: (liste: string): string => `Kilder, der ikke svarede i dag: ${liste}.`,

  // The bands
  hermesForeslaar: 'Hermes foreslår',
  hermesForeslog: 'Hermes foreslog',
  nyhedsbreveArkiveret: 'Nyhedsbreve arkiveret i dag',
  hermesArbejde: 'Hermes\' arbejde i rummet',
  forslagElement: (tekst: string): string => `Forslaget: ${tekst}`,
  svarIChatten: 'Svar i chatten, hvis du vil.',
  nyhedsbrevElement: (emne: string): string => `Nyhedsbrevet: ${emne}`,

  // The change log
  fortrudtKl: (kl: string): string => `Fortrudt kl. ${kl}`,
  fortryd: 'Fortryd',

  // The empty room
  ingenAvisEndnu: 'Ingen avis endnu',
  rummetErTomt: 'Rummet er tomt',
  ingenAvis: 'Ingen avis for i dag endnu.',
  henterNormalt: 'Kiras morgenavis henter normalt kilderne kl. 7. Hermes kan hente dem nu; det tager et par minutter.',
  hentAvisen: 'Bed Hermes hente avisen',

  // The Nu line (what waits on you, reported to Nu)
  nuForslag: (tekst: string): string => `Nyheder: ${tekst}`,
};

export type NyhederTekster = typeof da;

const en: NyhederTekster = {

  undertitel: (medNyheder: number, antal: number, nyheder: number): string => `The morning paper, picked by Hermes · ${medNyheder} of ${antal} sources answered, ${nyheder} stories`,
  opdater: 'Refresh',
  opdaterTitel: 'Ask Hermes to pick again',

  femLinjer: 'Today in five lines',
  banerne: 'The lanes',
  baneElement: (navn: string): string => `Lane: ${navn}`,
  nyhedElement: (titel: string): string => `Story: ${titel}`,
  relevans: { mig: 'Me', familie: 'Family', arbejde: 'Work', danmark: 'Denmark', holdning: 'Opinion', projekter: 'Projects' } as Record<RelevansFor, string>,
  gemt: 'Saved',
  gemTilSenere: 'Save for later',
  statusGemmer: 'saving for later',
  kilderFejlede: (liste: string): string => `Sources that did not answer today: ${liste}.`,

  hermesForeslaar: 'Hermes proposes',
  hermesForeslog: 'Hermes proposed',
  nyhedsbreveArkiveret: 'Newsletters archived today',
  hermesArbejde: 'Hermes\' work in the room',
  forslagElement: (tekst: string): string => `Proposal: ${tekst}`,
  svarIChatten: 'Reply in the chat if you like.',
  nyhedsbrevElement: (emne: string): string => `Newsletter: ${emne}`,

  fortrudtKl: (kl: string): string => `Undone at ${kl}`,
  fortryd: 'Undo',

  ingenAvisEndnu: 'No paper yet',
  rummetErTomt: 'The room is empty',
  ingenAvis: 'No paper for today yet.',
  henterNormalt: 'The morning paper normally fetches the sources at 7 a.m. Hermes can fetch them now; it takes a couple of minutes.',
  hentAvisen: 'Ask Hermes to fetch the paper',

  nuForslag: (tekst: string): string => `News: ${tekst}`,
};

export const NYHEDER_TEKSTER = { da, en };

/** The strings of the language being rendered (read at render time, never at module load). */
export const nyhederTekst = (): NyhederTekster => NYHEDER_TEKSTER[sprogNu()];
