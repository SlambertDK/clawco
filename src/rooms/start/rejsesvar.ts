// KC-0249: the Start chat answers the journey's own questions ("what is a model key?", "why Tailscale?", "what does
// this step give me?") from a fixed list, before any model works (spec 2026-11-03 §4 P5). No model is called: the
// answer is the app's own sentence in the language being rendered, so it is the same one a screen reader or a test
// reads. The questions are matched in both languages whatever the screen's (a Danish question on an English screen
// still gets its answer, in English). Once a model works the chat is the model's again (room.ts decides). Pure.

import { startTekst, type StartTekster } from './tekster.ts';

type Emne = keyof StartTekster['rejsesvar']['emner'] | 'trinet' | 'hjaelp';

/**
 * How a message is recognised as one of the journey's own questions. Ordinary chat must never fire (a mail that "never came",
 * "what is this email about", "how long was the meeting"), so a topic needs a specific phrase: `indeholder` (any one of the
 * phrases is in the message), `helt` (the whole message is the phrase, the chat's own suggestions and short forms), or `og`
 * (every group has one of its words in the message: a question word AND the thing asked about). The order matters — the first
 * topic that matches wins, so "what is this step" (trinet) is tried before "what is Clawco".
 */
type Regel = { indeholder?: readonly string[]; helt?: readonly string[]; og?: readonly (readonly string[])[] };
const SPOERGSMAAL = ['hvad', 'hvorfor', 'hvordan', 'what', 'why', 'how'];
const EMNER: readonly (readonly [Emne, Regel])[] = [
  ['hjaelp', { helt: ['hvad kan jeg sige', 'what can i say'] }],
  // The chat's own suggestions for Start (shell/forslag.ts) are questions too, matched as the whole message.
  ['trinet', { helt: ['hvad skal jeg nu', 'what should i do now', 'what do i do next'], og: [SPOERGSMAAL, ['det her trin', 'dette trin', 'trinnet', 'this step']] }],
  ['modelnoegle', { indeholder: ['modelnøgle', 'model key', 'api-nøgle', 'api nøgle', 'api key'], helt: ['hvad er en nøgle', 'what is a key'] }],
  ['tailscale', { indeholder: ['tailscale'] }],
  ['kilde', { helt: ['hvad er en kilde', 'hvad er kilder', 'what is a source', 'what are sources'] }],
  ['sikkerhed', { indeholder: ['hvor ligger mine data', 'where is my data', 'where does my data', 'er mine data sikre', 'is my data safe', 'er clawco sikker', 'is clawco safe'] }],
  ['tid', { indeholder: ['hvor lang tid tager rejsen', 'hvor lang tid tager det her', 'hvor lang tid tager opsætningen', 'how long does the journey', 'how long does this take', 'how long does the setup', 'how long will this take'], helt: ['hvor lang tid tager det', 'how long does it take'] }],
  ['hvadEr', { indeholder: ['hvad er clawco', 'what is clawco', 'hvad er hermes', 'what is hermes'] }],
  ['aldrig', { og: [['clawco', 'hermes'], ['aldrig', 'never', 'betale', ' pay', 'slette', 'delete', 'sende mail', 'send mail']] }],
];

const normaliser = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/^[\s?!.,]+|[\s?!.,]+$/g, '');

const passer = (b: string, r: Regel): boolean =>
  Boolean(r.indeholder?.some((f) => b.includes(f))) || Boolean(r.helt?.includes(b)) || Boolean(r.og?.every((g) => g.some((f) => b.includes(f))));

/** Which topic a message asks about, or null when it asks about none of them. */
export function rejseEmne(besked: string): Emne | null {
  const b = normaliser(besked);
  return EMNER.find(([, regel]) => passer(b, regel))?.[0] ?? null;
}

/**
 * The fixed answer to a message, or null when none fits. `aabent` is the step the person is on (title and sentence); the
 * "what does this step give me" answer is that step's own sentence.
 */
export function rejseSvar(besked: string, aabent: { titel: string; tekst: string } | undefined): string | null {
  const emne = rejseEmne(besked);
  if (!emne) return null;
  const T = startTekst().rejsesvar;
  if (emne === 'hjaelp') return T.ikkeEndnu;
  if (emne === 'trinet') return aabent ? T.trinSvar(aabent.titel, aabent.tekst) : T.ingenTrin;
  return T.emner[emne];
}

/** What the chat says when no model works and no fixed answer fits. */
export const ikkeEndnuSvar = (): string => startTekst().rejsesvar.ikkeEndnu;
