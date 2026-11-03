// The verbs of the policy layer (KC-0122), mirroring the trust ladder (spec §4):
// 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo · the limits
// (never without Henrik's yes, or never at all): pay, write to others, delete,
// copy across zones. Every handling gets its verb from the app.

import { GRAENSEKLASSER, TRIN, type Graenseklasse, type TrinVerb } from '../tillid/trin.ts';

/** The ladder's verbs (src/tillid/trin.ts, KC-0143), then the limits. */
export type Verb = TrinVerb | Graenseklasse;
/** The limits (tillid/trin.ts), for the parts of the app that may depend on graenser/ but not on tillid/ (kilder/). */
export { GRAENSEKLASSER };
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

/**
 * KC-0270 (B1): words in a handling's label or instruction that reach other people. A pipe into a shell, a decoded
 * payload or `eval` is unknown — it could send anything — so it needs the same tap. Danish and English; matched on
 * the text as it stands (the run's instruction is exactly this text).
 */
const SEND_ORD: readonly RegExp[] = [
  /\b(?:videre)?send/i, /\bsvar\s+til\b/i, /\bbesvar/i, /\bforward/i, /\breply/i, /\bshare\b/i, /\bdel\s+med\b/i,
  /\bmail\s+to\b/i, /\b[Ss]kriv\s+til\s+\p{Lu}/u, /\bsms/i, /\bbesked\s+til\b/i, /\bmsmtp\b/i, /smtp/i,
  /\bcurl\b[^|;&\n]*\s(?:-d|--data(?:-\S*)?|-T|--upload-file|-F|--form)(?=[\s=@]|$)/i, /\bwget\b[^|;&\n]*--post-(?:data|file)/i,
  /\b(?:nc|ncat|netcat)\s/i, /openssl\s+s_client/i,
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|python3?|perl|ruby|node)\b/i, /\bbase64\s+(?:-\w*d|--decode)/i, /\beval\b/i,
];
/** KC-0270 (B1): words that delete — mail moved to the bin or flagged deleted counts. */
const SLET_ORD: readonly RegExp[] = [
  /\bslet/i, /\bfjern\w*\s+(?:\S+\s+){0,2}permanent/i, /\bdelete/i, /\bexpunge/i, /\bpurge/i, /\brm\s+-\w*[rf]/i,
  /\btrash\b/i, /\bpapirkurv/i, /\bskraldespand/i, /\bflag\s+(?:add|set)\b[^|;&\n]*\bdeleted\b/i,
];

/**
 * The app's floor for a free-form handling an agent wrote (KC-0122, KC-0270 B1): read from its label and
 * instruction, so a mail cannot dress a sending instruction up as "Arkivér". The model's own `tilAndre` (KC-0066)
 * can still raise it, never lower it. Otherwise something done with undo. Pure.
 */
export function agentGulv(h: { label?: string; instruktion?: string; tilAndre?: true | boolean }): Verb {
  const tekst = `${h.label ?? ''}\n${h.instruktion ?? ''}`;
  if (SLET_ORD.some((r) => r.test(tekst))) return 'slet';
  if (h.tilAndre || SEND_ORD.some((r) => r.test(tekst))) return 'send-til-andre';
  return 'udfoer-med-fortryd';
}

/** KC-0270 (B5): the text of a Fortryd the agent will run, or null for an undo the app does itself ('lokal:…'). */
export const agentFortryd = (fortryd: string | undefined | null): string | null => (fortryd && !fortryd.startsWith('lokal:') ? fortryd : null);

/** KC-0270 (B5): the verb of a Fortryd. An agent-written undo goes through the same floor as a handling; the app's own runs as undo. */
export const fortrydVerb = (agentTekst: string | null): Verb => (agentTekst ? agentGulv({ instruktion: agentTekst }) : 'udfoer-med-fortryd');

/** Verbs that need a human tap (a token) before anything runs. */
export const kraeverJa = (verb: string): boolean => verb === 'send-til-andre' || verb === 'slet';
