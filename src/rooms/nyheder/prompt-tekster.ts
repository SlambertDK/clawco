// KC-0241: the words the room Nyheder writes into what it asks Hermes, Danish and English, in the shape of
// dagen/tekster.ts: plain text or small functions, read at call time (nyhederPrompt()), never at load. English has
// exactly Danish's keys and shapes (test/rooms/nyheder-prompt.test.ts). Danish is Henrik's own installation, byte for
// byte as before (test/fixtures/sprog-prompt-rum-b/); English says "the user", since that installation is not
// Henrik's. Not here: the shared paragraphs (limits, language, zone, data, the button's verb), which
// src/agent/prompt.ts writes. JSON field names, the key words of "relevans" and the ```json fence are what the app
// parses the answer by, so they are the same in both languages.

import { sprogNu } from '../../shell/tekster.ts';

const da = {
  /** KC-0242: what the answer parser says when Hermes' JSON does not fit; it goes back to Hermes in the correction run, so the field names stay. */
  fejl: {
    ikkeObjekt: 'Nyheder: svaret er ikke et objekt',
    femLinjer: 'Nyheder: femLinjer mangler',
    ingenBaner: 'Nyheder: ingen baner med nyheder',
    zoneUkendt: (zone: string): string => `Nyheder: ukendt zone: ${zone}`,
    zoneAnden: (zone: string, korsel: string): string => `Nyheder: elementet siger zone ${zone}, men kørslen læste ${korsel}`,
  },
  /** `rum`: the room's name as the nav shows it (shell/tekster.ts `rum`). */
  rolle: (rum: string): string => `Du er Hermes, Henriks agent, og du arbejder inde i rummet "${rum}" i hans kontrolcenter. Hvad Henrik arbejder med, hvem hans familie er, og hvad han følger, ved du fra din egen hukommelse; brug det, du ved om Henrik. Han vil have få, relevante nyheder med en ærlig linje om, hvorfor de betyder noget for ham, ikke en lang liste.`,
  /** Who "points at an element" (agent/prompt.ts pegerTekst / elementSegment). */
  hvem: 'Henrik',

  skema: `\`\`\`json
{
  "femLinjer": ["fem korte linjer: det vigtigste i dag, set fra Henrik", "...", "...", "...", "..."],
  "baner": [
    { "navn": "banens navn, fx AI og agenter", "nyheder": [
      { "titel": "nyhedens titel", "hvorfor": "én linje: hvad nyheden er, kort", "kilde": "kilden fra listen", "url": "url'en fra listen, nøjagtigt som den står",
        "relevans": [ { "for": "mig | familie | arbejde | danmark | holdning | projekter", "note": "én konkret sætning om hvad det betyder for netop det" } ] }
    ] }
  ],
  "forslag": [ { "tekst": "et forslag til Henrik, fx om kilder eller noget du kan gøre", "handling": { "label": "knaptekst", "instruktion": "præcis instruktion til dig selv", "fortryd": "hvis det kan gøres om" } } ],
  "hermesStatus": "3-6 ord om hvad du følger"
}
\`\`\``,

  regler: `Regler:
- Skriv dansk, kort og konkret. Ingen hype.
- 2-4 baner, som du selv navngiver efter det, der faktisk er i listen (fx "AI og agenter", "Modeller og forskning", "Værktøjer", "Energi"). Højst 5 nyheder per bane. Udelad støj (reklame, gentagelser, ting uden substans).
- "relevans" er det vigtigste felt: brug det, du ved om Henrik (hans arbejde, familien, hans projekter, hans holdninger) og skriv 0-3 noter per nyhed, kun hvor det reelt betyder noget. Nøgler: "mig" (ham selv, helbred, vaner), "familie", "arbejde" (hans arbejdsplads og branche), "danmark" (samfund, politik, økonomi i Danmark), "holdning" (rører ved noget, han har en holdning til, sig hvordan), "projekter" (Hermes, kontrolcentret, hans kode). Ingen note = ikke relevant for det. Skriv konkret, aldrig "kan være interessant".
- "url" og "kilde" kopieres uændret fra listen; find aldrig på nyheder, der ikke er i listen.
- "titel" skrives rent: fjern tal, "HN", "RISING", emoji og andet støj fra skrabede titler, og oversæt ikke. Hvis titlen er engelsk, bliver den engelsk.
- "forslag" er valgfri (0-3). Giv kun en "handling", hvis du reelt kan udføre den med dine værktøjer uden at spørge. Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.
- Svar KUN med ét JSON-objekt i en \`\`\`json-blok. Ingen tekst udenom.`,

  /** "Now it is 2026-10-27 at 08.10 (Europe/Copenhagen)." `dato` and `tid` are the app's. */
  tidslinje: (dato: string, tid: string): string => `Nu er det ${dato} kl. ${tid} (Europe/Copenhagen).`,

  /** The task of the refresh run, up to the schema. */
  refreshOpgave: (antal: number, medNyheder: number, kilder: number, fejlede: number): string =>
    `Du får dagens nyheder fra Kiras morgenavis som JSON i beskeden (${antal} nyheder fra ${medNyheder} af ${kilder} kilder${fejlede ? `; ${fejlede} kilder fejlede i dag, de står i beskeden` : ''}). Udvælg og ordn dem. Svar med præcis dette skema:`,
  dagensNyheder: 'Dagens nyheder:',
  fejledeKilder: (liste: string): string => `Kilder der fejlede i dag: ${liste}`,

  /** The task of the fetch run, up to the schema. */
  hentOpgave: 'Der findes ingen morgenavis-data for i dag endnu. Hent dem selv: kør `python3 ~/.agent/scripts/morgenavis_cron.py` med din terminal, læs filen `/tmp/avis_data_<dato>.json`, og ordn nyhederne. Send IKKE noget på Telegram. Svar med præcis dette skema:',
  hentBesked: (rum: string): string => `Hent dagens nyheder med morgenavis_cron.py og byg rummet ${rum}.`,

  handlingRegler: `Regler for handlinger:
- Udfør handlingen med dine værktøjer, inden for det knappen må. Spørg ikke; hvis noget mangler, gør det bedste og sig hvad du antog.
- Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.
- Svar med højst tre korte danske sætninger om, hvad du gjorde. Ingen JSON.`,
  /** The sentence after the verb's task in a handling run. */
  handlingEfter: 'Rummets fem linjer i dag står også i beskeden.',
  knappen: (label: string): string => `Knappen: "${label}"`,
  femLinjerI: 'Rummets fem linjer i dag:',

  /** `peger`: the shared sentence about a pointed-at element (agent/prompt.ts). */
  chatOpgave: (peger: string, vaerktoejer: boolean): string => `Rummets indhold står som afledt data i beskeden. ${peger}${vaerktoejer ? ' Læs artiklen med dine værktøjer, hvis det giver et bedre svar.' : ' Du kan ikke åbne artiklerne: svar ud fra det, der står her.'}

Regler for chatten:
- Svar kort på dansk, som i en samtale.
- Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.`,
  /** KC-0259: the refresh rule that replaces "forslag" when the agent has no tools (a suggestion is a button that runs a tool). */
  ingenForslag: '- Du har ingen værktøjer: giv ingen "forslag", og udelad feltet.',
  rummetsIndhold: 'Rummets indhold:',
  ingenData: 'Rummet har ingen data endnu.',
};

type Tabel = typeof da;

const en: Tabel = {
  fejl: {
    ikkeObjekt: 'News: the answer is not an object',
    femLinjer: 'News: femLinjer is missing',
    ingenBaner: 'News: no lanes with news',
    zoneUkendt: (zone: string): string => `News: unknown zone: ${zone}`,
    zoneAnden: (zone: string, korsel: string): string => `News: the element says zone ${zone}, but the run read ${korsel}`,
  },
  rolle: (rum) => `You are Hermes, the user's agent, and you work inside the room "${rum}" of their control centre. What the user works on, who their family is and what they follow, you know from your own memory; use what you know about the user. They want a few relevant news items, each with an honest line on why it matters to them, not a long list.`,
  hvem: 'The user',

  skema: `\`\`\`json
{
  "femLinjer": ["five short lines: the most important things today, seen from the user's side", "...", "...", "...", "..."],
  "baner": [
    { "navn": "the lane's name, e.g. AI and agents", "nyheder": [
      { "titel": "the news item's title", "hvorfor": "one line: what the news is, briefly", "kilde": "the source from the list", "url": "the url from the list, exactly as it is written",
        "relevans": [ { "for": "mig | familie | arbejde | danmark | holdning | projekter", "note": "one concrete sentence on what it means for exactly that" } ] }
    ] }
  ],
  "forslag": [ { "tekst": "a suggestion to the user, e.g. about sources or something you can do", "handling": { "label": "button text", "instruktion": "exact instruction to yourself", "fortryd": "if it can be undone" } } ],
  "hermesStatus": "3-6 words on what you are following"
}
\`\`\``,

  regler: `Rules:
- Write in English, short and concrete. No hype.
- 2-4 lanes, which you name yourself after what is actually in the list (e.g. "AI and agents", "Models and research", "Tools", "Energy"). At most 5 news items per lane. Leave out noise (ads, repeats, things with no substance).
- "relevans" is the most important field: use what you know about the user (their work, family, projects, views) and write 0-3 notes per news item, only where it really matters. Keys: "mig" (the user themselves, health, habits), "familie" (family), "arbejde" (their workplace and industry), "danmark" (society, politics, economy in Denmark), "holdning" (touches something they hold a view on, say how), "projekter" (Hermes, the control centre, their code). No note = not relevant for that. Write concretely, never "may be interesting".
- "url" and "kilde" are copied unchanged from the list; never invent news that is not in the list.
- "titel" is written clean: remove numbers, "HN", "RISING", emoji and other noise from scraped titles, and do not translate. If the title is in another language, it stays in that language.
- "forslag" is optional (0-3). Give a "handling" only if you can really carry it out with your tools without asking. You must never send mail, unsubscribe from newsletters, buy anything or delete anything.
- Answer ONLY with one JSON object in a \`\`\`json block. No text around it.`,

  tidslinje: (dato, tid) => `It is now ${dato} at ${tid.replace('.', ':')} (Europe/Copenhagen).`,

  refreshOpgave: (antal, medNyheder, kilder, fejlede) =>
    `You get today's news from Kira's morning paper as JSON in the message (${antal} news items from ${medNyheder} of ${kilder} sources${fejlede ? `; ${fejlede} sources failed today, they are listed in the message` : ''}). Pick and order them. Answer with exactly this schema:`,
  dagensNyheder: "Today's news:",
  fejledeKilder: (liste) => `Sources that failed today: ${liste}`,

  hentOpgave: 'There is no morning-paper data for today yet. Fetch it yourself: run `python3 ~/.agent/scripts/morgenavis_cron.py` in your terminal, read the file `/tmp/avis_data_<date>.json`, and order the news. Do NOT send anything on Telegram. Answer with exactly this schema:',
  hentBesked: (rum) => `Fetch today's news with morgenavis_cron.py and build the room ${rum}.`,

  handlingRegler: `Rules for actions:
- Carry out the action with your tools, within what the button may do. Do not ask; if something is missing, do your best and say what you assumed.
- You must never send mail, unsubscribe from newsletters, buy anything or delete anything.
- Answer with at most three short sentences in English about what you did. No JSON.`,
  handlingEfter: "The room's five lines for today are also in the message.",
  knappen: (label) => `The button: "${label}"`,
  femLinjerI: "The room's five lines today:",

  chatOpgave: (peger, vaerktoejer) => `The room's content is in the message as derived data. ${peger}${vaerktoejer ? ' Read the article with your tools if that gives a better answer.' : ' You cannot open the articles: answer from what is written here.'}

Rules for the chat:
- Answer briefly in English, as in a conversation.
- You must never send mail, unsubscribe from newsletters, buy anything or delete anything.`,
  ingenForslag: '- You have no tools: give no "forslag", and leave the field out.',
  rummetsIndhold: "The room's content:",
  ingenData: 'The room has no data yet.',
};

export const NYHEDER_PROMPT: { da: Tabel; en: Tabel } = { da, en };

/** The room's prompt words in the language of the run being built. */
export const nyhederPrompt = (): Tabel => NYHEDER_PROMPT[sprogNu()];
