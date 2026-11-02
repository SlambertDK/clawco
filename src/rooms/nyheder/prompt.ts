// What we ask Hermes in the room Nyheder. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import { copenhagenDate, copenhagenTime } from '../dagen/source.ts';
import { KORSEL } from './schema.ts';
import type { NyhederState } from './schema.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, PEGER } from '../../agent/prompt.ts';
import type { TrimmedNyheder } from './source.ts';

const ROLLE = `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Nyheder" i hans kontrolcenter. Hvad Henrik arbejder med, hvem hans familie er, og hvad han følger, ved du fra din egen hukommelse; brug det, du ved om Henrik. Han vil have få, relevante nyheder med en ærlig linje om, hvorfor de betyder noget for ham, ikke en lang liste.`;

const SKEMA = `\`\`\`json
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
\`\`\``;

const REGLER = `Regler:
- Skriv dansk, kort og konkret. Ingen hype.
- 2-4 baner, som du selv navngiver efter det, der faktisk er i listen (fx "AI og agenter", "Modeller og forskning", "Værktøjer", "Energi"). Højst 5 nyheder per bane. Udelad støj (reklame, gentagelser, ting uden substans).
- "relevans" er det vigtigste felt: brug det, du ved om Henrik (hans arbejde, familien, hans projekter, hans holdninger) og skriv 0-3 noter per nyhed, kun hvor det reelt betyder noget. Nøgler: "mig" (ham selv, helbred, vaner), "familie", "arbejde" (hans arbejdsplads og branche), "danmark" (samfund, politik, økonomi i Danmark), "holdning" (rører ved noget, han har en holdning til, sig hvordan), "projekter" (Hermes, kontrolcentret, hans kode). Ingen note = ikke relevant for det. Skriv konkret, aldrig "kan være interessant".
- "url" og "kilde" kopieres uændret fra listen; find aldrig på nyheder, der ikke er i listen.
- "titel" skrives rent: fjern tal, "HN", "RISING", emoji og andet støj fra skrabede titler, og oversæt ikke. Hvis titlen er engelsk, bliver den engelsk.
- "forslag" er valgfri (0-3). Giv kun en "handling", hvis du reelt kan udføre den med dine værktøjer uden at spørge. Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.
- Svar KUN med ét JSON-objekt i en \`\`\`json-blok. Ingen tekst udenom.`;

function tidslinje(now: Date): string {
  return `Nu er det ${copenhagenDate(now)} kl. ${copenhagenTime(now.toISOString())} (Europe/Copenhagen).`;
}

export function buildNyhederRefreshRun(data: TrimmedNyheder, now: Date): RunSpec {
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nDu får dagens nyheder fra Kiras morgenavis som JSON i beskeden (${data.nyheder.length} nyheder fra ${data.kilder.medNyheder} af ${data.kilder.antal} kilder${data.kilder.fejlede.length ? `; ${data.kilder.fejlede.length} kilder fejlede i dag, de står i beskeden` : ''}). Udvælg og ordn dem. Svar med præcis dette skema:\n\n${SKEMA}\n\n${REGLER}`,
      data: [{ kilde: 'morgenavis', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\nDagens nyheder:\n\`\`\`json\n${JSON.stringify(data.nyheder, null, 1)}\n\`\`\`${data.kilder.fejlede.length ? `\n\nKilder der fejlede i dag: ${data.kilder.fejlede.join(', ')}` : ''}` }],
    }),
  };
}

export function buildNyhederHentRun(now: Date): RunSpec {
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nDer findes ingen morgenavis-data for i dag endnu. Hent dem selv: kør \`python3 ~/.agent/scripts/morgenavis_cron.py\` med din terminal, læs filen \`/tmp/avis_data_<dato>.json\`, og ordn nyhederne. Send IKKE noget på Telegram. Svar med præcis dette skema:\n\n${SKEMA}\n\n${REGLER}`,
      data: [{ kilde: 'hent', zone: KORSEL, tillid: 'betroet', tekst: `${tidslinje(now)}\n\nHent dagens nyheder med morgenavis_cron.py og byg rummet Nyheder.` }],
    }),
  };
}

const HANDLING_REGLER = `Regler for handlinger:
- Udfør handlingen med dine værktøjer, inden for det knappen må. Spørg ikke; hvis noget mangler, gør det bedste og sig hvad du antog.
- Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.
- Svar med højst tre korte danske sætninger om, hvad du gjorde. Ingen JSON.`;

/** `verb`: the handling's verb as the policy layer ran it (KC-0122). The label and the five lines are Hermes' text: afledt. */
export function buildNyhederHandlingRun(label: string, instruktion: string, state: NyhederState, verb: string): RunSpec {
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${handlingsOpgave(verb)} Rummets fem linjer i dag står også i beskeden.\n\n${HANDLING_REGLER}`,
      data: [
        { kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: instruktion },
        { kilde: 'rum-state', zone: KORSEL, tillid: 'afledt', tekst: `Knappen: "${label}"\n\nRummets fem linjer i dag:\n${state.femLinjer.map((l) => `- ${l}`).join('\n')}` },
      ],
    }),
  };
}

export function buildNyhederFortrydRun(fortryd: string): RunSpec {
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${fortrydOpgave()}\n\n${HANDLING_REGLER}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }],
    }),
  };
}

export function buildNyhederChatRun(besked: string, kontekst: string | undefined, state: NyhederState | null): RunSpec {
  const indhold = state ? `Rummets indhold:\n\`\`\`json\n${JSON.stringify({ femLinjer: state.femLinjer, baner: state.baner.map((b) => ({ navn: b.navn, nyheder: b.nyheder.map((n) => ({ titel: n.titel, kilde: n.kilde, url: n.url })) })), kilder: state.kilder }, null, 1)}\n\`\`\`` : 'Rummet har ingen data endnu.';
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nRummets indhold står som afledt data i beskeden. ${PEGER} Læs artiklen med dine værktøjer, hvis det giver et bedre svar.\n\nRegler for chatten:\n- Svar kort på dansk, som i en samtale.\n- Du må aldrig sende mail, afmelde nyhedsbreve, købe noget eller slette noget.`,
      data: [{ kilde: 'rum-state', zone: KORSEL, tillid: 'afledt', tekst: indhold }, ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
