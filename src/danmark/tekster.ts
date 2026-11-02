// KC-0170 slice 3: the plain refusals of the Digital Post window (what Start and Nu's notice card answer when a tap cannot
// be done), in Danish and English. Danish is what vindue.ts said before, byte for byte; English has exactly its keys, read
// at call time (never at module load). The language comes from src/store/sprog.ts. The names stay: Digital Post, mit.dk,
// e-Boks, borger.dk, Clawco. The text Nu and Start draw around the window lives in the shell and Start's table, not here.

import { sprogNu } from '../store/sprog.ts';

const da = {
  /** `domaener` = the hint domains, joined by ", " (the domains the notification mail comes from). */
  afsenderAfvist: (domaener: string): string => `Det er ikke en adresse, Digital Post sender fra. Skriv adressen i notifikationsmailen (den slutter på ${domaener}), eller vælg en fra listen.`,
  vaelgViser: 'Vælg, hvor du læser din Digital Post: mit.dk, e-Boks eller borger.dk.',
  forbindMailFoerst: 'Forbind først den mail, Digital Post sender notifikationen til.',
  ingenBeskedAtSaette: 'Der er ingen besked at sætte.',
  kanIkkeLaeseMail: 'Clawco kan ikke læse din mail lige nu. Prøv igen om lidt.',
  beskedFindesIkke: 'Den besked findes ikke længere.',
};
const en: typeof da = {
  afsenderAfvist: (domaener: string): string => `That is not an address Digital Post sends from. Type the address on the notification mail (it ends in ${domaener}), or pick one from the list.`,
  vaelgViser: 'Choose where you read your Digital Post: mit.dk, e-Boks or borger.dk.',
  forbindMailFoerst: 'First connect the mail account Digital Post sends the notification to.',
  ingenBeskedAtSaette: 'There is no notice to mark as seen.',
  kanIkkeLaeseMail: 'Clawco cannot read your mail right now. Try again in a moment.',
  beskedFindesIkke: 'That notice no longer exists.',
};
export const DANMARK_TEKSTER = { da, en };
export const danmarkTekst = (): typeof da => DANMARK_TEKSTER[sprogNu()];
