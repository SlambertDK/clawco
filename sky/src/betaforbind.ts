// The closed beta's wiring (KC-0203): beta/ never imports abonnement/ or konto/ (sky/test/aftryk.test.ts), so the gift
// and the attempt counter are handed to it here. Used by server.ts and the operator's scripts.
import type { Database } from './db/pool.ts';
import type { Priser } from './abonnement/priser.ts';
import { forlaengGave, saetGave } from './abonnement/synk.ts';
import { taelOp } from './konto/graenser.ts';
import { BETA_PLAN, type Gaver, type IndloesDeps } from './beta/invitationer.ts';

/** The beta gift: plan Husstand, active, no Stripe, with an end date; billing's own writer (abonnement/synk.ts). */
export function betaGaver(priser: Priser): Gaver {
  return {
    giv: (tx, kontoId, slutter, nu) => saetGave(tx, kontoId, BETA_PLAN, priser, nu, slutter),
    forlaeng: (tx, kontoId, til, nu) => forlaengGave(tx, kontoId, til, nu),
  };
}

export function betaIndloesDeps(db: Database, priser: Priser): IndloesDeps {
  return { db, gaver: betaGaver(priser), begraens: (n, graense, nu) => taelOp(db, n, graense, nu) };
}
