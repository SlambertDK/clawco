// KC-0170: the words of the messages connector, Danish and English (the shape of src/kilder/tekster.ts): the card and the
// panel's list, the setup sentences, the refusals and the health words — plus the few words a shaped message carries as
// data (the placeholder for an unknown sender and for an id taken out of a text), which are written in the language the read
// runs in. The channel names (Telegram, WhatsApp, Signal) are product names and stay as they are in both tables; the commands
// in GENFORBIND_KANAL (../helbred-tekst.ts) are literal commands.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Beskeder',
  handling: { forbind: 'Forbind', gemValget: 'Gem valget' },
  ingenKanal: 'Clawco kan læse de beskeder, der når Hermes på Telegram, WhatsApp eller Signal, og vise dem, der kræver noget af dig, i Nu. '
    + 'Hermes skriver ingen beskeder til Clawco endnu: Hermes skal have en beskedkanal, og Clawcos beskedkrog skal være sat op hos Hermes. '
    + 'Clawco læser kun og svarer aldrig selv.',
  erlig: 'Clawco læser kun de samtaler, du vælger, og svarer aldrig selv. Andre samtaler ser hverken Hermes eller Clawco.',
  ingenBeskeder: (erlig: string): string => `Hermes har ikke modtaget nogen beskeder endnu. Skriv til Hermes på en af dine kanaler, så står samtalen her. ${erlig}`,
  og: 'og',
  anden: 'anden',
  andre: 'andre',
  samtaleOrd: (n: number): string => (n === 1 ? 'samtale' : 'samtaler'),

  // time since
  min: (n: number): string => `${n} min`,
  timer: (t: number): string => `${t} ${t === 1 ? 'time' : 'timer'}`,
  dage: (d: number): string => `${d} dage`,

  // the card
  ser: (antal: number, kanaler: string, navne: string): string => `Hermes kan se ${antal} ${antal === 1 ? 'samtale' : 'samtaler'} på ${kanaler}: ${navne}.`,
  laeser: (valgte: number, antal: number, navne: string): string => `Clawco læser ${valgte} af ${antal} samtaler: ${navne}.`,
  vaelg: 'Vælg, hvilke Clawco må læse; grupper er fra, til du vælger dem.',
  kortSamlet: (ser: string, laeser: string, erlig: string): string => `${ser} ${laeser} ${erlig}`,

  // the fields and the panel
  standardNavn: (gruppe: boolean, kanal: string): string => `${gruppe ? 'Gruppe' : 'Samtale'} på ${kanal}`,
  laesIkke: 'Læs ikke',
  laesZone: (zone: string): string => `Læs, ${zone}`,
  felt: (navn: string, gruppe: boolean, kanal: string): string => `${navn} (${gruppe ? 'gruppe' : 'samtale'} på ${kanal})`,
  /** The zones in the choice's label, lower case. */
  zone: { privat: 'privat', arbejde: 'arbejde', husstand: 'husstand' } as Record<string, string>,

  // setup, choice and health
  laeserNu: (navne: string): string => `Clawco læser nu ${navne}.`,
  laeserIngen: 'Clawco læser ingen samtaler endnu.',
  laeserNuAf: (valgte: number, antal: number): string => `Clawco læser nu ${valgte} af ${antal} ${antal === 1 ? 'samtale' : 'samtaler'}.`,
  ingenValgt: 'Ingen samtaler er valgt.',
  seneste: (siden: string): string => `Seneste besked for ${siden} siden.`,

  // refusals
  loggenKunneIkkeLaeses: 'Hermes’ beskedlog kunne ikke læses.',
  ingenBeskederEndnu: 'Hermes skriver ingen beskeder til Clawco endnu.',
  saetKrogOp: 'Hermes skriver ingen beskeder til Clawco endnu. Sæt Clawcos beskedkrog op hos Hermes først.',
  ukendtSamtale: 'Den samtale kender Clawco ikke. Prøv igen.',

  // data words of a shaped message
  ukendtAfsender: 'ukendt afsender',
  skjult: '[skjult]',
  nummer: '[nummer]',
  vedhaeftning: 'vedhæftning',
  ukendtType: 'ukendt',
};

export type BeskederTekster = typeof da;

const en: BeskederTekster = {
  navn: 'Messages',
  handling: { forbind: 'Connect', gemValget: 'Save the choice' },
  ingenKanal: 'Clawco can read the messages that reach Hermes on Telegram, WhatsApp or Signal, and show the ones that need something from you in Now. '
    + 'Hermes is not writing any messages to Clawco yet: Hermes needs a message channel, and Clawco\'s message hook has to be set up at Hermes. '
    + 'Clawco only reads and never replies itself.',
  erlig: 'Clawco only reads the conversations you choose, and never replies itself. Neither Hermes nor Clawco sees other conversations.',
  ingenBeskeder: (erlig) => `Hermes has not received any messages yet. Write to Hermes on one of your channels, and the conversation appears here. ${erlig}`,
  og: 'and',
  anden: 'other',
  andre: 'others',
  samtaleOrd: (n) => (n === 1 ? 'conversation' : 'conversations'),

  min: (n) => `${n} min`,
  timer: (t) => `${t} ${t === 1 ? 'hour' : 'hours'}`,
  dage: (d) => `${d} days`,

  ser: (antal, kanaler, navne) => `Hermes can see ${antal} ${antal === 1 ? 'conversation' : 'conversations'} on ${kanaler}: ${navne}.`,
  laeser: (valgte, antal, navne) => `Clawco reads ${valgte} of ${antal} conversations: ${navne}.`,
  vaelg: 'Choose which ones Clawco may read; groups are off until you choose them.',
  kortSamlet: (ser, laeser, erlig) => `${ser} ${laeser} ${erlig}`,

  standardNavn: (gruppe, kanal) => `${gruppe ? 'Group' : 'Conversation'} on ${kanal}`,
  laesIkke: 'Do not read',
  laesZone: (zone) => `Read, ${zone}`,
  felt: (navn, gruppe, kanal) => `${navn} (${gruppe ? 'group' : 'conversation'} on ${kanal})`,
  zone: { privat: 'private', arbejde: 'work', husstand: 'household' },

  laeserNu: (navne) => `Clawco now reads ${navne}.`,
  laeserIngen: 'Clawco reads no conversations yet.',
  laeserNuAf: (valgte, antal) => `Clawco now reads ${valgte} of ${antal} ${antal === 1 ? 'conversation' : 'conversations'}.`,
  ingenValgt: 'No conversations are chosen.',
  seneste: (siden) => `Latest message ${siden} ago.`,

  loggenKunneIkkeLaeses: 'Hermes’ message log could not be read.',
  ingenBeskederEndnu: 'Hermes is not writing any messages to Clawco yet.',
  saetKrogOp: 'Hermes is not writing any messages to Clawco yet. Set up Clawco\'s message hook at Hermes first.',
  ukendtSamtale: 'Clawco does not know that conversation. Try again.',

  ukendtAfsender: 'unknown sender',
  skjult: '[hidden]',
  nummer: '[number]',
  vedhaeftning: 'attachment',
  ukendtType: 'unknown',
};

export const BESKEDER_TEKSTER = { da, en };
export const beskederTekst = (): BeskederTekster => efterSprog(BESKEDER_TEKSTER);
