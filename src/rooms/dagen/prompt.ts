// What we ask Hermes, for each kind of run in the room Dagen. Pure functions:
// data in, { input, instructions } out. Hermes' answer is validated by schema.ts.

import { handlingensVerb, KORSEL } from './schema.ts';
import type { DagenState, Handling } from './schema.ts';
import type { TrimmedAvis } from './source.ts';
import { copenhagenDate, copenhagenTime } from './source.ts';
import type { TrimmedUge } from './uge.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, peger } from '../../agent/prompt.ts';
import { dagenPromptTekst } from './prompt-tekster.ts';

/** What a room's prompt functions return: the built { instructions, input } (src/agent/prompt.ts). */
export type RunSpec = ReturnType<typeof byggPrompt>;

function tidslinje(now: Date): string {
  return dagenPromptTekst().tidslinje(copenhagenDate(now), copenhagenTime(now.toISOString()));
}

/**
 * KC-0259: the schema and rules for an agent without tools. A "handling" is a button that runs one of the agent's tools,
 * so the field is cut from the schema (anbefaling and kalender), its rules go, and one line says so. The field names are
 * the same in both languages.
 */
function skemaOgRegler(vaerktoejer: boolean): { skema: string; regler: string } {
  const T = dagenPromptTekst();
  if (vaerktoejer) return { skema: T.skema, regler: T.regler };
  const skema = T.skema.replace(/,\n\s*"handling": \{[^\n]*\}(?=\n)/, '').replace(/, "handling": \{[^}]*\}/, '');
  const linjer = T.regler.split('\n')
    .filter((l) => !/^- (Sæt|Set) "tilAndre"/.test(l))
    .map((l) => l.replace(/ (Giv den en|Give it a) "handling".*$/, ''));
  linjer.splice(linjer.length - 1, 0, T.ingenHandlinger); // before the closing "answer only with one JSON object" rule
  return { skema, regler: linjer.join('\n') };
}

/** Build the room from the data Kira's pipeline already fetched. */
export function buildRefreshRun(data: TrimmedAvis, now: Date, uge?: TrimmedUge | null, o: { vaerktoejer?: boolean } = {}): RunSpec {
  const T = dagenPromptTekst();
  const { skema, regler } = skemaOgRegler(o.vaerktoejer !== false);
  const ugeTekst = uge ? `\n\n${T.uge(JSON.stringify(uge.dage, null, 1))}${uge.fejl.length ? `\n${T.ugeFejl(uge.fejl.join('; '))}` : ''}` : `\n\n${T.ugeMangler}`;
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      katalog: true,
      opgave: `${T.rolle}\n\n${T.refreshOpgave}\n\n${skema}\n\n${regler}`,
      data: [{ kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\n${T.raadata(JSON.stringify(data, null, 1))}${ugeTekst}` }],
    }),
  };
}

/** No data file yet: ask Hermes to run Kira's pipeline with its terminal tool, then build. */
export function buildHentRun(now: Date): RunSpec {
  const T = dagenPromptTekst();
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      katalog: true,
      opgave: `${T.rolle}\n\n${T.hentOpgave}\n\n${T.skema}\n\n${T.regler}`,
      data: [{ kilde: 'hent', zone: KORSEL, tillid: 'betroet', tekst: `${tidslinje(now)}\n\n${T.hentBesked}` }],
    }),
  };
}

/** KC-0123: the room's state is text Hermes wrote from the day's data — an afledt segment, never task text. */
const indholdSegment = (state: DagenState | null, foer = '') => ({
  kilde: 'rum-state', zone: KORSEL, tillid: 'afledt' as const,
  tekst: `${foer}${state ? dagenPromptTekst().aktueltIndhold(JSON.stringify(state, null, 1)) : dagenPromptTekst().ingenData}`,
});

export function buildHandlingRun(h: Handling, state: DagenState): RunSpec {
  const T = dagenPromptTekst();
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${handlingsOpgave(handlingensVerb(h))} ${T.indholdOgsaa}\n\n${T.handlingRegler}`,
      data: [{ kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: h.instruktion }, indholdSegment(state, `${T.knappen(h.label)}\n\n`)],
    }),
  };
}

export function buildFortrydRun(fortryd: string, state: DagenState): RunSpec {
  const T = dagenPromptTekst();
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${fortrydOpgave()} ${T.indholdOgsaa}\n\n${T.handlingRegler}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }, indholdSegment(state)],
    }),
  };
}

export function buildChatRun(besked: string, kontekst: string | undefined, state: DagenState | null): RunSpec {
  const T = dagenPromptTekst();
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${T.rolle}\n\n${T.aktueltStaar} ${peger()}\n\n${T.chatRegler}`,
      data: [indholdSegment(state), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
