// The health state machine of a connected source (KC-0139). Pure: it turns the
// real outcomes the app sees (a health check, a read) into one debounced state
// the person is shown. A transient failure (nede, langsomt) is a hiccup until it
// has happened three times in a row over at least an hour; an auth failure
// (log-ind-igen) is shown at once; a known expiry within 48 h is shown as
// snart-udloebet; one ok clears the lot. No I/O, no clock: the time is in the
// outcome. Invariant: a state is only ever derived from outcomes passed in.

import type { HelbredStatus } from './types.ts';

export type Vist = HelbredStatus;

/** What is remembered of one source ($KC_DATA_DIR/helbred.json). */
export type Post = {
  /** The state shown now. */
  vist: Vist;
  /** When `vist` last changed (ISO). */
  siden?: string;
  /** Consecutive failed outcomes (any kind), 0 while ok. */
  fejl: number;
  /** When the current run of failures began (ISO). */
  foersteFejl?: string;
  /** The last outcome that proved the source works (a health check or a read). */
  sidstOk?: string;
  /** The last successful read — the only thing that makes data fresh. */
  sidstLaest?: string;
  /** A known expiry of the source's access (ISO). */
  udloeber?: string;
};

/** One real outcome: a health check (or a failed read, as 'nede'), or a successful read (`laest`). */
export type Maaling = { tid: string; status: HelbredStatus; udloeber?: string; laest?: boolean };

export const FEJL_ANTAL = 3;
export const FEJL_SPAND_MS = 60 * 60_000;
export const UDLOEB_VINDUE_MS = 48 * 3600_000;

const klar = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN);

/** Folds one outcome into what is remembered; an unreadable time changes nothing. */
export function iagttag(foer: Post | undefined, m: Maaling): Post {
  const tid = klar(m.tid);
  const nu: Post = foer ?? { vist: 'ok', fejl: 0 };
  if (Number.isNaN(tid)) return nu;

  const saet = (p: Omit<Post, 'siden'>): Post => ({ ...p, siden: !foer || foer.vist !== p.vist ? m.tid : foer.siden ?? m.tid });

  if (m.status === 'ok' || m.status === 'snart-udloebet') {
    const udloeber = m.udloeber && !Number.isNaN(klar(m.udloeber)) ? m.udloeber : undefined;
    const snart = m.status === 'snart-udloebet' || (udloeber !== undefined && klar(udloeber) - tid <= UDLOEB_VINDUE_MS);
    return saet({
      vist: snart ? 'snart-udloebet' : 'ok', fejl: 0, sidstOk: m.tid,
      ...(m.laest ? { sidstLaest: m.tid } : nu.sidstLaest ? { sidstLaest: nu.sidstLaest } : {}),
      ...(udloeber ? { udloeber } : {}),
    });
  }

  // A failure: the run of failures grows; what is shown depends on the kind and the debounce.
  const foerste = nu.fejl > 0 && nu.foersteFejl && !Number.isNaN(klar(nu.foersteFejl)) ? nu.foersteFejl : m.tid;
  const fejl = nu.fejl + 1;
  const rest = {
    fejl, foersteFejl: foerste,
    ...(nu.sidstOk ? { sidstOk: nu.sidstOk } : {}), ...(nu.sidstLaest ? { sidstLaest: nu.sidstLaest } : {}),
    ...(nu.udloeber ? { udloeber: nu.udloeber } : {}),
  };
  if (m.status === 'log-ind-igen') return saet({ vist: 'log-ind-igen', ...rest });
  if (nu.vist === 'log-ind-igen') return saet({ vist: 'log-ind-igen', ...rest }); // a transient error never hides a login that is needed
  const synlig = fejl >= FEJL_ANTAL && tid - klar(foerste) >= FEJL_SPAND_MS;
  return saet({ vist: synlig ? m.status : nu.vist, ...rest });
}
