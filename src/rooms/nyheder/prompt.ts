// What we ask Hermes in the room Nyheder. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import { copenhagenDate, copenhagenTime } from '../dagen/source.ts';
import { KORSEL } from './schema.ts';
import type { NyhederState } from './schema.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, pegerTekst } from '../../agent/prompt.ts';
import type { TrimmedNyheder } from './source.ts';
import { tekst } from '../../shell/tekster.ts';
import { nyhederPrompt } from './prompt-tekster.ts';

// KC-0241: the words are in prompt-tekster.ts, Danish and English, read at call time; the room's name is the nav's.
const rum = (): string => tekst().rum['nyheder']!;
const rolle = (): string => nyhederPrompt().rolle(rum());

function tidslinje(now: Date): string {
  return nyhederPrompt().tidslinje(copenhagenDate(now), copenhagenTime(now.toISOString()));
}

/**
 * KC-0259: the schema and rules for an agent without tools: "forslag" is a button that runs one of the agent's tools,
 * so the field and its rule are left out and replaced by one line that says so (field names are the same in both languages).
 */
function skemaOgRegler(vaerktoejer: boolean): { skema: string; regler: string } {
  const T = nyhederPrompt();
  if (vaerktoejer) return { skema: T.skema, regler: T.regler };
  const linjer = T.regler.split('\n').filter((l) => !l.startsWith('- "forslag"'));
  linjer.splice(linjer.length - 1, 0, T.ingenForslag); // before the closing "answer only with one JSON object" rule
  return { skema: T.skema.split('\n').filter((l) => !/^\s*"forslag":/.test(l)).join('\n'), regler: linjer.join('\n') };
}

export function buildNyhederRefreshRun(data: TrimmedNyheder, now: Date, o: { vaerktoejer?: boolean } = {}): RunSpec {
  const T = nyhederPrompt();
  const { skema, regler } = skemaOgRegler(o.vaerktoejer !== false);
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.refreshOpgave(data.nyheder.length, data.kilder.medNyheder, data.kilder.antal, data.kilder.fejlede.length)}\n\n${skema}\n\n${regler}`,
      data: [{ kilde: 'morgenavis', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\n${T.dagensNyheder}\n\`\`\`json\n${JSON.stringify(data.nyheder, null, 1)}\n\`\`\`${data.kilder.fejlede.length ? `\n\n${T.fejledeKilder(data.kilder.fejlede.join(', '))}` : ''}` }],
    }),
  };
}

export function buildNyhederHentRun(now: Date): RunSpec {
  const T = nyhederPrompt();
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.hentOpgave}\n\n${T.skema}\n\n${T.regler}`,
      data: [{ kilde: 'hent', zone: KORSEL, tillid: 'betroet', tekst: `${tidslinje(now)}\n\n${T.hentBesked(rum())}` }],
    }),
  };
}

/** `verb`: the handling's verb as the policy layer ran it (KC-0122). The label and the five lines are Hermes' text: afledt. */
export function buildNyhederHandlingRun(label: string, instruktion: string, state: NyhederState, verb: string): RunSpec {
  const T = nyhederPrompt();
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${handlingsOpgave(verb)} ${T.handlingEfter}\n\n${T.handlingRegler}`,
      data: [
        { kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: instruktion },
        { kilde: 'rum-state', zone: KORSEL, tillid: 'afledt', tekst: `${T.knappen(label)}\n\n${T.femLinjerI}\n${state.femLinjer.map((l) => `- ${l}`).join('\n')}` },
      ],
    }),
  };
}

export function buildNyhederFortrydRun(fortryd: string): RunSpec {
  const T = nyhederPrompt();
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${fortrydOpgave()}\n\n${T.handlingRegler}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }],
    }),
  };
}

export function buildNyhederChatRun(besked: string, kontekst: string | undefined, state: NyhederState | null, o: { vaerktoejer?: boolean } = {}): RunSpec {
  const T = nyhederPrompt();
  const indhold = state ? `${T.rummetsIndhold}\n\`\`\`json\n${JSON.stringify({ femLinjer: state.femLinjer, baner: state.baner.map((b) => ({ navn: b.navn, nyheder: b.nyheder.map((n) => ({ titel: n.titel, kilde: n.kilde, url: n.url })) })), kilder: state.kilder }, null, 1)}\n\`\`\`` : T.ingenData;
  return {
    ...byggPrompt({
      rum: 'nyheder',
      zone: KORSEL,
      opgave: `${rolle()}\n\n${T.chatOpgave(pegerTekst(T.hvem), o.vaerktoejer !== false)}`,
      data: [{ kilde: 'rum-state', zone: KORSEL, tillid: 'afledt', tekst: indhold }, ...elementSegment(kontekst, KORSEL, T.hvem), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}
