// What we ask Hermes in the room Skrive. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import { KORSEL } from './schema.ts';
import type { Dokument } from './schema.ts';
import { byggPrompt, elementSegment, PEGER } from '../../agent/prompt.ts';

const ROLLE = `Du er Hermes, Henriks agent, og du skriver sammen med ham i rummet "Skrive" i hans kontrolcenter. Henrik skriver dansk, jordnær tone, korte sætninger, ingen hype og ingen floskler. Du skriver i hans stemme, ikke din.`;

const DOK_SKEMA = `\`\`\`json
{
  "titel": "kort titel",
  "afsnit": ["første afsnit som ren tekst", "andet afsnit", "..."],
  "kilder": ["hvor et tal eller en påstand kommer fra, hvis du brugte noget konkret; ellers tom liste"]
}
\`\`\``;

const FORSLAG_SKEMA = `\`\`\`json
{
  "forslag": [
    { "afsnitId": "a2", "ny": "den nye tekst til hele afsnittet", "hvorfor": "én linje om hvad der blev bedre" },
    { "afsnitId": null, "efterId": "a3", "ny": "et nyt afsnit, der indsættes efter a3", "hvorfor": "..." }
  ]
}
\`\`\``;

function nummereret(dok: Dokument): string {
  return dok.afsnit.map((a) => `[${a.id}] ${a.tekst}`).join('\n\n');
}

const TYPER: Record<string, string> = {
  stram: 'Stram op: fjern fyld og gentagelser, kortere sætninger, samme indhold.',
  konkret: 'Gør mere konkret: erstat vage ord med tal, navne, datoer og eksempler; hvis du mangler fakta, skriv [SÆT IND: ...] i stedet for at opfinde.',
  kortere: 'Gør kortere: halver længden og behold det vigtigste.',
  varmere: 'Gør tonen varmere og mere personlig uden at blive højtidelig.',
};

export function beskrivType(type: string): string {
  return TYPER[type] ?? type;
}

export function buildNytRun(titel: string, brief: string): RunSpec {
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nHenrik vil have et første udkast. Skriv det som rene tekstafsnit (ingen overskrifter, ingen punktopstillinger, ingen markdown) i den længde, briefen lægger op til; er der ingen længde nævnt, så 3-6 afsnit. Brug dine værktøjer, hvis briefen peger på noget konkret (en mail, et dokument, et tal) du kan slå op. Svar KUN med ét JSON-objekt i en \`\`\`json-blok efter dette skema:\n\n${DOK_SKEMA}`,
      data: [{ kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: `Titel: ${titel || '(find selv en)'}\n\nBrief: ${brief}` }],
    }),
  };
}

/** KC-0123: the draft is Hermes' text (and may quote mails or notes it looked up) — an afledt segment, never task text. */
const udkastSegment = (dok: Dokument | null) => ({
  kilde: 'udkast', zone: KORSEL, tillid: 'afledt' as const,
  tekst: dok ? `Udkastet "${dok.titel}" (brief: ${dok.brief}), med afsnit-id'er i klammer:\n\n${nummereret(dok)}` : 'Der er intet aktivt udkast.',
});

export function buildForslagRun(dok: Dokument, afsnitId: string | null, type: string): RunSpec {
  const hvad = afsnitId ? `Afsnit ${afsnitId}` : 'Hele teksten';
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nUdkastet står som afledt data i beskeden, med afsnit-id'er i klammer; Henriks ønske står til sidst.\n\nRegler:\n- Giv højst 3 forslag. Hvert forslag erstatter ét helt afsnit (afsnitId) eller indsætter et nyt afsnit (afsnitId null + efterId).\n- Rør kun det, Henrik beder om. Beder han om ét afsnit, så kun det afsnit (evt. ét nyt afsnit lige efter, hvis det er nødvendigt).\n- Behold Henriks stemme og fakta. Opfind ikke tal.\n- Svar KUN med ét JSON-objekt i en \`\`\`json-blok efter dette skema:\n\n${FORSLAG_SKEMA}`,
      data: [udkastSegment(dok), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: `${hvad}: ${beskrivType(type)}${afsnitId ? ` (afsnitId: ${afsnitId})` : ' (hele teksten)'}` }],
    }),
  };
}

export function buildSkriveChatRun(besked: string, kontekst: string | undefined, dok: Dokument | null): RunSpec {
  return {
    ...byggPrompt({
      rum: 'skrive',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nDet aktive udkast står som afledt data i beskeden, med afsnit-id'er i klammer. ${PEGER}\n\nRegler for chatten:\n- Svar kort på dansk, som i en samtale.\n- Hvis Henrik beder om en ændring i teksten, så svar med én linje og tilføj til sidst én \`\`\`json-blok efter dette skema (højst 3 forslag, kun det han beder om):\n\n${FORSLAG_SKEMA}\n\n- Ret aldrig teksten selv; Henrik bruger eller afviser forslagene.`,
      data: [udkastSegment(dok), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
