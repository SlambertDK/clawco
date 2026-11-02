// The ElevenLabs agent named PRODUKT (KC-0121), defined in code and synced on
// start-up (StemmeClient.ensureAgent). It is Henrik's voice interface to the
// app: it reads what waits, asks, and relays decisions to the app through
// client tools that run in the browser. Hermes does the work; the agent
// never claims something is done before the app says so.

import type { AgentConfig } from './types.ts';
import { PRODUKT } from '../shell/navn.ts';
import { sprogNu, type Sprog } from '../store/sprog.ts';
import { STEMME_TEKSTER, stemmeTekst } from './tekster.ts';

export const AGENT_NAME = PRODUKT;

export const AGENT_PROMPT = STEMME_TEKSTER.da.prompt;

export const AGENT_FIRST_MESSAGE = STEMME_TEKSTER.da.foersteBesked;

/**
 * KC-0241: the agent in one language. Danish is Henrik's (name PRODUKT, synced as before); English is its own agent in
 * ElevenLabs with a name that tells the two apart. Tool and parameter names and the variables are the same in both: the
 * browser calls them by name.
 */
export function agentConfig(sprog: Sprog): AgentConfig {
  const t = STEMME_TEKSTER[sprog];
  return {
    name: sprog === 'en' ? `${AGENT_NAME} (English)` : AGENT_NAME,
    language: sprog,
    llm: 'claude-sonnet-5-5',
    prompt: t.prompt,
    firstMessage: t.foersteBesked,
    ttsModelId: 'eleven_flash_v2_5',
    turnTimeout: 10,
    turnEagerness: 'normal',
    maxDurationSeconds: 900,
    dynamicVariablePlaceholders: { ...t.pladsholdere },
    tools: [
      {
        name: 'hent_oversigt',
        description: t.vaerktoej.hentOversigt,
        parameters: { type: 'object', properties: {}, required: [] },
        expectsResponse: true,
        responseTimeoutSecs: 20,
        preToolSpeech: 'off',
      },
      {
        name: 'udfoer',
        description: t.vaerktoej.udfoer,
        parameters: { type: 'object', properties: { id: { type: 'string', description: t.vaerktoej.udfoerId } }, required: ['id'] },
        expectsResponse: true,
        responseTimeoutSecs: 20,
        preToolSpeech: 'auto',
      },
      {
        name: 'spoerg_hermes',
        description: t.vaerktoej.spoergHermes,
        parameters: { type: 'object', properties: { besked: { type: 'string', description: t.vaerktoej.spoergHermesBesked } }, required: ['besked'] },
        expectsResponse: true,
        responseTimeoutSecs: 75,
        preToolSpeech: 'auto',
      },
    ],
  };
}

/** Henrik's agent: what an installation without a chosen language (or with Danish) syncs to ElevenLabs. */
export const AGENT_CONFIG: AgentConfig = agentConfig('da');

/** The voice used until a Danish library voice is chosen (needs voices_read/voices_write on the key): ElevenLabs' premade "Sarah". */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/** Fixed words Scribe should recognise in Henrik's speech, on top of the room's own labels (Danish; see keyterms()). */
export const KEYTERMS = STEMME_TEKSTER.da.keyterms;

/** KC-0241: the fixed words in the language of the request (or of `sprog`). */
export const keyterms = (sprog: Sprog = sprogNu()): string[] => [...STEMME_TEKSTER[sprog].keyterms];

/** The spoken count for the first message, in the language being rendered. */
export function antalTekst(n: number): string {
  const t = stemmeTekst().antal;
  return n === 0 ? t.ingen : n === 1 ? t.en : t.flere(n);
}
