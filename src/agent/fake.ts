// Scripted AgentClient for tests and local dev (KC_AGENT=fake).

import { AFBRUDT, AgentError } from './types.ts';
import type { AgentClient, AgentEvent, AgentRunRequest, AgentRunResult, AgentStatus, NoegleSvar } from './types.ts';
import { MODEL_TEST } from './prompt.ts';

type FakeAnswer = string | { output: string; events?: AgentEvent[] };
/** KC-0127: how the fake answers Start's live test of a model. */
export type ModelTestUdfald = 'klar' | '401' | 'timeout';

export function createFakeAgent(
  opts: { answer?: (req: AgentRunRequest) => FakeAnswer; delayMs?: number; modelTest?: (req: AgentRunRequest) => ModelTestUdfald; status?: () => AgentStatus } = {},
): AgentClient & { calls: AgentRunRequest[]; noegler: { envNavn: string; laengde: number }[] } {
  const calls: AgentRunRequest[] = [];
  const noegler: { envNavn: string; laengde: number }[] = [];
  let counter = 0;
  const modelTest = opts.modelTest ?? (() => 'klar' as const);
  const answer = (req: AgentRunRequest): FakeAnswer => {
    if (req.instructions !== MODEL_TEST.instructions) return (opts.answer ?? (() => 'Fake svar fra Hermes.'))(req);
    if (modelTest(req) === '401') throw new Error("Error code: 401 - {'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}");
    return 'klar';
  };

  return {
    mode: 'fake',
    calls,
    noegler,
    async run(req: AgentRunRequest): Promise<AgentRunResult> {
      calls.push(req);
      counter += 1;
      const runId = `fake_${counter}`;
      const emit = (e: AgentEvent): void => req.onEvent?.(e);

      // KC-0118: an abort before or during the delay rejects like the real client.
      if (req.signal?.aborted) throw new AgentError(AFBRUDT, runId);
      // KC-0127: a model that never answers — only the caller's signal ends the run.
      if (req.instructions === MODEL_TEST.instructions && modelTest(req) === 'timeout') {
        await new Promise<void>((_resolve, reject) => {
          if (!req.signal) return;
          req.signal.addEventListener('abort', () => reject(new AgentError(AFBRUDT, runId)), { once: true });
        });
      }
      if (opts.delayMs && opts.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => { req.signal?.removeEventListener('abort', stop); resolve(); }, opts.delayMs);
          const stop = (): void => { clearTimeout(t); reject(new AgentError(AFBRUDT, runId)); };
          req.signal?.addEventListener('abort', stop, { once: true });
        });
      }

      let result: FakeAnswer;
      try {
        result = answer(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'run.failed', error: message });
        throw new AgentError(message, runId);
      }
      const output = typeof result === 'string' ? result : result.output;
      const events = typeof result === 'string' ? [] : (result.events ?? []);

      emit({ type: 'tool.started', tool: 'terminal', preview: 'fake' });
      emit({ type: 'tool.completed', tool: 'terminal', error: false });
      for (const e of events) emit(e);
      // KC-0122: a listener that aborted during the events stops the run, as with the real client.
      if (req.signal?.aborted) throw new AgentError(AFBRUDT, runId);
      emit({ type: 'run.completed', output });
      return { runId, output };
    },
    async health(): Promise<boolean> {
      return (opts.status?.() ?? 'klar') === 'klar';
    },
    async status(): Promise<AgentStatus> {
      return opts.status?.() ?? 'klar';
    },
    // KC-0127: records the name and the length only; the value goes nowhere.
    async saetModelNoegle(udbyder: { envNavn: string }, vaerdi: string): Promise<NoegleSvar> {
      noegler.push({ envNavn: udbyder.envNavn, laengde: vaerdi.length });
      return { slags: 'gemt', noegle: udbyder.envNavn, laengde: vaerdi.length };
    },
  };
}
