// The trust ladder (KC-0143, spec §4, D5): what each trin lets Hermes do on its
// own, the limits no rule can ever grant, and the one pure decision that says
// whether Henrik's rules cover an autonomous handling. The policy layer
// (src/graenser/afgoer.ts) calls tilladtAfRegler for every handling Hermes or
// the app would do on its own; nothing else decides by trin. Invariant: a limit
// class is never tilladt, whatever the rules, the trin or the model says.

import type { Regel } from './regler.ts';
import type { ReglerLaest } from './lager.ts';

/** 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo. */
export type Trin = 0 | 1 | 2 | 3 | 4;

/** The ladder: each trin's verb in the policy layer, its Danish name and the sentence the UI shows. */
export const TRIN = [
  { trin: 0, verb: 'laes', navn: 'se', saetning: 'Hermes må se og foreslå, men gør intet af sig selv.' },
  { trin: 1, verb: 'sorter', navn: 'sortere', saetning: 'Hermes må sortere og lægge ting i Ordnet, men aldrig skrive i dine filer eller oprette aftaler.' },
  { trin: 2, verb: 'bogfoer', navn: 'føre regnskab', saetning: 'Hermes må skrive linjer i dit regnskab, hver med Fortryd.' },
  { trin: 3, verb: 'forbered', navn: 'forberede', saetning: 'Hermes må lave udkast og forberede, men du sender og bruger dem selv.' },
  { trin: 4, verb: 'udfoer-med-fortryd', navn: 'udføre med fortryd', saetning: 'Hermes må handle i dine egne systemer, og du kan fortryde.' },
] as const satisfies readonly { trin: Trin; verb: string; navn: string; saetning: string }[];

export type TrinVerb = (typeof TRIN)[number]['verb'];

/** What no rule can ever allow: paying, writing to others, deleting, copying data across zones (AGENTS.md §9). */
export const GRAENSEKLASSER = ['betal', 'send-til-andre', 'slet', 'kopier-paa-tvaers'] as const;
export type Graenseklasse = (typeof GRAENSEKLASSER)[number];

export const erTrin = (v: unknown): v is Trin => TRIN.some((t) => t.trin === v);

/** The trin a ladder verb needs; null for a limit class or an unknown verb (no trin covers those). */
export function trinForVerb(verb: string): Trin | null {
  return TRIN.find((t) => t.verb === verb)?.trin ?? null;
}

export type Gaelder = { kilde: string; slags?: string };
export type RegelHandling = Gaelder & { kraevetTrin: Trin; klasse: 'normal' | Graenseklasse };
export type RegelUdfald = { tilladt: true; regelId: string } | { tilladt: false; aarsag: 'graense' | 'ingen-regel' | 'for-lavt-trin' };

const lille = (s: string | undefined): string | undefined => s?.trim().toLowerCase();

/** Whether the rule's gaelder covers `g`: its kilde (or `*`), and its slags when it names one. */
function daekker(r: Regel, g: Gaelder): boolean {
  const kilde = lille(r.gaelder.kilde);
  if (kilde !== '*' && kilde !== lille(g.kilde)) return false;
  return r.gaelder.slags === undefined || lille(r.gaelder.slags) === lille(g.slags);
}

/** The highest active rule covering `g` (the first in the file on a tie); none when the file is missing or unreadable. */
function hoejeste(regler: ReglerLaest | undefined, g: Gaelder): Regel | undefined {
  if (regler?.tilstand !== 'ok') return undefined; // fail closed: no file or a broken one grants nothing
  let bedst: Regel | undefined;
  for (const r of regler.saet.regler) if (r.status === 'aktiv' && daekker(r, g) && (!bedst || r.trin > bedst.trin)) bedst = r;
  return bedst;
}

/** Whether Henrik's rules let Hermes do `h` on its own. Pure. */
export function tilladtAfRegler(regler: ReglerLaest | undefined, h: RegelHandling): RegelUdfald {
  if (h.klasse !== 'normal') return { tilladt: false, aarsag: 'graense' };
  const r = hoejeste(regler, h);
  if (!r) return { tilladt: false, aarsag: 'ingen-regel' };
  return h.kraevetTrin <= r.trin ? { tilladt: true, regelId: r.id } : { tilladt: false, aarsag: 'for-lavt-trin' };
}

/** The highest trin the app may propose for a rule on `gaelder` (KC-0144): one above what Hermes has there now, 1–4. Hand-edited rules have no cap. */
export function maksTrinForForslag(regler: ReglerLaest | undefined, gaelder: Gaelder): Trin {
  const nu = hoejeste(regler, gaelder)?.trin ?? 0;
  return Math.min(4, Math.max(1, nu + 1)) as Trin;
}
