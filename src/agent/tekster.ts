// KC-0170 slice 3: the words of a failed Hermes connection and of the direct model's own timer, in Danish and English.
// They surface in the Kø panel (a failed run's text) and in the Start card, so they follow the language of the request.
// Same pattern as the other tables: `da` is what the code said before (byte for byte), `en` has exactly its keys, read at
// call time (never at module load). The language comes from src/store/sprog.ts (the one import this folder allows itself
// besides prompt.ts's two). Stays as it was on purpose: the message of an aborted run (`AFBRUDT`, a sentinel the kill
// switch and the tests compare, never shown: "Stop alt" settles the run first), the text Hermes itself sends in
// `run.failed`, and the shell command the Start card shows the operator.
//
// The two fixed Hermes sentences start/contain the words rooms/start/modelfejl.ts classifies on (a missing key, a
// refused key, a timeout); the English ones keep that to the extent the existing rules can match ("timed out"), see the
// KC-0170 findings for the two rules that still need an English pattern.

import { sprogNu } from '../store/sprog.ts';

const da = {
  /** Clawco has no key to Hermes yet (a fresh install): the run fails closed and nothing is sent. */
  manglerNoegle: 'Clawco har ingen nøgle til Hermes endnu',
  /** Hermes' own timer ran out. */
  hermesTid: 'Hermes svarede ikke i tide',
  udenRunId: 'Hermes svarede uden run_id',
  /** The `what` of "<what>: HTTP 401 <detail>". */
  afvisteKoerslen: 'Hermes afviste kørslen',
  eventStreamFejlede: 'Hermes event-stream fejlede',
  eventStreamTom: 'Hermes event-stream uden indhold',
  eventStreamForStor: 'Hermes event-stream blev for stor',
  statusFejlede: 'Hermes status fejlede',
  koerslenFejlede: 'Hermes-kørslen fejlede',
  annulleret: 'Hermes-kørslen blev annulleret',
  sluttedeUdenSvar: (status: string): string => `Hermes-kørslen sluttede uden svar (status: ${status})`,
  ukendtStatus: 'ukendt',
  /** The direct agent's own timer (not Start's 20-second test). */
  modelTid: 'Modellen svarede ikke i tide.',
};
const en: typeof da = {
  manglerNoegle: 'Clawco has no key to Hermes yet',
  hermesTid: 'Hermes timed out',
  udenRunId: 'Hermes answered without a run_id',
  afvisteKoerslen: 'Hermes rejected the run',
  eventStreamFejlede: 'Hermes event stream failed',
  eventStreamTom: 'Hermes event stream without content',
  eventStreamForStor: 'Hermes event stream grew too large',
  statusFejlede: 'Hermes status failed',
  koerslenFejlede: 'The Hermes run failed',
  annulleret: 'The Hermes run was cancelled',
  sluttedeUdenSvar: (status: string): string => `The Hermes run ended without an answer (status: ${status})`,
  ukendtStatus: 'unknown',
  modelTid: 'The model timed out.',
};
export const AGENT_TEKSTER = { da, en };
export const agentTekst = (): typeof da => AGENT_TEKSTER[sprogNu()];
/** KC-0241: the language of the run being built — the one place the agent folder reads it, for prompt-tekster.ts and the builders. */
export const agentSprog = (): 'da' | 'en' => sprogNu();
