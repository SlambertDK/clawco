// KC-0263: the Copilot transport of the built-in agent (direkte.ts, api 'copilot-sdk'). GitHub's sanctioned way in is
// @github/copilot-sdk, which runs the bundled Copilot runtime as a child process over JSON-RPC and bills the person's own
// Copilot plan; the token is the one "Sign in with GitHub" saved (github-enhed.ts). The SDK is imported only here and
// sits behind a tiny interface (CopilotKlient), so the tests drive a fake and never start the runtime.
//
// The model must stay a text model with no hands, as the other direct providers are (KC-0180): the runtime is an agent
// with shell, file, web and GitHub tools of its own, so every way in is shut, each one tested (test/agent/copilot.test.ts):
// - client mode 'empty' (README: "Use "empty" for multi-user server mode"), useLoggedInUser false, the token only;
// - availableTools [] and excludedTools builtin:* mcp:* custom:* (exclusion always wins); no tools, MCP servers, custom
//   agents, skills, plugins, hooks or instruction directories; skills, config discovery, session store, memory,
//   session telemetry, on-demand instruction discovery, file hooks, host git and MCP apps all off;
// - onPermissionRequest rejects everything, and any tool, permission, sub-agent, skill or hook event fails the run
//   closed with one fixed sentence (the session is aborted);
// - the runtime's home (COPILOT_HOME) and cwd are a fresh directory under the OS tmp, each session in its own empty
//   subdirectory (never the data dir or the app dir); the child env is an allowlist (PATH, HOME → that dir, the locale,
//   COPILOT_TELEMETRY_DISABLED=true), so no KC_ value and no key is inherited;
// - the system text replaces the runtime's persona and tool instructions: Clawco's instructions plus direkte's
//   no-tools sentence.
// One client per installation, started lazily, replaced when the token changes, stopped by stop() (sign-out, shutdown).
// Every failure is one fixed sentence injected by the composition root; the runtime's text only decides the kind.

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CopilotClientOptions, PermissionHandler, SessionConfig } from '@github/copilot-sdk';
import { AFBRUDT, AgentError } from './types.ts';
import type { AgentEvent, AgentRunResult } from './types.ts';
import { agentTekst } from './tekster.ts';

export type CopilotFejlArt = 'github' | 'kredit' | 'model' | 'vaerktoej' | 'copilot-start' | 'ukendt';

/** One runtime event as the transport reads it. */
export type CopilotHaendelse = { type: string; data?: unknown };
export interface CopilotSession {
  readonly sessionId: string;
  on(handler: (e: CopilotHaendelse) => void): () => void;
  send(o: { prompt: string }): Promise<unknown>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}
export interface CopilotKlient {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(cfg: CopilotSessionValg): Promise<CopilotSession>;
  deleteSession(id: string): Promise<void>;
}

/** The client options Clawco passes — exactly these. */
export type CopilotKlientValg = {
  mode: 'empty';
  gitHubToken: string;
  useLoggedInUser: false;
  baseDirectory: string;
  workingDirectory: string;
  logLevel: 'error';
  env: Record<string, string>;
};
export type LavKlient = (valg: CopilotKlientValg) => CopilotKlient | Promise<CopilotKlient>;

/** The real SDK, loaded on first use (an install that never picks Copilot never loads it). */
export const sdkKlient: LavKlient = async (valg) => {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const k = new CopilotClient(valg satisfies CopilotClientOptions);
  return {
    start: () => k.start(),
    stop: () => k.stop(),
    deleteSession: (id) => k.deleteSession(id),
    async createSession(cfg) {
      const s = await k.createSession(cfg);
      return {
        sessionId: s.sessionId,
        on: (h) => s.on((e) => h(e as CopilotHaendelse)),
        send: (o) => s.send(o),
        abort: () => s.abort(),
        disconnect: () => s.disconnect(),
      };
    },
  };
};

/** The env names the runtime may inherit; everything else (KC_*, every key, NODE_OPTIONS) stays behind. */
const ARVES = ['PATH', 'LANG', 'LC_ALL'] as const;

/** The runtime child's env: the allowlist, HOME and TMPDIR → the tmp base, Copilot's own telemetry off. */
export function koerselsMiljoe(env: Record<string, string | undefined>, hjem: string): Record<string, string> {
  const ud: Record<string, string> = {};
  for (const k of ARVES) { const v = env[k]; if (typeof v === 'string' && v) ud[k] = v; }
  return { ...(ud['PATH'] ? { PATH: ud['PATH'] } : {}), HOME: hjem, TMPDIR: hjem, ...(ud['LANG'] ? { LANG: ud['LANG'] } : {}), ...(ud['LC_ALL'] ? { LC_ALL: ud['LC_ALL'] } : {}), COPILOT_TELEMETRY_DISABLED: 'true' };
}

/** Denies every permission request, whatever its kind (README: Permission Handling, `{ kind: "reject" }`). */
const afvisAlt: PermissionHandler = () => ({ kind: 'reject', feedback: 'Clawco giver ikke modellen værktøjer.' });

/** The session options Clawco passes — exactly these (the type is the SDK's, so a renamed option fails the typecheck). */
export function sessionValg(o: { model: string; system: string; arbejdsmappe: string }) {
  return {
    model: o.model,
    streaming: true,
    systemMessage: { mode: 'replace', content: o.system },
    workingDirectory: o.arbejdsmappe,
    onPermissionRequest: afvisAlt,
    availableTools: [],
    excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
    tools: [],
    mcpServers: {},
    customAgents: [],
    skillDirectories: [],
    includedBuiltinSkills: [],
    instructionDirectories: [],
    pluginDirectories: [],
    agentDirectories: [],
    hookDirectories: [],
    enableSkills: false,
    enableConfigDiscovery: false,
    enableSessionStore: false,
    enableSessionTelemetry: false,
    enableOnDemandInstructionDiscovery: false,
    enableFileHooks: false,
    enableHostGitOperations: false,
    enableMcpApps: false,
    enableExperimentalMode: false,
    coauthorEnabled: false,
    manageScheduleEnabled: false,
    skipCustomInstructions: true,
    customAgentsLocalOnly: true,
    memory: { enabled: false },
    infiniteSessions: { enabled: false },
  } satisfies SessionConfig;
}
export type CopilotSessionValg = ReturnType<typeof sessionValg>;

/** Events that mean the runtime is about to act, not answer: the run fails closed. */
const HANDLING = /^(?:tool\.|external_tool\.|permission\.requested|subagent\.|skill\.invoked|hook\.start|command\.execute|elicitation\.requested|sampling\.requested|exit_plan_mode\.requested|mcp\.)/;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

type Wire = Record<string, unknown>;
const isRecord = (v: unknown): v is Wire => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The kind of a session.error. The message is read here and dropped: it can echo the token. */
function fejlArt(d: unknown): CopilotFejlArt {
  if (!isRecord(d)) return 'ukendt';
  const type = typeof d['errorType'] === 'string' ? d['errorType'] : '';
  const tekst = typeof d['message'] === 'string' ? d['message'] : '';
  if (type === 'authentication' || type === 'authorization' || d['statusCode'] === 401 || d['statusCode'] === 403) return 'github';
  if (type === 'quota' || type === 'rate_limit' || d['statusCode'] === 402 || d['statusCode'] === 429) return 'kredit';
  if (d['statusCode'] === 404 || /model\b[^.]{0,80}\b(?:not (?:supported|found|available)|unknown|does not exist)/i.test(tekst)) return 'model';
  return 'ukendt';
}

export type CopilotKoersel = {
  system: string;
  input: string;
  model: string;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
};

export interface CopilotTransport {
  koer(req: CopilotKoersel, token: string): Promise<AgentRunResult>;
  /** Stops the client and removes its tmp directories (sign-out, a new token, shutdown). Never throws. */
  stop(): Promise<void>;
}

export function createCopilot(o: {
  fejl: Record<CopilotFejlArt, string>;
  lavKlient?: LavKlient;
  timeoutMs?: number;
  /** Where the allowlist is read from (default process.env). */
  env?: Record<string, string | undefined>;
  /** The tmp root (default the OS tmp). */
  tmp?: string;
}): CopilotTransport {
  const lavKlient = o.lavKlient ?? sdkKlient;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  type Aktiv = { klient: CopilotKlient; token: string; rod: string; arbejde: string };
  let aktiv: Promise<Aktiv> | undefined;
  let koe: Promise<unknown> = Promise.resolve();
  /** One after the other: a start, a replace and a stop never overlap. */
  const enAdGangen = <T>(fn: () => Promise<T>): Promise<T> => { const p = koe.then(fn, fn); koe = p.catch(() => undefined); return p; };

  async function luk(a: Promise<Aktiv> | undefined): Promise<void> {
    const x = await a?.catch(() => undefined);
    if (!x) return;
    await x.klient.stop().catch(() => undefined);
    await rm(x.rod, { recursive: true, force: true }).catch(() => undefined);
  }

  function klientTil(token: string): Promise<Aktiv> {
    return enAdGangen(async () => {
      const nu = await aktiv?.catch(() => undefined);
      if (nu && nu.token === token) return nu;
      await luk(aktiv);
      aktiv = undefined;
      const rod = await mkdtemp(path.join(o.tmp ?? tmpdir(), 'clawco-copilot-'));
      const hjem = path.join(rod, 'hjem');
      const arbejde = path.join(rod, 'arbejde');
      const p = (async (): Promise<Aktiv> => {
        try {
          await mkdir(hjem, { mode: 0o700 });
          await mkdir(arbejde, { mode: 0o700 });
          const klient = await lavKlient({ mode: 'empty', gitHubToken: token, useLoggedInUser: false, baseDirectory: hjem, workingDirectory: arbejde, logLevel: 'error', env: koerselsMiljoe(o.env ?? process.env, hjem) });
          await klient.start();
          return { klient, token, rod, arbejde };
        } catch (e) {
          await rm(rod, { recursive: true, force: true }).catch(() => undefined);
          throw e;
        }
      })();
      aktiv = p;
      p.catch(() => { if (aktiv === p) aktiv = undefined; });
      return p;
    });
  }

  async function koer(req: CopilotKoersel, token: string): Promise<AgentRunResult> {
    const runId = `copilot_${randomUUID()}`;
    const emit = (e: AgentEvent): void => { try { req.onEvent?.(e); } catch { /* a listener bug must not kill the run */ } };
    const fejl = (art: CopilotFejlArt): AgentError => { emit({ type: 'run.failed', error: o.fejl[art] }); return new AgentError(o.fejl[art], runId); };
    if (req.signal?.aborted) throw new AgentError(AFBRUDT, runId);

    let a: Aktiv;
    try { a = await klientTil(token); } catch { throw fejl('copilot-start'); }
    if (req.signal?.aborted) throw new AgentError(AFBRUDT, runId);
    const mappe = await mkdtemp(path.join(a.arbejde, 'session-'));
    let session: CopilotSession;
    try {
      session = await a.klient.createSession(sessionValg({ model: req.model, system: req.system, arbejdsmappe: mappe }));
    } catch {
      await rm(mappe, { recursive: true, force: true }).catch(() => undefined);
      throw fejl('ukendt');
    }

    let tekst = '';
    let slut = '';
    let afsluttet = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let afbryd: (() => void) | undefined;
    let af: (() => void) | undefined;
    try {
      return await new Promise<AgentRunResult>((resolve, reject) => {
        const faerdig = (fn: () => void): void => { if (afsluttet) return; afsluttet = true; fn(); };
        const stopFejl = (err: AgentError): void => faerdig(() => { void session.abort().catch(() => undefined); reject(err); });
        af = session.on((e) => {
          if (afsluttet) return;
          if (HANDLING.test(e.type)) return stopFejl(fejl('vaerktoej'));
          const d = isRecord(e.data) ? e.data : {};
          if (e.type === 'assistant.message_delta' && typeof d['deltaContent'] === 'string' && d['deltaContent'] !== '') {
            tekst += d['deltaContent'];
            emit({ type: 'message.delta', text: d['deltaContent'] });
          } else if (e.type === 'assistant.message' && typeof d['content'] === 'string') {
            slut = d['content'];
          } else if (e.type === 'session.error') {
            stopFejl(fejl(fejlArt(e.data)));
          } else if (e.type === 'session.idle') {
            faerdig(() => { const output = tekst || slut; emit({ type: 'run.completed', output }); resolve({ runId, output }); });
          }
        });
        afbryd = (): void => stopFejl(new AgentError(AFBRUDT, runId));
        req.signal?.addEventListener('abort', afbryd, { once: true });
        timer = setTimeout(() => { const tid = agentTekst().modelTid; emit({ type: 'run.failed', error: tid }); stopFejl(new AgentError(tid, runId)); }, timeoutMs);
        session.send({ prompt: req.input }).catch(() => stopFejl(fejl('ukendt')));
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (afbryd) req.signal?.removeEventListener('abort', afbryd);
      af?.();
      await session.disconnect().catch(() => undefined);
      await a.klient.deleteSession(session.sessionId).catch(() => undefined);
      await rm(mappe, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    koer,
    stop: () => enAdGangen(async () => { const a = aktiv; aktiv = undefined; await luk(a); }),
  };
}
