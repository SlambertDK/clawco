// The decision (KC-0122, spec D5): pure. Every handling passes here before the
// agent or the app acts. What the model writes can raise a denial, never lift
// one: the verb comes from the app (verber.ts), the token from a human tap.

import { erVerb, type Verb } from './verber.ts';
import { blandetZoner, type DataZone } from '../identitet/zoner.ts';
import { kan } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import { tilladtAfRegler, trinForVerb, type Gaelder } from '../tillid/trin.ts';
import type { ReglerLaest } from '../tillid/lager.ts';

/**
 * A handling about to run: which room, which element/handling, its verb and the zones of the data it touches.
 * `gaelder` (KC-0143): the source and kind it acts on, which Henrik's rules are matched against when it runs on its own.
 */
export type Forslag = { rum: string; id: string; verb: string; zoner: DataZone[]; gaelder?: Gaelder;
  /** KC-0161: needs a human tap (a redeemed token for exactly this press) although its verb is not a limit; never on its own, never by voice. */
  tap?: true };
/**
 * Who asks and how. `ja` = a valid human-tap token was redeemed for exactly this handling. `regler` (KC-0143): the
 * rules file as read now; only `baggrund` (nobody tapped) consults it, and without it nothing above trin 0 runs.
 */
export type Kontekst = { person: Person; kanal: 'knap' | 'stemme' | 'chat' | 'baggrund'; ja: boolean; regler?: ReglerLaest | undefined };
export type Udfald = 'tillad' | 'kraever-ja' | 'afvis';
export type Afgoerelse = { udfald: Udfald; hvorfor: string };

export function afgoer(f: Forslag, ctx: Kontekst): Afgoerelse {
  const verb = f.verb;
  if (!erVerb(verb)) return { udfald: 'afvis', hvorfor: 'Clawco gjorde det ikke: handlingen siger ikke, hvad den gør, så den bliver ikke kørt.' };
  if (verb === 'betal') return { udfald: 'afvis', hvorfor: 'Clawco betaler aldrig noget. Det gør du selv.' };
  if (verb === 'kopier-paa-tvaers' || blandetZoner(f.zoner)) return { udfald: 'afvis', hvorfor: 'Clawco flytter eller kopierer aldrig noget mellem zonerne privat, arbejde og husstand.' };
  // KC-0161: a handling that needs a tap is never done by nobody-asked, whatever the rules say.
  if (f.tap === true && ctx.kanal === 'baggrund') return { udfald: 'kraever-ja', hvorfor: 'Clawco gør aldrig det her af sig selv. Det kræver dit eget tryk på knappen.' };
  // KC-0143: nobody asked (timers, Kuratoren, which run as INGEN): the owner's rules are the authority, not a role.
  if (ctx.kanal === 'baggrund') return afSigSelv(f, verb, ctx.regler) ?? { udfald: 'tillad', hvorfor: 'Inden for grænserne.' };
  if (!kan(ctx.person.rolle, verb === 'laes' ? 'laese' : 'handle')) return { udfald: 'afvis', hvorfor: 'Din rolle i husstanden må ikke sætte det her i gang.' };
  if (f.tap === true) {
    if (ctx.kanal === 'stemme') return { udfald: 'afvis', hvorfor: 'Clawco gør ikke det her på et ord fra stemmen. Tryk selv på knappen på skærmen.' };
    if (!ctx.ja) return { udfald: 'kraever-ja', hvorfor: 'Clawco gør kun det her, når du selv har trykket ja på knappen.' };
  }
  if (verb === 'send-til-andre' || verb === 'slet') {
    const hvad = verb === 'slet' ? 'slette noget' : 'skrive til andre';
    if (ctx.kanal === 'stemme') return { udfald: 'afvis', hvorfor: `Clawco må ikke ${hvad} på et ord fra stemmen. Tryk selv på knappen på skærmen.` };
    if (!ctx.ja) return { udfald: 'kraever-ja', hvorfor: `Clawco må kun ${hvad}, når du selv har trykket ja på knappen.` };
    return { udfald: 'tillad', hvorfor: `Du trykkede ja, så Clawco må ${hvad} denne ene gang.` };
  }
  return { udfald: 'tillad', hvorfor: 'Inden for grænserne.' };
}

const IKKE_ENDNU: Record<string, string> = { sorter: 'sortere', bogfoer: 'bogføre', forbered: 'forberede', 'udfoer-med-fortryd': 'gøre' };

/** The question an autonomous handling without a covering rule leaves for Henrik (on its card and in the audit line). */
export const ikkeEndnu = (verb: string): string => `Jeg må ikke ${IKKE_ENDNU[verb] ?? 'gøre'} dette endnu: hvilken regel skal dække det?`;

/**
 * KC-0143: a handling nobody tapped. Trin 0 (read) needs no rule; above it the highest active rule covering the
 * handling's scope must reach its trin (tillid/trin.ts). A limit is never done on its own, whatever the rules or a
 * token say. A denial waits for Henrik (kraever-ja): the app shows it as a card. Null = covered.
 */
function afSigSelv(f: Forslag, verb: Exclude<Verb, 'betal' | 'kopier-paa-tvaers'>, regler: ReglerLaest | undefined): Afgoerelse | null {
  const trin = trinForVerb(verb);
  if (trin === 0) return null;
  const hvad = IKKE_ENDNU[verb] ?? 'gøre';
  if (trin === null) return { udfald: 'kraever-ja', hvorfor: `Clawco må aldrig ${verb === 'slet' ? 'slette noget' : 'skrive til andre'} af sig selv. Det kræver dit eget tryk.` };
  const u = f.gaelder ? tilladtAfRegler(regler, { ...f.gaelder, kraevetTrin: trin, klasse: 'normal' }) : { tilladt: false as const, aarsag: 'ingen-regel' as const };
  if (u.tilladt) return null;
  if (u.aarsag === 'for-lavt-trin') return { udfald: 'kraever-ja', hvorfor: `Jeg må ikke ${hvad} dette endnu: reglen, der dækker det, står på et for lavt trin (det kræver trin ${trin}). Hvilken regel skal dække det?` };
  return { udfald: 'kraever-ja', hvorfor: ikkeEndnu(verb) };
}

/** The reason a handling with this verb can never run (pay, cross-zone, an unknown verb); null when a person may run it. Renderers show it instead of a button. */
export function aldrigTilladt(verb: string): string | null {
  const a = afgoer({ rum: '', id: '', verb, zoner: [] }, { person: { id: '', login: null, navn: '', rolle: 'ejer' }, kanal: 'knap', ja: true });
  return a.udfald === 'afvis' ? a.hvorfor : null;
}
