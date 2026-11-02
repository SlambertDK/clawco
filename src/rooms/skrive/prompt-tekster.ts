// KC-0241: the words the room Skrive writes into what it asks Hermes, Danish and English (see
// nyheder/prompt-tekster.ts for the rules: read at call time, same keys and shapes, Danish byte for byte,
// "the user" in English). The ids (afsnitId, efterId), the JSON field names and the fence are what the app parses the
// answer by and stay the same.

import { sprogNu } from '../../shell/tekster.ts';

const da = {
  rolle: (rum: string): string => `Du er Hermes, Henriks agent, og du skriver sammen med ham i rummet "${rum}" i hans kontrolcenter. Henrik skriver dansk, jordnær tone, korte sætninger, ingen hype og ingen floskler. Du skriver i hans stemme, ikke din.`,
  /** Who "points at an element" (agent/prompt.ts pegerTekst / elementSegment). */
  hvem: 'Henrik',

  dokSkema: `\`\`\`json
{
  "titel": "kort titel",
  "afsnit": ["første afsnit som ren tekst", "andet afsnit", "..."],
  "kilder": ["hvor et tal eller en påstand kommer fra, hvis du brugte noget konkret; ellers tom liste"]
}
\`\`\``,

  forslagSkema: `\`\`\`json
{
  "forslag": [
    { "afsnitId": "a2", "ny": "den nye tekst til hele afsnittet", "hvorfor": "én linje om hvad der blev bedre" },
    { "afsnitId": null, "efterId": "a3", "ny": "et nyt afsnit, der indsættes efter a3", "hvorfor": "..." }
  ]
}
\`\`\``,

  /** What each kind of change asks for; a type that is not here is passed on as it is (beskrivType). */
  typer: {
    stram: 'Stram op: fjern fyld og gentagelser, kortere sætninger, samme indhold.',
    konkret: 'Gør mere konkret: erstat vage ord med tal, navne, datoer og eksempler; hvis du mangler fakta, skriv [SÆT IND: ...] i stedet for at opfinde.',
    kortere: 'Gør kortere: halver længden og behold det vigtigste.',
    varmere: 'Gør tonen varmere og mere personlig uden at blive højtidelig.',
  } as Record<string, string>,

  /** The new-draft task, up to the schema. */
  nytOpgave: 'Henrik vil have et første udkast. Skriv det som rene tekstafsnit (ingen overskrifter, ingen punktopstillinger, ingen markdown) i den længde, briefen lægger op til; er der ingen længde nævnt, så 3-6 afsnit. Brug dine værktøjer, hvis briefen peger på noget konkret (en mail, et dokument, et tal) du kan slå op. Svar KUN med ét JSON-objekt i en ```json-blok efter dette skema:',
  /** The message of the new-draft run: the title (or a note to find one) and the brief. */
  nytBesked: (titel: string, brief: string): string => `Titel: ${titel || '(find selv en)'}\n\nBrief: ${brief}`,

  /** The suggestions task, up to the schema. */
  forslagOpgave: `Udkastet står som afledt data i beskeden, med afsnit-id'er i klammer; Henriks ønske står til sidst.

Regler:
- Giv højst 3 forslag. Hvert forslag erstatter ét helt afsnit (afsnitId) eller indsætter et nyt afsnit (afsnitId null + efterId).
- Rør kun det, Henrik beder om. Beder han om ét afsnit, så kun det afsnit (evt. ét nyt afsnit lige efter, hvis det er nødvendigt).
- Behold Henriks stemme og fakta. Opfind ikke tal.
- Svar KUN med ét JSON-objekt i en \`\`\`json-blok efter dette skema:`,
  /** The user's request in the suggestions run: which part, and what is asked. */
  forslagBesked: (afsnitId: string | null, hvad: string): string => `${afsnitId ? `Afsnit ${afsnitId}` : 'Hele teksten'}: ${hvad}${afsnitId ? ` (afsnitId: ${afsnitId})` : ' (hele teksten)'}`,

  /** The chat task; `peger` is the shared sentence about a pointed-at element, `skema` the suggestions schema. */
  chatOpgave: (peger: string, skema: string): string => `Det aktive udkast står som afledt data i beskeden, med afsnit-id'er i klammer. ${peger}

Regler for chatten:
- Svar kort på dansk, som i en samtale.
- Hvis Henrik beder om en ændring i teksten, så svar med én linje og tilføj til sidst én \`\`\`json-blok efter dette skema (højst 3 forslag, kun det han beder om):

${skema}

- Ret aldrig teksten selv; Henrik bruger eller afviser forslagene.`,

  /** The draft as a data segment: its heading line, and the line when there is none. */
  udkast: (titel: string, brief: string): string => `Udkastet "${titel}" (brief: ${brief}), med afsnit-id'er i klammer:`,
  intetUdkast: 'Der er intet aktivt udkast.',
};

type Tabel = typeof da;

const en: Tabel = {
  rolle: (rum) => `You are Hermes, the user's agent, and you write together with them in the room "${rum}" of their control centre. The user writes in English, in a down-to-earth tone, short sentences, no hype and no clichés. You write in their voice, not yours.`,
  hvem: 'The user',

  dokSkema: `\`\`\`json
{
  "titel": "short title",
  "afsnit": ["first paragraph as plain text", "second paragraph", "..."],
  "kilder": ["where a number or a claim comes from, if you used something concrete; otherwise an empty list"]
}
\`\`\``,

  forslagSkema: `\`\`\`json
{
  "forslag": [
    { "afsnitId": "a2", "ny": "the new text for the whole paragraph", "hvorfor": "one line on what got better" },
    { "afsnitId": null, "efterId": "a3", "ny": "a new paragraph, inserted after a3", "hvorfor": "..." }
  ]
}
\`\`\``,

  typer: {
    stram: 'Tighten up: remove filler and repetition, shorter sentences, same content.',
    konkret: 'Make it more concrete: replace vague words with numbers, names, dates and examples; if you lack facts, write [INSERT: ...] instead of inventing.',
    kortere: 'Make it shorter: halve the length and keep what matters most.',
    varmere: 'Make the tone warmer and more personal without getting solemn.',
  },

  nytOpgave: 'The user wants a first draft. Write it as plain paragraphs of text (no headings, no bullet points, no markdown) at the length the brief suggests; if no length is mentioned, 3-6 paragraphs. Use your tools if the brief points at something concrete (a mail, a document, a number) you can look up. Answer ONLY with one JSON object in a ```json block following this schema:',
  nytBesked: (titel, brief) => `Title: ${titel || '(pick one yourself)'}\n\nBrief: ${brief}`,

  forslagOpgave: `The draft is in the message as derived data, with paragraph ids in brackets; the user's request is at the end.

Rules:
- Give at most 3 suggestions. Each suggestion replaces one whole paragraph (afsnitId) or inserts a new paragraph (afsnitId null + efterId).
- Touch only what the user asks for. If they ask for one paragraph, then only that paragraph (at most one new paragraph right after it, if necessary).
- Keep the user's voice and the facts. Do not invent numbers.
- Answer ONLY with one JSON object in a \`\`\`json block following this schema:`,
  forslagBesked: (afsnitId, hvad) => `${afsnitId ? `Paragraph ${afsnitId}` : 'The whole text'}: ${hvad}${afsnitId ? ` (afsnitId: ${afsnitId})` : ' (the whole text)'}`,

  chatOpgave: (peger, skema) => `The active draft is in the message as derived data, with paragraph ids in brackets. ${peger}

Rules for the chat:
- Answer briefly in English, as in a conversation.
- If the user asks for a change in the text, answer with one line and add, at the end, one \`\`\`json block following this schema (at most 3 suggestions, only what they ask for):

${skema}

- Never change the text yourself; the user uses or rejects the suggestions.`,

  udkast: (titel, brief) => `The draft "${titel}" (brief: ${brief}), with paragraph ids in brackets:`,
  intetUdkast: 'There is no active draft.',
};

export const SKRIVE_PROMPT: { da: Tabel; en: Tabel } = { da, en };

/** The room's prompt words in the language of the run being built. */
export const skrivePrompt = (): Tabel => SKRIVE_PROMPT[sprogNu()];
