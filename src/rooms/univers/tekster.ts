// KC-0170: the Univers room's strings — the overview, one univers with its task board, the meeting view and the
// Nu line — Danish and English, in the shape of src/shell/tekster.ts (which also says which language is being
// rendered). Plain text or small functions: render.ts escapes all of it. English must have exactly Danish's keys
// (the type and test/rooms/univers-tekster.test.ts hold that). Not here (stays Danish): the Hermes prompts, the log
// lines the room writes, the errors, the archive button and its confirm text (room.ts), and the data-element
// context strings, which are what prompt.ts and room.ts match on.

import { sprogNu } from '../../shell/tekster.ts';
import type { OpgaveStatus } from './schema.ts';

const da = {
  // Time and wording
  /** The separator in a clock time: "11.00". */
  iDag: 'i dag',
  iMorgen: 'i morgen',
  iGaar: 'i går',
  minutter: (n: number): string => `${n} min`,
  timerOgMinutter: (t: number, r: number): string => `${t} t ${r} min`,
  timer: (t: number): string => `${t} t`,
  omVarighed: (v: string): string => `om ${v}`,
  tilbageVarighed: (v: string): string => `${v} tilbage`,
  slut: 'slut',
  nMoeder: (n: number): string => `${n} ${n === 1 ? 'møde' : 'møder'}`,
  nAabneOpgaver: (n: number): string => `${n} ${n === 1 ? 'åben opgave' : 'åbne opgaver'}`,
  nVersioner: (n: number): string => `${n} ${n === 1 ? 'version' : 'versioner'}`,

  // Shared parts
  ingenDeltagere: 'Ingen deltagere noteret',
  mal: 'Mål',
  aabnKnap: 'Åbn',
  forberedt: 'Forberedt',
  ikkeForberedt: 'Ikke forberedt',
  ikkeForberedtPunktum: 'Ikke forberedt.',
  ikkeForberedtEndnu: 'Ikke forberedt endnu',
  deltagere: 'Deltagere',
  titel: 'Titel',
  navn: 'Navn',

  // The prepare form
  forbered: 'Forbered med Hermes',
  forberedIgen: 'Forbered igen',
  forberedIgenFold: 'forbered igen',
  onske: 'Hvad vil du have ud af mødet? (valgfrit)',
  onskeEksempel: 'Fx at få rollen afklaret',
  forbererModet: 'forbereder mødet',

  // The task board
  status: { aaben: 'Åben', igang: 'I gang', faerdig: 'Færdig' } as Record<OpgaveStatus, string>,
  aabnIgen: 'Åben igen',
  moedeChip: 'Møde: ',
  flytter: 'flytter',
  ingen: 'Ingen',
  faerdigeOpgaver: 'færdige opgaver',

  // Meeting cards
  aabnMoedevisningen: 'Åbn mødevisningen',
  talepunkterFold: 'talepunkter',

  // Document cards
  aendret: 'ændret ',
  forhaandsvisning: 'forhåndsvisning',

  // The overview
  nyMoedeHvilket: 'Hvilket univers hører det til?',
  laegIUnivers: 'Læg i univers',
  laegger: 'lægger mødet i univers',
  ikkeEtMoede: 'Ikke et møde for mig',
  skjuler: 'skjuler mødet',
  opretForst: 'Opret først et univers, så kan mødet lægges i det.',
  husstandOm: 'Hvem der er med, og det, der gælder jer alle.',
  dineUniverser: 'Dine universer',
  ingenUniverser: 'Ingen universer endnu',
  ingenUniverserTekst: 'Opret et under, eller bed Hermes i chatten: "lav et univers om min arena".',
  nytUnivers: 'Nyt univers',
  navnEksempel: 'Fx Min arena',
  omHvad: 'Hvad handler det om? En sætning.',
  omEksempel: 'Fx Min nye lederrolle og det, jeg skal levere i den',
  opretUnivers: 'Opret univers',
  opretter: 'opretter univers',
  rumIntro: 'Et sted per emne, der vokser. Alt, du og Hermes laver om emnet, bliver her.',
  nyeMoeder: 'Nye møder',

  // One univers
  alleUniverser: 'Alle universer',
  naeste: 'Næste',
  ingenKommende: 'Ingen kommende møder.',
  nytMoede: 'Nyt møde',
  starter: 'Starter',
  moedeEksempel: 'Fx Pitch til Tom om lederrollen',
  varighedMin: 'Varighed i minutter',
  deltagereIndtast: 'Deltagere (navne eller mails, adskilt af komma)',
  tilfoejMoedet: 'Tilføj mødet',
  tilfoejer: 'tilføjer mødet',
  moeder: 'Møder',
  ingenMoederEndnu: 'Ingen møder endnu. Læg et fra Univers-oversigten, eller tilføj et nedenfor.',
  tidligereMoeder: 'tidligere møder',
  opgaver: 'Opgaver',
  ingenOpgaverEndnu: 'Ingen opgaver endnu. Bed Hermes i chatten om at lave dem, eller forbered et møde.',
  dokumenter: 'Dokumenter',
  ingenDokumenterEndnu: 'Ingen dokumenter endnu. Bed Hermes i chatten om fx en præsentation eller et notat.',
  noter: 'Noter',
  ingenNoterEndnu: 'Ingen noter endnu.',
  hvadErAendret: 'Hvad der er ændret',
  fortrudtKl: 'Fortrudt kl. ',
  fortryd: 'Fortryd',

  // The meeting view
  tilDagen: 'Til Dagen',
  praesentationenFold: 'præsentationen',
  talepunkter: 'Talepunkter',
  vilSandsynligvis: 'Vil sandsynligvis: ',
  baggrund: 'Baggrund',
  opgaverTilMoedet: 'Opgaver til mødet',
  ingenAabneTilMoedet: 'Ingen åbne opgaver til mødet.',
  hermesKanLave: 'Hermes kan lave mål, talepunkter og en præsentation ud fra, hvem der er med.',
  deltagereKolon: (navne: string): string => ` Deltagere: ${navne}.`,

  // Under the bands of one univers (room.ts): the archive button, and the page for a univers that is gone
  erArkiveret: 'Universet er arkiveret: det er skjult i menuen, og alt er bevaret.',
  arkiverKnap: 'Arkivér universet',
  arkiverBekraeft: 'Arkivér universet? Det skjules i menuen, men alt beholdes.',
  arkiverer: 'arkiverer',
  findesIkke: 'Universet findes ikke',
  findesIkkeTekst: 'Det er enten arkiveret for længe siden eller aldrig oprettet. Se alle universer for at finde det, du leder efter.',

  // The Nu line (reported to Nu by the overview)
  nuNyeMoeder: (n: number): string => (n === 1 ? '1 nyt møde venter på et univers' : `${n} nye møder venter på et univers`),
};

export type UniversTekster = typeof da;

const en: UniversTekster = {
  // Time and wording
  iDag: 'today',
  iMorgen: 'tomorrow',
  iGaar: 'yesterday',
  minutter: (n) => `${n} min`,
  timerOgMinutter: (t, r) => `${t} h ${r} min`,
  timer: (t) => `${t} h`,
  omVarighed: (v) => `in ${v}`,
  tilbageVarighed: (v) => `${v} left`,
  slut: 'over',
  nMoeder: (n) => `${n} ${n === 1 ? 'meeting' : 'meetings'}`,
  nAabneOpgaver: (n) => `${n} open ${n === 1 ? 'task' : 'tasks'}`,
  nVersioner: (n) => `${n} ${n === 1 ? 'version' : 'versions'}`,

  // Shared parts
  ingenDeltagere: 'No participants noted',
  mal: 'Goal',
  aabnKnap: 'Open',
  forberedt: 'Prepared',
  ikkeForberedt: 'Not prepared',
  ikkeForberedtPunktum: 'Not prepared.',
  ikkeForberedtEndnu: 'Not prepared yet',
  deltagere: 'Participants',
  titel: 'Title',
  navn: 'Name',

  // The prepare form
  forbered: 'Prepare with Hermes',
  forberedIgen: 'Prepare again',
  forberedIgenFold: 'prepare again',
  onske: 'What do you want out of the meeting? (optional)',
  onskeEksempel: 'E.g. to get the role settled',
  forbererModet: 'preparing the meeting',

  // The task board
  status: { aaben: 'Open', igang: 'In progress', faerdig: 'Done' },
  aabnIgen: 'Reopen',
  moedeChip: 'Meeting: ',
  flytter: 'moving',
  ingen: 'None',
  faerdigeOpgaver: 'done tasks',

  // Meeting cards
  aabnMoedevisningen: 'Open the meeting view',
  talepunkterFold: 'talking points',

  // Document cards
  aendret: 'changed ',
  forhaandsvisning: 'preview',

  // The overview
  nyMoedeHvilket: 'Which universe does it belong to?',
  laegIUnivers: 'Put in universe',
  laegger: 'putting the meeting in the universe',
  ikkeEtMoede: 'Not a meeting for me',
  skjuler: 'hiding the meeting',
  opretForst: 'Create a universe first, then the meeting can be put in it.',
  husstandOm: 'Who is in it, and what applies to all of you.',
  dineUniverser: 'Your universes',
  ingenUniverser: 'No universes yet',
  ingenUniverserTekst: 'Create one below, or ask Hermes in the chat: "make a universe about my arena".',
  nytUnivers: 'New universe',
  navnEksempel: 'E.g. My arena',
  omHvad: 'What is it about? One sentence.',
  omEksempel: 'E.g. My new leadership role and what I am to deliver in it',
  opretUnivers: 'Create universe',
  opretter: 'creating the universe',
  rumIntro: 'One place per topic, and it grows. Everything you and Hermes do on the topic stays here.',
  nyeMoeder: 'New meetings',

  // One univers
  alleUniverser: 'All universes',
  naeste: 'Next',
  ingenKommende: 'No upcoming meetings.',
  nytMoede: 'New meeting',
  starter: 'Starts',
  moedeEksempel: 'E.g. Pitch to Tom about the leadership role',
  varighedMin: 'Duration in minutes',
  deltagereIndtast: 'Participants (names or emails, separated by commas)',
  tilfoejMoedet: 'Add the meeting',
  tilfoejer: 'adding the meeting',
  moeder: 'Meetings',
  ingenMoederEndnu: 'No meetings yet. Put one in from the Universes overview, or add one below.',
  tidligereMoeder: 'earlier meetings',
  opgaver: 'Tasks',
  ingenOpgaverEndnu: 'No tasks yet. Ask Hermes in the chat to make them, or prepare a meeting.',
  dokumenter: 'Documents',
  ingenDokumenterEndnu: 'No documents yet. Ask Hermes in the chat for e.g. a presentation or a memo.',
  noter: 'Notes',
  ingenNoterEndnu: 'No notes yet.',
  hvadErAendret: 'What has changed',
  fortrudtKl: 'Undone at ',
  fortryd: 'Undo',

  // The meeting view
  tilDagen: 'To Today',
  praesentationenFold: 'the presentation',
  talepunkter: 'Talking points',
  vilSandsynligvis: 'Probably wants: ',
  baggrund: 'Background',
  opgaverTilMoedet: 'Tasks for the meeting',
  ingenAabneTilMoedet: 'No open tasks for the meeting.',
  hermesKanLave: 'Hermes can make a goal, talking points and a presentation based on who is coming.',
  deltagereKolon: (navne) => ` Participants: ${navne}.`,

  erArkiveret: 'The universe is archived: it is hidden in the menu, and everything is kept.',
  arkiverKnap: 'Archive the universe',
  arkiverBekraeft: 'Archive the universe? It is hidden in the menu, but everything is kept.',
  arkiverer: 'archiving',
  findesIkke: 'The universe does not exist',
  findesIkkeTekst: 'It was archived long ago or never created. See all universes to find the one you are looking for.',

  // The Nu line (reported to Nu by the overview)
  nuNyeMoeder: (n) => (n === 1 ? '1 new meeting is waiting for a universe' : `${n} new meetings are waiting for a universe`),
};

export const UNIVERS_TEKSTER: { da: UniversTekster; en: UniversTekster } = { da, en };

/** The room's strings in the language being rendered. Call it at render time, never at module load. */
export const universTekst = (): UniversTekster => UNIVERS_TEKSTER[sprogNu()];
