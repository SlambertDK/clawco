// KC-0241: everything the voice layer itself says, in Danish and English: the agent's prompt, first message,
// placeholders and tools, the spoken counts and overview lines, the clock and date phrasing, and the words Scribe should
// recognise. Same pattern as the other tables: `da` is what the code said before (byte for byte: Henrik's installation
// syncs it to ElevenLabs and hears it), `en` has exactly its keys, and the table is read at call time via sprogNu()
// (never at module load). agentConfig(sprog) reads a table by name, because the agent is synced once per language and
// not per request. Stays as it was on purpose, in both languages: the tool names and parameter names (the browser calls
// them by name), the `{{...}}` variable names and the ids in "(id rum:xyz)". The rooms' own spoken passages are in
// src/rooms/<room>/tekster.ts. Depends on nothing in src/ but store/sprog.ts and shell/navn.ts.

import { sprogNu } from '../store/sprog.ts';
import { PRODUKT } from '../shell/navn.ts';

const da = {
  /** The agent's system prompt; {{oversigt}}, {{rum}} and {{system__time}} are filled by the app and ElevenLabs. */
  prompt: `Du er stemmen i Henriks kontrolcenter. Du taler dansk, kort og roligt, som en assistent der sidder ved siden af ham mens han er på farten. Henrik hører dig; han kan ikke se en skærm. Hermes er den agent, der udfører tingene; du er den, der fortæller og lytter.

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
- Ingen lister, ingen markdown, ingen engelske ord hvor der findes danske. Tal som et menneske.`,
  foersteBesked: 'Hej Henrik. {{antal_tekst}} Skal vi tage det én ad gangen?',
  /** Placeholders so the agent can be tried in ElevenLabs' own UI; the keys are the app's own variables. */
  pladsholdere: {
    oversigt: 'Der venter én ting. 1. Mail fra Eksempel Energi om mødet torsdag. Valg: svar med udkast (id mail:x-svar), arkivér (id mail:x-arkiver).',
    rum: 'Nu',
    antal_tekst: 'Der venter én ting.',
  },
  vaerktoej: {
    hentOversigt: 'Henter den aktuelle liste over det, der venter på Henrik, med valg og id\'er. Brug den efter handlinger, eller når Henrik spørger hvad der venter.',
    udfoer: 'Sætter Hermes i gang med det valg Henrik har truffet. id er præcis det id, der står i parentes efter valget i oversigten (fx "mail:abc-svar"). Svarer med det samme; resultatet kommer senere som en besked.',
    udfoerId: 'Valgets id fra oversigten, fx mail:abc-arkiver',
    spoergHermes: 'Stiller Hermes et spørgsmål om det, Henrik står i, og venter på svaret (op til et minut). Brug den når Henrik spørger om noget, der ikke står i oversigten.',
    spoergHermesBesked: 'Henriks spørgsmål, med hans egne ord',
  },
  /** Fixed words Scribe should recognise in the user's speech, on top of the room's own labels. */
  keyterms: ['Hermes', 'arkivér', 'svar', 'næste', 'fortryd', 'færdig', 'spring over', PRODUKT],
  /** The spoken count for the first message. */
  antal: {
    ingen: 'Der venter ikke noget på dig lige nu.',
    en: 'Der venter én ting på dig.',
    flere: (n: number): string => `Der venter ${n} ting på dig.`,
  },
  /** The cross-room overview the agent is given. */
  oversigt: {
    intet: 'Intet venter på dig lige nu.',
    en: 'Der venter én ting.',
    flere: (n: number): string => `Der venter ${n} ting.`,
    valg: (liste: string): string => ` Valg: ${liste}.`,
    kuratorEt: 'Kuratoren har ét kort til dig.',
    kuratorFlere: (n: number): string => `Kuratoren har ${n} kort til dig.`,
  },
  /** Dates and times as words (tale.ts). Weekdays Sunday first, the order of Date#getUTCDay. */
  tale: {
    dage: ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'],
    maaneder: ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'],
    /** "klokken 10" on the hour, "klokken 10.30" otherwise; h has no leading zero. */
    klokken: (h: string, m: string): string => (m === '00' ? `klokken ${h}` : `klokken ${h}.${m}`),
    /** "torsdag den 29. oktober" */
    dato: (dag: string, d: number, maaned: string): string => `${dag} den ${d}. ${maaned}`,
    /** The date and the time said together. */
    datoMedTid: (dato: string, tid: string): string => `${dato} ${tid}`,
  },
};

export type StemmeTekster = typeof da;

const en: StemmeTekster = {
  prompt: `You are the voice of ${PRODUKT}, the user's personal control centre. You speak English, briefly and calmly, like an assistant sitting next to them while they are on the move. The user hears you; they cannot see a screen. Hermes is the agent that does the work; you are the one who tells and listens.

What is waiting for the user right now (built by the app, with numbers and ids):
{{oversigt}}

They are in the room {{rum}}. The time is {{system__time}}.

How you work:
- Take one thing at a time. Say what it is (three sentences at most), name the choices by their names, and wait for the user's answer. NEVER say the ids aloud.
- When the user chooses, call the tool udfoer with the right id from the overview. Confirm with one sentence ("I have set Hermes to archive it.") and move on to the next item. Do not wait for Hermes to finish.
- When you are told that Hermes has finished something, mention it briefly in your next sentence.
- "Next", "skip" or "later" means: move on without doing anything. "Stop" or "that's it" means: finish with one sentence.
- If the user asks about something you do not know from the overview, call spoerg_hermes with their question and relay the answer briefly.
- After some actions, or if the user asks what is waiting, call hent_oversigt and use the new list.
- You never send mail, never pay and never delete anything. If the user asks for that, say they have to do it on the screen.
- Do not guess. If you are unsure what the user meant, ask with one short sentence.
- No lists, no markdown, no jargon where a plain word exists. Speak like a person.`,
  foersteBesked: 'Hello. {{antal_tekst}} Shall we take it one at a time?',
  pladsholdere: {
    oversigt: 'One thing is waiting. 1. Mail from Example Energy about the Thursday meeting. Choices: reply with a draft (id mail:x-svar), archive (id mail:x-arkiver).',
    rum: 'Now',
    antal_tekst: 'One thing is waiting.',
  },
  vaerktoej: {
    hentOversigt: 'Fetches the current list of what is waiting for the user, with choices and ids. Use it after actions, or when the user asks what is waiting.',
    udfoer: 'Sets Hermes going with the choice the user has made. id is exactly the id in parentheses after the choice in the overview (e.g. "mail:abc-svar"). Answers immediately; the result comes later as a message.',
    udfoerId: 'The choice\'s id from the overview, e.g. mail:abc-arkiver',
    spoergHermes: 'Asks Hermes a question about what the user is looking at and waits for the answer (up to a minute). Use it when the user asks about something that is not in the overview.',
    spoergHermesBesked: 'The user\'s question, in their own words',
  },
  keyterms: ['Hermes', 'archive', 'reply', 'next', 'undo', 'done', 'skip', PRODUKT],
  antal: {
    ingen: 'Nothing is waiting for you right now.',
    en: 'One thing is waiting for you.',
    flere: (n) => `${n} things are waiting for you.`,
  },
  oversigt: {
    intet: 'Nothing is waiting for you right now.',
    en: 'One thing is waiting.',
    flere: (n) => `${n} things are waiting.`,
    valg: (liste) => ` Choices: ${liste}.`,
    kuratorEt: 'The curator has one card for you.',
    kuratorFlere: (n) => `The curator has ${n} cards for you.`,
  },
  tale: {
    dage: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    maaneder: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    klokken: (h, m) => (m === '00' ? `at ${h}` : `at ${h}:${m}`),
    dato: (dag, d, maaned) => `${dag} ${d} ${maaned}`,
    datoMedTid: (dato, tid) => `${dato} ${tid}`,
  },
};

export const STEMME_TEKSTER = { da, en };
export const stemmeTekst = (): StemmeTekster => STEMME_TEKSTER[sprogNu()];
