// The prompt builder (KC-0118, spec D4): on our side of the agent seam. Every
// instruction sent to any agent is built here, in fixed sections in a fixed
// order — limits, block catalog, language, zone, the room's task — so swapping
// the agent changes no prompt text. Rooms keep only their own task and data.
// The limits are written once (spec D5: the SOUL repeats them, the policy layer
// KC-0122 enforces them). Every data segment carries a trust tag; all but
// `betroet` are wrapped with one random boundary per run (KC-0123, udtroet.ts).

import type { DataZone } from '../identitet/zoner.ts';
import { katalogTekst } from '../shell/katalog.ts';
import { erTillid, nyGraense, omslutUtroet, type DataSegment } from './udtroet.ts';
import { erVerb } from '../graenser/verber.ts';
import { PROMPT_TEKSTER, promptTekst } from './prompt-tekster.ts';

export type PromptOpts = {
  /** The room (or job) the run belongs to, e.g. "mail", "hjem", "kurator". */
  rum: string;
  /** The one zone this run reads (KC-0117). */
  zone: DataZone;
  /** The room's task: its role, rules and answer schema. */
  opgave: string;
  /** Include the block catalog (the "visuel" field) — rooms whose answer carries a visual. */
  katalog?: boolean;
  /** KC-0142: the rules Henrik approved (tillid/prompt.ts reglerTilPrompt) — his own text, after the zone line. */
  regler?: string;
  data: DataSegment[];
  /** The run's boundary (tests); default a fresh random one. */
  graense?: string;
};

// KC-0241: the words are in prompt-tekster.ts, read at call time in the language of the run. The constants are the Danish
// ones (tests and the rooms that still interpolate them); the builders below use the call-time forms.
export const GRAENSER = PROMPT_TEKSTER.da.graenser;
export const SPROG = PROMPT_TEKSTER.da.sprog;
/** The limits, in the language of the run. */
export const graenser = (): string => promptTekst().graenser;
/** The language line, in the language of the run. */
export const sprogLinje = (): string => promptTekst().sprog;

const zoneLinje = (zone: DataZone): string => promptTekst().zone(zone);

/** KC-0123: how the agent tells data from the task — only lines with this run's boundary delimit data. */
const dataLinje = (g: string): string => promptTekst().data(g);

/**
 * The input from tagged segments: betroet verbatim, the rest wrapped with one boundary. `linje` is the instructions
 * line naming that boundary (null when nothing is wrapped). byggPrompt and the answer-correction run (runs.ts) use it.
 */
export function omslutData(data: DataSegment[], graense?: string): { input: string; linje: string | null } {
  for (const d of data) if (!erTillid((d as { tillid?: unknown }).tillid)) throw new Error(`data-segment uden gyldig tillid: ${String(d.kilde)}`);
  const g = graense ?? nyGraense();
  return {
    input: data.map((d) => (d.tillid === 'betroet' ? d.tekst : omslutUtroet(d, { graense: g }))).join('\n\n'),
    linje: data.some((d) => d.tillid !== 'betroet') ? dataLinje(g) : null,
  };
}

export function byggPrompt(o: PromptOpts): { instructions: string; input: string } {
  const { input, linje } = omslutData(o.data, o.graense);
  const dele = [graenser(), o.katalog ? katalogTekst() : null, sprogLinje(), zoneLinje(o.zone), linje, o.regler ?? null, o.opgave];
  return { instructions: dele.filter((d): d is string => d !== null).join('\n\n'), input };
}

/** KC-0123: the chat's "Om: …" is an element's name, built from state Hermes wrote — so it is an afledt segment, never task text. */
export const elementSegment = (kontekst: string | undefined, zone: DataZone, hvem = 'Henrik'): DataSegment[] =>
  (kontekst ? [{ kilde: 'element', zone, tillid: 'afledt', tekst: promptTekst().elementSegment(hvem, kontekst) }] : []);

/** The task text that goes with elementSegment; `hvem` is "Brugeren" where the room speaks of the user (Start). */
export const pegerTekst = (hvem = 'Henrik'): string => promptTekst().peger(hvem);
export const PEGER = PROMPT_TEKSTER.da.peger('Henrik');
/** PEGER in the language of the run. */
export const peger = (): string => pegerTekst();

/** The task sentence of a handling's run: the app's fixed text for its verb. The handling's own text goes in as an `afledt` segment. */
export function handlingsOpgave(verb: string): string {
  const T = promptTekst();
  const v = erVerb(verb) ? (T.verb[verb] ?? '') : '';
  if (!v) return T.handlingForbudt(erVerb(verb) ? verb : T.ukendtVerb);
  return T.handling(v, T.afledt);
}

/** The task sentence of a Fortryd run; what to undo goes in as an `afledt` segment. */
export function fortrydOpgave(): string {
  return promptTekst().fortryd;
}

/** KC-0127: Start's live test of a model — one tiny run, no tools, one word back. The fake recognises it by these instructions. */
export const MODEL_TEST = {
  instructions: 'Dette er en forbindelsestest fra Clawco. Brug ingen værktøjer. Svar med præcis ét ord: klar',
  input: 'Svar med ordet klar.',
} as const;
