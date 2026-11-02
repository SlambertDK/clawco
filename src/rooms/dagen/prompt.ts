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

/** Build the room from the data Kira's pipeline already fetched. */
export function buildRefreshRun(data: TrimmedAvis, now: Date, uge?: TrimmedUge | null): RunSpec {
  const T = dagenPromptTekst();
  const ugeTekst = uge ? `\n\n${T.uge(JSON.stringify(uge.dage, null, 1))}${uge.fejl.length ? `\n${T.ugeFejl(uge.fejl.join('; '))}` : ''}` : `\n\n${T.ugeMangler}`;
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      katalog: true,
      opgave: `${T.rolle}\n\n${T.refreshOpgave}\n\n${T.skema}\n\n${T.regler}`,
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
