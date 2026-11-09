// KC-0180: the direct-model AgentClient (KC_AGENT=direkte). No Hermes beside
// it: one streamed HTTP call per run to the provider chosen in Start, with the
// key from the agent's own NoegleLager. Two wire shapes cover the providers:
// Anthropic Messages and OpenAI-compatible chat completions (read 2026-10-31:
// platform.claude.com/docs/en/build-with-claude/streaming and /api/errors,
// developers.openai.com chat completions create, openrouter.ai streaming).
// No tools: it never emits tool.* events, so the run watcher (graenser/opsyn.ts)
// has nothing to catch and the policy layer is untouched. Every failure is one
// fixed sentence injected by the composition root; a provider body only
// decides the kind, because it can echo a fragment of the key.

import { randomUUID } from 'node:crypto';
import { AFBRUDT, AgentError } from './types.ts';
import type { AgentClient, AgentEvent, AgentRunRequest, AgentRunResult, AgentStatus, NoegleSvar } from './types.ts';
import type { NoegleLager } from './noeglelager.ts';
import { parseSseChunks, SseForStor } from './sse.ts';
import { agentTekst } from './tekster.ts';
import { PROMPT_TEKSTER, promptTekst } from './prompt-tekster.ts';
import type { CopilotTransport } from './copilot.ts';
import { gyldigDato, INKLUDERET_ID, type Inkluderet } from './inkluderet.ts';

/**
 * How a provider is called directly; no url = the saved local address + /chat/completions. KC-0263: copilot-sdk = the
 * Copilot transport (copilot.ts) with the token "Sign in with GitHub" saved, injected as `copilot`. KC-0265: anthropic-proxy =
 * Clawco's model proxy of a Sky plan: the Anthropic wire with a bearer token, its address and token from `inkluderet`.
 */
export type DirekteApi = { api: 'anthropic-messages' | 'openai-chat' | 'copilot-sdk' | 'anthropic-proxy'; url?: string };
/** What the agent needs of a provider (the KC-0127 list in rooms/start/udbydere.ts satisfies it; injected). */
export type DirekteUdbyder = { id: string; envNavn: string; hermesProvider: string; kraeverNoegle: boolean; direkte?: DirekteApi };
/** KC-0265: kvote = the included AI's month is used up (402), inkluderet-ikke-klar = no token / refused (fail closed), inkluderet-utilgaengelig = the proxy does not answer (503, 5xx, 429, nobody there). */
export type DirekteFejlArt = 'model-noegle' | 'kun-hermes' | 'noegle' | 'kredit' | 'model' | 'forbindelse' | 'ukendt' | 'kvote' | 'inkluderet-ikke-klar' | 'inkluderet-utilgaengelig';

/** Appended to every run's system text: the model has no tools and must say so rather than claim it did something. */
export const UDEN_VAERKTOEJ = PROMPT_TEKSTER.da.udenVaerktoej;
/** KC-0241: the same line in the language of the run. */
export const udenVaerktoej = (): string => promptTekst().udenVaerktoej;

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TOKENS = 8192;
const ANTHROPIC_VERSION = '2023-06-01';
const KREDIT = /insufficient_quota|credit balance|billing|quota/i;

type Wire = Record<string, unknown>;
const isRecord = (v: unknown): v is Wire => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The kind of an HTTP failure. The body is read here and dropped: only the kind leaves this function. */
async function httpArt(res: Response): Promise<DirekteFejlArt> {
  if (res.status === 401 || res.status === 403) return 'noegle';
  if (res.status === 402) return 'kredit';
  if (res.status === 404) return 'model';
  const tekst = await res.text().catch(() => '');
  if ((res.status === 400 || res.status === 429) && KREDIT.test(tekst)) return 'kredit';
  return 'ukendt';
}

/**
 * KC-0265: the kind of an HTTP failure from Clawco's proxy (error types `ugyldig_noegle`, `kvote_brugt` + `nulstilles`,
 * `model_ikke_tilladt`, `ikke_tilgaengelig`). Status and the error type only pick the kind; a 402's reset date is kept when
 * it is a real date; nothing else of the body leaves this function.
 */
async function proxyArt(res: Response, ink: Pick<Inkluderet, 'noter'>): Promise<DirekteFejlArt> {
  let type: unknown;
  let dato: string | undefined;
  try {
    const d: unknown = JSON.parse(await res.text());
    if (isRecord(d)) {
      const e = d['error'];
      type = isRecord(e) ? e['type'] : undefined;
      dato = gyldigDato((isRecord(e) ? e['nulstilles'] : undefined) ?? d['nulstilles']);
    }
  } catch { /* an unreadable body is only a status */ }
  if (res.status === 402 || type === 'kvote_brugt') { ink.noter({ art: 'kvote', ...(dato ? { nulstilles: dato } : {}) }); return 'kvote'; }
  if (res.status === 401 || res.status === 403 || type === 'ugyldig_noegle' || type === 'model_ikke_tilladt') return 'inkluderet-ikke-klar';
  if (res.status === 429) return 'inkluderet-utilgaengelig';
  if (res.status >= 500) { ink.noter({ art: 'utilgaengelig' }); return 'inkluderet-utilgaengelig'; }
  return 'ukendt';
}

export function createDirekte(o: {
  udbydere: readonly DirekteUdbyder[];
  lager: NoegleLager;
  fejl: Record<DirekteFejlArt, string>;
  /** The provider chosen in Start and whether its last live test passed (settings; KC-0127). For health only. */
  testet?: () => Promise<{ udbyder?: string; ok: boolean }>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
  /** KC-0263: the Copilot transport (absent = a copilot-sdk provider fails closed as kun-hermes). */
  copilot?: CopilotTransport;
  /** KC-0265: Clawco's model proxy of a Sky plan (absent = a provider with `anthropic-proxy` fails closed). */
  inkluderet?: Pick<Inkluderet, 'baseUrl' | 'noter' | 'utilgaengelig'>;
}): AgentClient {
  const doFetch: typeof fetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hentNoegle = (id: string): Promise<string | undefined> => o.lager.hent(id).catch(() => undefined);

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const runId = `direkte_${randomUUID()}`;
    const emit = (e: AgentEvent): void => {
      try { req.onEvent?.(e); } catch { /* a listener bug must not kill the run */ }
    };
    const fejl = (art: DirekteFejlArt): AgentError => {
      emit({ type: 'run.failed', error: o.fejl[art] });
      return new AgentError(o.fejl[art], runId);
    };
    if (req.signal?.aborted) throw new AgentError(AFBRUDT, runId);

    const u = o.udbydere.find((x) => x.hermesProvider === req.provider);
    if (!u || !req.model) throw fejl('model-noegle');
    if (!u.direkte) throw fejl('kun-hermes');
    const api = u.direkte.api;
    const ink = api === 'anthropic-proxy' ? o.inkluderet : undefined;
    const proxy = api === 'anthropic-proxy';
    if (proxy && !ink) throw fejl('inkluderet-ikke-klar');
    const noegle = await hentNoegle(u.id);
    if (!noegle) throw fejl(proxy ? 'inkluderet-ikke-klar' : 'model-noegle');
    const system = `${req.instructions}\n\n${udenVaerktoej()}`;
    if (api === 'copilot-sdk') {
      if (!o.copilot) throw fejl('kun-hermes');
      return o.copilot.koer({ system, input: req.input, model: req.model, ...(req.onEvent ? { onEvent: req.onEvent } : {}), ...(req.signal ? { signal: req.signal } : {}) }, noegle);
    }
    const url = ink ? `${ink.baseUrl}/v1/messages` : u.direkte.url ?? `${noegle.replace(/\/+$/, '')}/chat/completions`;

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    let body: Wire;
    if (api === 'anthropic-messages' || api === 'anthropic-proxy') {
      if (proxy) headers['authorization'] = `Bearer ${noegle}`; else headers['x-api-key'] = noegle;
      headers['anthropic-version'] = ANTHROPIC_VERSION;
      body = { model: req.model, max_tokens: o.maxTokens ?? DEFAULT_MAX_TOKENS, system, messages: [{ role: 'user', content: req.input }], stream: true };
    } else {
      if (u.kraeverNoegle) headers['authorization'] = `Bearer ${noegle}`;
      body = { model: req.model, messages: [{ role: 'system', content: system }, { role: 'user', content: req.input }], stream: true };
    }

    const controller = new AbortController();
    let timedOut = false;
    let afbrudt = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const afbryd = (): void => { afbrudt = true; controller.abort(); };
    req.signal?.addEventListener('abort', afbryd, { once: true });

    // A failed fetch or read leaves as AFBRUDT, the timer sentence or a fixed sentence: never the underlying error, which may name the URL.
    try {
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, ...(proxy ? { redirect: 'error' as const } : {}) }); // KC-0265: the bearer token goes to the proxy's address only, never along a redirect
      } catch {
        if (ink && !stoppetFejl()) ink.noter({ art: 'utilgaengelig' });
        throw stoppetFejl() ?? fejl(ink ? 'inkluderet-utilgaengelig' : 'forbindelse');
      }
      if (!res.ok) throw fejl(ink ? await proxyArt(res, ink) : await httpArt(res));
      if (!res.body) throw fejl('ukendt');

      let tekst = '';
      let faerdig = false;
      /** One SSE data payload; answers true when the stream says the answer is complete. */
      const handle = (payload: string): boolean => {
        if (api === 'openai-chat' && payload.trim() === '[DONE]') return true;
        let d: unknown;
        try { d = JSON.parse(payload); } catch { return false; }
        if (!isRecord(d)) return false;
        if (api === 'anthropic-messages' || api === 'anthropic-proxy') {
          if (d['type'] === 'error') throw fejl('ukendt');
          if (d['type'] === 'message_stop') return true;
          const delta = d['delta'];
          if (d['type'] === 'content_block_delta' && isRecord(delta) && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            tekst += delta['text'];
            emit({ type: 'message.delta', text: delta['text'] });
          }
          return false;
        }
        if (d['error'] !== undefined) throw fejl('ukendt');
        const valg = Array.isArray(d['choices']) ? d['choices'][0] : undefined;
        if (!isRecord(valg)) return false;
        if (valg['finish_reason'] === 'error') throw fejl('ukendt');
        const delta = valg['delta'];
        if (isRecord(delta) && typeof delta['content'] === 'string' && delta['content'] !== '') {
          tekst += delta['content'];
          emit({ type: 'message.delta', text: delta['content'] });
        }
        if (typeof valg['finish_reason'] === 'string') faerdig = true;
        return false;
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = parseSseChunks();
      // KC-0275 (B7): a stream past the buffer maximum is a failed run, in our words.
      const push = (t: string): string[] => { try { return parser.push(t); } catch (e) { throw e instanceof SseForStor ? fejl('ukendt') : e; } };
      try {
        laes: for (;;) {
          let del: ReadableStreamReadResult<Uint8Array>;
          try { del = await reader.read(); } catch { throw stoppetFejl() ?? fejl('forbindelse'); }
          const payloads = del.done ? push(decoder.decode() + '\n\n') : push(decoder.decode(del.value, { stream: true }));
          for (const p of payloads) {
            if (handle(p)) { faerdig = true; break laes; }
            if (afbrudt) throw new AgentError(AFBRUDT, runId);
          }
          if (del.done) break;
        }
      } finally {
        reader.cancel().catch(() => {});
      }
      if (afbrudt) throw new AgentError(AFBRUDT, runId);
      if (!faerdig) throw stoppetFejl() ?? fejl('ukendt');
      ink?.noter({ art: 'ok' });
      emit({ type: 'run.completed', output: tekst });
      return { runId, output: tekst };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', afbryd);
    }

    function stoppetFejl(): AgentError | undefined {
      if (afbrudt) return new AgentError(AFBRUDT, runId);
      if (timedOut) { const tid = agentTekst().modelTid; emit({ type: 'run.failed', error: tid }); return new AgentError(tid, runId); }
      return undefined;
    }
  }

  /** KC-0265: Clawco's AI is the chosen one and the proxy said "not available" a minute ago or less. */
  async function proxyNede(): Promise<boolean> {
    if (!o.inkluderet?.utilgaengelig()) return false;
    try { return (await o.testet?.())?.udbyder === INKLUDERET_ID; } catch { return false; }
  }

  async function health(): Promise<boolean> {
    try {
      const t = await o.testet?.();
      if (!t?.ok || !t.udbyder) return false;
      if (await proxyNede()) return false;
      return Boolean(await hentNoegle(t.udbyder));
    } catch { return false; }
  }

  // There is no key to an agent here: the model key is Start's step 2 (an open step until its test passes).
  // KC-0265: but a proxy that just said "not available" is the agent not answering (Start and /health say so).
  async function status(): Promise<AgentStatus> { return (await proxyNede()) ? 'utilgaengelig' : 'klar'; }

  async function saetModelNoegle(udbyder: { envNavn: string }, vaerdi: string): Promise<NoegleSvar> {
    const u = o.udbydere.find((x) => x.envNavn === udbyder.envNavn);
    if (!u) throw new Error('ukendt udbyder');
    const { laengde } = await o.lager.saet(u.id, vaerdi);
    return { slags: 'gemt', noegle: u.envNavn, laengde };
  }

  return { mode: 'direkte', harVaerktoejer: false, run, health, status, saetModelNoegle };
}
