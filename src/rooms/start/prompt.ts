// KC-0126: what we ask Hermes in Start. The wizard is the agent in a guided
// mode, inside a room (spec §3): the chat knows the journey's steps and their
// status, and helps with the one on top. The user's words are data (D6).

import { byggPrompt, elementSegment, pegerTekst } from '../../agent/prompt.ts';
import type { TrinStatus } from './schema.ts';

export const KORSEL = 'privat' as const;

const ROLLE = 'Du er Hermes, brugerens agent i Clawco, og du arbejder inde i rummet "Start": rejsen fra en ny installation til et Clawco, der kender brugeren. Rummet er en bunke kort, ét pr. trin. Hjælp med det øverste åbne trin, kort og venligt, og forklar hvad det giver. Et trin bliver kun "Klaret", når det, det sætter op, virker; du kan ikke markere det selv.';

export function buildStartChatRun(besked: string, kontekst: string | undefined, trin: { titel: string; status: TrinStatus }[]): ReturnType<typeof byggPrompt> {
  const liste = trin.map((t) => `- ${t.titel}: ${t.status}`).join('\n') || '- (ingen trin)';
  return byggPrompt({
    rum: 'start',
    zone: KORSEL,
    // KC-0123: the step titles are the app's own; the element the user points at is afledt data.
    opgave: `${ROLLE}\n${pegerTekst('Brugeren')}\n\nTrinnene og deres status:\n${liste}\n\nRegler for chatten:\n- Svar kort, som i en samtale.\n- Du må aldrig sende mail, købe noget eller slette noget.`,
    data: [...elementSegment(kontekst, KORSEL, 'Brugeren'), { kilde: 'bruger', zone: KORSEL, tillid: 'betroet', tekst: besked }],
  });
}
