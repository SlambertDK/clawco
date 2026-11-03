// The rules section of every prompt that thinks for Henrik (KC-0142): built
// only from his rules file, never from mail, web or other source text (spec
// D6), with each rule's id and trin so Hermes can cite "R-0004". Paused and
// invalid rules are not followed; no file or a broken file means trin 0.

import type { ReglerLaest } from './lager.ts';
import type { Regel } from './regler.ts';
import { TRIN, trinNavn } from './trin.ts';
import { REGEL_PROMPT_TEKSTER, regelPromptTekst } from './prompt-tekster.ts';
import { tillidTekst } from './tekster.ts';

// KC-0241: the words are in prompt-tekster.ts, read at call time in the language of the run; the constants are the Danish ones.
export const REGLER_OVERSKRIFT = REGEL_PROMPT_TEKSTER.da.overskrift;

const trinLinje = (): string => regelPromptTekst().trinLinje(TRIN.map((t) => `${t.trin} ${trinNavn(t.trin)}`).join(' · '));

const enLinje = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** KC-0242: why the rules file cannot be read, in the language of the run (the code keeps the Danish reason; an unknown one is shown as it is). */
const hvorforTekst = (hvorfor: string): string => {
  const kendte = tillidTekst().ulaeseligHvorfor;
  return Object.hasOwn(kendte, hvorfor) ? kendte[hvorfor]! : hvorfor;
};

function regelLinje(r: Regel): string {
  const g = r.gaelder.slags ? `${r.gaelder.kilde} / ${r.gaelder.slags}` : r.gaelder.kilde;
  return regelPromptTekst().regelLinje(r.id, r.trin, g, enLinje(r.titel), r.tekst ? enLinje(r.tekst) : '');
}

export function reglerTilPrompt(l: ReglerLaest | undefined): string {
  const T = regelPromptTekst();
  if (!l || l.tilstand === 'mangler') return `${T.overskrift}\n${T.ingenGodkendt} ${T.trin0}`;
  if (l.tilstand === 'ulaeselig') return `${T.overskrift}\n${T.ulaeselig(enLinje(hvorforTekst(l.hvorfor)))}`;
  // KC-0270 (B3): a file changed outside Clawco is not trusted text until the owner approved it; its rules are not shown.
  if (l.aendretUdenfor) return `${T.overskrift}\n${T.ikkeGodkendt} ${T.trin0}`;
  const aktive = l.saet.regler.filter((r) => r.status === 'aktiv');
  const linjer = aktive.length ? aktive.map(regelLinje) : [T.ingenAktive];
  const ugyldige = l.saet.ugyldige.map((u) => T.ugyldig(enLinje(u.overskrift)));
  return [
    T.overskrift,
    ...linjer,
    ...(ugyldige.length ? [T.ugyldigeOverskrift, ...ugyldige] : []),
    trinLinje(),
    `${T.trin0} ${T.henvis(aktive[0]?.id ?? 'R-0001')}`,
  ].join('\n');
}

/** KC-0144: the proposal text (a PROPOSAL, nothing more; the Danish constant is for the rooms that still interpolate it). */
export const REGELFORSLAG_TEKST = REGEL_PROMPT_TEKSTER.da.regelforslag;
/** The proposal text in the language of the run. */
export const regelforslagTekst = (): string => regelPromptTekst().regelforslag;
