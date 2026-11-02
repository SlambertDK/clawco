// KC-0170: the Mail room's strings, Danish and English, in the shape of src/rooms/start/tekster.ts (which says how the
// language is chosen): plain text or small functions, escaped by render.ts. English must have exactly Danish's keys (the
// type and test/rooms/mail-tekster.test.ts hold that). Render code calls mailTekst() at render time, never at load.
// Not here (follow-up): ActionError messages, log texts, the read-only answer, the prompts and the spoken view.
// The Proton folder names (Handling, Afventer, Regninger) are names, not words: they stay as they are.

import { sprogNu } from '../../shell/tekster.ts';
import type { Beslutning } from './schema.ts';

const da = {
  rum: 'Mail',
  /** What the room reports to Nu for each decision that waits. */
  nuLinje: (emne: string): string => `Mail: ${emne}`,
  /** The Intl locale for the received-time ("26. okt. 18.57"). */

  typeLabel: { svar: 'Skal besvares', aktion: 'Du skal gøre noget', info: 'Til orientering', nyhedsbrev: 'Nyhedsbrev', regning: 'Regning', kvittering: 'Kvittering' } as Record<Beslutning['type'], string>,

  // A decision card
  mailen: (emne: string): string => `Mailen: ${emne}`,
  ordnet: 'Ordnet',
  sendt: 'Sendt',
  faerdig: 'Færdig',
  frist: (naar: string): string => `Frist ${naar}`,
  mailNr: (id: string): string => `Mail ${id}`,
  send: 'Send',
  sendBekraeft: (fra: string): string => `Send svaret til ${fra} nu?`,
  sender: 'sender',
  gemSomKladde: 'Gem som kladde',
  gemmerKladden: 'gemmer kladden',
  kopier: 'Kopiér',
  rydderOp: 'rydder op',
  ditSvar: "Dit svar (Hermes' udkast, ret som du vil)",
  seUdkastet: 'Se udkastet',
  hvorfor: 'Hvorfor?',
  fortryd: 'Fortryd',
  fortrudtKl: 'Fortrudt kl. ',
  faerdigMedOrientering: (n: number): string => `Færdig med de ${n} til orientering`,
  faerdigMedKunOrientering: (n: number): string => `Færdig med de ${n}, der kun er til orientering`,

  // The numbers
  talElement: (n: number, hvad: string): string => `Tal: ${n} ${hvad}`,
  ulaeste: 'ulæste eller markerede',
  iIndbakken: 'i indbakken',
  iHandling: 'i Handling',
  iAfventer: 'i Afventer',
  iRegninger: 'i Regninger',

  // The header
  laeseKunTekst: (forbindelse: string): string => `Ulæste og markerede mails i ${forbindelse}. Clawco kan kun læse den, så du flytter og svarer i din egen mailapp.`,
  forbindelseTekst: (forbindelse: string): string => `Indbakken i ${forbindelse}. Færdig flytter mailen til arkivet.`,
  handlingErIndbakke: 'Handling er din indbakke. Hermes sorterer resten.',
  opdater: 'Opdatér',
  opdaterIndbakkenTitel: 'Bed Hermes læse indbakken igen',
  opdaterHandlingTitel: 'Bed Hermes læse Handling igen',

  // The bands
  venterPaaBeslutning: 'Venter på din beslutning',
  afgjort: 'Afgjort',
  ordnetIDag: 'Ordnet af Hermes i dag',
  visAlle: (n: number): string => `Vis alle ${n}`,
  hermesArbejde: "Hermes' arbejde i rummet",

  // The empty room
  ikkeHentet: 'Ikke hentet endnu',
  ikkeHentetEndnu: 'Ikke hentet endnu.',
  rummetErTomt: 'Rummet er tomt',
  tomForklaring: 'Hermes læser mappen Handling i Proton og foreslår, hvad der skal ske med hver mail. Det tager et par minutter.',
  bedHermesLaese: 'Bed Hermes læse Handling',
};

export type MailTekster = typeof da;

const en: MailTekster = {
  rum: 'Mail',
  nuLinje: (emne) => `Mail: ${emne}`,

  typeLabel: { svar: 'Needs a reply', aktion: 'Something to do', info: 'For your information', nyhedsbrev: 'Newsletter', regning: 'Bill', kvittering: 'Receipt' },

  mailen: (emne) => `Mail: ${emne}`,
  ordnet: 'Handled',
  sendt: 'Sent',
  faerdig: 'Done',
  frist: (naar) => `Due ${naar}`,
  mailNr: (id) => `Mail ${id}`,
  send: 'Send',
  sendBekraeft: (fra) => `Send the reply to ${fra} now?`,
  sender: 'sending',
  gemSomKladde: 'Save as draft',
  gemmerKladden: 'saving the draft',
  kopier: 'Copy',
  rydderOp: 'tidying up',
  ditSvar: "Your reply (Hermes' draft, edit as you like)",
  seUdkastet: 'See the draft',
  hvorfor: 'Why?',
  fortryd: 'Undo',
  fortrudtKl: 'Undone at ',
  faerdigMedOrientering: (n) => `Done with the ${n} for your information`,
  faerdigMedKunOrientering: (n) => `Done with the ${n} that are only for your information`,

  talElement: (n, hvad) => `Count: ${n} ${hvad}`,
  ulaeste: 'unread or flagged',
  iIndbakken: 'in the inbox',
  iHandling: 'in Handling',
  iAfventer: 'in Afventer',
  iRegninger: 'in Regninger',

  laeseKunTekst: (forbindelse) => `Unread and flagged mails in ${forbindelse}. Clawco can only read it, so you move and reply in your own mail app.`,
  forbindelseTekst: (forbindelse) => `The inbox in ${forbindelse}. Done moves the mail to the archive.`,
  handlingErIndbakke: 'Handling is your inbox. Hermes sorts the rest.',
  opdater: 'Refresh',
  opdaterIndbakkenTitel: 'Ask Hermes to read the inbox again',
  opdaterHandlingTitel: 'Ask Hermes to read Handling again',

  venterPaaBeslutning: 'Waiting for your decision',
  afgjort: 'Decided',
  ordnetIDag: 'Sorted by Hermes today',
  visAlle: (n) => `Show all ${n}`,
  hermesArbejde: "Hermes' work in the room",

  ikkeHentet: 'Not fetched yet',
  ikkeHentetEndnu: 'Not fetched yet.',
  rummetErTomt: 'The room is empty',
  tomForklaring: 'Hermes reads the Handling folder in Proton and suggests what should happen to each mail. It takes a couple of minutes.',
  bedHermesLaese: 'Ask Hermes to read Handling',
};

export const MAIL_TEKSTER = { da, en };

/** The Mail strings of the language being rendered (Danish when none is chosen). */
export const mailTekst = (): MailTekster => MAIL_TEKSTER[sprogNu()];
