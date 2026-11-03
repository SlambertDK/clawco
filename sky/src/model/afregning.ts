// KC-0273 (D4): what a call is held to before it is forwarded, and what it is billed when it ends. Pure.
// The reservation: max_tokens × the output price plus an input estimate, priced as the dearest input kind (a byte-level
// tokenizer never makes more tokens than bytes, so the forwarded body's UTF-8 length bounds the prompt). It goes into
// the ledger before the provider is called (regnskab.ts reserverKald) and must fit under the month's cap, so neither a
// hang-up nor a failed ledger write afterwards can make a call free.
// The settle, when the stream is over:
//   - the final count arrived (message_delta, or the JSON's usage)       → the real usage;
//   - the stream ended cleanly with no usage at all (only an error event) → nothing: the provider answered nothing;
//   - anything else (the tenant hung up, the deadline, the upstream broke, a clean end without message_delta)
//                                                                         → the input side as message_start said (else the
//     estimate) and the output side at max_tokens: the reservation. Counting the streamed text instead would be fairer
//     to a tenant who hangs up early, but the reservation is simpler and never undercounts.
import { prisMikroUsd, type Forbrug, type Modelpriser } from './priser.ts';

export type Reservation = { forbrug: Forbrug; pris: number; maxTokens: number };

const NUL: Forbrug = { input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 };

export function reservation(p: Modelpriser, model: string, udbyder: string, krop: Record<string, unknown>, maxTokens: number): Reservation {
  const anslag = Buffer.byteLength(JSON.stringify(krop), 'utf8');
  const forbrug: Forbrug = { ...NUL, input: anslag, output: maxTokens };
  const pris = Math.max(prisMikroUsd(p, model, udbyder, forbrug), prisMikroUsd(p, model, udbyder, { ...NUL, cacheSkriv1t: anslag, output: maxTokens }));
  return { forbrug, pris, maxTokens };
}

/** What the call is billed (see the header). `ren` = the stream ended by itself (not a hang-up, deadline or break). */
export function afregning(o: { set: Forbrug | null; komplet: boolean; ren: boolean; reservation: Reservation }): { forbrug: Forbrug; regel: 'maalt' | 'intet' | 'reservation' } {
  if (o.set && o.komplet) return { forbrug: o.set, regel: 'maalt' };
  if (!o.set && o.ren) return { forbrug: { ...NUL }, regel: 'intet' };
  const ind = o.set ?? { ...o.reservation.forbrug, output: 0 };
  return { forbrug: { ...ind, output: Math.max(ind.output, o.reservation.maxTokens) }, regel: 'reservation' };
}
