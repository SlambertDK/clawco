// What we ask Hermes, for each kind of run in the room Dagen. Pure functions:
// data in, { input, instructions } out. Hermes' answer is validated by schema.ts.

import { handlingensVerb, KORSEL } from './schema.ts';
import type { DagenState, Handling } from './schema.ts';
import type { TrimmedAvis } from './source.ts';
import { copenhagenDate, copenhagenTime } from './source.ts';
import type { TrimmedUge } from './uge.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, PEGER } from '../../agent/prompt.ts';

/** What a room's prompt functions return: the built { instructions, input } (src/agent/prompt.ts). */
export type RunSpec = ReturnType<typeof byggPrompt>;

const SKEMA = `\`\`\`json
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
\`\`\``;

const REGLER = `Regler:
- Skriv dansk, kort og konkret. Klokkeslæt som HH.MM. Ingen hype, ingen moral.
- "treLinjer" er højst tre linjer: det vigtigste møde eller den vigtigste opgave, hvad der er ændret eller ledigt, og hvad der er praktisk (vejr, transport, frister).
- Præcis én "anbefaling": den ene ting, der ændrer dagen mest. Giv den en "handling" kun hvis du selv kan udføre den (f.eks. oprette en kalenderblok, samle materiale, lave et udkast). "instruktion" skal være så præcis, at du kan udføre den uden at spørge. Skriv "fortryd" når handlingen kan gøres om.
- "kalender": kun dagens tidsatte aftaler, i rækkefølge. Heldagsting nævnes kun i treLinjer, hvis de betyder noget.
- "morgenavis": 4-6 nyheder, de mest relevante for Henrik ud fra det, du ved om hans arbejde, interesser og lokalområde. "hvorfor" kobler til hans dag eller projekter.
- "ugen": de næste dage fra kalenderdata (i dag udeladt). Én post per dag, der har aftaler eller betyder noget; "note" er det vigtige: hvad planerne betyder for Henrik og familien (hvem er hvor, hvad skal forberedes, hvor er der kollisioner eller fri tid). Brug det, du ved om familien. Kopiér aftalerne fra data, uden at opfinde.
- Du må aldrig betale, sende mail til andre mennesker eller slette data fra en handling. Sådanne handlinger må ikke foreslås.
- Sæt "tilAndre": true på en handling, når det, den laver, er til andre mennesker (fx et udkast til en dagsorden, et svar eller en invitation). Du laver kun udkastet; Henrik sender selv. Knappen bliver rød. Ellers udelad feltet.
- "visuel" er billedet af dagen (KC-0060): en "dagslinje" med regn og sol fra vejret som zoner og dagens vigtigste aftaler som punkter (højst 6, ét ord hver); klokken nu tegner appen selv. Giv anbefalingen og hver aftale et "ikon".
- Svar KUN med ét JSON-objekt i en \`\`\`json-blok. Ingen tekst udenom.`;

const ROLLE = `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Dagen" i hans kontrolcenter. Rummet viser dagen i tre linjer, én anbefaling, kalenderen og morgenavisen.`;

function tidslinje(now: Date): string {
  return `Nu er det ${copenhagenDate(now)} kl. ${copenhagenTime(now.toISOString())} (Europe/Copenhagen).`;
}

/** Build the room from the data Kira's pipeline already fetched. */
export function buildRefreshRun(data: TrimmedAvis, now: Date, uge?: TrimmedUge | null): RunSpec {
  const ugeTekst = uge ? `\n\nUgen frem (Google Kalender, alle kalendere inkl. familiens):\n\`\`\`json\n${JSON.stringify(uge.dage, null, 1)}\n\`\`\`${uge.fejl.length ? `\n(kalendere der fejlede: ${uge.fejl.join('; ')})` : ''}` : '\n\n(Ugen frem kunne ikke hentes i dag; udelad "ugen".)';
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      katalog: true,
      opgave: `${ROLLE}\n\nDu får dagens rådata som JSON i beskeden (kalender, forpligtelser, mail-emner, nyheder, helbredsstatus) og ugen frem fra kalenderen. Byg rummets indhold ud fra dem. Svar med præcis dette skema:\n\n${SKEMA}\n\n${REGLER}`,
      data: [{ kilde: 'kalender', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\nDagens rådata:\n\`\`\`json\n${JSON.stringify(data, null, 1)}\n\`\`\`${ugeTekst}` }],
    }),
  };
}

/** No data file yet: ask Hermes to run Kira's pipeline with its terminal tool, then build. */
export function buildHentRun(now: Date): RunSpec {
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      katalog: true,
      opgave: `${ROLLE}\n\nDer findes ingen data for i dag endnu. Hent dem selv: kør \`python3 ~/.agent/scripts/morgenavis_cron.py\` (eller \`morgenavis_fetch.py\` direkte) med din terminal, læs filen \`/tmp/avis_data_<dato>.json\`, og byg så rummets indhold. Send IKKE noget på Telegram. Svar med præcis dette skema:\n\n${SKEMA}\n\n${REGLER}`,
      data: [{ kilde: 'hent', zone: KORSEL, tillid: 'betroet', tekst: `${tidslinje(now)}\n\nHent dagens data med morgenavis_cron.py og byg rummet Dagen.` }],
    }),
  };
}

const HANDLING_REGLER = `Regler for handlinger:
- Udfør handlingen med dine værktøjer, inden for det knappen må. Spørg ikke; hvis noget mangler, gør det bedste og sig hvad du antog.
- Du må aldrig betale, sende mail til andre mennesker eller slette data. Hvis handlingen kræver det, gør du det ikke og siger hvorfor.
- Svar med højst tre korte danske sætninger om, hvad du gjorde. Ingen JSON, ingen overskrifter.`;

/** KC-0123: the room's state is text Hermes wrote from the day's data — an afledt segment, never task text. */
const indholdSegment = (state: DagenState | null, foer = '') => ({
  kilde: 'rum-state', zone: KORSEL, tillid: 'afledt' as const,
  tekst: `${foer}${state ? `Rummets aktuelle indhold:\n\`\`\`json\n${JSON.stringify(state, null, 1)}\n\`\`\`` : 'Rummet har ingen data endnu.'}`,
});

export function buildHandlingRun(h: Handling, state: DagenState): RunSpec {
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${handlingsOpgave(handlingensVerb(h))} Rummets aktuelle indhold står også i beskeden.\n\n${HANDLING_REGLER}`,
      data: [{ kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: h.instruktion }, indholdSegment(state, `Knappen: "${h.label}"\n\n`)],
    }),
  };
}

export function buildFortrydRun(fortryd: string, state: DagenState): RunSpec {
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${fortrydOpgave()} Rummets aktuelle indhold står også i beskeden.\n\n${HANDLING_REGLER}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }, indholdSegment(state)],
    }),
  };
}

export function buildChatRun(besked: string, kontekst: string | undefined, state: DagenState | null): RunSpec {
  return {
    ...byggPrompt({
      rum: 'dagen',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nRummets aktuelle indhold står som afledt data i beskeden. ${PEGER}\n\nRegler for chatten:
- Svar kort på dansk, som i en samtale. Brug dine værktøjer når det giver et bedre svar.
- Hvis svaret bør ændre rummet (en ny linje, en anden anbefaling, en ny note på en aftale), så tilføj til sidst én \`\`\`json-blok med {"opdater": {...}} der kun indeholder de felter af rummets skema, der skal ændres. Ellers ingen JSON.
- Du må aldrig betale, sende mail til andre mennesker eller slette data.`,
      data: [indholdSegment(state), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
