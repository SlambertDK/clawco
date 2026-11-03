// KC-0127: the model providers of Start's step 2, as data. Each names the env
// key Hermes reads (the key, or a local model's address), the provider id sent
// on /v1/runs, and two sensible default models (Clawco's two tiers: lille is
// the quick one, taenker the thorough one). The env names are also the only
// ones Clawco may write into Hermes' env file. Model discovery runs on the
// server with the pasted key in a header; the key never reaches the browser.

import type { DirekteApi } from '../../agent/direkte.ts';
import { INKLUDERET_ID } from '../../agent/inkluderet.ts';

export type Udbyder = {
  id: string;
  navn: string;
  /** What the field shows before anything is pasted. */
  noeglePlaceholder: string;
  kraeverNoegle: boolean;
  /** The env name Hermes reads (hermes-agent's provider registry): the key, or a local model's base URL. */
  envNavn: string;
  /** Hermes' provider id, sent with the model on every run. */
  hermesProvider: string;
  standardModeller: { lille: string; taenker: string };
  /** A model on the user's own machine: its default address. */
  standardUrl?: string;
  /** GET for the model list: an absolute URL, or a path under the local address. */
  hentModeller?: { url: string; auth: 'bearer' | 'x-api-key' | 'ingen' };
  /** KC-0180: how the direct-model agent calls it (none = only through Hermes); no url = the saved local address. KC-0263: copilot-sdk = "Sign in with GitHub", no key field. */
  direkte?: DirekteApi;
  /** KC-0265: Clawco's own AI of a Sky plan (not a provider the person brings): no key, no address, no model to choose; offered only where the proxy is configured. */
  inkluderet?: true;
};

export const UDBYDERE: readonly Udbyder[] = [
  { id: 'anthropic', navn: 'Anthropic', noeglePlaceholder: 'sk-ant-…', kraeverNoegle: true, envNavn: 'ANTHROPIC_API_KEY', hermesProvider: 'anthropic', standardModeller: { lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' }, hentModeller: { url: 'https://api.anthropic.com/v1/models', auth: 'x-api-key' }, direkte: { api: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages' } },
  { id: 'openai', navn: 'OpenAI', noeglePlaceholder: 'sk-…', kraeverNoegle: true, envNavn: 'OPENAI_API_KEY', hermesProvider: 'openai-api', standardModeller: { lille: 'gpt-5-mini', taenker: 'gpt-5' }, hentModeller: { url: 'https://api.openai.com/v1/models', auth: 'bearer' }, direkte: { api: 'openai-chat', url: 'https://api.openai.com/v1/chat/completions' } },
  { id: 'copilot', navn: 'GitHub Copilot', noeglePlaceholder: 'github_pat_… eller ghu_…', kraeverNoegle: true, envNavn: 'COPILOT_GITHUB_TOKEN', hermesProvider: 'copilot', standardModeller: { lille: 'claude-haiku-5.5', taenker: 'claude-sonnet-5.5' }, direkte: { api: 'copilot-sdk' } },
  { id: 'openrouter', navn: 'OpenRouter', noeglePlaceholder: 'sk-or-…', kraeverNoegle: true, envNavn: 'OPENROUTER_API_KEY', hermesProvider: 'openrouter', standardModeller: { lille: 'anthropic/claude-haiku-4.5', taenker: 'anthropic/claude-sonnet-4.5' }, hentModeller: { url: 'https://openrouter.ai/api/v1/models', auth: 'bearer' }, direkte: { api: 'openai-chat', url: 'https://openrouter.ai/api/v1/chat/completions' } },
  { id: 'lmstudio', navn: 'LM Studio på din egen maskine', noeglePlaceholder: 'http://127.0.0.1:1234', kraeverNoegle: false, envNavn: 'LM_BASE_URL', hermesProvider: 'lmstudio', standardModeller: { lille: 'qwen/qwen3-8b', taenker: 'qwen/qwen3-14b' }, standardUrl: 'http://127.0.0.1:1234', hentModeller: { url: '/models', auth: 'ingen' }, direkte: { api: 'openai-chat' } },
  { id: 'ollama', navn: 'Ollama på din egen maskine', noeglePlaceholder: 'http://127.0.0.1:11434', kraeverNoegle: false, envNavn: 'CUSTOM_BASE_URL', hermesProvider: 'ollama', standardModeller: { lille: 'qwen3:8b', taenker: 'qwen3:14b' }, standardUrl: 'http://127.0.0.1:11434', hentModeller: { url: '/models', auth: 'ingen' }, direkte: { api: 'openai-chat' } },
];

/**
 * KC-0265: the included AI of a Sky plan. Deliberately NOT in UDBYDERE: that list is what a person may bring (and what the
 * agent's env-file allowlist is derived from); this one exists only where KC_MODEL_PROXY_URL and KC_MODEL_TOKEN_FIL are set
 * (ModelVindue.inkluderet). Both tiers are the one small model (Calm, spec 2026-11-03 §3); its token is the file Sky delivers.
 * `envNavn` is the env name that names that file and is never written anywhere.
 */
export const INKLUDERET: Udbyder = {
  id: INKLUDERET_ID, navn: 'Clawcos AI', noeglePlaceholder: '', kraeverNoegle: false, envNavn: 'KC_MODEL_TOKEN_FIL', hermesProvider: 'clawco',
  standardModeller: { lille: 'claude-haiku-5-5', taenker: 'claude-haiku-5-5' }, inkluderet: true, direkte: { api: 'anthropic-proxy' },
};

export const udbyderAf = (id: string): Udbyder | undefined => UDBYDERE.find((u) => u.id === id) ?? (id === INKLUDERET.id ? INKLUDERET : undefined);

/** The env names Clawco may write into the agent's env file: derived from the list, never kept by hand. */
export const MODEL_ENV_NOEGLER: readonly string[] = UDBYDERE.map((u) => u.envNavn);

const MODEL_NAVN = /^[A-Za-z0-9._:/-]{1,80}$/;
const NOEGLE_MAKS = 2000;

/** What goes into the agent's env file: the key trimmed, or a local address as its OpenAI-compatible base (…/v1). Null = refused. */
export function envVaerdi(u: Udbyder, input: string): string | null {
  const v = input.trim();
  if (u.kraeverNoegle) return v && v.length <= NOEGLE_MAKS ? v : null;
  let url: URL;
  try { url = new URL(v || u.standardUrl || ''); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const sti = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${sti.endsWith('/v1') ? sti : `${sti}/v1`}`;
}

/** The model names the provider offers (discovery). Never throws: [] when it has none, or anything fails. */
export async function hentModelNavne(u: Udbyder, o: { noegle?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string[]> {
  const h = u.hentModeller;
  if (!h) return [];
  const url = h.url.startsWith('/') ? `${(o.baseUrl ?? '').replace(/\/+$/, '')}${h.url}` : h.url;
  const headers: Record<string, string> = {};
  if (h.auth === 'bearer' && o.noegle) headers['authorization'] = `Bearer ${o.noegle}`;
  if (h.auth === 'x-api-key' && o.noegle) { headers['x-api-key'] = o.noegle; headers['anthropic-version'] = '2023-06-01'; }
  try {
    const res = await (o.fetchImpl ?? fetch)(url, { headers, signal: AbortSignal.timeout(o.timeoutMs ?? 8000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    return body.data.map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && MODEL_NAVN.test(id)).slice(0, 200);
  } catch { return []; }
}
