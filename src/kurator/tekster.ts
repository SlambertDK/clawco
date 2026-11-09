// KC-0170 (slice 3): what the Kuratoren says that reaches the screen — the refusals behind Nu's card buttons (toasts),
// the log lines those buttons write, the labels of its runs (the I gang band) and the run result — in Danish and
// English, in the shape of src/rooms/*/tekster.ts: plain text or small functions, English with exactly Danish's keys
// (the type and test/kurator/tekster.test.ts hold that). Said in the language of the request that causes them
// (sprogNu, set per request by the composition root); a run the clock starts has no request, so it speaks Danish
// (the language of an installation without a profile). Not here, on purpose: Hermes' prompt and the schema's errors
// (addressed to Hermes, Danish), the audit line (a record, not a screen), and the ledger files' table format.

import { sprogNu, type Sprog } from '../store/sprog.ts';
import { tekst } from '../shell/tekster.ts';
import type { DataZone } from '../identitet/zoner.ts';

type Hvor = 'shelfatlas' | 'privat';

const da = {
  /** Which ledger a line went to, inside a sentence. */
  hvor: { shelfatlas: 'ShelfAtlas-regnskabet', privat: 'det private regnskab' } as Record<Hvor, string>,

  // Refusals behind the card buttons (the toast)
  kortFindesIkke: 'Kortet findes ikke',
  ingenVault: 'Ingen vault sat op',
  linjenTabt: 'Linjen står ikke længere i regnskabet',
  forSent: 'I aften kan kun vælges før kl. 17',
  kortHarIngenHandling: 'Kortet har ingen handling',
  kortIkkeSkrevet: 'Kortet er ikke skrevet i et regnskab',
  linjeIkkeIRegnskab: 'Linjen står ikke længere i et regnskab',
  venterIkkePaaValg: 'Kortet venter ikke på et valg af regnskab',
  kortVaekIntetHent: 'Kortet er væk, så der er intet at hente tilbage',
  kortVaekKanIkkeFlyttes: 'Kortet er væk, så linjen kan ikke flyttes; fortryd linjen i stedet',
  linjenFindesIkke: 'Linjen findes ikke',
  alleredeFortrudt: 'Allerede fortrudt',
  kanIkkeFortrydes: 'Kan ikke fortrydes',
  kanIkkeFortrydesHer: 'Kan ikke fortrydes her',

  // What a finished run says
  noteret: 'Noteret.',
  gjort: (label: string): string => `${label}: gjort.`,
  fortrudt: 'Fortrudt.',
  kortTal: (n: number): string => `${n} kort`,

  // The log lines the buttons write
  logSenere: (til: 'aften' | 'morgen', titel: string): string => `Udsat til ${til === 'aften' ? 'i aften kl. 18' : 'i morgen kl. 07'}: ${titel}`,
  logLukkede: (titel: string, grund: string): string => `Lukkede "${titel}"${grund ? `: ${grund}` : ''}`,
  /** KC-0259: a proposed button was dropped because the agent has no tools to run it. */
  logHandlingFjernet: (titel: string): string => `Fjernede knappen på kortet "${titel}": agenten har ingen værktøjer til at køre den`,
  logSkrev: (leverandoer: string, beloeb: string, valuta: string, hvor: Hvor): string => `Skrev ${leverandoer} ${beloeb} ${valuta} ind i ${da.hvor[hvor]}`,
  logFlyttede: (leverandoer: string, beloeb: string, valuta: string, hvor: Hvor): string => `Flyttede ${leverandoer} ${beloeb} ${valuta} til ${da.hvor[hvor]}`,
  logZoneKort: (zone: string, n: number): string => `Kuratoren (${zone}): ${n === 1 ? 'et kort' : `${n} kort`} fra beskeder er lagt øverst.`,

  // The run labels (the I gang band)
  labelLaerer: 'Nu: lærer af dit svar',
  labelLaererStikproeve: 'Nu: lærer af søndagstjekket',
  labelHandling: (label: string): string => `Nu: ${label}`,
  labelFortryder: 'Nu: fortryder',
  labelKuratorGrundigt: 'Kuratoren tænker grundigt',
  labelKurator: 'Kuratoren tænker',
  labelKuratorZone: (zone: string): string => `Kuratoren tænker (${zone})`,

  /** The amount of a bill line Hermes could not read (written to the ledger and shown in Nu). */
  seMail: 'se mail',
};

export type KuratorTekster = typeof da;

const en: KuratorTekster = {
  hvor: { shelfatlas: 'the ShelfAtlas ledger', privat: 'the private ledger' },

  kortFindesIkke: 'The card does not exist',
  ingenVault: 'No vault is set up',
  linjenTabt: 'The line is no longer in the ledger',
  forSent: 'Tonight can only be chosen before 17:00',
  kortHarIngenHandling: 'The card has no action',
  kortIkkeSkrevet: 'The card has not been written to a ledger',
  linjeIkkeIRegnskab: 'The line is no longer in a ledger',
  venterIkkePaaValg: 'The card is not waiting for a choice of ledger',
  kortVaekIntetHent: 'The card is gone, so there is nothing to bring back',
  kortVaekKanIkkeFlyttes: 'The card is gone, so the line cannot be moved; undo the line instead',
  linjenFindesIkke: 'The line does not exist',
  alleredeFortrudt: 'Already undone',
  kanIkkeFortrydes: 'Cannot be undone',
  kanIkkeFortrydesHer: 'Cannot be undone here',

  noteret: 'Noted.',
  gjort: (label) => `${label}: done.`,
  fortrudt: 'Undone.',
  kortTal: (n) => (n === 1 ? '1 card' : `${n} cards`),

  logSenere: (til, titel) => `Snoozed until ${til === 'aften' ? 'tonight at 18:00' : 'tomorrow at 07:00'}: ${titel}`,
  logLukkede: (titel, grund) => `Closed "${titel}"${grund ? `: ${grund}` : ''}`,
  logHandlingFjernet: (titel) => `Removed the button on the card "${titel}": the agent has no tools to run it`,
  logSkrev: (leverandoer, beloeb, valuta, hvor) => `Wrote ${leverandoer} ${beloeb} ${valuta} into ${en.hvor[hvor]}`,
  logFlyttede: (leverandoer, beloeb, valuta, hvor) => `Moved ${leverandoer} ${beloeb} ${valuta} to ${en.hvor[hvor]}`,
  logZoneKort: (zone, n) => `The curator (${zone}): ${n === 1 ? 'a card' : `${n} cards`} from messages put at the top.`,

  labelLaerer: 'Now: learning from your answer',
  labelLaererStikproeve: 'Now: learning from the Sunday check',
  labelHandling: (label) => `Now: ${label}`,
  labelFortryder: 'Now: undoing',
  labelKuratorGrundigt: 'The curator is thinking hard',
  labelKurator: 'The curator is thinking',
  labelKuratorZone: (zone) => `The curator is thinking (${zone})`,

  seMail: 'see mail',
};

export const KURATOR_TEKSTER: Record<Sprog, KuratorTekster> = { da, en };

/** The strings of the language of the request (Danish when none is set — also for a run the clock starts). */
export const kuratorTekst = (): KuratorTekster => KURATOR_TEKSTER[sprogNu()];

/** A zone's name in the language of the request, for a sentence: Danish lower-cased as before, English as the shell's table spells it. */
export const zoneOrd = (zone: DataZone): string => tekst().zone[zone];
