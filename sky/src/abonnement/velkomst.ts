// The welcome mails (KC-0200): a welcome when the account's Clawco is klar, a "getting started?" tips mail on day 3 of
// the trial and a "your trial ends in two days" mail. Which of them an account is owed now is a pure function of the
// clock, the account, its entitlement (rettigheder.ts) and what was already sent; the job (velkomst-job.ts) only
// remembers what went out (udsendte_mails), so a missed tick or a restart never skips or repeats one. Each mail has a
// window: a mail that could not go out in time is not sent days late (a "welcome" a week after sign-up reads wrong).
//
// Day 0 is the moment the Clawco became klar (never account creation: the welcome must not promise what is not there).
// The trial-ending mail counts back from the entitlement's proeveSlutter (KC-0192), not from Stripe's trial_will_end.
// Only the tips mail can be turned off (the welcome and the trial-ending mail are service messages, few and about the
// account); the preference is read at send time. Nothing goes to a deleted, cancelled or paused account (KC-0196 writes
// from the trial's end), and a gift (beta) or paying account gets the welcome only.
import type { Rettighed } from './rettigheder.ts';

export const VELKOMST_MAILS = ['velkomst', 'kom-i-gang', 'proeve-slutter'] as const;
export type VelkomstMail = (typeof VELKOMST_MAILS)[number];

export type VelkomstKonto = {
  /** When the account's own Clawco became klar; null while it is not (yet). */
  klarVed: Date | null;
  slettet: boolean;
  /** False when the person said no thanks to the tips mail. */
  tips: boolean;
};

const DAG_MS = 86_400_000;
/** The welcome goes out within this long after klar, or not at all. */
export const VELKOMST_VINDUE_MS = 2 * DAG_MS;
/** The tips mail: from day 3 after klar, until day 5. */
export const KOM_I_GANG_FRA_MS = 3 * DAG_MS;
export const KOM_I_GANG_TIL_MS = 5 * DAG_MS;
/** The trial-ending mail: from two days before the trial ends, until it ends. */
export const PROEVE_SLUTTER_FOER_MS = 2 * DAG_MS;

/** A live account that has not asked to stop: no cancellation pending, not paused, overdue or cancelled. */
function igang(r: Rettighed): boolean {
  return (r.status === 'proeve' || r.status === 'aktiv') && r.opsiges === null;
}

/** A Stripe trial still running and not cancelled. */
function iProeve(r: Rettighed): boolean {
  return r.kilde === 'stripe' && r.status === 'proeve' && r.opsiges === null;
}

export function hvilkeMailsSkalUd(nu: Date, konto: VelkomstKonto, r: Rettighed, udsendte: ReadonlySet<VelkomstMail>): VelkomstMail[] {
  if (konto.slettet || !igang(r)) return [];
  const t = nu.getTime();
  const ud: VelkomstMail[] = [];
  const sidenKlar = konto.klarVed ? t - konto.klarVed.getTime() : null;
  if (sidenKlar !== null && sidenKlar >= 0 && sidenKlar < VELKOMST_VINDUE_MS) ud.push('velkomst');
  if (sidenKlar !== null && sidenKlar >= KOM_I_GANG_FRA_MS && sidenKlar < KOM_I_GANG_TIL_MS && iProeve(r) && konto.tips) ud.push('kom-i-gang');
  if (iProeve(r) && r.proeveSlutter !== null) {
    const slut = new Date(r.proeveSlutter).getTime();
    if (t >= slut - PROEVE_SLUTTER_FOER_MS && t < slut) ud.push('proeve-slutter');
  }
  return ud.filter((m) => !udsendte.has(m));
}
