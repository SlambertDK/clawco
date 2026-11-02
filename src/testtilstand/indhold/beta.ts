// KC-0203 in the test world: the closed beta, one moment per thing it shows. The world switches the beta on by writing
// beta.json into the moment's folder (the app's own switch is KC_BETA; in the world it is "the file exists", kunMedFil),
// so every other moment is an ordinary install with nothing of the beta. The day numbers are UTC days from `startet`.
//   "Beta: første besøg"      day 1, the plain "lukket beta" card
//   "Beta: dag 3 / 7 / 14"    the feedback card of that day (day 14 with the pay question and the prices of the price file)
//   "Beta: Hvad deler jeg?"   the page of what would be sent, consent off, two answers already sent
// All invented.

import type { BetaTilstand, Feedback } from '../../beta/tilstand.ts';
import type { Moment } from '../typer.ts';

export const BETA_START = 'beta-start';
export const BETA_DAG3 = 'beta-dag3';
export const BETA_DAG7 = 'beta-dag7';
export const BETA_DAG14 = 'beta-dag14';
export const BETA_DELING = 'beta-deling';

const DAG_MS = 86_400_000;

/** The moments, appended to the day's table (indhold/fakta.ts). Two days after the story's day, in the morning. */
export const BETA_MOMENTER: readonly Moment[] = [
  { id: BETA_START, tid: '08:00', dagPlus: 2, navn: 'Beta: første besøg', url: '/rum/hjem', replik: 'Hvad er en lukket beta?' },
  { id: BETA_DAG3, tid: '08:10', dagPlus: 2, navn: 'Beta: dag 3', url: '/rum/hjem', replik: 'Hvordan går det?' },
  { id: BETA_DAG7, tid: '08:20', dagPlus: 2, navn: 'Beta: dag 7', url: '/rum/hjem', replik: 'Hvordan går det med Clawco?' },
  { id: BETA_DAG14, tid: '08:30', dagPlus: 2, navn: 'Beta: dag 14', url: '/rum/hjem', replik: 'Ville jeg betale for det her?' },
  { id: BETA_DELING, tid: '08:40', dagPlus: 2, navn: 'Beta: Hvad deler jeg?', url: '/beta/deling', replik: 'Hvad deler jeg med Henrik?' },
];

const iso = (ms: number): string => new Date(ms).toISOString();

/** beta.json at the moment (`nu` = the moment's instant), or undefined for every other moment: no file, no beta. */
export function betaFroe(momentId: string, nu: string): BetaTilstand | undefined {
  const t = Date.parse(nu);
  const dagSiden = (n: number): number => t - n * DAG_MS;
  const svar = (dag: 3 | 7 | 14, vurdering: Feedback['vurdering'], tekst: string | null, betale: Feedback['betale'], n: number): Feedback => ({ dag, vurdering, tekst, betale, tid: iso(dagSiden(n)) });
  const tre = svar(3, 4, 'Mailen drillede de første dage', null, 3);
  const syv = svar(7, 4, null, null, 1);
  switch (momentId) {
    case BETA_START: return { startet: iso(t - 5 * 60_000), samtykke: false, svaret: {}, feedback: [] };
    case BETA_DAG3: return { startet: iso(dagSiden(2)), samtykke: false, betaKortLukket: iso(dagSiden(2) + 60_000), svaret: {}, feedback: [] };
    case BETA_DAG7: return { startet: iso(dagSiden(6)), samtykke: false, betaKortLukket: iso(dagSiden(6) + 60_000), svaret: { 3: tre.tid }, feedback: [tre] };
    case BETA_DAG14: return { startet: iso(dagSiden(13)), samtykke: false, betaKortLukket: iso(dagSiden(13) + 60_000), svaret: { 3: tre.tid, 7: syv.tid }, feedback: [tre, syv] };
    case BETA_DELING: return { startet: iso(dagSiden(9)), samtykke: false, betaKortLukket: iso(dagSiden(9) + 60_000), svaret: { 3: tre.tid, 7: syv.tid }, feedback: [tre, syv] };
    default: return undefined;
  }
}
