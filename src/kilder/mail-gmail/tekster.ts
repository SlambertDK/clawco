// KC-0170: the words of the Gmail connector, Danish and English (the shape of src/kilder/tekster.ts). The fixed failure
// sentences (GMAIL_FEJLTEKST) are the table's own, read through a constant that follows the language of the request.
// "Gmail", "Google" and the name of the service choice "Mail og Gmail (app-adgangskode)" are provider names / the other
// card's labels (mail-imap/tekster.ts keeps the same words under its service list).

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  fejl: {
    adgang: 'Google afviste adgangen til din Gmail. Log ind med Google igen.',
    tom: 'Clawco har ingen adgang til din Gmail. Log ind med Google igen.',
  },
  fuldAdgang: 'Google kalder tilladelsen "fuld adgang til din Gmail", fordi Google ikke har en smallere tilladelse til mail over IMAP. '
    + 'Clawco bruger den kun til at læse afsender, emne og tid, aldrig selve mailen, og kan hverken sende, flytte eller slette; det sørger Clawcos egen kode for.',
  alternativ: 'Vil du ikke give den tilladelse, kan du i stedet vælge Mail og Gmail (app-adgangskode); det kræver bekræftelse i to trin hos Google.',
  handlingGemOgLogInd: 'Gem og log ind med Google',
  handlingLogIndIgen: 'Log ind med Google igen',
  handlingSkiftKonto: 'Skift Google-konto',
  handlingGivAdgang: 'Giv adgang til mail',
  handlingLogInd: 'Log ind med Google',
  opsaetTekst: (fuld: string, alternativ: string): string => `Første gang laver du din egen lille Google-app, så din mail går direkte fra Google til Clawco, uden en app-adgangskode. Det tager fem minutter, ét trin ad gangen. ${fuld} ${alternativ}`,
  loginIgenTekst: (fejl: string, fuld: string): string => `${fejl} ${fuld}`,
  forbundetSom: (adresse: string): string => `Forbundet som ${adresse}. `,
  forbundet: 'Forbundet. ',
  forbundetTekst: (hvem: string, fuld: string): string => `${hvem}${fuld}`,
  tilfoejTekst: (fuld: string, alternativ: string): string => `Google er allerede koblet: kun mail mangler. Clawco bruger den samme Google-app og beder kun om tilladelse til mail; kalenderen røres ikke. ${fuld} ${alternativ}`,
  logIndTekst: (fuld: string, alternativ: string): string => `Log ind med din Google-konto, så står dine ulæste og ventende mails i Nu. Du skal ikke lave en app-adgangskode. ${fuld} ${alternativ}`,
  gmailSvarerIkke: 'Gmail svarer ikke.',
  ingenAdresse: 'Google sagde ikke, hvilken Gmail-adresse der loggede ind. Prøv at logge ind igen.',
};

export type GmailTekster = typeof da;

const en: GmailTekster = {
  fejl: {
    adgang: 'Google refused the access to your Gmail. Log in with Google again.',
    tom: 'Clawco has no access to your Gmail. Log in with Google again.',
  },
  fuldAdgang: 'Google calls the permission "full access to your Gmail", because Google has no narrower permission for mail over IMAP. '
    + 'Clawco only uses it to read the sender, subject and time, never the mail itself, and can neither send, move nor delete; Clawco\'s own code makes sure of that.',
  alternativ: 'If you do not want to give that permission, you can choose Mail and Gmail (app password) instead; it needs two-step verification at Google.',
  handlingGemOgLogInd: 'Save and log in with Google',
  handlingLogIndIgen: 'Log in with Google again',
  handlingSkiftKonto: 'Change Google account',
  handlingGivAdgang: 'Give access to mail',
  handlingLogInd: 'Log in with Google',
  opsaetTekst: (fuld, alternativ) => `The first time you make your own small Google app, so your mail goes straight from Google to Clawco, without an app password. It takes five minutes, one step at a time. ${fuld} ${alternativ}`,
  loginIgenTekst: (fejl, fuld) => `${fejl} ${fuld}`,
  forbundetSom: (adresse) => `Connected as ${adresse}. `,
  forbundet: 'Connected. ',
  forbundetTekst: (hvem, fuld) => `${hvem}${fuld}`,
  tilfoejTekst: (fuld, alternativ) => `Google is already connected: only mail is missing. Clawco uses the same Google app and only asks for permission for mail; the calendar is not touched. ${fuld} ${alternativ}`,
  logIndTekst: (fuld, alternativ) => `Log in with your Google account, and your unread and waiting mails appear in Now. You do not have to make an app password. ${fuld} ${alternativ}`,
  gmailSvarerIkke: 'Gmail is not answering.',
  ingenAdresse: 'Google did not say which Gmail address logged in. Try logging in again.',
};

export const GMAIL_TEKSTER = { da, en };
export const gmailTekst = (): GmailTekster => efterSprog(GMAIL_TEKSTER);
