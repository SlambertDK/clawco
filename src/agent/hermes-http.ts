// AgentClient over Hermes' api_server: POST /v1/runs, then stream
// GET /v1/runs/{id}/events (SSE). See AGENTS.md §1 "Hermes contract".

import { AFBRUDT, AgentError } from './types.ts';
import type { AgentClient, AgentEvent, AgentRunRequest, AgentRunResult, AgentStatus, NoegleSvar } from './types.ts';
import { parseSseChunks, SseForStor } from './sse.ts';
import { agentTekst } from './tekster.ts';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 5000;
const VENT_MS = 30_000;

/**
 * KC-0127: writes one KEY=value into Hermes' env file — injected by the composition root (the secrets module's
 * writer: allowlist, 0600, atomic). Answers name + length, or null when the file cannot be written here.
 */
export type NoegleSkriver = (navn: string, vaerdi: string) => Promise<{ noegle: string; laengde: number } | null>;

type Wire = Record<string, unknown>;

function isRecord(v: unknown): v is Wire {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Pull a human message out of an `{"error": ...}` body, if there is one. */
async function errorDetail(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return '';
  }
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body)) {
      const e = body['error'];
      if (typeof e === 'string') return e;
      if (isRecord(e) && typeof e['message'] === 'string') return e['message'];
    }
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

async function httpError(what: string, res: Response, runId?: string): Promise<AgentError> {
  const detail = await errorDetail(res);
  return new AgentError(`${what}: HTTP ${res.status}${detail ? ` ${detail}` : ''}`, runId);
}

/** KC-0127: the one command that puts a key into Hermes' env file on its own host (read from the keyboard, never on the line). */
export const noegleKommando = (envNavn: string): string =>
  `read -rsp 'Indsæt værdien: ' V && printf '\\n%s=%s\\n' ${envNavn} "$V" >> ~/.hermes/.env && unset V && hermes gateway restart`;

export function createHermesHttp(opts: {
  baseUrl: string;
  /** Clawco's key to Hermes. A function is read on every call, so a key entered in Start works without a restart (KC-0127). */
  apiKey: string | (() => string | undefined);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * KC-0127: where model keys go. `skriv` = the writer for Hermes' env file on this host (absent, or null back: the
   * command is shown instead); `genstart` restarts the gateway afterwards (injected; never run in dev); `ventMs`
   * bounds the wait for Hermes to answer again.
   */
  noegler?: { skriv?: NoegleSkriver; genstart?: () => Promise<void>; ventMs?: number };
}): AgentClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const noegle = (): string => (typeof opts.apiKey === 'function' ? opts.apiKey() : opts.apiKey)?.trim() ?? '';
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authHeaders = (): Record<string, string> => ({ authorization: `Bearer ${noegle()}` });

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    // KC-0127 (KC-0156): no key yet — fail closed, nothing sent.
    if (!noegle()) throw new AgentError(agentTekst().manglerNoegle);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let runId: string | undefined;
    // KC-0118: the caller's signal aborts the same controller as the timeout.
    if (req.signal?.aborted) { clearTimeout(timer); throw new AgentError(AFBRUDT); }
    let afbrudt = false;
    // KC-0270 (B2): closing our stream is not enough — Hermes is told to stop the run too.
    const afbryd = (): void => { afbrudt = true; controller.abort(); if (runId) void cancel(runId); };
    req.signal?.addEventListener('abort', afbryd, { once: true });

    try {
      return await execute();
    } catch (err) {
      if (afbrudt) throw new AgentError(AFBRUDT, runId);
      if (timedOut) throw new AgentError(agentTekst().hermesTid, runId);
      if (err instanceof AgentError) throw err;
      throw new AgentError(err instanceof Error ? err.message : String(err), runId);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', afbryd);
    }

    async function execute(): Promise<AgentRunResult> {
      const body: Record<string, string> = { input: req.input, instructions: req.instructions };
      if (req.sessionId !== undefined) body['session_id'] = req.sessionId;
      if (req.model) body['model'] = req.model;
      if (req.provider) body['provider'] = req.provider;

      const post = await doFetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!post.ok) throw await httpError(agentTekst().afvisteKoerslen, post);
      let started: unknown;
      try {
        started = await post.json();
      } catch {
        throw new AgentError(agentTekst().udenRunId);
      }
      const id = isRecord(started) ? str(started['run_id']) : undefined;
      if (!id) throw new AgentError(agentTekst().udenRunId);
      runId = id;

      const emit = (e: AgentEvent): void => {
        try {
          req.onEvent?.(e);
        } catch {
          // a listener bug must not kill the run
        }
      };

      const events = await doFetch(`${baseUrl}/v1/runs/${encodeURIComponent(id)}/events`, {
        headers: { ...authHeaders(), accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!events.ok) throw await httpError(agentTekst().eventStreamFejlede, events, id);
      if (!events.body) throw new AgentError(agentTekst().eventStreamTom, id);

      let deltas = '';
      const handle = (payload: string): AgentRunResult | undefined => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return undefined;
        }
        if (!isRecord(parsed)) return undefined;
        switch (parsed['event']) {
          case 'tool.started': {
            const tool = str(parsed['tool']) ?? 'unknown';
            const preview = str(parsed['preview']);
            emit(preview === undefined ? { type: 'tool.started', tool } : { type: 'tool.started', tool, preview });
            return undefined;
          }
          case 'tool.completed':
            emit({ type: 'tool.completed', tool: str(parsed['tool']) ?? 'unknown', error: parsed['error'] === true });
            return undefined;
          case 'message.delta': {
            const text = str(parsed['delta']) ?? '';
            deltas += text;
            emit({ type: 'message.delta', text });
            return undefined;
          }
          case 'run.completed': {
            const given = str(parsed['output']);
            const output = given !== undefined && given !== '' ? given : deltas;
            emit({ type: 'run.completed', output });
            return { runId: id, output };
          }
          case 'run.failed': {
            const error = str(parsed['error']) ?? agentTekst().koerslenFejlede;
            emit({ type: 'run.failed', error });
            throw new AgentError(error, id);
          }
          case 'run.cancelled': {
            const error = agentTekst().annulleret;
            emit({ type: 'run.failed', error });
            throw new AgentError(error, id);
          }
          default:
            return undefined; // reasoning.available and anything new
        }
      };

      const reader = events.body.getReader();
      const decoder = new TextDecoder();
      const parser = parseSseChunks();
      // KC-0275 (B7): a stream that grows past the buffer maximum without finishing an event is a failed run.
      const push = (tekst: string): string[] => {
        try { return parser.push(tekst); } catch (err) {
          if (err instanceof SseForStor) throw new AgentError(agentTekst().eventStreamForStor, id);
          throw err;
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const payload of push(decoder.decode(value, { stream: true }))) {
            const result = handle(payload);
            if (result) return result;
          }
        }
        for (const payload of push(decoder.decode() + '\n\n')) {
          const result = handle(payload);
          if (result) return result;
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      // Stream ended without a terminal event: ask for the run's final state.
      const status = await doFetch(`${baseUrl}/v1/runs/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (!status.ok) throw await httpError(agentTekst().statusFejlede, status, id);
      const info: unknown = await status.json().catch(() => undefined);
      const state = isRecord(info) ? str(info['status']) : undefined;
      if (isRecord(info) && state === 'completed') {
        const given = str(info['output']);
        const output = given !== undefined && given !== '' ? given : deltas;
        emit({ type: 'run.completed', output });
        return { runId: id, output };
      }
      const error =
        (isRecord(info) ? str(info['error']) : undefined) ??
        agentTekst().sluttedeUdenSvar(state ?? agentTekst().ukendtStatus);
      emit({ type: 'run.failed', error });
      throw new AgentError(error, id);
    }
  }

  let cancelAdvaret = false;
  async function cancel(runId: string): Promise<void> {
    try {
      const res = await doFetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      // 404 is also a run that already ended; a Hermes without the route answers 404/405 for every run — say it once.
      if ((res.status === 404 || res.status === 405) && !cancelAdvaret) { cancelAdvaret = true; console.warn(`[hermes] cancel ikke understøttet af Hermes (HTTP ${res.status} på /v1/runs/{id}/stop)`); }
    } catch {
      // a Hermes that does not answer: nothing more to stop from here
    }
  }

  async function health(): Promise<boolean> {
    if (!noegle()) return false;
    try {
      const res = await doFetch(`${baseUrl}/health`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function status(): Promise<AgentStatus> {
    if (!noegle()) return 'mangler-noegle';
    return (await health()) ? 'klar' : 'utilgaengelig';
  }

  // KC-0127: write the key where Hermes reads it, restart the gateway, and wait (bounded) until it answers again.
  async function saetModelNoegle(udbyder: { envNavn: string }, vaerdi: string): Promise<NoegleSvar> {
    const n = opts.noegler;
    const skrevet = n?.skriv ? await n.skriv(udbyder.envNavn, vaerdi) : null;
    if (!n || !skrevet) return { slags: 'kommando', kommando: noegleKommando(udbyder.envNavn) };
    const { noegle: navn, laengde } = skrevet;
    if (n.genstart) {
      await n.genstart();
      const slut = Date.now() + (n.ventMs ?? VENT_MS);
      while (!(await health()) && Date.now() < slut) await new Promise((r) => setTimeout(r, 500));
    }
    return { slags: 'gemt', noegle: navn, laengde };
  }

  return { mode: 'hermes-http', harVaerktoejer: true, run, health, status, saetModelNoegle, cancel };
}
