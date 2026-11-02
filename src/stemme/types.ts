// The stemme layer: what a room offers the voice (the spoken view), the
// cross-room overview, the agent definition, and the one seam to ElevenLabs.
// Rooms depend on StemmeRum/StemmePunkt only; the server depends on the rest.

import type { Sprog } from '../store/sprog.ts';

/** One thing Henrik can choose by voice; id is a handling id in that room, or `aktion:<name>:<arg>`. */
export type StemmeValg = { id: string; label: string };

/** One decision, spoken: 1–3 short Danish sentences and the choices. */
export type StemmePunkt = { id: string; sig: string; valg: StemmeValg[] };

/** A room's spoken view: a one-line résumé and the decisions that suit voice. */
export type StemmeRum = { rum: string; resume: string; punkter: StemmePunkt[] };

/** The cross-room overview the agent gets: numbered spoken text plus the ids behind it. */
export type Oversigt = {
  tekst: string;
  punkter: (StemmePunkt & { rum: string; nr: number })[];
};

export type ClientToolDef = {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[] };
  expectsResponse: boolean;
  responseTimeoutSecs?: number;
  /** ElevenLabs: when the agent may speak while the tool runs. */
  preToolSpeech?: 'auto' | 'force' | 'off';
};

export type AgentConfig = {
  name: string;
  language: string;
  llm: string;
  prompt: string;
  firstMessage: string;
  ttsModelId: string;
  turnTimeout: number;
  turnEagerness: 'patient' | 'normal' | 'eager';
  maxDurationSeconds: number;
  tools: ClientToolDef[];
  /** Placeholders so the agent can be tested in ElevenLabs' own UI; names must match the prompt's {{vars}}. */
  dynamicVariablePlaceholders: Record<string, string>;
};

export type StemmeIds = { agentId: string; toolIds: Record<string, string> };

export class StemmeError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.name = 'StemmeError'; this.status = status; }
}

/** The one seam to ElevenLabs. Two implementations: elevenlabs (HTTP) and fake (dev/tests). */
export interface StemmeClient {
  readonly mode: 'elevenlabs' | 'fake';
  /** Speech → text in `sprog` (default Danish, KC-0241). mime is the recording's type without codec params. */
  lyt(audio: Uint8Array, mime: string, keyterms: string[], sprog?: Sprog): Promise<string>;
  /** Text in `sprog` (default Danish) → audio stream (mp3 for elevenlabs, wav for fake). */
  sig(tekst: string, voiceId: string, sprog?: Sprog): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }>;
  /** A short-lived WebRTC conversation token for the agent. */
  samtaleToken(agentId: string): Promise<string>;
  /** Creates or updates the agent and its client tools so they match `config`; returns the ids to store. */
  ensureAgent(config: AgentConfig, voiceId: string, known?: Partial<StemmeIds>): Promise<StemmeIds>;
  /** Returns a usable voice id: the given one, or a Danish voice from the library added to the account. */
  ensureVoice(voiceId?: string): Promise<string>;
}
