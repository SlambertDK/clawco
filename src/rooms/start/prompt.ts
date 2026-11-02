// KC-0126: what we ask Hermes in Start. The wizard is the agent in a guided
// mode, inside a room (spec §3): the chat knows the journey's steps and their
// status, and helps with the one on top. The user's words are data (D6).

import { byggPrompt, elementSegment, pegerTekst } from '../../agent/prompt.ts';
import type { TrinStatus } from './schema.ts';
import { tekst } from '../../shell/tekster.ts';
import { startPrompt } from './prompt-tekster.ts';

export const KORSEL = 'privat' as const;

export function buildStartChatRun(besked: string, kontekst: string | undefined, trin: { titel: string; status: TrinStatus }[]): ReturnType<typeof byggPrompt> {
  // KC-0241: the words are in prompt-tekster.ts, Danish and English, read at call time; the room's name is the nav's.
  const T = startPrompt();
  const liste = trin.map((t) => `- ${t.titel}: ${T.status[t.status] ?? t.status}`).join('\n') || T.ingenTrin;
  return byggPrompt({
    rum: 'start',
    zone: KORSEL,
    // KC-0123: the step titles are the app's own; the element the user points at is afledt data.
    opgave: `${T.rolle(tekst().rum['start']!)}\n${pegerTekst(T.hvem)}\n\n${T.trinOverskrift}\n${liste}\n\n${T.chatRegler}`,
    data: [...elementSegment(kontekst, KORSEL, T.hvem), { kilde: 'bruger', zone: KORSEL, tillid: 'betroet', tekst: besked }],
  });
}
