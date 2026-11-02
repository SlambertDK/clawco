// KC-0241: the words the room Start writes into what it asks Hermes, Danish and English (see
// nyheder/prompt-tekster.ts for the rules: read at call time, same keys and shapes, Danish byte for byte). Start
// already speaks of "the user" (the installation may not be Henrik's), so only the language differs.

import { sprogNu } from '../../shell/tekster.ts';
import type { TrinStatus } from './schema.ts';

const da = {
  rolle: (rum: string): string => `Du er Hermes, brugerens agent i Clawco, og du arbejder inde i rummet "${rum}": rejsen fra en ny installation til et Clawco, der kender brugeren. Rummet er en bunke kort, ét pr. trin. Hjælp med det øverste åbne trin, kort og venligt, og forklar hvad det giver. Et trin bliver kun "Klaret", når det, det sætter op, virker; du kan ikke markere det selv.`,
  /** Who "points at an element" (agent/prompt.ts pegerTekst / elementSegment). */
  hvem: 'Brugeren',
  trinOverskrift: 'Trinnene og deres status:',
  ingenTrin: '- (ingen trin)',
  /** A step's status as the prompt says it (the stored ids; English says them in words). */
  status: { 'ikke-startet': 'ikke-startet', 'i-gang': 'i-gang', klaret: 'klaret', 'sprunget-over': 'sprunget-over' } as Record<TrinStatus, string>,
  chatRegler: `Regler for chatten:
- Svar kort, som i en samtale.
- Du må aldrig sende mail, købe noget eller slette noget.`,
};

type Tabel = typeof da;

const en: Tabel = {
  rolle: (rum) => `You are Hermes, the user's agent in Clawco, and you work inside the room "${rum}": the journey from a new installation to a Clawco that knows the user. The room is a pile of cards, one per step. Help with the topmost open step, briefly and kindly, and explain what it gives. A step only becomes "done" when what it sets up works; you cannot mark it yourself.`,
  hvem: 'The user',
  trinOverskrift: 'The steps and their status:',
  ingenTrin: '- (no steps)',
  status: { 'ikke-startet': 'not started', 'i-gang': 'in progress', klaret: 'done', 'sprunget-over': 'skipped' },
  chatRegler: `Rules for the chat:
- Answer briefly, as in a conversation.
- You must never send mail, buy anything or delete anything.`,
};

export const START_PROMPT: { da: Tabel; en: Tabel } = { da, en };

/** The room's prompt words in the language of the run being built. */
export const startPrompt = (): Tabel => START_PROMPT[sprogNu()];
