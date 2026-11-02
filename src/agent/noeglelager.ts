// KC-0180: where the direct-model agent keeps a provider's key (or a local
// model's address). The one deliberate exception to "Clawco never keeps model
// keys itself" (KC-0127), limited to the agent's own store. The env default
// reads KC_MODEL_NOEGLE_<UDBYDER> (dev, tests) and holds a saved key in memory
// only: never in process.env, which every child process (himalaya, scripts)
// inherits. The encrypted file store arrives in KC-0181.

export interface NoegleLager {
  hent(udbyder: string): Promise<string | undefined>;
  /** Keeps the key (trimmed); answers its length only. Rejects an empty key or an unknown provider. */
  saet(udbyder: string, noegle: string): Promise<{ laengde: number }>;
  findes(udbyder: string): Promise<boolean>;
}

/** The env name a provider's key is read from: 'anthropic' → KC_MODEL_NOEGLE_ANTHROPIC. */
export const noegleEnvNavn = (udbyder: string): string => `KC_MODEL_NOEGLE_${udbyder.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export function envNoegleLager(o: { udbydere: readonly string[]; env?: Record<string, string | undefined> }): NoegleLager {
  const env = o.env ?? process.env;
  const gemt = new Map<string, string>();
  const kendt = (udbyder: string): void => {
    // The message names the provider id only, never the value.
    if (!o.udbydere.includes(udbyder)) throw new Error(`ukendt udbyder: ${udbyder.slice(0, 40)}`);
  };
  const laes = (udbyder: string): string | undefined => {
    kendt(udbyder);
    const v = (gemt.get(udbyder) ?? env[noegleEnvNavn(udbyder)] ?? '').trim();
    return v || undefined;
  };
  return {
    async hent(udbyder) { return laes(udbyder); },
    async findes(udbyder) { return laes(udbyder) !== undefined; },
    async saet(udbyder, noegle) {
      kendt(udbyder);
      const v = noegle.trim();
      if (!v) throw new Error('nøglen er tom');
      gemt.set(udbyder, v);
      return { laengde: v.length };
    },
  };
}
