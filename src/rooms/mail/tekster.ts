// KC-0170: the Mail room's strings, Danish and English, in the shape of src/rooms/start/tekster.ts (which says how the
// language is chosen): plain text or small functions, escaped by render.ts. English must have exactly Danish's keys (the
// type and test/rooms/mail-tekster.test.ts hold that). Render code calls mailTekst() at render time, never at load.
// The refusals (toasts), the log lines, the run labels (the I gang band), the read-only answer, the placeholders for a
// mail without a subject or sender and the status line are here too (slice 3): said in the language of the request that
// causes them. Not here, on purpose: the prompts and the schema's errors (addressed to Hermes, Danish) and the spoken
// view. The Proton folder names (Handling, Afventer, Regninger) are names, not words: they stay as they are.

import { sprogNu } from '../../shell/tekster.ts';
import { statusISprog, type StatusArt } from '../status.ts';
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

  // Refusals (the toast)
  fejlFindesIkke: 'Mailen findes ikke i rummet',
  laeseKunSvar: 'Clawco kan kun læse denne mailkonto, så mailen flyttes og besvares i din egen mailapp.',
  kanIkkeSende: 'Clawco kan ikke sende mail herfra. Gem svaret som kladde, og send det fra din mailapp.',
  svaretTomt: 'Svaret er tomt',
  alleredeSendtEllerFaerdig: 'Mailen er allerede sendt eller færdig',
  alleredeFaerdig: 'Mailen er allerede færdig',
  vaelgMindstEn: 'Vælg mindst én mail',
  andetAtGoere: 'Mailen har andet at gøre end Færdig',
  kunneIkkeLaeses: (fejl: string): string => `Mailen kunne ikke læses: ${fejl}`,

  // What a finished run says, and its empty answers
  faerdigFlyttes: (mappe: string): string => `Færdig. Flyttes til ${mappe}.`,
  arkivet: 'arkivet',
  mailFaerdig: (n: number): string => (n === 1 ? '1 mail færdig.' : `${n} mails færdige.`),
  kladdeGemt: 'Kladden er gemt.',
  sendtTekst: 'Sendt.',
  flyttet: 'Flyttet.',
  fortrudt: 'Fortrudt.',
  gjort: (label: string): string => `${label}: gjort.`,
  intetSvar: '(intet svar)',

  // The room's log (in the language of the request that caused the line)
  logLaeste: (n: number, sorteret: number): string => `Hermes læste Handling (${n} mails, ${sorteret} sorteret i dag).`,
  logKunneIkkeLaese: (liste: string): string => ` Kunne ikke læse: ${liste}.`,
  logLaesteIndbakke: (n: number): string => `Hermes læste indbakken (${n} mails).`,
  logLaesteIndbakkeKun: (n: number): string => `Hermes læste indbakken (${n} ulæste eller markerede mails).`,
  logFaerdigMed: (emne: string, mappe: string): string => `Færdig med "${emne}"; flyttes til ${mappe} i baggrunden.`,
  logIkkeFlyttet: (emne: string, fejl: string): string => `Mailen "${emne}" blev ikke flyttet: ${fejl}`,
  skjultTitel: (til: string): string => `Mail lagt i ${til}`,

  // The run labels (the I gang band)
  labelFlytterTilbage: 'Mail: flytter mailen tilbage',
  labelSender: (emne: string): string => `Mail: sender svar på "${emne}"`,
  labelFlytter: (emne: string, mappe: string): string => `Mail: flytter "${emne}" til ${mappe}`,
  labelGemmerKladde: (emne: string): string => `Mail: gemmer kladden til "${emne}"`,
  labelFlytterArkiv: (emne: string): string => `Mail: flytter "${emne}" til arkivet`,

  // Placeholders for a mail without a subject or a sender, and the status the room stores when Hermes gave none
  udenEmne: '(uden emne)',
  ukendtAfsender: '(ukendt afsender)',
  foelger: 'Holder øje med Handling',
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

  fejlFindesIkke: 'The mail is not in the room',
  laeseKunSvar: 'Clawco can only read this mail account, so the mail is moved and answered in your own mail app.',
  kanIkkeSende: 'Clawco cannot send mail from here. Save the reply as a draft and send it from your mail app.',
  svaretTomt: 'The reply is empty',
  alleredeSendtEllerFaerdig: 'The mail has already been sent or is done',
  alleredeFaerdig: 'The mail is already done',
  vaelgMindstEn: 'Choose at least one mail',
  andetAtGoere: 'This mail needs more than Done',
  kunneIkkeLaeses: (fejl) => `The mail could not be read: ${fejl}`,

  faerdigFlyttes: (mappe) => `Done. Moving to ${mappe}.`,
  arkivet: 'the archive',
  mailFaerdig: (n) => (n === 1 ? '1 mail done.' : `${n} mails done.`),
  kladdeGemt: 'The draft is saved.',
  sendtTekst: 'Sent.',
  flyttet: 'Moved.',
  fortrudt: 'Undone.',
  gjort: (label) => `${label}: done.`,
  intetSvar: '(no answer)',

  logLaeste: (n, sorteret) => `Hermes read Handling (${n} mails, ${sorteret} sorted today).`,
  logKunneIkkeLaese: (liste) => ` Could not read: ${liste}.`,
  logLaesteIndbakke: (n) => `Hermes read the inbox (${n} mails).`,
  logLaesteIndbakkeKun: (n) => `Hermes read the inbox (${n} unread or flagged mails).`,
  logFaerdigMed: (emne, mappe) => `Done with "${emne}"; moving it to ${mappe} in the background.`,
  logIkkeFlyttet: (emne, fejl) => `The mail "${emne}" was not moved: ${fejl}`,
  skjultTitel: (til) => `Mail put in ${til}`,

  labelFlytterTilbage: 'Mail: moving the mail back',
  labelSender: (emne) => `Mail: sending the reply to "${emne}"`,
  labelFlytter: (emne, mappe) => `Mail: moving "${emne}" to ${mappe}`,
  labelGemmerKladde: (emne) => `Mail: saving the draft for "${emne}"`,
  labelFlytterArkiv: (emne) => `Mail: moving "${emne}" to the archive`,

  udenEmne: '(no subject)',
  ukendtAfsender: '(unknown sender)',
  foelger: 'Watching Handling',
};

export const MAIL_TEKSTER = { da, en };

/** The Mail strings of the language being rendered (Danish when none is chosen). */
export const mailTekst = (): MailTekster => MAIL_TEKSTER[sprogNu()];

/** The things the room stores in its state that are words: the status, and a mail's placeholder subject and sender. */
const STATUS: StatusArt[] = [{ da: da.foelger, en: en.foelger }];
const EMNE: StatusArt = { da: da.udenEmne, en: en.udenEmne };
const AFSENDER: StatusArt = { da: da.ukendtAfsender, en: en.ukendtAfsender };

/** A stored status in the language of the request. */
export const mailStatus = (lagret: string): string => statusISprog(lagret, STATUS, sprogNu());
/** A mail's subject / sender as shown: the placeholder the room stored in either language reads in the language of the request. */
export const mailEmne = (emne: string): string => statusISprog(emne, [EMNE], sprogNu());
export const mailFra = (fra: string): string => statusISprog(fra, [AFSENDER], sprogNu());
/** Whether a stored subject is the placeholder (in either language): Hermes had none, and the real one comes from the envelope. */
export const erUdenEmne = (emne: string): boolean => emne === da.udenEmne || emne === en.udenEmne;
