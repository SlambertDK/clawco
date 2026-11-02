// The grace stages after a failed payment (KC-0196): a pure function of the entitlement (rettigheder.ts) and the
// clock, with the day numbers from config/priser.json (paamindelseVedFejl, fristVedFejl). Because the stage is
// computed from forfaldenSiden and now, a missed scheduler tick or a restart never skips or repeats one; the job
// (frist-job.ts) only remembers which mails went out. Nothing here deletes, stops or wipes anything.
//
// The published terms (docs/legal/vilkaar.*.md, sections on trial and failed payment) promise that in the beta a
// Clawco is not stopped automatically because a payment is missing, and that we write before we do anything to it.
// So the read-only stage carries no mail of its own here, and nothing in this file enforces read-only: the flag
// (erSkrivebeskyttet) is the signal KC-0192 already computes; what a tenant does with it is a product decision
// recorded on the ticket.
import type { Priser } from './priser.ts';
import { erSkrivebeskyttet, type Rettighed } from './rettigheder.ts';

export type FristTrin = 'ingen' | 'betaling-fejlet' | 'betaling-paamindelse' | 'skrivebeskyttet' | 'proeve-slut';
/** The mails of the stages (templates in delt/skabeloner/). */
export type FristMail = 'betaling-fejlet' | 'betaling-paamindelse' | 'proeve-slut';
export const FRIST_MAILS: readonly FristMail[] = ['betaling-fejlet', 'betaling-paamindelse', 'proeve-slut'];

export type Frist = {
  trin: FristTrin;
  /** The mail the owner is owed now: the latest stage that has one (a missed tick never skips it). */
  mail: FristMail | null;
  /** One failed payment (or one ended trial) = one episode, with its own mails. */
  episode: string | null;
  /** When the episode began: the failed payment, or the trial's end. */
  siden: string | null;
  /** When the overdue account turns read-only by the config's grace period. */
  skrivebeskyttesVed: string | null;
  skrivebeskyttet: boolean;
};

const DAG_MS = 86_400_000;

export function beregnFrist(r: Rettighed, priser: Priser, nu: Date): Frist {
  const skrivebeskyttet = erSkrivebeskyttet(r, priser, nu);
  const ingen: Frist = { trin: 'ingen', mail: null, episode: null, siden: null, skrivebeskyttesVed: null, skrivebeskyttet };
  if (r.kilde !== 'stripe') return ingen;
  if (r.status === 'forfalden' && r.forfaldenSiden !== null) {
    const siden = new Date(r.forfaldenSiden).getTime();
    const dage = Math.floor((nu.getTime() - siden) / DAG_MS);
    const trin: FristTrin = dage >= priser.fristVedFejl ? 'skrivebeskyttet' : dage >= priser.paamindelseVedFejl ? 'betaling-paamindelse' : 'betaling-fejlet';
    return {
      trin, mail: trin === 'betaling-fejlet' ? 'betaling-fejlet' : 'betaling-paamindelse',
      episode: `forfalden:${r.forfaldenSiden}`, siden: r.forfaldenSiden,
      skrivebeskyttesVed: new Date(siden + priser.fristVedFejl * DAG_MS).toISOString(), skrivebeskyttet,
    };
  }
  // A trial that ended without a card (trial_settings: pause): one mail, no dunning for someone who never paid.
  if (r.status === 'pause' && r.proeveSlutter !== null) {
    return { trin: 'proeve-slut', mail: 'proeve-slut', episode: `proeve:${r.abonnement ?? r.proeveSlutter}`, siden: r.proeveSlutter, skrivebeskyttesVed: null, skrivebeskyttet };
  }
  return ingen;
}
