// The hetzner fleet driver (KC-0212, spec D18): built behind the same seam, but it refuses every call
// while the cost ledger has no active Hetzner line that paid MRR covers — so a paid server can never be
// provisioned before the customers pay for it. Even when covered it refuses: the real driver is KC-0182.
import { erDaekketAktiv, type Omkostninger } from '../delt/omkostninger.ts';
import type { Flaade } from './flaade.ts';

/** The ledger line that allows the first Hetzner node (config/omkostninger.json). */
export const HETZNER_LINJE = 'hetzner-node-1';

export class HetznerSlukket extends Error {
  constructor() {
    super(`Hetzner er slukket: omkostningslisten har ingen tændt og dækket linje ${HETZNER_LINJE} (spec D18)`);
    this.name = 'HetznerSlukket';
  }
}

export function hetznerFlaade(o: { omkostninger: () => Omkostninger; mrr: () => number }): Flaade {
  const naegt = async (): Promise<never> => {
    if (!erDaekketAktiv(o.omkostninger(), HETZNER_LINJE, o.mrr())) throw new HetznerSlukket();
    throw new Error('Hetzner-driveren er ikke bygget endnu (KC-0182)');
  };
  return { navn: 'hetzner', klargoer: naegt, stop: naegt, slet: naegt, status: naegt, maerkede: naegt, startede: naegt, beholder: naegt, opgrader: naegt };
}
