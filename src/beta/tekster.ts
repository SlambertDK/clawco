// KC-0170 slice 3: the answers a beta household sees as a toast when its feedback cannot be taken (src/beta/feedback.ts),
// in Danish and English. Danish is what feedback.ts said before, byte for byte; English has exactly its keys, read at call
// time. The page "Hvad deler jeg?" has its own table beside it (side.ts, `da` and `en` already). Stays Danish on purpose:
// the BetaFejl messages of tilstand.ts (beta.json damaged: logged by the server, never answered to a person).

import { sprogNu } from '../store/sprog.ts';

const da = {
  ugyldigForespoergsel: 'Ugyldig forespørgsel.',
  ukendtSpoergsmaal: 'Ukendt spørgsmål.',
  venterIkke: 'Det spørgsmål venter ikke på dig lige nu.',
  vaelgVurdering: 'Vælg en vurdering fra 1 til 5.',
  tekstForLang: (max: number): string => `Teksten må højst være ${max} tegn.`,
  ugyldigtBetale: 'Ugyldigt svar på spørgsmålet om at betale.',
};
const en: typeof da = {
  ugyldigForespoergsel: 'Invalid request.',
  ukendtSpoergsmaal: 'Unknown question.',
  venterIkke: 'That question is not waiting for you right now.',
  vaelgVurdering: 'Choose a rating from 1 to 5.',
  tekstForLang: (max: number): string => `The text can be at most ${max} characters.`,
  ugyldigtBetale: 'Invalid answer to the question about paying.',
};
export const BETA_FEEDBACK_TEKSTER = { da, en };
export const betaFeedbackTekst = (): typeof da => BETA_FEEDBACK_TEKSTER[sprogNu()];
