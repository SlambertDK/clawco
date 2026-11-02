// StemmeClient over the ElevenLabs HTTP API: speech-to-text (scribe_v2),
// text-to-speech (flash), conversation tokens, and idempotent sync of the
// agent and its client tools. See docs/superpowers/specs/2026-10-27-stemme-design.md.

import { StemmeError } from './types.ts';
import type { AgentConfig, ClientToolDef, StemmeClient, StemmeIds } from './types.ts';
import { PRODUKT } from '../shell/navn.ts';
import type { Sprog } from '../store/sprog.ts';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 50;
const CLIENT_EVENTS = [
  'audio',
  'interruption',
  'user_transcript',
  'agent_response',
  'agent_response_correction',
  'client_tool_call',
  'ping',
];

type Wire = Record<string, unknown>;

function isRecord(v: unknown): v is Wire {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function list(v: unknown): Wire[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function cleanKeyterms(terms: string[]): string[] {
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (t === '' || t.length > MAX_KEYTERM_LENGTH || out.includes(t)) continue;
    out.push(t);
    if (out.length === MAX_KEYTERMS) break;
  }
  return out;
}

function audioFilename(mime: string): string {
  if (mime.includes('mp4')) return 'speech.m4a';
  if (mime.includes('ogg')) return 'speech.ogg';
  return 'speech.webm';
}

function toolConfig(t: ClientToolDef): Wire {
  return {
    type: 'client',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    expects_response: t.expectsResponse,
    response_timeout_secs: t.responseTimeoutSecs ?? 20,
    pre_tool_speech: t.preToolSpeech ?? 'auto',
  };
}

function agentBody(config: AgentConfig, voiceId: string, toolIds: string[]): Wire {
  return {
    name: config.name,
    conversation_config: {
      agent: {
        first_message: config.firstMessage,
        language: config.language,
        prompt: { prompt: config.prompt, llm: config.llm, temperature: 0.3, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: config.dynamicVariablePlaceholders },
      },
      tts: { voice_id: voiceId, model_id: config.ttsModelId },
      turn: { turn_timeout: config.turnTimeout, turn_eagerness: config.turnEagerness },
      conversation: { max_duration_seconds: config.maxDurationSeconds, client_events: CLIENT_EVENTS },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

export function createElevenLabs(opts: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }): StemmeClient {
  const apiKey = opts.apiKey.trim();
  if (apiKey === '') throw new StemmeError('ElevenLabs-nøglen mangler', 503);
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  /** One request; never throws on an HTTP status (callers decide), only on transport failure. */
  async function send(what: string, method: string, path: string, body?: BodyInit, contentType?: string): Promise<Response> {
    const headers: Record<string, string> = { 'xi-api-key': apiKey };
    if (contentType) headers['content-type'] = contentType;
    try {
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      return await doFetch(`${base}${path}`, init);
    } catch (err) {
      throw new StemmeError(`ElevenLabs ${what} fejlede: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  }

  async function failure(what: string, res: Response): Promise<StemmeError> {
    let text = '';
    try {
      text = await res.text();
    } catch {
      // unreadable body: report the status alone
    }
    return new StemmeError(`ElevenLabs ${what} ${res.status}: ${text.slice(0, 200)}`, 502);
  }

  async function ok(what: string, res: Response): Promise<Response> {
    if (!res.ok) throw await failure(what, res);
    return res;
  }

  async function readJson(what: string, res: Response): Promise<Wire> {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new StemmeError(`ElevenLabs ${what} svarede uden gyldigt JSON`, 502);
    }
    if (!isRecord(parsed)) throw new StemmeError(`ElevenLabs ${what} svarede uden gyldigt JSON`, 502);
    return parsed;
  }

  async function getJson(what: string, path: string): Promise<Wire> {
    return readJson(what, await ok(what, await send(what, 'GET', path)));
  }

  async function sendJson(what: string, method: string, path: string, body: unknown): Promise<Response> {
    return send(what, method, path, JSON.stringify(body), 'application/json');
  }

  async function lyt(audio: Uint8Array, mime: string, keyterms: string[], sprog: Sprog = 'da'): Promise<string> {
    const cleanMime = (mime.split(';')[0] ?? '').trim() || 'audio/webm';
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('language_code', sprog);
    form.append('tag_audio_events', 'false');
    form.append('diarize', 'false');
    for (const t of cleanKeyterms(keyterms)) form.append('keyterms', t);
    form.append('file', new Blob([audio as Uint8Array<ArrayBuffer>], { type: cleanMime }), audioFilename(cleanMime));
    const res = await ok('tale-til-tekst', await send('tale-til-tekst', 'POST', '/v1/speech-to-text', form));
    const text = (await readJson('tale-til-tekst', res))['text'];
    return typeof text === 'string' ? text.trim() : '';
  }

  async function sig(tekst: string, voiceId: string, sprog: Sprog = 'da'): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
    const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_64`;
    const res = await ok(
      'tekst-til-tale',
      await sendJson('tekst-til-tale', 'POST', path, {
        text: tekst,
        model_id: 'eleven_flash_v2_5',
        language_code: sprog,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
      }),
    );
    if (!res.body) throw new StemmeError('ElevenLabs tekst-til-tale svarede uden lyd', 502);
    return { body: res.body, contentType: 'audio/mpeg' };
  }

  async function samtaleToken(agentId: string): Promise<string> {
    const json = await getJson('samtale-token', `/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);
    const token = str(json['token']);
    if (!token) throw new StemmeError('ElevenLabs samtale-token svarede uden token', 502);
    return token;
  }

  async function ensureVoice(voiceId?: string, sprog: Sprog = 'da'): Promise<string> {
    if (voiceId) return voiceId;
    const json = await getJson('stemmebibliotek', `/v1/shared-voices?language=${sprog}&page_size=5&sort=usage_character_count_1y`);
    const first = list(json['voices'])[0];
    const sharedId = first ? str(first['voice_id']) : undefined;
    const owner = first ? str(first['public_owner_id']) : undefined;
    if (!first || !sharedId || !owner) throw new StemmeError(`Ingen ${sprog === 'en' ? 'engelsk' : 'dansk'} stemme fundet i ElevenLabs' bibliotek`, 502);
    const name = str(first['name']) ?? sharedId;
    const added = await ok(
      'tilføj stemme',
      await sendJson('tilføj stemme', 'POST', `/v1/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(sharedId)}`, {
        new_name: `${PRODUKT} – ${name}`,
      }),
    );
    const id = str((await readJson('tilføj stemme', added))['voice_id']);
    if (!id) throw new StemmeError('ElevenLabs tilføj stemme svarede uden voice_id', 502);
    return id;
  }

  async function ensureAgent(config: AgentConfig, voiceId: string, known?: Partial<StemmeIds>): Promise<StemmeIds> {
    // The account's tool list is fetched at most once, and only when needed.
    let existingTools: Promise<Wire[]> | undefined;
    const existing = (): Promise<Wire[]> =>
      (existingTools ??= getJson('værktøjsliste', '/v1/convai/tools').then((j) => list(j['tools'])));

    async function syncTool(def: ClientToolDef): Promise<string> {
      const body = { tool_config: toolConfig(def) };
      const patch = async (id: string): Promise<Response> =>
        sendJson('opdater værktøj', 'PATCH', `/v1/convai/tools/${encodeURIComponent(id)}`, body);

      const knownId = known?.toolIds?.[def.name];
      if (knownId) {
        const res = await patch(knownId);
        if (res.ok) return knownId;
        if (res.status !== 404) throw await failure('opdater værktøj', res);
      }
      for (const t of await existing()) {
        const cfg = isRecord(t['tool_config']) ? t['tool_config'] : undefined;
        const id = str(t['id']) ?? str(t['tool_id']);
        if (id && cfg && cfg['name'] === def.name) {
          await ok('opdater værktøj', await patch(id));
          return id;
        }
      }
      const created = await ok('opret værktøj', await sendJson('opret værktøj', 'POST', '/v1/convai/tools', body));
      const id = str((await readJson('opret værktøj', created))['id']);
      if (!id) throw new StemmeError('ElevenLabs opret værktøj svarede uden id', 502);
      return id;
    }

    const toolIds: Record<string, string> = {};
    for (const def of config.tools) toolIds[def.name] = await syncTool(def);
    const body = agentBody(config, voiceId, config.tools.map((t) => toolIds[t.name]!));
    const patchAgent = async (id: string): Promise<Response> =>
      sendJson('opdater agent', 'PATCH', `/v1/convai/agents/${encodeURIComponent(id)}`, body);

    if (known?.agentId) {
      const res = await patchAgent(known.agentId);
      if (res.ok) return { agentId: known.agentId, toolIds };
      if (res.status !== 404) throw await failure('opdater agent', res);
    }
    const found = await getJson('agentliste', `/v1/convai/agents?search=${encodeURIComponent(config.name)}&page_size=20`);
    for (const a of list(found['agents'])) {
      const id = str(a['agent_id']);
      if (id && a['name'] === config.name) {
        await ok('opdater agent', await patchAgent(id));
        return { agentId: id, toolIds };
      }
    }
    const created = await ok('opret agent', await sendJson('opret agent', 'POST', '/v1/convai/agents/create', body));
    const agentId = str((await readJson('opret agent', created))['agent_id']);
    if (!agentId) throw new StemmeError('ElevenLabs opret agent svarede uden agent_id', 502);
    return { agentId, toolIds };
  }

  return { mode: 'elevenlabs', lyt, sig, samtaleToken, ensureAgent, ensureVoice };
}
