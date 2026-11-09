// The one seam between the app and the agent (KC-0118, spec D4). Hermes over
// HTTP is the default implementation, the fake serves tests and dev; OpenClaw
// joins later (KC-0112). Prompts, tool policy and the block catalog stay on our
// side of the seam (src/agent/prompt.ts). Only src/server.ts picks a client.

export type AgentEvent =
  | { type: 'tool.started'; tool: string; preview?: string }
  | { type: 'tool.completed'; tool: string; error: boolean }
  | { type: 'message.delta'; text: string }
  | { type: 'run.completed'; output: string }
  | { type: 'run.failed'; error: string };

export type AgentRunRequest = {
  /** The user-turn text Hermes answers. */
  input: string;
  /** Ephemeral system instructions for this run. */
  instructions: string;
  /** Optional Hermes session id for continuity (one per room). */
  sessionId?: string;
  /** Model override for this run (Hermes' api_server accepts a bare model on /v1/runs). */
  model?: string;
  provider?: string;
  /** Called for every lifecycle event while the run is in flight. */
  onEvent?: (event: AgentEvent) => void;
  /** KC-0118: aborts the run (kill switch, policy layer); the run rejects with AgentError(AFBRUDT). */
  signal?: AbortSignal;
};

export type AgentRunResult = { runId: string; output: string };

/** KC-0127: klar = answers; mangler-noegle = Clawco has no key to it yet (a fresh install); utilgaengelig = does not answer. */
export type AgentStatus = 'klar' | 'mangler-noegle' | 'utilgaengelig';

/** KC-0127: what became of a model key: handed to the agent (name + length only), or the one command to run by hand. */
export type NoegleSvar = { slags: 'gemt'; noegle: string; laengde: number } | { slags: 'kommando'; kommando: string };

export interface AgentClient {
  readonly mode: 'hermes-http' | 'fake' | 'direkte';
  /**
   * KC-0259: whether the agent runs tools of its own (web search, reading a mail or an article, running a command).
   * Hermes does; the built-in agent (direkte, and Copilot/Clawco's AI under it) does not. The rooms ask it to leave out
   * what only works with tools: a button, a suggestion or an ask that would end in "I have no tools".
   */
  readonly harVaerktoejer: boolean;
  /** Resolves with Hermes' final text; rejects with AgentError on run.failed. */
  run(req: AgentRunRequest): Promise<AgentRunResult>;
  /** True when Hermes answers its health endpoint. Never throws. */
  health(): Promise<boolean>;
  /** KC-0127: whether the agent can run now, and if not why. Never throws. */
  status(): Promise<AgentStatus>;
  /**
   * KC-0127: hands a model provider's key (or a local model's address) to the agent under the agent's env name.
   * Clawco never keeps it. Answers name + length, or the command to run on the agent's host when it cannot write.
   */
  saetModelNoegle(udbyder: { envNavn: string }, vaerdi: string): Promise<NoegleSvar>;
  /**
   * KC-0270 (B2): tells the agent to stop a run it is still working on (Hermes: POST /v1/runs/{id}/stop). The run's
   * own abort signal calls it; it never throws. Absent where the run lives in this process (the abort is enough).
   */
  cancel?(runId: string): Promise<void>;
}

/** The message of an aborted run (signal). */
export const AFBRUDT = 'afbrudt';

export class AgentError extends Error {
  readonly runId: string | undefined;
  constructor(message: string, runId?: string) {
    super(message);
    this.name = 'AgentError';
    this.runId = runId;
  }
}
