// KC-0241: the words Dagen writes into what it asks Hermes, Danish and English, in the shape of src/rooms/dagen/tekster.ts:
// plain text or small functions, read at call time (dagenPromptTekst()), never at load. English has exactly Danish's keys
// (test/rooms/dagen-prompt.test.ts). Danish is Henrik's installation and stays byte for byte as it was
// (test/fixtures/sprog-prompt-rum-a/). Stays the same in both languages, because the app parses the answer by it: every json
// field name, the enums ("klar | flyttet | aflyst", "dagslinje", "regn"), the ```json fence and the file name
// morgenavis_cron.py. The shared sections (limits, catalog, language, zone, PEGER, the verb sentences) come from src/agent.

import { sprogNu } from '../../shell/tekster.ts';

const da = {
  /** KC-0242: what the answer parser says when Hermes' JSON does not fit; it goes back to Hermes in the correction run, so the field names stay. */
  fejl: {
    ingenJson: 'Hermes svarede uden JSON, eller med en blok, der ikke kan læses',
    ikkeObjekt: 'Dagen: svaret er ikke et objekt',
    treLinjer: 'Dagen: treLinjer mangler',
    anbefaling: 'Dagen: anbefaling mangler',
    handlingIkkeObjekt: (hvor: string): string => `${hvor}: handling skal være et objekt`,
    handlingMangler: (hvor: string): string => `${hvor}: handling kræver label og instruktion`,
    zoneUkendt: (zone: string): string => `ukendt zone: ${zone}`,
    zoneAnden: (zone: string, korsel: string): string => `elementet siger zone ${zone}, men kørslen læste ${korsel}`,
  },
  /** The role line; the room's English name is the shell's (rum table). */
  rolle: `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Dagen" i hans kontrolcenter. Rummet viser dagen i tre linjer, én anbefaling, kalenderen og morgenavisen.`,
  /** "Nu er det 2026-10-26 kl. 07.12 (Europe/Copenhagen)." */
  tidslinje: (dato: string, tid: string): string => `Nu er det ${dato} kl. ${tid} (Europe/Copenhagen).`,
  skema: `\`\`\`json
{
  "dato": "YYYY-MM-DD",
  "vejr": "kort vejrlinje, hvis du kender den, ellers udelad",
  "treLinjer": ["linje 1", "linje 2", "linje 3"],
  "visuel": { "ikon": "sunrise", "billede": { "art": "dagslinje", "fra": 6, "til": 22, "zoner": [{ "fra": "16:00", "til": "19:00", "slags": "regn" }], "punkter": [{ "tid": "10:00", "ikon": "users", "tekst": "Møde" }] } },
  "anbefaling": {
    "tekst": "den ene ting, Henrik bør gøre i dag",
    "overskrift": "højst 30 tegn: selve skridtet, fx 'Læs dagsordenen i toget'",
    "ikon": "<ikon>",
    "handling": { "label": "knaptekst (2-5 ord)", "instruktion": "præcis instruktion til dig selv om, hvad du gør når knappen trykkes", "fortryd": "præcis instruktion der gør det om igen, hvis det kan gøres om" }
  },
  "kalender": [
    { "tid": "HH.MM", "slut": "HH.MM", "titel": "...", "ikon": "<ikon>", "note": "én linje om hvad der skal til, hvis relevant", "status": "klar | flyttet | aflyst", "handling": { "label": "...", "instruktion": "...", "fortryd": "..." } }
  ],
  "morgenavis": [
    { "titel": "...", "hvorfor": "én linje om hvorfor det er relevant for Henrik i dag", "kilde": "...", "url": "https://..." }
  ],
  "ugen": [
    { "dato": "YYYY-MM-DD", "note": "1-2 linjer om hvad dagen betyder for Henrik: forberedelse, logistik, familie, kollisioner, fri tid", "aftaler": [ { "tid": "HH.MM eller 'hele dagen'", "slut": "HH.MM", "titel": "...", "kalender": "Henrik | Family | ..." } ] }
  ],
  "hermesStatus": "3-6 ord om hvad du holder øje med nu"
}
\`\`\``,
  regler: `Regler:
- Skriv dansk, kort og konkret. Klokkeslæt som HH.MM. Ingen hype, ingen moral.
- "treLinjer" er højst tre linjer: det vigtigste møde eller den vigtigste opgave, hvad der er ændret eller ledigt, og hvad der er praktisk (vejr, transport, frister).
- Præcis én "anbefaling": den ene ting, der ændrer dagen mest. Giv den en "handling" kun hvis du selv kan udføre den (f.eks. oprette en kalenderblok, samle materiale, lave et udkast). "instruktion" skal være så præcis, at du kan udføre den uden at spørge. Skriv "fortryd" når handlingen kan gøres om.
- "kalender": kun dagens tidsatte aftaler, i rækkefølge. Heldagsting nævnes kun i treLinjer, hvis de betyder noget.
- "morgenavis": 4-6 nyheder, de mest relevante for Henrik ud fra det, du ved om hans arbejde, interesser og lokalområde. "hvorfor" kobler til hans dag eller projekter.
- "ugen": de næste dage fra kalenderdata (i dag udeladt). Én post per dag, der har aftaler eller betyder noget; "note" er det vigtige: hvad planerne betyder for Henrik og familien (hvem er hvor, hvad skal forberedes, hvor er der kollisioner eller fri tid). Brug det, du ved om familien. Kopiér aftalerne fra data, uden at opfinde.
- Du må aldrig betale, sende mail til andre mennesker eller slette data fra en handling. Sådanne handlinger må ikke foreslås.
- Sæt "tilAndre": true på en handling, når det, den laver, er til andre mennesker (fx et udkast til en dagsorden, et svar eller en invitation). Du laver kun udkastet; Henrik sender selv. Knappen bliver rød. Ellers udelad feltet.
- "visuel" er billedet af dagen (KC-0060): en "dagslinje" med regn og sol fra vejret som zoner og dagens vigtigste aftaler som punkter (højst 6, ét ord hver); klokken nu tegner appen selv. Giv anbefalingen og hver aftale et "ikon".
- Svar KUN med ét JSON-objekt i en \`\`\`json-blok. Ingen tekst udenom.`,
  /** KC-0259: the agent has no tools, so no "handling" (a button that runs one of them) is asked for. */
  ingenHandlinger: '- Du har ingen værktøjer: giv aldrig en "handling" (hverken på anbefalingen eller i kalenderen); udelad feltet.',
  handlingRegler: `Regler for handlinger:
- Udfør handlingen med dine værktøjer, inden for det knappen må. Spørg ikke; hvis noget mangler, gør det bedste og sig hvad du antog.
- Du må aldrig betale, sende mail til andre mennesker eller slette data. Hvis handlingen kræver det, gør du det ikke og siger hvorfor.
- Svar med højst tre korte danske sætninger om, hvad du gjorde. Ingen JSON, ingen overskrifter.`,
  chatRegler: `Regler for chatten:
- Svar kort på dansk, som i en samtale. Brug dine værktøjer når det giver et bedre svar.
- Hvis svaret bør ændre rummet (en ny linje, en anden anbefaling, en ny note på en aftale), så tilføj til sidst én \`\`\`json-blok med {"opdater": {...}} der kun indeholder de felter af rummets skema, der skal ændres. Ellers ingen JSON.
- Du må aldrig betale, sende mail til andre mennesker eller slette data.`,

  // The tasks
  refreshOpgave: 'Du får dagens rådata som JSON i beskeden (kalender, forpligtelser, mail-emner, nyheder, helbredsstatus) og ugen frem fra kalenderen. Byg rummets indhold ud fra dem. Svar med præcis dette skema:',
  hentOpgave: 'Der findes ingen data for i dag endnu. Hent dem selv: kør \`python3 ~/.agent/scripts/morgenavis_cron.py\` (eller \`morgenavis_fetch.py\` direkte) med din terminal, læs filen \`/tmp/avis_data_<dato>.json\`, og byg så rummets indhold. Send IKKE noget på Telegram. Svar med præcis dette skema:',
  indholdOgsaa: 'Rummets aktuelle indhold står også i beskeden.',
  aktueltStaar: 'Rummets aktuelle indhold står som afledt data i beskeden.',

  // The data segments
  raadata: (json: string): string => `Dagens rådata:\n\`\`\`json\n${json}\n\`\`\``,
  uge: (json: string): string => `Ugen frem (Google Kalender, alle kalendere inkl. familiens):\n\`\`\`json\n${json}\n\`\`\``,
  ugeFejl: (fejl: string): string => `(kalendere der fejlede: ${fejl})`,
  ugeMangler: '(Ugen frem kunne ikke hentes i dag; udelad "ugen".)',
  hentBesked: 'Hent dagens data med morgenavis_cron.py og byg rummet Dagen.',
  knappen: (label: string): string => `Knappen: "${label}"`,
  aktueltIndhold: (json: string): string => `Rummets aktuelle indhold:\n\`\`\`json\n${json}\n\`\`\``,
  ingenData: 'Rummet har ingen data endnu.',
};

export type DagenPromptTekster = typeof da;

const en: DagenPromptTekster = {
  fejl: {
    ingenJson: 'Hermes answered without JSON, or with a block that cannot be read',
    ikkeObjekt: 'Today: the answer is not an object',
    treLinjer: 'Today: treLinjer is missing',
    anbefaling: 'Today: anbefaling is missing',
    handlingIkkeObjekt: (hvor: string): string => `${hvor}: handling must be an object`,
    handlingMangler: (hvor: string): string => `${hvor}: handling requires label and instruktion`,
    zoneUkendt: (zone: string): string => `unknown zone: ${zone}`,
    zoneAnden: (zone: string, korsel: string): string => `the element says zone ${zone}, but the run read ${korsel}`,
  },
  rolle: `You are Hermes, the user's agent, and you work inside the room "Today" in their control centre. The room shows the day in three lines, one recommendation, the calendar and the morning paper.`,
  tidslinje: (dato, tid) => `It is now ${dato} at ${tid} (Europe/Copenhagen).`,
  skema: `\`\`\`json
{
  "dato": "YYYY-MM-DD",
  "vejr": "short weather line, if you know it, otherwise omit",
  "treLinjer": ["line 1", "line 2", "line 3"],
  "visuel": { "ikon": "sunrise", "billede": { "art": "dagslinje", "fra": 6, "til": 22, "zoner": [{ "fra": "16:00", "til": "19:00", "slags": "regn" }], "punkter": [{ "tid": "10:00", "ikon": "users", "tekst": "Meeting" }] } },
  "anbefaling": {
    "tekst": "the one thing the user should do today",
    "overskrift": "at most 30 characters: the step itself, e.g. 'Read the agenda on the train'",
    "ikon": "<icon>",
    "handling": { "label": "button text (2-5 words)", "instruktion": "precise instruction to yourself about what you do when the button is pressed", "fortryd": "precise instruction that undoes it, if it can be undone" }
  },
  "kalender": [
    { "tid": "HH.MM", "slut": "HH.MM", "titel": "...", "ikon": "<icon>", "note": "one line about what it takes, if relevant", "status": "klar | flyttet | aflyst", "handling": { "label": "...", "instruktion": "...", "fortryd": "..." } }
  ],
  "morgenavis": [
    { "titel": "...", "hvorfor": "one line about why it is relevant for the user today", "kilde": "...", "url": "https://..." }
  ],
  "ugen": [
    { "dato": "YYYY-MM-DD", "note": "1-2 lines about what the day means for the user: preparation, logistics, family, collisions, free time", "aftaler": [ { "tid": "HH.MM or 'all day'", "slut": "HH.MM", "titel": "...", "kalender": "Personal | Family | ..." } ] }
  ],
  "hermesStatus": "3-6 words about what you are watching now"
}
\`\`\``,
  regler: `Rules:
- Write in English, short and concrete. Times as HH.MM. No hype, no moralising.
- "treLinjer" is at most three lines: the most important meeting or task, what has changed or is free, and what is practical (weather, transport, deadlines).
- Exactly one "anbefaling": the one thing that changes the day most. Give it a "handling" only if you can carry it out yourself (e.g. create a calendar block, gather material, make a draft). "instruktion" must be so precise that you can carry it out without asking. Write "fortryd" when the action can be undone.
- "kalender": only today's timed appointments, in order. All-day things are mentioned only in treLinjer, if they matter.
- "morgenavis": 4-6 news items, the most relevant for the user based on what you know about their work, interests and local area. "hvorfor" ties it to their day or projects.
- "ugen": the next days from the calendar data (today left out). One entry per day that has appointments or matters; "note" is the important part: what the plans mean for the user and the family (who is where, what must be prepared, where there are collisions or free time). Use what you know about the family. Copy the appointments from the data, without inventing.
- You must never pay, send mail to other people or delete data from an action. Such actions must not be proposed.
- Set "tilAndre": true on an action when what it does is for other people (e.g. a draft agenda, a reply or an invitation). You only make the draft; the user sends it themselves. The button turns red. Otherwise omit the field.
- "visuel" is the picture of the day (KC-0060): a "dagslinje" with rain and sun from the weather as zones and the day's most important appointments as points (at most 6, one word each); the app draws the current time itself. Give the recommendation and every appointment an "ikon".
- Answer ONLY with one JSON object in a \`\`\`json block. No text around it.`,
  ingenHandlinger: '- You have no tools: never give a "handling" (neither on the anbefaling nor in the calendar); leave the field out.',
  handlingRegler: `Rules for actions:
- Carry out the action with your tools, within what the button may do. Do not ask; if something is missing, do the best you can and say what you assumed.
- You must never pay, send mail to other people or delete data. If the action requires it, you do not do it and say why.
- Answer with at most three short English sentences about what you did. No JSON, no headings.`,
  chatRegler: `Rules for the chat:
- Answer briefly in English, as in a conversation. Use your tools when they give a better answer.
- If the answer should change the room (a new line, a different recommendation, a new note on an appointment), add at the end one \`\`\`json block with {"opdater": {...}} that contains only the fields of the room's schema that must change. Otherwise no JSON.
- You must never pay, send mail to other people or delete data.`,

  refreshOpgave: 'You get today\'s raw data as JSON in the message (calendar, commitments, mail subjects, news, health status) and the week ahead from the calendar. Build the room\'s content from them. Answer with exactly this schema:',
  hentOpgave: 'There is no data for today yet. Fetch it yourself: run \`python3 ~/.agent/scripts/morgenavis_cron.py\` (or \`morgenavis_fetch.py\` directly) with your terminal, read the file \`/tmp/avis_data_<date>.json\`, and then build the room\'s content. Do NOT send anything on Telegram. Answer with exactly this schema:',
  indholdOgsaa: 'The room\'s current content is also in the message.',
  aktueltStaar: 'The room\'s current content is in the message as derived data.',

  raadata: (json) => `Today's raw data:\n\`\`\`json\n${json}\n\`\`\``,
  uge: (json) => `The week ahead (Google Calendar, all calendars incl. the family's):\n\`\`\`json\n${json}\n\`\`\``,
  ugeFejl: (fejl) => `(calendars that failed: ${fejl})`,
  ugeMangler: '(The week ahead could not be fetched today; omit "ugen".)',
  hentBesked: 'Fetch today\'s data with morgenavis_cron.py and build the room "Today".',
  knappen: (label) => `The button: "${label}"`,
  aktueltIndhold: (json) => `The room's current content:\n\`\`\`json\n${json}\n\`\`\``,
  ingenData: 'The room has no data yet.',
};

export const DAGEN_PROMPT_TEKSTER: { da: DagenPromptTekster; en: DagenPromptTekster } = { da, en };

/** The prompt words of the language being rendered (the request's, or the run's). */
export const dagenPromptTekst = (): DagenPromptTekster => DAGEN_PROMPT_TEKSTER[sprogNu()];
