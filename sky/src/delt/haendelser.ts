// A tiny in-process event seam, so Sky modules can react to each other without importing each other
// (konto emits `konto.slettet`; abonnement, KC-0173, cancels the subscription when it hears it).

export type Haendelse = { navn: 'konto.slettet'; kontoId: number; tidspunkt: string };

type Lytter<N extends Haendelse['navn']> = (h: Extract<Haendelse, { navn: N }>) => void | Promise<void>;

export type Haendelser = {
  udsend(h: Haendelse): void;
  /** Returns a function that stops listening. */
  lyt<N extends Haendelse['navn']>(navn: N, fn: Lytter<N>): () => void;
};

export function haendelser(): Haendelser {
  const lyttere = new Map<string, Set<(h: Haendelse) => void | Promise<void>>>();
  return {
    udsend(h) {
      for (const fn of lyttere.get(h.navn) ?? []) {
        // A failing listener must not undo what already happened (the account is gone either way).
        const fejl = (err: unknown) => { console.error(`sky: lytter på ${h.navn} fejlede:`, (err as Error).message); };
        try { void Promise.resolve(fn(h)).catch(fejl); } catch (err) { fejl(err); }
      }
    },
    lyt(navn, fn) {
      const saet = lyttere.get(navn) ?? new Set();
      const f = fn as (h: Haendelse) => void | Promise<void>;
      saet.add(f);
      lyttere.set(navn, saet);
      return () => { saet.delete(f); };
    },
  };
}
