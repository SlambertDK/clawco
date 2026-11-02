// KC-0203: the closed beta's switch. KC_BETA=ja is set by Clawco Sky when it provisions a beta household's Clawco
// (KC_BETA_SAMTYKKE=ja when the redemption's checkbox was ticked). A self-installed Clawco has neither, and then nothing
// of the beta exists: no card, no page, no link, no route (AGENTS §4 r11 covers the beta world in testtilstand).

export type BetaIndstilling = {
  /** The household ticked "Som betatester deler jeg disse tal" at redemption. Read once, at the first start; after that the person owns it. */
  samtykkeStart: boolean;
  /** The test world only: the beta is on while its data folder holds beta.json (the world switches moments by files). Never set by the env. */
  kunMedFil?: true;
  /** The price file the day-14 question reads (default: config/priser.json). Tests point it at a fixture. */
  priserFil?: string;
};

const ja = (v: string | undefined): boolean => (v ?? '').trim() === 'ja';

export function betaFraMiljoe(env: Record<string, string | undefined>): BetaIndstilling | null {
  if (!ja(env['KC_BETA'])) return null;
  return { samtykkeStart: ja(env['KC_BETA_SAMTYKKE']) };
}
