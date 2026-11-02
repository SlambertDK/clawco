// The ElevenLabs agent named PRODUKT (KC-0121), defined in code and synced on
// start-up (StemmeClient.ensureAgent). It is Henrik's voice interface to the
// app: it reads what waits, asks, and relays decisions to the app through
// client tools that run in the browser. Hermes does the work; the agent
// never claims something is done before the app says so.

import type { AgentConfig } from './types.ts';
import { PRODUKT } from '../shell/navn.ts';

export const AGENT_NAME = PRODUKT;

export const AGENT_PROMPT = `Du er stemmen i Henriks kontrolcenter. Du taler dansk, kort og roligt, som en assistent der sidder ved siden af ham mens han er på farten. Henrik hører dig; han kan ikke se en skærm. Hermes er den agent, der udfører tingene; du er den, der fortæller og lytter.

Det der venter på Henrik lige nu (bygget af appen, med numre og id'er):
{{oversigt}}

Han står i rummet {{rum}}. Klokken er {{system__time}}.

Sådan arbejder du:
- Tag én ting ad gangen. Sig hvad det er (højst tre sætninger), nævn valgene med deres navne, og vent på Henriks svar. Sig ALDRIG id'erne højt.
- Når Henrik vælger, kald værktøjet udfoer med det rigtige id fra oversigten. Bekræft med én sætning ("Jeg har sat Hermes i gang med at arkivere den.") og gå videre til næste punkt. Vent ikke på at Hermes bliver færdig.
- Når du får at vide at Hermes er færdig med noget, nævn det kort i din næste sætning.
- "Næste", "spring over" eller "senere" betyder: gå videre uden at gøre noget. "Stop" eller "det var det" betyder: afslut med én sætning.
- Spørger Henrik om noget du ikke ved fra oversigten, kald spoerg_hermes med hans spørgsmål og gengiv svaret kort.
- Efter nogle handlinger, eller hvis Henrik spørger hvad der venter, kald hent_oversigt og brug den nye liste.
- Du sender aldrig mails, betaler aldrig og sletter aldrig noget. Beder Henrik om det, sig at det skal han gøre på skærmen.
- Gæt ikke. Er du i tvivl om hvad Henrik mente, spørg med én kort sætning.
- Ingen lister, ingen markdown, ingen engelske ord hvor der findes danske. Tal som et menneske.`;

export const AGENT_FIRST_MESSAGE = 'Hej Henrik. {{antal_tekst}} Skal vi tage det én ad gangen?';

export const AGENT_CONFIG: AgentConfig = {
  name: AGENT_NAME,
  language: 'da',
  llm: 'claude-sonnet-5-5',
  prompt: AGENT_PROMPT,
  firstMessage: AGENT_FIRST_MESSAGE,
  ttsModelId: 'eleven_flash_v2_5',
  turnTimeout: 10,
  turnEagerness: 'normal',
  maxDurationSeconds: 900,
  dynamicVariablePlaceholders: {
    oversigt: 'Der venter én ting. 1. Mail fra Eksempel Energi om mødet torsdag. Valg: svar med udkast (id mail:x-svar), arkivér (id mail:x-arkiver).',
    rum: 'Nu',
    antal_tekst: 'Der venter én ting.',
  },
  tools: [
    {
      name: 'hent_oversigt',
      description: 'Henter den aktuelle liste over det, der venter på Henrik, med valg og id\'er. Brug den efter handlinger, eller når Henrik spørger hvad der venter.',
      parameters: { type: 'object', properties: {}, required: [] },
      expectsResponse: true,
      responseTimeoutSecs: 20,
      preToolSpeech: 'off',
    },
    {
      name: 'udfoer',
      description: 'Sætter Hermes i gang med det valg Henrik har truffet. id er præcis det id, der står i parentes efter valget i oversigten (fx "mail:abc-svar"). Svarer med det samme; resultatet kommer senere som en besked.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Valgets id fra oversigten, fx mail:abc-arkiver' } }, required: ['id'] },
      expectsResponse: true,
      responseTimeoutSecs: 20,
      preToolSpeech: 'auto',
    },
    {
      name: 'spoerg_hermes',
      description: 'Stiller Hermes et spørgsmål om det, Henrik står i, og venter på svaret (op til et minut). Brug den når Henrik spørger om noget, der ikke står i oversigten.',
      parameters: { type: 'object', properties: { besked: { type: 'string', description: 'Henriks spørgsmål, med hans egne ord' } }, required: ['besked'] },
      expectsResponse: true,
      responseTimeoutSecs: 75,
      preToolSpeech: 'auto',
    },
  ],
};

/** The voice used until a Danish library voice is chosen (needs voices_read/voices_write on the key): ElevenLabs' premade "Sarah". */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/** Fixed words Scribe should recognise in Henrik's speech, on top of the room's own labels. */
export const KEYTERMS = ['Hermes', 'arkivér', 'svar', 'næste', 'fortryd', 'færdig', 'spring over', PRODUKT];

/** The spoken count for the first message. */
export function antalTekst(n: number): string {
  return n === 0 ? 'Der venter ikke noget på dig lige nu.' : n === 1 ? 'Der venter én ting på dig.' : `Der venter ${n} ting på dig.`;
}
