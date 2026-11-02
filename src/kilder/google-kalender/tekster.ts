// KC-0170: the words of the Google Calendar connector, Danish and English (the shape of src/kilder/tekster.ts). What it
// shares with Gmail (the app is not set up, the return address is unknown, the login could not be confirmed, the field
// labels) is in ../google/tekster.ts. "Google Calendar API" is the console's own name for the API and stays in both.

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Google Kalender',
  handlingLogInd: 'Log ind med Google',
  handlingGemOgLogInd: 'Gem og log ind med Google',
  kortTekst: 'Log ind med din Google-konto, så står alle dine kalendere de næste syv dage i Dagen og i Nu. Clawco kan kun læse kalenderen, aldrig ændre den.',
  kortTekstOpsaet: 'Første gang laver du din egen lille Google-app, så din kalender går direkte fra Google til Clawco. Det tager fem minutter, ét trin ad gangen. Clawco kan kun læse kalenderen, aldrig ændre den.',
  ingenAdgang: 'Clawco har ingen adgang til kalenderen. Log ind med Google igen.',
  googleSvarerIkke: 'Google svarer ikke.',
  kalenderIkkeNaaet: 'Google Kalender kunne ikke nås.',
  kalenderlisteFejl: (status: number): string => `Kalenderlisten kunne ikke hentes fra Google (fejl ${status}).`,
  /** One calendar of the account failed: shown among the day's errors, with the calendar's name. */
  netvaerksfejl: (kalender: string): string => `${kalender}: netværksfejl`,
};

export type GoogleKalenderTekster = typeof da;

const en: GoogleKalenderTekster = {
  navn: 'Google Calendar',
  handlingLogInd: 'Log in with Google',
  handlingGemOgLogInd: 'Save and log in with Google',
  kortTekst: 'Log in with your Google account, and all your calendars for the next seven days appear in Today and in Now. Clawco can only read the calendar, never change it.',
  kortTekstOpsaet: 'The first time you make your own small Google app, so your calendar goes straight from Google to Clawco. It takes five minutes, one step at a time. Clawco can only read the calendar, never change it.',
  ingenAdgang: 'Clawco has no access to the calendar. Log in with Google again.',
  googleSvarerIkke: 'Google is not answering.',
  kalenderIkkeNaaet: 'Google Calendar could not be reached.',
  kalenderlisteFejl: (status) => `The calendar list could not be fetched from Google (error ${status}).`,
  netvaerksfejl: (kalender) => `${kalender}: network error`,
};

export const GOOGLE_KALENDER_TEKSTER = { da, en };
export const kalenderTekst = (): GoogleKalenderTekster => efterSprog(GOOGLE_KALENDER_TEKSTER);
