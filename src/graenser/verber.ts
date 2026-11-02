// The verbs of the policy layer (KC-0122), mirroring the trust ladder (spec §4):
// 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo · the limits
// (never without Henrik's yes, or never at all): pay, write to others, delete,
// copy across zones. Every handling gets its verb from the app.

import { GRAENSEKLASSER, TRIN, type Graenseklasse, type TrinVerb } from '../tillid/trin.ts';

/** The ladder's verbs (src/tillid/trin.ts, KC-0143), then the limits. */
export type Verb = TrinVerb | Graenseklasse;
export const VERBER: readonly Verb[] = [...TRIN.map((t) => t.verb), ...GRAENSEKLASSER];

export const erVerb = (v: unknown): v is Verb => typeof v === 'string' && (VERBER as readonly string[]).includes(v);

/** How strict a verb is: the ladder, then the limits. */
const STRENGHED: Record<Verb, number> = { laes: 0, sorter: 1, bogfoer: 2, forbered: 3, 'udfoer-med-fortryd': 4, 'send-til-andre': 5, slet: 6, 'kopier-paa-tvaers': 7, betal: 8 };

export const strengeste = (a: Verb, b: Verb): Verb => (STRENGHED[a] >= STRENGHED[b] ? a : b);

/**
 * The verb of a handling an agent proposed. `gulv` is what the app sets (static in room code). A declared verb counts
 * only when it is stricter — model output can raise a denial, never lift one. An unknown declared verb is kept as
 * it is, so `afgoer` denies the handling.
 */
export function verbFra(erklaeret: unknown, gulv: Verb): string {
  if (erklaeret === undefined || erklaeret === null || erklaeret === '') return gulv;
  if (!erVerb(erklaeret)) return typeof erklaeret === 'string' ? erklaeret.slice(0, 40) : 'ukendt';
  return strengeste(erklaeret, gulv);
}

/** The app's floor for a free-form handling an agent wrote: for other people (KC-0066) or something done with undo. */
export const agentGulv = (h: { tilAndre?: true | boolean }): Verb => (h.tilAndre ? 'send-til-andre' : 'udfoer-med-fortryd');

/** Verbs that need a human tap (a token) before anything runs. */
export const kraeverJa = (verb: string): boolean => verb === 'send-til-andre' || verb === 'slet';
