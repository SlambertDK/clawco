// KC-0170: the Skrive room's strings (render.ts and the Nu line in room.ts), Danish and English, in the shape of
// src/shell/tekster.ts (which also says which language is being rendered). Plain text or small functions: render.ts
// escapes all of it. English must have exactly Danish's keys (the type and test/rooms/skrive-tekster.test.ts hold
// that). The refusals (toasts), the log lines, the status lines and the note's heading are here too (slice 3): they are
// said in the language of the request that causes them. Not here, on purpose: the prompt and the schema's errors
// (addressed to Hermes, Danish), and the voice (stemme.ts).

import { sprogNu } from '../../shell/tekster.ts';
import { statusISprog, type StatusArt } from '../status.ts';

const da = {
  /** The separator between hours and minutes: Copenhagen's "10.04". */

  // Header and room chrome
  undertitel: 'Du siger hvad. Hermes skriver. Du bruger eller afviser.',
  kopier: 'Kopiér',
  hentSomFil: 'Hent som fil',
  gemIObsidian: 'Gem i Obsidian',
  gemIgenIObsidian: 'Gem igen i Obsidian',
  statusGemmer: 'gemmer i Obsidian',
  hermesForslagGruppe: 'Hermes\' forslag',
  aendringer: 'Ændringer',

  // The documents row
  nytUdkastChip: '+ Nyt udkast',
  statusSkifter: 'skifter',
  statusSkriver: 'skriver udkast',

  // The open document
  udkastet: (titel: string): string => `Udkastet: ${titel}`,
  aendretKl: (kl: string): string => `ændret ${kl}`,
  brief: (b: string): string => `Brief: ${b}`,
  heleTeksten: 'Hele teksten',
  kilderIUdkastet: 'Kilder i udkastet',
  gemtIObsidian: (som: string): string => `Gemt i Obsidian: ${som}`,
  ingenUdkast: 'Ingen udkast endnu',
  ingenUdkastTekst: 'Beskriv, hvad Hermes skal skrive, så kommer det første udkast her som afsnit, du kan pege på.',

  // Paragraphs and proposals
  afsnit: (nr: number): string => `Afsnit ${nr}`,
  nytAfsnitEfter: (nr: number): string => `Nyt afsnit efter afsnit ${nr}`,
  stramOp: 'Stram op',
  goerKonkret: 'Gør mere konkret',
  kortere: 'Kortere',
  forslagTil: (hvor: string): string => `Forslag til ${hvor.toLowerCase()}`,
  hermesForeslaar: (hvor: string): string => `Hermes foreslår · ${hvor}`,
  brug: 'Brug',
  afvis: 'Afvis',

  // The change log
  fortrudtKl: (kl: string): string => `Fortrudt kl. ${kl}`,
  fortryd: 'Fortryd',

  // The new-draft form
  nytUdkast: 'Nyt udkast',
  titelValgfri: 'Titel (valgfri)',
  titelPlaceholder: 'Fx Mail til driften om vinterberedskab',
  briefSpoergsmaal: 'Hvad skal Hermes skrive? Til hvem, hvilken tone, hvor langt.',
  briefPlaceholder: 'Kort mail til Tom om, at vi strammer reserverne fra december. Venlig, konkret, højst fem linjer.',
  skrivUdkastet: 'Skriv udkastet',

  // The Nu line (what waits on you, reported to Nu)
  nuForslag: (titel: string): string => `Forslag til "${titel}"`,
  udkast: 'udkast',

  // Refusals (the toast) and the errors of a run
  fejlUdkastFindesIkke: 'Udkastet findes ikke',
  fejlUdkastVaek: 'Udkastet findes ikke længere',
  fejlAfsnitFindesIkke: 'Afsnittet findes ikke',
  fejlForslagVaek: 'Forslaget findes ikke længere',
  fejlBriefMangler: 'Skriv hvad Hermes skal skrive (brief mangler)',
  fejlIngenMappe: 'Ingen Obsidian-mappe sat op (KC_VAULT_INBOX)',

  // What a finished run says (the toast) and the chat's empty answer
  forslagBrugt: 'Forslaget er brugt.',
  gemtSom: (navn: string): string => `Gemt som ${navn}`,
  fortrudt: 'Fortrudt.',
  fjernedeNoten: 'Fjernede noten fra Obsidian-indbakken igen.',
  notenAendret: 'Noten er ændret eller væk; lod den være.',
  fjernedeAfsnit: 'Fjernede det indsatte afsnit igen.',
  satteTilbage: 'Satte afsnittet tilbage.',
  intetSvar: '(intet svar)',

  // The room's log (written in the language of the request that caused the line)
  logSkrev: (titel: string, n: number): string => `Skrev udkastet "${titel}" (${n} afsnit).`,
  hvorNytAfsnit: 'nyt afsnit',
  hvorAfsnitNr: (nr: number): string => `afsnit ${nr}`,
  logBrugte: (hvor: string, titel: string): string => `Brugte Hermes' forslag til ${hvor} i "${titel}".`,
  logGemte: (titel: string, navn: string): string => `Gemte "${titel}" i Obsidian-indbakken (${navn}).`,

  // The status line the room stores, and the heading of the saved note
  klar: 'Klar til at skrive',
  skriverMed: (titel: string): string => `Skriver med på "${titel}"`,
  kilderOverskrift: 'Kilder',

  /** The spoken view (stemme.ts). */
  stemme: {
    igang: (titel: string): string => `Et udkast er i gang: ${titel}.`,
    intet: 'Intet udkast i gang.',
  },
};

export type SkriveTekster = typeof da;

const en: SkriveTekster = {

  undertitel: 'You say what. Hermes writes. You use it or dismiss it.',
  kopier: 'Copy',
  hentSomFil: 'Download as file',
  gemIObsidian: 'Save to Obsidian',
  gemIgenIObsidian: 'Save to Obsidian again',
  statusGemmer: 'saving to Obsidian',
  hermesForslagGruppe: 'Hermes\' proposals',
  aendringer: 'Changes',

  nytUdkastChip: '+ New draft',
  statusSkifter: 'switching',
  statusSkriver: 'writing a draft',

  udkastet: (titel: string): string => `The draft: ${titel}`,
  aendretKl: (kl: string): string => `changed ${kl}`,
  brief: (b: string): string => `Brief: ${b}`,
  heleTeksten: 'The whole text',
  kilderIUdkastet: 'Sources in the draft',
  gemtIObsidian: (som: string): string => `Saved to Obsidian: ${som}`,
  ingenUdkast: 'No drafts yet',
  ingenUdkastTekst: 'Describe what Hermes should write, and the first draft appears here as paragraphs you can point at.',

  afsnit: (nr: number): string => `Paragraph ${nr}`,
  nytAfsnitEfter: (nr: number): string => `New paragraph after paragraph ${nr}`,
  stramOp: 'Tighten',
  goerKonkret: 'Make more concrete',
  kortere: 'Shorter',
  forslagTil: (hvor: string): string => `Proposal for ${hvor.toLowerCase()}`,
  hermesForeslaar: (hvor: string): string => `Hermes proposes · ${hvor}`,
  brug: 'Use',
  afvis: 'Dismiss',

  fortrudtKl: (kl: string): string => `Undone at ${kl}`,
  fortryd: 'Undo',

  nytUdkast: 'New draft',
  titelValgfri: 'Title (optional)',
  titelPlaceholder: 'E.g. Mail to ops about winter readiness',
  briefSpoergsmaal: 'What should Hermes write? To whom, what tone, how long.',
  briefPlaceholder: 'Short mail to Tom saying we are tightening the reserves from December. Friendly, concrete, five lines at most.',
  skrivUdkastet: 'Write the draft',

  nuForslag: (titel: string): string => `Proposal for "${titel}"`,
  udkast: 'draft',

  fejlUdkastFindesIkke: 'The draft does not exist',
  fejlUdkastVaek: 'The draft no longer exists',
  fejlAfsnitFindesIkke: 'The paragraph does not exist',
  fejlForslagVaek: 'The proposal no longer exists',
  fejlBriefMangler: 'Say what Hermes should write (the brief is missing)',
  fejlIngenMappe: 'No Obsidian folder is set up (KC_VAULT_INBOX)',

  forslagBrugt: 'The proposal has been used.',
  gemtSom: (navn: string): string => `Saved as ${navn}`,
  fortrudt: 'Undone.',
  fjernedeNoten: 'Removed the note from the Obsidian inbox again.',
  notenAendret: 'The note has been changed or is gone; left it alone.',
  fjernedeAfsnit: 'Removed the inserted paragraph again.',
  satteTilbage: 'Put the paragraph back.',
  intetSvar: '(no answer)',

  logSkrev: (titel: string, n: number): string => `Wrote the draft "${titel}" (${n} ${n === 1 ? 'paragraph' : 'paragraphs'}).`,
  hvorNytAfsnit: 'a new paragraph',
  hvorAfsnitNr: (nr: number): string => `paragraph ${nr}`,
  logBrugte: (hvor: string, titel: string): string => `Used Hermes' proposal for ${hvor} in "${titel}".`,
  logGemte: (titel: string, navn: string): string => `Saved "${titel}" to the Obsidian inbox (${navn}).`,

  klar: 'Ready to write',
  skriverMed: (titel: string): string => `Writing along on "${titel}"`,
  kilderOverskrift: 'Sources',

  stemme: {
    igang: (titel) => `A draft is in progress: ${titel}.`,
    intet: 'No draft in progress.',
  },
};

export const SKRIVE_TEKSTER = { da, en };

/** The strings of the language being rendered (read at render time, never at module load). */
export const skriveTekst = (): SkriveTekster => SKRIVE_TEKSTER[sprogNu()];

/** The status kinds the room stores (a stored Danish one still reads in English, and the other way round). */
const STATUS: StatusArt[] = [
  { da: da.klar, en: en.klar },
  { da: da.skriverMed, en: en.skriverMed },
];

/** A stored status in the language of the request. */
export const skriveStatus = (lagret: string): string => statusISprog(lagret, STATUS, sprogNu());
